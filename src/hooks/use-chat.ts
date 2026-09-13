/**
 * Unified Chat Hook
 * 
 * Consolidates:
 * - Chat state management (messages, streaming, scroll)
 * - File attachment handling (upload to Pinata)
 * - Audio recording (MediaRecorder + Pinata upload)
 * 
 * Provides O(1) message updates, RAF-batched streaming, and stick-to-bottom scroll.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type {
    Attachment,
    ActivityEvent,
    ActivityState,
    ModelEvent,
    PlanDecision,
    ProposalSnapshot,
} from "@compose-market/sdk";

export type Task = NonNullable<ProposalSnapshot["tasks"]>[number];
import { createActivityState, reduceActivityState, decodeActivityEvent } from "@compose-market/sdk";
import { uploadConversationFile, cleanupConversationFiles } from "@/lib/pinata";
import {
    createObjectUrlPreview,
    revokeObjectUrlPreview,
    revokeObjectUrlSet,
} from "@/lib/performance/object-url";

// =============================================================================
// Types
// =============================================================================

export type MessageType = "text" | "image" | "audio" | "video" | "embedding" | "pdf" | "file";

export interface Plan {
    type: "plan.proposed" | "approval.requested" | "approval.decided" | "plan.feedback_requested";
    proposalId: string;
    version: number;
    state: string;
    decision?: PlanDecision;
    rootRunId?: string;
    runId?: string;
    requestedBy?: string;
    proposal?: ProposalSnapshot;
    tasks?: Task[];
    markdown?: string;
    ts?: number;
    updatedAt?: number;
    approver?: string;
    reason?: string;
    feedback?: string;
    /** Machine failure reason when the plan state is failed. */
    failureReason?: string;
    pending?: boolean;
    error?: string;
}

export interface ConnectorRequest {
    requestId: string;
    slug: string;
    bindingId?: string;
    runId?: string;
    rootRunId?: string;
    userAddress?: string;
    agentWallet?: string;
    actions?: string[];
    reason?: string;
    state: "requested" | "escalated" | "connected" | "discarded";
    ts?: number;
}

export interface Artifact {
    id: string;
    artifactType: "image" | "audio" | "video" | "embedding" | "realtime" | "file" | "artifact" | "delivery";
    url?: string;
    inline?: boolean;
    partial?: boolean;
    embedding?: number[] | number[][];
    mimeType?: string;
    bytes?: number;
    responseId?: string;
    outputIndex?: number;
    status?: string;
    progress?: number;
    jobId?: string;
    sourceTool?: string;
    source?: "agent" | "child";
    runKey?: string;
    raw?: Record<string, unknown>;
    hydrating?: boolean;
    error?: string;
    /** Delivery artifacts (plan final delivery content store). */
    title?: string;
    content?: string;
    summary?: string;
    deliverableId?: string;
    contentHash?: string;
    taskId?: string;
    taskTitle?: string;
    agentWallet?: string;
}

export type MessageBlock =
    | { id: string; type: "text"; text: string }
    | { id: string; type: "reasoning"; text: string }
    | { id: string; type: "plan"; planId: string }
    | { id: string; type: "activity"; nodeId?: string }
    | { id: string; type: "asset"; artifactId: string }
    | { id: string; type: "notice"; tone?: "error" | "info"; text: string };

export interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    type?: MessageType;
    imageUrl?: string;
    audioUrl?: string;
    videoUrl?: string;
    partialImage?: boolean;
    activity?: ActivityState;
    proposal?: Plan;
    connectorRequests?: ConnectorRequest[];
    artifacts?: Artifact[];
    blocks?: MessageBlock[];
}

export interface AttachedFile {
    file: File;
    cid?: string;
    url?: string;
    preview?: string;
    uploading: boolean;
    type: "image" | "audio" | "video" | "pdf" | "file";
}

export interface RealtimeSession {
    responseId: string;
    append: (input: unknown, params?: Record<string, unknown>) => Promise<void>;
    close: () => Promise<void>;
}

interface MicStream {
    context: AudioContext;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    gain: GainNode;
    queue: Promise<void>;
    stopped: boolean;
}

function b64(bytes: Uint8Array): string {
    let text = "";
    const size = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += size) {
        text += String.fromCharCode(...bytes.subarray(offset, offset + size));
    }
    return btoa(text);
}

function wav(samples: Float32Array, sampleRate: number): string {
    const channels = 1;
    const width = 2;
    const buffer = new ArrayBuffer(44 + samples.length * width);
    const view = new DataView(buffer);
    const write = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) {
            view.setUint8(offset + index, value.charCodeAt(index));
        }
    };

    write(0, "RIFF");
    view.setUint32(4, 36 + samples.length * width, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * width, true);
    view.setUint16(32, channels * width, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, samples.length * width, true);

    let offset = 44;
    for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index] || 0));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += width;
    }

    return `data:audio/wav;base64,${b64(new Uint8Array(buffer))}`;
}

export function toAttachment(attached: Pick<AttachedFile, "type" | "url" | "file"> | undefined): Attachment | undefined {
    if (!attached?.url) {
        return undefined;
    }

    return {
        type: attached.type,
        url: attached.url,
        mimeType: attached.file.type || undefined,
        filename: attached.file.name || undefined,
    };
}

type ResponseMessagePart =
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string }
    | { type: "input_audio"; audio_url: string }
    | { type: "input_video"; video_url: string };

export interface ResponseMessage {
    role: "user" | "assistant" | "system";
    content: string | ResponseMessagePart[];
}

export function toMessage(message: Message): ResponseMessage {
    const parts: ResponseMessagePart[] = [];
    if (message.content.trim().length > 0) {
        parts.push({ type: "input_text", text: message.content });
    }
    if (message.imageUrl) parts.push({ type: "input_image", image_url: message.imageUrl });
    if (message.audioUrl) parts.push({ type: "input_audio", audio_url: message.audioUrl });
    if (message.videoUrl) parts.push({ type: "input_video", video_url: message.videoUrl });
    if (parts.length === 0) return { role: message.role, content: "" };
    if (parts.length === 1 && parts[0].type === "input_text") return { role: message.role, content: message.content };
    return { role: message.role, content: parts };
}

export interface UseChatOptions {
    /** Conversation ID for Pinata grouping */
    conversationId?: string;
    /** Called when a full response is received */
    onResponse?: (message: Message) => void;
    /** Called when an error occurs */
    onError?: (error: string) => void;
    /** Max files allowed (default: 1) */
    maxFiles?: number;
}

export type ChatActivityPhase = "idle" | "thinking" | "tool" | "streaming" | "error";

export interface ChatToolActivity {
    id: string;
    toolName: string;
    displayName?: string;
    status: "running" | "completed" | "error";
    summary?: string;
    startedAt: number;
    endedAt?: number;
}

export interface ChatActivityState {
    phase: ChatActivityPhase;
    label: string;
    tools: ChatToolActivity[];
    updatedAt: number;
}

function summarizeActivity(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

export function noticeId(tone: "error" | "info", message: string): string {
    const normalized = message.replace(/\s+/g, " ").trim().toLowerCase() || tone;
    let hash = 5381;
    for (let i = 0; i < normalized.length; i += 1) {
        hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    }
    return `notice:${tone}:${hash >>> 0}`;
}

export interface UseChatReturn {
    // === Messages ===
    messages: Message[];
    /** Latest assistant message's ActivityState (for side-panel Mission Control) */
    latestActivity?: ActivityState;
    /** Latest assistant message's Plan (for side-panel Mission Control) */
    latestPlan?: Plan;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    /** Add a user message, returns the message ID */
    addUserMessage: (content: string, options?: {
        type?: Message["type"];
        imageUrl?: string;
        audioUrl?: string;
        videoUrl?: string;
    }) => string;
    /** Create an assistant placeholder, returns the message ID */
    createAssistantPlaceholder: (type?: Message["type"]) => string;
    /** Update assistant message by ID (O(1) for last message) */
    updateAssistantMessage: (id: string, update: Partial<Message>) => void;
    /** Reduce a real runtime activity event into an assistant message activity tree. */
    applyAssistantActivityEvent: (id: string, event: ActivityEvent) => void;
    /** Append or replace an ordered assistant message block. */
    upsertAssistantBlock: (id: string, block: MessageBlock) => void;
    /** Append text to an ordered assistant text/reasoning block. */
    appendAssistantBlockText: (id: string, blockId: string, type: "text" | "reasoning", delta: string) => void;
    /** Preserve typed model events for callers that want a central hook point. */
    applyAssistantModelEvent: (id: string, event: ModelEvent) => void;
    /** Fold a local/transport failure into the same stream tree used by SSE errors. */
    failAssistant: (id: string, message: string) => void;
    /** Upsert a generated media/artifact reference on an assistant message. */
    upsertAssistantArtifact: (id: string, artifact: Artifact) => void;
    /** Clear all messages */
    clearMessages: () => void;

    // === Streaming ===
    streamedTextRef: React.MutableRefObject<string>;
    currentAssistantIdRef: React.MutableRefObject<string | null>;
    /** Schedule a streaming update (batched to RAF) */
    scheduleStreamUpdate: (content: string) => void;
    /** Flush any pending stream content immediately */
    flushStreamContent: (assistantId?: string, content?: string) => void;
    activityState: ChatActivityState;
    clearActivityState: () => void;
    clearActivityStateUnlessError: () => void;
    setActivityPhase: (phase: ChatActivityPhase, label?: string) => void;
    startToolActivity: (toolName: string, summary?: string, displayName?: string) => void;
    finishToolActivity: (toolName: string, summary?: string, failed?: boolean, displayName?: string) => void;

    // === Scroll ===
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    /** Check if user is near bottom of scroll */
    isNearBottom: () => boolean;

    // === File Attachment ===
    attachedFiles: AttachedFile[];
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    /** Handle file input change event */
    handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    /** Remove a specific file */
    handleRemoveFile: (file: File) => void;
    /** Clear all attached files */
    clearFiles: () => void;
    /** Cleanup uploaded files from Pinata */
    cleanupFiles: () => Promise<void>;
    /** Whether any file is currently uploading */
    isUploading: boolean;
    /** List of uploaded CIDs for cleanup */
    uploadedCids: string[];

    // === Realtime ===
    realtimeActive: boolean;
    setRealtimeSession: (session: RealtimeSession | null) => void;
    closeRealtime: () => Promise<void>;
    stopRealtimeArtifacts: (responseId?: string) => void;

    // === Audio Recording ===
    isRecording: boolean;
    recordingSupported: boolean;
    /** Start recording audio from microphone */
    startRecording: () => Promise<void>;
    /** Stop recording and upload to Pinata */
    stopRecording: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
    const {
        conversationId: providedId,
        onError,
        maxFiles = 1,
    } = options;

    // Stabilize onError with a ref — prevents handleFileSelect/startRecording churn
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    // Stable conversationId - capture on first render only
    const conversationIdRef = useRef(providedId ?? `conv-${Date.now()}`);

    // === Message State ===
    const [messages, setMessages] = useState<Message[]>([]);
    const [activityState, setActivityState] = useState<ChatActivityState>({
        phase: "idle",
        label: "",
        tools: [],
        updatedAt: Date.now(),
    });

    // === File Attachment State ===
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [uploadedCids, setUploadedCids] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachedFilesRef = useRef<AttachedFile[]>([]);
    const previewUrlsRef = useRef<Set<string>>(new Set());

    // === Recording State ===
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSupported, setRecordingSupported] = useState(true);
    const [realtimeActive, setRealtimeActive] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const realtimeRef = useRef<RealtimeSession | null>(null);
    const stoppedRealtimeResponsesRef = useRef<Set<string>>(new Set());
    const micRef = useRef<MicStream | null>(null);

    // === Streaming refs (synchronous flush, no rAF batching) ===
    const streamedTextRef = useRef<string>("");
    const currentAssistantIdRef = useRef<string | null>(null);

    // === Scroll Refs ===
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);

    // Check if recording is supported on mount
    useEffect(() => {
        if (!navigator.mediaDevices?.getUserMedia) {
            setRecordingSupported(false);
        }
    }, []);

    useEffect(() => {
        attachedFilesRef.current = attachedFiles;
    }, [attachedFiles]);

    // ==========================================================================
    // Message Functions
    // ==========================================================================

    const addUserMessage = useCallback((
        content: string,
        msgOptions?: {
            type?: Message["type"];
            imageUrl?: string;
            audioUrl?: string;
            videoUrl?: string;
        }
    ): string => {
        const id = crypto.randomUUID();
        stickToBottomRef.current = true;
        const message: Message = {
            id,
            role: "user",
            content,
            timestamp: Date.now(),
            type: msgOptions?.type || "text",
            imageUrl: msgOptions?.imageUrl,
            audioUrl: msgOptions?.audioUrl,
            videoUrl: msgOptions?.videoUrl,
        };
        setMessages(prev => [...prev, message]);
        return id;
    }, []);

    const createAssistantPlaceholder = useCallback((type?: Message["type"]): string => {
        const id = crypto.randomUUID();
        currentAssistantIdRef.current = id;
        streamedTextRef.current = "";
        stickToBottomRef.current = true;

        setMessages(prev => [...prev, {
            id,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            type: type || "text",
        }]);

        return id;
    }, []);

    const updateAssistantMessage = useCallback((id: string, update: Partial<Message>) => {
        setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];

            // Fast path: updating last message
            if (last?.id === id) {
                next[next.length - 1] = { ...last, ...update };
                return next;
            }

            // Fallback: find by ID
            const idx = next.findIndex(m => m.id === id);
            if (idx >= 0) {
                next[idx] = { ...next[idx], ...update };
            }
            return next;
        });
    }, []);

    const upsertAssistantBlock = useCallback((id: string, block: MessageBlock) => {
        setMessages((prev) => {
            const next = [...prev];
            const merge = (message: Message): Message => {
                const blocks = [...(message.blocks ?? [])];
                const index = blocks.findIndex((item) => item.id === block.id);
                if (index >= 0) blocks[index] = { ...blocks[index], ...block } as MessageBlock;
                else blocks.push(block);
                return { ...message, blocks };
            };
            const last = next[next.length - 1];
            if (last?.id === id) {
                next[next.length - 1] = merge(last);
                return next;
            }
            const idx = next.findIndex((m) => m.id === id);
            if (idx >= 0) next[idx] = merge(next[idx]);
            return next;
        });
    }, []);

    const appendAssistantBlockText = useCallback((id: string, blockId: string, type: "text" | "reasoning", delta: string) => {
        if (!delta) return;
        setMessages((prev) => {
            const next = [...prev];
            const merge = (message: Message): Message => {
                const blocks = [...(message.blocks ?? [])];
                const index = blocks.findIndex((item) => item.id === blockId);
                if (index >= 0) {
                    const current = blocks[index];
                    const text = current.type === "text" || current.type === "reasoning" ? current.text : "";
                    blocks[index] = { id: blockId, type, text: text + delta };
                } else {
                    blocks.push({ id: blockId, type, text: delta });
                }
                return { ...message, blocks };
            };
            const last = next[next.length - 1];
            if (last?.id === id) {
                next[next.length - 1] = merge(last);
                return next;
            }
            const idx = next.findIndex((m) => m.id === id);
            if (idx >= 0) next[idx] = merge(next[idx]);
            return next;
        });
    }, []);

    const applyAssistantActivityEvent = useCallback((id: string, event: ActivityEvent) => {
        setMessages((prev) => {
            const next = [...prev];
            const merge = (message: Message): Message => {
                const visible = visibleActivity(event);
                return {
                    ...message,
                    activity: reduceActivityState(message.activity ?? createActivityState(), event),
                    blocks: visible
                        ? blockup(message.blocks, { id: `activity`, type: "activity" })
                        : message.blocks,
                };
            };
            const last = next[next.length - 1];
            if (last?.id === id) {
                next[next.length - 1] = merge(last);
                return next;
            }
            const idx = next.findIndex((m) => m.id === id);
            if (idx >= 0) next[idx] = merge(next[idx]);
            return next;
        });
    }, []);

    const applyAssistantModelEvent = useCallback((_id: string, _event: ModelEvent) => {
        // Model events are projected by use-stream into ordered text/reasoning/asset blocks.
    }, []);

    const failAssistant = useCallback((id: string, message: string) => {
        setMessages((prev) => {
            const next = [...prev];
            const merge = (current: Message): Message => ({
                ...current,
                blocks: blockup(current.blocks, {
                    id: noticeId("error", message),
                    type: "notice",
                    tone: "error",
                    text: message,
                }),
            });
            const last = next[next.length - 1];
            if (last?.id === id) {
                next[next.length - 1] = merge(last);
                return next;
            }
            const idx = next.findIndex((m) => m.id === id);
            if (idx >= 0) next[idx] = merge(next[idx]);
            return next;
        });
    }, []);

    const upsertAssistantArtifact = useCallback((id: string, artifact: Artifact) => {
        if (
            artifact.artifactType === "audio"
            && artifact.partial === true
            && artifact.responseId
            && stoppedRealtimeResponsesRef.current.has(artifact.responseId)
        ) return;
        setMessages((prev) => {
            const next = [...prev];
            const merge = (message: Message): Message => {
                const artifacts = [...(message.artifacts || [])];
                const key = artifactKey(artifact);
                const idx = artifacts.findIndex((item) => item.id === artifact.id || (key !== undefined && artifactKey(item) === key));
                const blockId = idx >= 0 ? artifacts[idx].id : artifact.id;
                if (idx >= 0) {
                    const patch = Object.fromEntries(
                        Object.entries(artifact).filter(([, value]) => value !== undefined),
                    ) as Partial<Artifact>;
                    artifacts[idx] = { ...artifacts[idx], ...patch, id: artifacts[idx].id };
                } else {
                    artifacts.push(artifact);
                }
                return {
                    ...message,
                    artifacts,
                    blocks: blockup(message.blocks, { id: `asset:${blockId}`, type: "asset", artifactId: blockId }),
                };
            };
            const last = next[next.length - 1];
            if (last?.id === id) {
                next[next.length - 1] = merge(last);
                return next;
            }
            const idx = next.findIndex((m) => m.id === id);
            if (idx >= 0) next[idx] = merge(next[idx]);
            return next;
        });
    }, []);

    function artifactKey(artifact: Artifact): string | undefined {
        const index = artifact.outputIndex ?? rawNumber(artifact.raw, "outputIndex") ?? rawNumber(artifact.raw, "output_index");
        if (artifact.responseId) {
            return `${artifact.artifactType}:${artifact.responseId}:${artifact.jobId ?? index ?? 0}`;
        }
        if (artifact.jobId) {
            return `${artifact.artifactType}:job:${artifact.jobId}`;
        }
        return undefined;
    }

    function rawNumber(raw: Record<string, unknown> | undefined, key: string): number | undefined {
        const value = raw?.[key];
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }

    function blockup(blocks: MessageBlock[] | undefined, block: MessageBlock): MessageBlock[] {
        const next = [...(blocks ?? [])];
        const index = next.findIndex((item) => item.id === block.id);
        if (index >= 0) next[index] = { ...next[index], ...block } as MessageBlock;
        else next.push(block);
        return next;
    }

    function visibleActivity(event: ActivityEvent): boolean {
        if (event.type === "activity.trace" || event.type === "activity.plan") return false;
        if (event.type === "activity.message" && !event.parentId) return false;
        return true;
    }

    const stopMic = useCallback(() => {
        const mic = micRef.current;
        if (!mic) return;
        mic.stopped = true;
        mic.processor.onaudioprocess = null;
        try { mic.processor.disconnect(); } catch { }
        try { mic.source.disconnect(); } catch { }
        try { mic.gain.disconnect(); } catch { }
        mic.stream.getTracks().forEach((track) => track.stop());
        void mic.queue.catch(() => undefined);
        void mic.context.close().catch(() => undefined);
        micRef.current = null;
        mediaStreamRef.current = null;
        setIsRecording(false);
    }, []);

    const stopRealtimeArtifacts = useCallback((responseId?: string) => {
        if (responseId) stoppedRealtimeResponsesRef.current.add(responseId);
        setMessages((prev) => prev.map((message) => {
            let changed = false;
            const artifacts = message.artifacts?.map((artifact) => {
                if (
                    artifact.artifactType !== "audio"
                    || artifact.partial !== true
                    || (responseId && artifact.responseId !== responseId)
                ) return artifact;
                changed = true;
                if (artifact.responseId) stoppedRealtimeResponsesRef.current.add(artifact.responseId);
                return {
                    ...artifact,
                    partial: false,
                    status: "stopped",
                    raw: { ...artifact.raw, status: "stopped" },
                };
            });
            return changed ? { ...message, artifacts } : message;
        }));
        setActivityState((prev) => prev.phase === "error" ? prev : {
            phase: "idle",
            label: "",
            tools: [],
            updatedAt: Date.now(),
        });
    }, []);

    const setRealtimeSession = useCallback((session: RealtimeSession | null) => {
        if (!session) stopMic();
        else stoppedRealtimeResponsesRef.current.delete(session.responseId);
        realtimeRef.current = session;
        setRealtimeActive(Boolean(session));
    }, [stopMic]);

    const closeRealtime = useCallback(async () => {
        const session = realtimeRef.current;
        stopMic();
        stopRealtimeArtifacts(session?.responseId);
        setRealtimeSession(null);
        if (session) {
            await session.close();
        }
    }, [setRealtimeSession, stopMic, stopRealtimeArtifacts]);

    const clearMessages = useCallback(() => {
        void closeRealtime().catch(() => undefined);
        setMessages([]);
        streamedTextRef.current = "";
        currentAssistantIdRef.current = null;
        setActivityState({
            phase: "idle",
            label: "",
            tools: [],
            updatedAt: Date.now(),
        });
    }, [closeRealtime]);

    const clearActivityState = useCallback(() => {
        setActivityState({
            phase: "idle",
            label: "",
            tools: [],
            updatedAt: Date.now(),
        });
    }, []);

    const clearActivityStateUnlessError = useCallback(() => {
        setActivityState((prev) => prev.phase === "error" ? prev : {
            phase: "idle",
            label: "",
            tools: [],
            updatedAt: Date.now(),
        });
    }, []);

    const setActivityPhase = useCallback((phase: ChatActivityPhase, label?: string) => {
        setActivityState((prev) => ({
            ...prev,
            phase,
            label: label ?? prev.label,
            updatedAt: Date.now(),
        }));
    }, []);

    const startToolActivity = useCallback((toolName: string, summary?: string, displayName?: string) => {
        setActivityState((prev) => ({
            phase: "tool",
            label: `Using ${displayName || toolName}`,
            tools: [
                ...prev.tools,
                {
                    id: crypto.randomUUID(),
                    toolName,
                    displayName,
                    status: "running",
                    summary: summarizeActivity(summary),
                    startedAt: Date.now(),
                },
            ],
            updatedAt: Date.now(),
        }));
    }, []);

    const finishToolActivity = useCallback((toolName: string, summary?: string, failed = false, displayName?: string) => {
        setActivityState((prev) => {
            const nextTools = [...prev.tools];
            const index = [...nextTools]
                .reverse()
                .findIndex((item) => item.toolName === toolName && item.status === "running");

            if (index >= 0) {
                const resolvedIndex = nextTools.length - 1 - index;
                nextTools[resolvedIndex] = {
                    ...nextTools[resolvedIndex],
                    status: failed ? "error" : "completed",
                    displayName: displayName || nextTools[resolvedIndex].displayName,
                    summary: summarizeActivity(summary) || nextTools[resolvedIndex].summary,
                    endedAt: Date.now(),
                };
            } else {
                nextTools.push({
                    id: crypto.randomUUID(),
                    toolName,
                    displayName,
                    status: failed ? "error" : "completed",
                    summary: summarizeActivity(summary),
                    startedAt: Date.now(),
                    endedAt: Date.now(),
                });
            }

            return {
                phase: failed ? "error" : "thinking",
                label: failed ? `${displayName || toolName} failed` : `Processed ${displayName || toolName}`,
                tools: nextTools,
                updatedAt: Date.now(),
            };
        });
    }, []);

    // ==========================================================================
    // Streaming Functions (synchronous; per-delta updates render on every tick)
    // ==========================================================================

    const flushStreamContent = useCallback((targetAssistantId?: string, targetContent?: string) => {
        const assistantId = targetAssistantId ?? currentAssistantIdRef.current;
        const content = targetContent ?? streamedTextRef.current;

        if (assistantId && content) {
            updateAssistantMessage(assistantId, { content });
        }
    }, [updateAssistantMessage]);

    const scheduleStreamUpdate = useCallback((content: string) => {
        streamedTextRef.current = content;
        const assistantId = currentAssistantIdRef.current;
        if (assistantId) {
            updateAssistantMessage(assistantId, { content });
        }
    }, [updateAssistantMessage]);

    // ==========================================================================
    // Scroll Functions
    // ==========================================================================

    const isNearBottom = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    }, []);

    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const updateStickiness = () => {
            stickToBottomRef.current = isNearBottom();
        };
        const markUserScroll = () => {
            if (!isNearBottom()) stickToBottomRef.current = false;
        };
        updateStickiness();
        el.addEventListener("wheel", markUserScroll, { passive: true });
        el.addEventListener("touchmove", markUserScroll, { passive: true });
        el.addEventListener("scroll", updateStickiness, { passive: true });
        return () => {
            el.removeEventListener("wheel", markUserScroll);
            el.removeEventListener("touchmove", markUserScroll);
            el.removeEventListener("scroll", updateStickiness);
        };
    }, [isNearBottom]);

    useEffect(() => {
        if (!stickToBottomRef.current) return;
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, [messages]);

    // ==========================================================================
    // File Attachment Functions
    // ==========================================================================

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        const type: AttachedFile["type"] = file.type.startsWith("image/")
            ? "image"
            : file.type.startsWith("video/")
                ? "video"
                : file.type.startsWith("audio/")
                    ? "audio"
                    : file.type === "application/pdf"
                        ? "pdf"
                        : "file";
        let preview: string | undefined;

        try {
            preview = createObjectUrlPreview(file);
            previewUrlsRef.current.add(preview);

            const newFile: AttachedFile = {
                file,
                preview,
                uploading: true,
                type,
            };

            if (maxFiles === 1) {
                revokeObjectUrlSet(attachedFilesRef.current.map((attachedFile) => attachedFile.preview));
                previewUrlsRef.current.clear();
                previewUrlsRef.current.add(preview);
                setAttachedFiles([newFile]);
            } else {
                const currentFiles = attachedFilesRef.current;
                if (currentFiles.length >= maxFiles) {
                    const filesToDrop = currentFiles.slice(0, currentFiles.length - maxFiles + 1);
                    for (const attachedFile of filesToDrop) {
                        revokeObjectUrlPreview(attachedFile.preview);
                        if (attachedFile.preview) {
                            previewUrlsRef.current.delete(attachedFile.preview);
                        }
                    }
                }
                setAttachedFiles(prev =>
                    prev.length >= maxFiles
                        ? [...prev.slice(1), newFile]
                        : [...prev, newFile]
                );
            }

            const { cid, url } = await uploadConversationFile(file, conversationIdRef.current);

            setAttachedFiles(prev =>
                prev.map(f => f.file === file ? { ...f, cid, url, uploading: false } : f)
            );
            setUploadedCids(prev => [...prev, cid]);

        } catch (err) {
            console.error("File upload failed:", err);
            const attachedPreview = attachedFilesRef.current.find((attachedFile) => attachedFile.file === file)?.preview ?? preview;
            revokeObjectUrlPreview(attachedPreview);
            if (attachedPreview) {
                previewUrlsRef.current.delete(attachedPreview);
            }
            setAttachedFiles(prev => prev.filter(f => f.file !== file));
            onErrorRef.current?.("Failed to upload file");
        }

        e.target.value = "";
    }, [maxFiles]);

    const handleRemoveFile = useCallback((file: File) => {
        const attachedFile = attachedFilesRef.current.find((currentFile) => currentFile.file === file);
        revokeObjectUrlPreview(attachedFile?.preview);
        if (attachedFile?.preview) {
            previewUrlsRef.current.delete(attachedFile.preview);
        }
        setAttachedFiles(prev => prev.filter(f => f.file !== file));
    }, []);

    const clearFiles = useCallback(() => {
        revokeObjectUrlSet(attachedFilesRef.current.map((attachedFile) => attachedFile.preview));
        previewUrlsRef.current.clear();
        setAttachedFiles([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, []);

    const cleanupFiles = useCallback(async () => {
        if (uploadedCids.length > 0) {
            await cleanupConversationFiles(uploadedCids);
            setUploadedCids([]);
        }
    }, [uploadedCids]);

    const isUploading = attachedFiles.some(f => f.uploading);

    // ==========================================================================
    // Audio Recording Functions
    // ==========================================================================

    const startMic = useCallback(async (): Promise<boolean> => {
        const session = realtimeRef.current;
        if (!session) return false;
        if (micRef.current) return true;

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
            stream.getTracks().forEach((track) => track.stop());
            onErrorRef.current?.("Live microphone input is not supported in this browser");
            return true;
        }

        const context = new Ctor({ latencyHint: "interactive" });
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(1024, 1, 1);
        const gain = context.createGain();
        gain.gain.value = 0;

        const mic: MicStream = {
            context,
            stream,
            source,
            processor,
            gain,
            queue: Promise.resolve(),
            stopped: false,
        };
        micRef.current = mic;
        mediaStreamRef.current = stream;

        processor.onaudioprocess = (event) => {
            if (mic.stopped) return;
            const input = event.inputBuffer.getChannelData(0);
            const packet = wav(input, context.sampleRate);
            mic.queue = mic.queue
                .then(() => session.append([
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_audio",
                                input_audio: { url: packet },
                            },
                        ],
                    },
                ]))
                .catch((error) => {
                    console.error("[chat] realtime microphone failed:", error);
                    onErrorRef.current?.("Realtime microphone stream failed");
                    stopMic();
                });
        };

        source.connect(processor);
        processor.connect(gain);
        gain.connect(context.destination);
        await context.resume().catch(() => undefined);
        setIsRecording(true);
        setActivityPhase("streaming", "Live microphone");
        return true;
    }, [setActivityPhase, stopMic]);

    const startRecording = useCallback(async () => {
        if (!recordingSupported) {
            onErrorRef.current?.("Audio recording not supported in this browser");
            return;
        }

        try {
            if (await startMic()) return;

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            recorder.onstop = async () => {
                mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
                mediaStreamRef.current = null;

                const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                const audioFile = new File([audioBlob], `recording-${Date.now()}.webm`, { type: "audio/webm" });
                let preview: string | undefined;

                try {
                    preview = createObjectUrlPreview(audioFile);
                    previewUrlsRef.current.add(preview);

                    const attachedFile: AttachedFile = {
                        file: audioFile,
                        preview,
                        uploading: true,
                        type: "audio",
                    };

                    // Add to attached files
                    if (maxFiles === 1) {
                        revokeObjectUrlSet(attachedFilesRef.current.map((currentFile) => currentFile.preview));
                        previewUrlsRef.current.clear();
                        previewUrlsRef.current.add(preview);
                        setAttachedFiles([attachedFile]);
                    } else {
                        const currentFiles = attachedFilesRef.current;
                        if (currentFiles.length >= maxFiles) {
                            const filesToDrop = currentFiles.slice(0, currentFiles.length - maxFiles + 1);
                            for (const currentFile of filesToDrop) {
                                revokeObjectUrlPreview(currentFile.preview);
                                if (currentFile.preview) {
                                    previewUrlsRef.current.delete(currentFile.preview);
                                }
                            }
                        }
                        setAttachedFiles(prev => [...prev, attachedFile]);
                    }

                    // Upload to Pinata
                    const { cid, url } = await uploadConversationFile(audioFile, conversationIdRef.current);

                    setAttachedFiles(prev =>
                        prev.map(f => f.file === audioFile ? { ...f, cid, url, uploading: false } : f)
                    );
                    setUploadedCids(prev => [...prev, cid]);

                } catch (err) {
                    console.error("Recording upload failed:", err);
                    const attachedFile = attachedFilesRef.current.find((currentFile) => currentFile.file === audioFile);
                    const attachedPreview = attachedFile?.preview ?? preview;
                    revokeObjectUrlPreview(attachedPreview);
                    if (attachedPreview) {
                        previewUrlsRef.current.delete(attachedPreview);
                    }
                    setAttachedFiles(prev => prev.filter((currentFile) => currentFile.file !== audioFile));
                    onErrorRef.current?.("Failed to upload recording");
                }
            };

            recorder.start();
            setIsRecording(true);

        } catch (err) {
            console.error("Failed to start recording:", err);
            onErrorRef.current?.("Failed to access microphone. Please check permissions.");
        }
    }, [recordingSupported, maxFiles, startMic]);

    const stopRecording = useCallback(() => {
        if (micRef.current || realtimeRef.current) {
            void closeRealtime().catch((error) => {
                console.error("[chat] realtime close failed:", error);
            });
            return;
        }
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, [closeRealtime, isRecording]);

    // ==========================================================================
    // Cleanup
    // ==========================================================================

    useEffect(() => {
        return () => {
            stopMic();
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            }
            revokeObjectUrlSet(previewUrlsRef.current);
            previewUrlsRef.current.clear();
        };
    }, [stopMic]);

    return useMemo(() => ({
        // Messages
        messages,
        // The plan's children live on the assistant message that proposed
        // it (their parent run IS the proposing run). Bind mission control
        // to that message's tree so later assistant messages (e.g. the
        // completion turn) don't supersede the swarm's work; fall back to
        // the newest tree when no plan owns the panel.
        latestActivity: (() => {
            const planMessage = [...messages].reverse().find((m) => m.role === "assistant" && m.proposal);
            if (planMessage?.activity) return planMessage.activity;
            return [...messages].reverse().find((m) => m.role === "assistant" && m.activity)?.activity;
        })(),
        latestPlan: messages.length > 0
            ? [...messages].reverse().find((m) => m.role === "assistant" && m.proposal)?.proposal
            : undefined,
        setMessages,
        addUserMessage,
        createAssistantPlaceholder,
        updateAssistantMessage,
        applyAssistantActivityEvent,
        applyAssistantModelEvent,
        upsertAssistantBlock,
        appendAssistantBlockText,
        failAssistant,
        upsertAssistantArtifact,
        clearMessages,
        // Streaming
        streamedTextRef,
        currentAssistantIdRef,
        scheduleStreamUpdate,
        flushStreamContent,
        activityState,
        clearActivityState, clearActivityStateUnlessError,
        setActivityPhase,
        startToolActivity,
        finishToolActivity,
        // Scroll
        scrollContainerRef,
        messagesEndRef,
        isNearBottom,
        // Files
        attachedFiles,
        fileInputRef,
        handleFileSelect,
        handleRemoveFile,
        clearFiles,
        cleanupFiles,
        isUploading,
        uploadedCids,
        // Realtime
        realtimeActive,
        setRealtimeSession,
        closeRealtime,
        stopRealtimeArtifacts,
        // Recording
        isRecording,
        recordingSupported,
        startRecording,
        stopRecording,
    }), [
        messages, activityState, attachedFiles, isUploading, uploadedCids, realtimeActive,
        isRecording, recordingSupported,
        addUserMessage, createAssistantPlaceholder, updateAssistantMessage,
        applyAssistantActivityEvent, applyAssistantModelEvent, upsertAssistantBlock, appendAssistantBlockText, failAssistant, upsertAssistantArtifact,
        clearMessages, scheduleStreamUpdate, flushStreamContent,
        clearActivityState, clearActivityStateUnlessError, setActivityPhase, startToolActivity, finishToolActivity,
        isNearBottom, handleFileSelect, handleRemoveFile, clearFiles, cleanupFiles,
        setRealtimeSession, closeRealtime, stopRealtimeArtifacts, startRecording, stopRecording,
    ]);
}
