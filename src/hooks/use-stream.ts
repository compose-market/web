/**
 * useComposeStream — the single dispatch surface every chat-like page
 * (playground, agent, workflow) uses to drive SDK streaming into the
 * use-chat activity machine.
 *
 * One hook replaces the three separate hand-rolled `parseEventStream` loops
 * that lived in `agent.tsx`, `workflow.tsx`, and `playground.tsx`. The hook
 * speaks to the SDK's typed stream iterators (`sdk.agent.stream`,
 * `sdk.workflow.stream`, `sdk.inference.chat.completions.stream`,
 * `sdk.inference.responses.stream`, `sdk.inference.videos.stream`) and
 * dispatches every event into the `useChat` activity sink (thinking,
 * streaming, tool, error) exactly once per page.
 *
 * Page consumers write:
 *
 *   const streamer = useComposeStream(chat, {
 *     onReceipt, onSessionInvalid, onError,
 *   });
 *   await streamer.runAgent({ agentWallet, message, threadId, userAddress });
 *
 * Nothing more. All SDK-event → UI-state wiring lives in this file.
 */

import { useCallback, useEffect, useRef } from "react";
import type {
    AgentRuntimeEvent,
    ChatCompletionChunk,
    ChatCompletionsCreateParams,
    ComposeAttachmentInput,
    ComposeCallOptions,
    ComposeReceipt,
    ResponseStreamEvent,
    ResponsesCreateParams,
    SessionBudgetSnapshot,
    SessionInvalidReason,
    ToolCallLifecycleEvent,
    VideoStatusStreamEvent,
    WorkflowRuntimeEvent,
} from "@compose-market/sdk";

import { sdk } from "@/lib/sdk";
import type { UseChatReturn } from "@/hooks/use-chat";

export interface ComposeStreamCallbacks {
    onReceipt?: (receipt: ComposeReceipt) => void;
    onBudget?: (snapshot: SessionBudgetSnapshot) => void;
    onSessionInvalid?: (reason: SessionInvalidReason) => void;
    onError?: (err: { code?: string; message: string }) => void;
    onVideoStatus?: (status: { jobId: string; status: "queued" | "processing" | "completed" | "failed"; progress?: number; url?: string; error?: string }) => void;
    /** Called as soon as the SDK emits its terminal done event. */
    onDone?: () => void;
    /** Called once with the final aggregated result after the stream ends. */
    onFinal?: (final: { text: string; requestId: string | null; structuredOutput?: unknown }) => void;
}

type StreamCallOptions = Pick<
    ComposeCallOptions,
    "x402MaxAmountWei" | "idempotencyKey" | "composeRunId" | "composeKey" | "userAddress" | "chainId"
>;

export interface AgentStreamArgs {
    agentWallet: string;
    message: string;
    threadId: string;
    userAddress: string;
    cloudPermissions?: string[];
    composeRunId?: string;
    attachment?: ComposeAttachmentInput;
    assistantId: string;
    signal?: AbortSignal;
    options?: StreamCallOptions;
}

export interface WorkflowStreamArgs {
    workflowWallet: string;
    message: string;
    threadId: string;
    userAddress: string;
    composeRunId?: string;
    continuous?: boolean;
    lastEventIndex?: number;
    attachment?: ComposeAttachmentInput;
    assistantId: string;
    signal?: AbortSignal;
    options?: StreamCallOptions;
}

export interface ChatStreamArgs {
    params: ChatCompletionsCreateParams;
    assistantId: string;
    signal?: AbortSignal;
    options?: StreamCallOptions;
}

export interface ResponsesStreamArgs {
    params: ResponsesCreateParams;
    assistantId: string;
    signal?: AbortSignal;
    options?: StreamCallOptions;
}

export interface VideoPollArgs {
    videoId: string;
    assistantId: string;
    signal?: AbortSignal;
}

export interface UseComposeStream {
    runAgent: (args: AgentStreamArgs) => Promise<void>;
    runWorkflow: (args: WorkflowStreamArgs) => Promise<void>;
    runChat: (args: ChatStreamArgs) => Promise<void>;
    runResponses: (args: ResponsesStreamArgs) => Promise<void>;
    runVideo: (args: VideoPollArgs) => Promise<void>;
}

export function useComposeStream(
    chat: UseChatReturn,
    callbacks: ComposeStreamCallbacks = {},
): UseComposeStream {
    const callbacksRef = useRef(callbacks);
    callbacksRef.current = callbacks;

    // Global event-bus subscriptions — fire page-level callbacks whenever the
    // SDK detects budget / sessionInvalid / receipt on ANY call, not just the
    // ones owned by this hook instance. This matches existing web UX where
    // the session indicator updates after every billable response globally.
    useEffect(() => {
        const unsubs: Array<() => void> = [
            sdk.events.on("receipt", (event) => callbacksRef.current.onReceipt?.(event.receipt)),
            sdk.events.on("budget", (event) => callbacksRef.current.onBudget?.(event.snapshot)),
            sdk.events.on("sessionInvalid", (event) => callbacksRef.current.onSessionInvalid?.(event.reason)),
            sdk.events.on("toolCallStart", (event: ToolCallLifecycleEvent) => {
                chat.startToolActivity(event.toolName, event.summary);
                chat.setActivityPhase("tool", `Using ${event.toolName}...`);
                const assistantId = chat.currentAssistantIdRef.current;
                if (assistantId) {
                    chat.upsertAssistantToolCall(assistantId, {
                        id: event.toolCallId,
                        name: event.toolName,
                        source: event.source,
                        summary: event.summary,
                        arguments: event.arguments,
                        status: "running",
                    });
                }
            }),
            sdk.events.on("toolCallEnd", (event: ToolCallLifecycleEvent) => {
                chat.finishToolActivity(event.toolName, event.summary, event.failed ?? false);
                const assistantId = chat.currentAssistantIdRef.current;
                if (assistantId) {
                    chat.upsertAssistantToolCall(assistantId, {
                        id: event.toolCallId,
                        name: event.toolName,
                        source: event.source,
                        summary: event.summary,
                        arguments: event.arguments,
                        status: event.failed ? "error" : "completed",
                        error: event.error,
                    });
                }
                if (event.failed) {
                    chat.setActivityPhase("error", event.error ?? `${event.toolName} failed`);
                } else {
                    chat.setActivityPhase("thinking", `Processed ${event.toolName}`);
                }
            }),
        ];
        return () => {
            for (const u of unsubs) u();
        };
    }, [chat]);

    const runAgent = useCallback(async (args: AgentStreamArgs): Promise<void> => {
        chat.currentAssistantIdRef.current = args.assistantId;
        chat.streamedTextRef.current = "";
        chat.setActivityPhase("thinking", "Preparing request...");

        const stream = sdk.agent.stream(
            {
                agentWallet: args.agentWallet,
                message: args.message,
                threadId: args.threadId,
                userAddress: args.userAddress,
                ...(args.cloudPermissions ? { cloudPermissions: args.cloudPermissions } : {}),
                ...(args.composeRunId ? { composeRunId: args.composeRunId } : {}),
                ...(args.attachment ? { attachment: args.attachment } : {}),
            },
            { ...args.options, signal: args.signal },
        );

        try {
            for await (const event of stream) {
                dispatchAgentEvent(event, chat, callbacksRef);
                if (event.type === "done") {
                    completeStreamTurn(chat, args.assistantId, callbacksRef);
                }
            }
            const final = await stream.final();
            chat.flushStreamContent(args.assistantId, chat.streamedTextRef.current);
            callbacksRef.current.onFinal?.({
                text: final.text,
                requestId: final.requestId,
            });
            if (!final.text) {
                chat.updateAssistantMessage(args.assistantId, { content: "No response received" });
            }
            clearActivityIfCurrent(chat, args.assistantId);
        } catch (err) {
            handleStreamError(err, chat, args.assistantId, callbacksRef);
        }
    }, [chat]);

    const runWorkflow = useCallback(async (args: WorkflowStreamArgs): Promise<void> => {
        chat.currentAssistantIdRef.current = args.assistantId;
        chat.streamedTextRef.current = "";
        chat.setActivityPhase("thinking", "Preparing workflow...");

        const stream = sdk.workflow.stream(
            {
                workflowWallet: args.workflowWallet,
                message: args.message,
                threadId: args.threadId,
                userAddress: args.userAddress,
                ...(args.composeRunId ? { composeRunId: args.composeRunId } : {}),
                ...(typeof args.continuous === "boolean" ? { continuous: args.continuous } : {}),
                ...(typeof args.lastEventIndex === "number" ? { lastEventIndex: args.lastEventIndex } : {}),
                ...(args.attachment ? { attachment: args.attachment } : {}),
            },
            { ...args.options, signal: args.signal },
        );

        let handledStructuredResult = false;

        try {
            for await (const event of stream) {
                const structured = dispatchWorkflowEvent(event, chat, callbacksRef);
                if (structured) handledStructuredResult = true;
                if (event.type === "done") {
                    completeStreamTurn(chat, args.assistantId, callbacksRef);
                }
            }
            const final = await stream.final();
            chat.flushStreamContent(args.assistantId, chat.streamedTextRef.current);

            if (!handledStructuredResult && final.text) {
                chat.updateAssistantMessage(args.assistantId, { content: final.text });
            }
            if (!final.text && !handledStructuredResult) {
                chat.updateAssistantMessage(args.assistantId, { content: "No response received" });
            }

            callbacksRef.current.onFinal?.({
                text: final.text,
                requestId: final.requestId,
                structuredOutput: final.structuredOutput,
            });
            clearActivityIfCurrent(chat, args.assistantId);
        } catch (err) {
            handleStreamError(err, chat, args.assistantId, callbacksRef);
        }
    }, [chat]);

    const runChat = useCallback(async (args: ChatStreamArgs): Promise<void> => {
        chat.currentAssistantIdRef.current = args.assistantId;
        chat.streamedTextRef.current = "";
        chat.setActivityPhase("thinking", "Preparing request...");

        const stream = sdk.inference.chat.completions.stream(args.params, {
            signal: args.signal,
            ...(args.options ?? {}),
        });

        try {
            for await (const chunk of stream) {
                dispatchChatChunk(chunk, chat);
            }
            const final = await stream.final();
            chat.flushStreamContent(args.assistantId, chat.streamedTextRef.current);
            const text = final.chatCompletion.choices[0]?.message.content ?? "";
            if (!text && !final.chatCompletion.choices[0]?.message.tool_calls) {
                chat.updateAssistantMessage(args.assistantId, { content: "No response received" });
            }
            callbacksRef.current.onFinal?.({ text, requestId: final.requestId });
            clearActivityIfCurrent(chat, args.assistantId);
        } catch (err) {
            handleStreamError(err, chat, args.assistantId, callbacksRef);
        }
    }, [chat]);

    const runResponses = useCallback(async (args: ResponsesStreamArgs): Promise<void> => {
        chat.currentAssistantIdRef.current = args.assistantId;
        chat.streamedTextRef.current = "";
        chat.setActivityPhase("thinking", "Preparing request...");

        const stream = sdk.inference.responses.stream(args.params, {
            signal: args.signal,
            ...(args.options ?? {}),
        });

        try {
            for await (const event of stream) {
                dispatchResponsesEvent(event, chat);
            }
            const final = await stream.final();
            chat.flushStreamContent(args.assistantId, chat.streamedTextRef.current);
            callbacksRef.current.onFinal?.({
                text: chat.streamedTextRef.current,
                requestId: final.requestId,
            });
            clearActivityIfCurrent(chat, args.assistantId);
        } catch (err) {
            handleStreamError(err, chat, args.assistantId, callbacksRef);
        }
    }, [chat]);

    const runVideo = useCallback(async (args: VideoPollArgs): Promise<void> => {
        chat.setActivityPhase("thinking", "Video queued...");
        const stream = sdk.inference.videos.stream(args.videoId, { signal: args.signal });
        try {
            for await (const event of stream as AsyncIterable<VideoStatusStreamEvent>) {
                if (event.type === "compose.video.status") {
                    callbacksRef.current.onVideoStatus?.(event);
                    if (event.status === "completed" && event.url) {
                        chat.updateAssistantMessage(args.assistantId, {
                            content: "Video generated:",
                            type: "video",
                            videoUrl: event.url,
                        });
                        chat.clearActivityState();
                    } else if (event.status === "failed") {
                        chat.updateAssistantMessage(args.assistantId, {
                            content: `Error: ${event.error ?? "Video generation failed"}`,
                            type: "video",
                        });
                        chat.setActivityPhase("error", event.error ?? "Video generation failed");
                    } else {
                        chat.updateAssistantMessage(args.assistantId, {
                            content: `Video generating... (${event.status}${event.progress ? ` - ${event.progress}%` : ""})`,
                            type: "video",
                        });
                        chat.setActivityPhase("thinking", `Video ${event.status}${event.progress ? ` (${event.progress}%)` : ""}`);
                    }
                } else if (event.type === "compose.error") {
                    callbacksRef.current.onError?.({ code: event.code, message: event.message });
                    chat.setActivityPhase("error", event.message);
                }
            }
        } catch (err) {
            handleStreamError(err, chat, args.assistantId, callbacksRef);
        }
    }, [chat]);

    return { runAgent, runWorkflow, runChat, runResponses, runVideo };
}

function completeStreamTurn(
    chat: UseChatReturn,
    assistantId: string,
    cbRef: React.MutableRefObject<ComposeStreamCallbacks>,
): void {
    chat.flushStreamContent(assistantId, chat.streamedTextRef.current);
    if (chat.currentAssistantIdRef.current === assistantId) {
        chat.clearActivityState();
    }
    cbRef.current.onDone?.();
}

function clearActivityIfCurrent(chat: UseChatReturn, assistantId: string): void {
    if (chat.currentAssistantIdRef.current === assistantId) {
        chat.clearActivityState();
    }
}

function dispatchAgentEvent(
    event: AgentRuntimeEvent,
    chat: UseChatReturn,
    cbRef: React.MutableRefObject<ComposeStreamCallbacks>,
): void {
    switch (event.type) {
        case "text-delta": {
            chat.streamedTextRef.current += event.delta;
            chat.scheduleStreamUpdate(chat.streamedTextRef.current);
            chat.setActivityPhase("streaming", "Responding...");
            return;
        }
        case "thinking-start":
            chat.setActivityPhase("thinking", event.message);
            {
                const assistantId = chat.currentAssistantIdRef.current;
                if (assistantId) {
                    chat.appendAssistantProgressEvent(assistantId, {
                        id: crypto.randomUUID(),
                        phase: "thinking",
                        message: event.message,
                    });
                }
            }
            return;
        case "thinking-end":
            chat.setActivityPhase("streaming", "Responding...");
            return;
        // tool-start + tool-end are already dispatched via the global
        // sdk.events.toolCallStart/End listener registered in useEffect.
        case "tool-start":
        case "tool-end":
            return;
        case "error": {
            chat.setActivityPhase("error", event.message);
            chat.streamedTextRef.current += event.message;
            chat.scheduleStreamUpdate(chat.streamedTextRef.current);
            cbRef.current.onError?.({ code: event.code, message: event.message });
            return;
        }
        case "done":
            chat.clearActivityState();
            return;
    }
}

function dispatchWorkflowEvent(
    event: WorkflowRuntimeEvent,
    chat: UseChatReturn,
    cbRef: React.MutableRefObject<ComposeStreamCallbacks>,
): boolean {
    switch (event.type) {
        case "start":
        case "step":
        case "agent":
        case "progress": {
            chat.streamedTextRef.current = event.message;
            chat.scheduleStreamUpdate(event.message);
            chat.setActivityPhase("thinking", event.message);
            const assistantId = chat.currentAssistantIdRef.current;
            if (assistantId) {
                chat.appendAssistantProgressEvent(assistantId, {
                    id: crypto.randomUUID(),
                    phase: event.type === "agent" ? "agent" : event.type,
                    message: event.message,
                });
            }
            return false;
        }
        case "tool-start":
        case "tool-end":
            return false;
        case "result": {
            const output = event.output;
            if (output && typeof output === "object" && "type" in output && ("url" in output || "data" in output || "base64" in output)) {
                const assistantId = chat.currentAssistantIdRef.current;
                if (assistantId) chat.handleJsonResponse(assistantId, output);
                chat.setActivityPhase("streaming", `Generated ${String((output as { type?: unknown }).type ?? "output")}...`);
                return true;
            }
            const text = typeof output === "string" ? output : JSON.stringify(output);
            chat.streamedTextRef.current = text;
            chat.scheduleStreamUpdate(text);
            chat.setActivityPhase("streaming", "Finalizing response...");
            return false;
        }
        case "complete": {
            chat.streamedTextRef.current = event.message;
            chat.scheduleStreamUpdate(event.message);
            chat.setActivityPhase("thinking", event.message);
            const assistantId = chat.currentAssistantIdRef.current;
            if (assistantId) {
                chat.appendAssistantProgressEvent(assistantId, {
                    id: crypto.randomUUID(),
                    phase: "complete",
                    message: event.message,
                });
            }
            return false;
        }
        case "error": {
            chat.streamedTextRef.current = `Error: ${event.message}`;
            chat.scheduleStreamUpdate(chat.streamedTextRef.current);
            chat.setActivityPhase("error", event.message);
            cbRef.current.onError?.({ code: event.code, message: event.message });
            return false;
        }
        case "done":
            chat.clearActivityState();
            return false;
    }
}

function dispatchChatChunk(chunk: ChatCompletionChunk, chat: UseChatReturn): void {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content.length > 0) {
        chat.streamedTextRef.current += delta.content;
        chat.scheduleStreamUpdate(chat.streamedTextRef.current);
        chat.setActivityPhase("streaming", "Responding...");
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        chat.setActivityPhase("thinking", "Thinking...");
        const assistantId = chat.currentAssistantIdRef.current;
        if (assistantId) {
            chat.appendAssistantReasoning(assistantId, delta.reasoning_content);
        }
    }
}

function dispatchResponsesEvent(event: ResponseStreamEvent | Record<string, unknown>, chat: UseChatReturn): void {
    if (event.type === "response.output_text.delta" && event.delta) {
        chat.streamedTextRef.current += event.delta;
        chat.scheduleStreamUpdate(chat.streamedTextRef.current);
        chat.setActivityPhase("streaming", "Responding...");
    } else if (event.type === "response.reasoning.delta") {
        chat.setActivityPhase("thinking", "Thinking...");
        const assistantId = chat.currentAssistantIdRef.current;
        if (assistantId) {
            chat.appendAssistantReasoning(assistantId, String(event.delta));
        }
    } else if ((event as { type?: unknown }).type === "response.image_generation_call.partial_image") {
        const imageEvent = event as {
            partial_image_index: number;
            partial_image_b64: string;
        };
        const assistantId = chat.currentAssistantIdRef.current;
        if (assistantId) {
            chat.updateAssistantMessage(assistantId, {
                content: `Refining image… (${imageEvent.partial_image_index + 1})`,
                type: "image",
                imageUrl: `data:image/png;base64,${imageEvent.partial_image_b64}`,
                partialImage: true,
            });
        }
        chat.setActivityPhase("streaming", "Refining image...");
    } else if ((event as { type?: unknown }).type === "response.image_generation_call.completed") {
        const imageEvent = event as {
            revised_prompt?: string;
            mime_type?: string;
            image_b64: string;
        };
        const assistantId = chat.currentAssistantIdRef.current;
        if (assistantId) {
            chat.updateAssistantMessage(assistantId, {
                content: imageEvent.revised_prompt || "Generated image:",
                type: "image",
                imageUrl: `data:${imageEvent.mime_type || "image/png"};base64,${imageEvent.image_b64}`,
                partialImage: false,
            });
        }
        chat.clearActivityState();
    } else if (event.type === "response.completed") {
        chat.clearActivityState();
    }
}

function handleStreamError(
    err: unknown,
    chat: UseChatReturn,
    assistantId: string,
    cbRef: React.MutableRefObject<ComposeStreamCallbacks>,
): void {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const message = err instanceof Error ? err.message : String(err);
    chat.setActivityPhase("error", message);
    chat.updateAssistantMessage(assistantId, { content: `Error: ${message}` });
    cbRef.current.onError?.({ message });
}
