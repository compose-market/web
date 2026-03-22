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
import { useState, useRef, useCallback, useEffect } from "react";
import { uploadConversationFile, cleanupConversationFiles } from "@/lib/pinata";
import { type ChatMessage, type AttachedFile } from "@/lib/api";
import {
    createObjectUrlPreview,
    revokeObjectUrlPreview,
    revokeObjectUrlSet,
} from "@/lib/performance/object-url";

// Re-export types for convenience
export type { ChatMessage, AttachedFile } from "@/lib/api";

// =============================================================================
// Types
// =============================================================================

export interface UseChatOptions {
    /** Conversation ID for Pinata grouping */
    conversationId?: string;
    /** Called when a full response is received */
    onResponse?: (message: ChatMessage) => void;
    /** Called when an error occurs */
    onError?: (error: string) => void;
    /** Enable 60fps max streaming updates via requestAnimationFrame */
    rafBatching?: boolean;
    /** Max files allowed (default: 1) */
    maxFiles?: number;
}

export interface UseChatReturn {
    // === Messages ===
    messages: ChatMessage[];
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    /** Add a user message, returns the message ID */
    addUserMessage: (content: string, options?: {
        type?: ChatMessage["type"];
        imageUrl?: string;
        audioUrl?: string;
    }) => string;
    /** Create an assistant placeholder, returns the message ID */
    createAssistantPlaceholder: (type?: ChatMessage["type"]) => string;
    /** Update assistant message by ID (O(1) for last message) */
    updateAssistantMessage: (id: string, update: Partial<ChatMessage>) => void;
    /** Parse OpenAI-format JSON response and update assistant message */
    handleJsonResponse: (id: string, data: unknown) => void;
    /** Clear all messages */
    clearMessages: () => void;

    // === Streaming ===
    streamedTextRef: React.MutableRefObject<string>;
    currentAssistantIdRef: React.MutableRefObject<string | null>;
    /** Schedule a streaming update (batched to RAF) */
    scheduleStreamUpdate: (content: string) => void;
    /** Flush any pending stream content immediately */
    flushStreamContent: () => void;

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
        rafBatching = true,
        maxFiles = 1,
    } = options;

    // Stable conversationId - capture on first render only
    const conversationIdRef = useRef(providedId ?? `conv-${Date.now()}`);

    // === Message State ===
    const [messages, setMessages] = useState<ChatMessage[]>([]);

    // === File Attachment State ===
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [uploadedCids, setUploadedCids] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachedFilesRef = useRef<AttachedFile[]>([]);
    const previewUrlsRef = useRef<Set<string>>(new Set());

    // === Recording State ===
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSupported, setRecordingSupported] = useState(true);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const mediaStreamRef = useRef<MediaStream | null>(null);

    // === RAF Batching Refs ===
    const streamedTextRef = useRef<string>("");
    const rafRef = useRef<number | null>(null);
    const currentAssistantIdRef = useRef<string | null>(null);

    // === Scroll Refs ===
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

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
            type?: ChatMessage["type"];
            imageUrl?: string;
            audioUrl?: string;
        }
    ): string => {
        const id = crypto.randomUUID();
        const message: ChatMessage = {
            id,
            role: "user",
            content,
            timestamp: Date.now(),
            type: msgOptions?.type || "text",
            imageUrl: msgOptions?.imageUrl,
            audioUrl: msgOptions?.audioUrl,
        };
        setMessages(prev => [...prev, message]);
        return id;
    }, []);

    const createAssistantPlaceholder = useCallback((type?: ChatMessage["type"]): string => {
        const id = crypto.randomUUID();
        currentAssistantIdRef.current = id;
        streamedTextRef.current = "";

        setMessages(prev => [...prev, {
            id,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            type: type || "text",
        }]);

        return id;
    }, []);

    const updateAssistantMessage = useCallback((id: string, update: Partial<ChatMessage>) => {
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

    const clearMessages = useCallback(() => {
        setMessages([]);
        streamedTextRef.current = "";
        currentAssistantIdRef.current = null;
    }, []);

    // ==========================================================================
    // Streaming Functions
    // ==========================================================================

    const flushStreamContent = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }

        const assistantId = currentAssistantIdRef.current;
        const content = streamedTextRef.current;

        if (assistantId && content) {
            updateAssistantMessage(assistantId, { content });
        }
    }, [updateAssistantMessage]);

    const scheduleStreamUpdate = useCallback((content: string) => {
        streamedTextRef.current = content;

        if (!rafBatching) {
            const assistantId = currentAssistantIdRef.current;
            if (assistantId) {
                updateAssistantMessage(assistantId, { content });
            }
            return;
        }

        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                const assistantId = currentAssistantIdRef.current;
                if (assistantId) {
                    updateAssistantMessage(assistantId, { content: streamedTextRef.current });
                }
            });
        }
    }, [rafBatching, updateAssistantMessage]);

    // ==========================================================================
    // JSON Response Handler (delegates to centralized parseJsonResponse)
    // ==========================================================================

    const handleJsonResponse = useCallback((id: string, data: unknown) => {
        // Import dynamically to avoid circular dependencies
        Promise.all([
            import("@/lib/api"),
            import("@/lib/multimodal"),
        ]).then(async ([{ parseJsonResponse }, { uploadBase64ToPinata }]) => {
            const result = parseJsonResponse(data);

            if (!result.success) {
                updateAssistantMessage(id, { content: `Error: ${result.error || "Unknown error"}` });
                return;
            }

            // Upload base64 to Pinata if present and no URL
            let url = result.url;
            if (!url && result.base64 && (result.type === "image" || result.type === "audio" || result.type === "video")) {
                try {
                    url = await uploadBase64ToPinata(result.base64, result.type, conversationIdRef.current);
                } catch (err) {
                    console.error("[use-chat] Pinata upload failed:", err);
                }
            }

            // Determine content
            // Fix: Only apply fallback if non-text media
            let finalContent = result.content;
            if (!finalContent) {
                if (result.type !== "text") {
                    finalContent = `Generated ${result.type}`;
                } else {
                    finalContent = ""; // Empty string for text (e.g. tool-only)
                }
            }

            updateAssistantMessage(id, {
                content: finalContent,
                type: result.type,
                imageUrl: result.type === "image" ? url : undefined,
                audioUrl: result.type === "audio" ? url : undefined,
                videoUrl: result.type === "video" ? url : undefined,
            });
        });
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
        if (!isNearBottom()) return;
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, [messages, isNearBottom]);

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
                : "audio";
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
            onError?.("Failed to upload file");
        }

        e.target.value = "";
    }, [maxFiles, onError]);

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

    const startRecording = useCallback(async () => {
        if (!recordingSupported) {
            onError?.("Audio recording not supported in this browser");
            return;
        }

        try {
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
                    onError?.("Failed to upload recording");
                }
            };

            recorder.start();
            setIsRecording(true);

        } catch (err) {
            console.error("Failed to start recording:", err);
            onError?.("Failed to access microphone. Please check permissions.");
        }
    }, [recordingSupported, maxFiles, onError]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, [isRecording]);

    // ==========================================================================
    // Cleanup
    // ==========================================================================

    useEffect(() => {
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            }
            revokeObjectUrlSet(previewUrlsRef.current);
            previewUrlsRef.current.clear();
        };
    }, []);

    return {
        // Messages
        messages,
        setMessages,
        addUserMessage,
        createAssistantPlaceholder,
        updateAssistantMessage,
        handleJsonResponse,
        clearMessages,
        // Streaming
        streamedTextRef,
        currentAssistantIdRef,
        scheduleStreamUpdate,
        flushStreamContent,
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
        // Recording
        isRecording,
        recordingSupported,
        startRecording,
        stopRecording,
    };
}
