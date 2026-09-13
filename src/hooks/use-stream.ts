import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
    Attachment,
    CallOptions,
    Receipt,
    ResponsesCreateParams,
    ActivityEvent,
    ModelEvent,
    RunEvent,
    RunProjection,
    StreamResult,
    SessionBudgetSnapshot,
    SessionInvalidReason,
    AgentStreamControls,
} from "@compose-market/sdk";
import { createRunProjection, reduceRunProjection } from "@compose-market/sdk";

import { sdk } from "@/lib/sdk";
import { noticeId, type Artifact, type ConnectorRequest, type Plan, type Task, type UseChatReturn } from "@/hooks/use-chat";
import {
    getModelTypeValues,
    IMAGE_ATTACHMENT_REQUIRED_MESSAGE,
    modelRequiresImageAttachment,
    submissionHasImageAttachment,
    type CatalogModel,
} from "@/lib/models";

export interface StreamCallbacks {
    onResponseId?: (responseId: string) => void;
    onReceipt?: (receipt: Receipt) => void;
    onBudget?: (snapshot: SessionBudgetSnapshot) => void;
    onSessionInvalid?: (reason: SessionInvalidReason) => void;
    onError?: (err: { code?: string; message: string }) => void;
    onVideoStatus?: (status: { jobId: string; status: "queued" | "processing" | "completed" | "failed"; progress?: number; url?: string; error?: string }) => void;
    onDone?: () => void;
    onFinal?: (final: { text: string; requestId: string | null; structuredOutput?: unknown }) => void;
}

export type StreamCallOptions = Pick<
    CallOptions,
    "x402MaxAmountWei" | "idempotencyKey" | "runId" | "key" | "userAddress" | "network" | "timeoutMs"
>;

export interface AgentStreamArgs extends AgentStreamControls {
    agentWallet: string;
    message: string;
    threadId: string;
    userAddress: string;
    cloudPermissions?: string[];
    runId?: string;
    attachment?: Attachment;
    assistantId: string;
    signal?: AbortSignal;
    options?: StreamCallOptions;
}

export interface WorkflowStreamArgs {
    workflowWallet: string;
    message: string;
    threadId: string;
    runId?: string;
    continuous?: boolean;
    lastEventIndex?: number;
    attachment?: Attachment;
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

export interface ResponsesAppendArgs {
    responseId: string;
    input: unknown;
    params?: Record<string, unknown>;
    signal?: AbortSignal;
    options?: StreamCallOptions;
}

export interface UseStream {
    runAgent: (args: AgentStreamArgs) => Promise<void>;
    runWorkflow: (args: WorkflowStreamArgs) => Promise<void>;
    runResponses: (args: ResponsesStreamArgs) => Promise<void>;
    appendResponses: (args: ResponsesAppendArgs) => Promise<void>;
    cancelResponses: () => void;
    watchPlan: (params: { agentWallet: string; runId: string; threadId: string }) => Promise<void>;
}

interface LiveResponse {
    model: string;
    responseId: string;
    assistantId: string;
    options?: StreamCallOptions;
    controller: AbortController;
    cleanup: () => void;
}

interface OpeningResponse {
    promise: Promise<LiveResponse>;
    controller: AbortController;
    cleanup: () => void;
}

const modelCards = new Map<string, Promise<CatalogModel | null>>();

function modelId(params: ResponsesCreateParams): string | null {
    const value = (params as { model?: unknown }).model;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function modelCard(model: string): Promise<CatalogModel | null> {
    const cached = modelCards.get(model);
    if (cached) return cached;
    const pending = Promise.resolve(sdk.models.get(model))
        .then((card) => card as CatalogModel)
        .catch(() => {
            modelCards.delete(model);
            return null;
        });
    modelCards.set(model, pending);
    return pending;
}

async function isRealtimeModel(model: string, card?: CatalogModel | null): Promise<boolean> {
    const resolved = card === undefined ? await modelCard(model) : card;
    return resolved ? getModelTypeValues(resolved).includes("realtime") : false;
}

function paramsWithoutInput(params: ResponsesCreateParams): Record<string, unknown> {
    const body = { ...(params as Record<string, unknown>) };
    delete body.model;
    delete body.input;
    delete body.stream;
    delete body.attachments;
    return body;
}

function latestInput(input: unknown): unknown {
    if (!Array.isArray(input)) return input;
    for (let index = input.length - 1; index >= 0; index -= 1) {
        const item = input[index];
        if (item && typeof item === "object" && !Array.isArray(item) && (item as { role?: unknown }).role === "user") {
            return [item];
        }
    }
    return input.slice(-1);
}

function abort(controller: AbortController): void {
    if (!controller.signal.aborted) controller.abort();
}

function linked(signal: AbortSignal | undefined, controller: AbortController): () => void {
    if (!signal) return () => undefined;
    if (signal.aborted) {
        abort(controller);
        return () => undefined;
    }
    const onabort = () => abort(controller);
    signal.addEventListener("abort", onabort, { once: true });
    return () => signal.removeEventListener("abort", onabort);
}

function removePlaceholder(chat: UseChatReturn, assistantId: string): void {
    chat.setMessages((prev) => prev.filter((message) => {
        if (message.id !== assistantId) return true;
        return Boolean(
            message.content
            || message.blocks?.length
            || message.artifacts?.length
            || message.activity
            || message.imageUrl
            || message.audioUrl
            || message.videoUrl
        );
    }));
}

export function useStream(
    chat: UseChatReturn,
    callbacks: StreamCallbacks = {},
): UseStream {
    const chatRef = useRef(chat);
    chatRef.current = chat;
    const callbacksRef = useRef(callbacks);
    callbacksRef.current = callbacks;
    const textBlockRef = useRef<string | null>(null);
    const blockSeqRef = useRef(0);
    const liveRef = useRef<Map<string, LiveResponse>>(new Map());
    const openingRef = useRef<Map<string, OpeningResponse>>(new Map());
    const responseControllerRef = useRef<AbortController | null>(null);

    const cancelStandardResponses = useCallback((): void => {
        const controller = responseControllerRef.current;
        responseControllerRef.current = null;
        if (controller) abort(controller);
    }, []);

    const closeRealtime = useCallback((cancel: boolean): void => {
        const live = Array.from(liveRef.current.values());
        const opening = Array.from(openingRef.current.values());
        liveRef.current.clear();
        openingRef.current.clear();

        for (const item of opening) {
            item.cleanup();
            abort(item.controller);
        }

        for (const item of live) {
            item.cleanup();
            abort(item.controller);
            if (cancel) {
                void sdk.inference.responses.cancel(item.responseId, item.options).catch(() => undefined);
            }
        }

        if (live.length > 0 || opening.length > 0) {
            chatRef.current.setRealtimeSession(null);
        }
    }, []);

    const cancelResponses = useCallback((): void => {
        cancelStandardResponses();
        closeRealtime(true);
    }, [cancelStandardResponses, closeRealtime]);

    useEffect(() => {
        const unsubs: Array<() => void> = [
            sdk.events.on("receipt", (event) => callbacksRef.current.onReceipt?.(event.receipt)),
            sdk.events.on("budget", (event) => callbacksRef.current.onBudget?.(event.snapshot)),
            sdk.events.on("sessionInvalid", (event) => callbacksRef.current.onSessionInvalid?.(event.reason)),
        ];
        return () => {
            for (const unsub of unsubs) unsub();
        };
    }, []);

    useEffect(() => {
        const unload = () => cancelResponses();
        window.addEventListener("beforeunload", unload);
        window.addEventListener("pagehide", unload);
        return () => {
            window.removeEventListener("beforeunload", unload);
            window.removeEventListener("pagehide", unload);
            cancelResponses();
        };
    }, [cancelResponses]);

    const runAgent = useCallback(async (args: AgentStreamArgs): Promise<void> => {
        const c = chatRef.current;
        c.currentAssistantIdRef.current = args.assistantId;
        c.streamedTextRef.current = "";
        textBlockRef.current = null;
        c.setActivityPhase("thinking", "Starting agent");

        const stream = sdk.agent.stream(
            {
                agentWallet: args.agentWallet,
                message: args.message,
                threadId: args.threadId,
                userAddress: args.userAddress,
                ...(args.cloudPermissions ? { cloudPermissions: args.cloudPermissions } : {}),
                ...(args.runId ? { runId: args.runId } : {}),
                ...(args.attachment ? { attachment: args.attachment } : {}),
                ...(args.mode ? { mode: args.mode } : {}),
                ...(args.scope ? { scope: args.scope } : {}),
                ...(args.action ? { action: args.action } : {}),
                ...(args.plan !== undefined ? { plan: args.plan } : {}),
                ...(args.sandbox !== undefined ? { sandbox: args.sandbox } : {}),
                ...(args.proof !== undefined ? { proof: args.proof } : {}),
                ...(args.constraints ? { constraints: args.constraints } : {}),
            },
            { ...args.options, signal: args.signal },
        );

        try {
            const { result, projection } = await consume(stream, (event) => {
                route(event, chatRef.current, callbacksRef, textBlockRef, blockSeqRef);
            });
            finish(chatRef.current, args.assistantId, projection.text, null, callbacksRef, projection.structuredOutput);
            if (result.receipt) callbacksRef.current.onReceipt?.(result.receipt);
        } catch (err) {
            fail(err, chatRef.current, args.assistantId, callbacksRef);
        }
    }, []);

    const runWorkflow = useCallback(async (args: WorkflowStreamArgs): Promise<void> => {
        const c = chatRef.current;
        c.currentAssistantIdRef.current = args.assistantId;
        c.streamedTextRef.current = "";
        textBlockRef.current = null;
        c.setActivityPhase("thinking", "Starting workflow");

        const stream = sdk.workflow.stream(
            {
                workflowWallet: args.workflowWallet,
                message: args.message,
                threadId: args.threadId,
                ...(args.runId ? { runId: args.runId } : {}),
                ...(typeof args.continuous === "boolean" ? { continuous: args.continuous } : {}),
                ...(typeof args.lastEventIndex === "number" ? { lastEventIndex: args.lastEventIndex } : {}),
                ...(args.attachment ? { attachment: args.attachment } : {}),
            },
            { ...args.options, signal: args.signal },
        );

        try {
            const { result, projection } = await consume(stream, (event) => {
                route(event, chatRef.current, callbacksRef, textBlockRef, blockSeqRef);
            });
            finish(chatRef.current, args.assistantId, projection.text, null, callbacksRef, projection.structuredOutput);
            if (result.receipt) callbacksRef.current.onReceipt?.(result.receipt);
        } catch (err) {
            fail(err, chatRef.current, args.assistantId, callbacksRef);
        }
    }, []);

    const append = useCallback(async (args: ResponsesStreamArgs, active: LiveResponse): Promise<void> => {
        const input = latestInput((args.params as { input?: unknown }).input);
        await sdk.inference.responses.append(active.responseId, {
            input,
            params: paramsWithoutInput(args.params),
        }, {
            signal: args.signal,
            ...(args.options ?? active.options ?? {}),
        });
    }, []);

    const runRealtimeResponses = useCallback(async (args: ResponsesStreamArgs, model: string): Promise<void> => {
        let responseId: string | null = null;
        let ready = false;
        const controller = new AbortController();
        const cleanup = linked(args.signal, controller);
        const settle: {
            resolve?: (response: LiveResponse) => void;
            reject?: (reason: unknown) => void;
        } = {};
        const started = new Promise<LiveResponse>((resolve, reject) => {
            settle.resolve = resolve;
            settle.reject = reject;
        });
        const opening: OpeningResponse = { promise: started, controller, cleanup };
        openingRef.current.set(model, opening);

        const stream = sdk.inference.responses.stream(args.params, {
            signal: controller.signal,
            ...(args.options ?? {}),
        });

        void (async () => {
            try {
                const { result } = await consume(stream, (event) => {
                    if (event.domain === "model" && event.responseId && !responseId) {
                        const id = event.responseId;
                        responseId = id;
                        const active: LiveResponse = {
                            model,
                            responseId: id,
                            assistantId: args.assistantId,
                            options: args.options,
                            controller,
                            cleanup,
                        };
                        liveRef.current.set(model, active);
                        if (openingRef.current.get(model) === opening) {
                            openingRef.current.delete(model);
                        }
                        chatRef.current.setRealtimeSession({
                            responseId: id,
                            append: async (input, params) => {
                                await sdk.inference.responses.append(id, { input, ...(params ? { params } : {}) }, args.options);
                            },
                            close: async () => {
                                liveRef.current.delete(model);
                                cleanup();
                                abort(controller);
                                chatRef.current.setRealtimeSession(null);
                                await sdk.inference.responses.cancel(id, args.options);
                            },
                        });
                        if (!ready) {
                            ready = true;
                            settle.resolve?.(active);
                        }
                    }
                    route(event, chatRef.current, callbacksRef, textBlockRef, blockSeqRef);
                });
                if (!ready) {
                    ready = true;
                    if (openingRef.current.get(model) === opening) {
                        openingRef.current.delete(model);
                    }
                    cleanup();
                    settle.reject?.(new Error("Realtime stream did not return a response id"));
                    return;
                }
                liveRef.current.delete(model);
                cleanup();
                chatRef.current.setRealtimeSession(null);
                finish(chatRef.current, args.assistantId, chatRef.current.streamedTextRef.current, null, callbacksRef);
                if (result.receipt) callbacksRef.current.onReceipt?.(result.receipt);
            } catch (err) {
                if (openingRef.current.get(model) === opening) {
                    openingRef.current.delete(model);
                }
                liveRef.current.delete(model);
                cleanup();
                chatRef.current.setRealtimeSession(null);
                if (!ready) {
                    ready = true;
                    settle.reject?.(err);
                    return;
                }
                fail(err, chatRef.current, args.assistantId, callbacksRef);
            }
        })();

        await started;
    }, []);

    const runResponses = useCallback(async (args: ResponsesStreamArgs): Promise<void> => {
        cancelStandardResponses();
        const model = modelId(args.params);
        const card = model ? await modelCard(model) : null;
        if (card && modelRequiresImageAttachment(card) && !submissionHasImageAttachment(args.params)) {
            const c = chatRef.current;
            c.setActivityPhase("error", IMAGE_ATTACHMENT_REQUIRED_MESSAGE);
            c.failAssistant(args.assistantId, IMAGE_ATTACHMENT_REQUIRED_MESSAGE);
            callbacksRef.current.onError?.({ code: "image_attachment_required", message: IMAGE_ATTACHMENT_REQUIRED_MESSAGE });
            return;
        }
        const active = model ? liveRef.current.get(model) : undefined;
        if (model && active) {
            const c = chatRef.current;
            removePlaceholder(c, args.assistantId);
            c.currentAssistantIdRef.current = active.assistantId;
            await append(args, active);
            return;
        }
        const opening = model ? openingRef.current.get(model) : undefined;
        if (model && opening) {
            const opened = await opening.promise;
            const c = chatRef.current;
            removePlaceholder(c, args.assistantId);
            c.currentAssistantIdRef.current = opened.assistantId;
            await append(args, opened);
            return;
        }

        if (model && await isRealtimeModel(model, card)) {
            const opened = liveRef.current.get(model);
            if (opened) {
                const c = chatRef.current;
                removePlaceholder(c, args.assistantId);
                c.currentAssistantIdRef.current = opened.assistantId;
                await append(args, opened);
                return;
            }
            const pending = openingRef.current.get(model);
            if (pending) {
                const ready = await pending.promise;
                const c = chatRef.current;
                removePlaceholder(c, args.assistantId);
                c.currentAssistantIdRef.current = ready.assistantId;
                await append(args, ready);
                return;
            }

            const c = chatRef.current;
            c.currentAssistantIdRef.current = args.assistantId;
            c.streamedTextRef.current = "";
            textBlockRef.current = null;
            await runRealtimeResponses(args, model);
            return;
        }

        const c = chatRef.current;
        c.currentAssistantIdRef.current = args.assistantId;
        c.streamedTextRef.current = "";
        textBlockRef.current = null;

        const controller = new AbortController();
        const cleanup = linked(args.signal, controller);
        responseControllerRef.current = controller;
        const stream = sdk.inference.responses.stream(args.params, {
            signal: controller.signal,
            ...(args.options ?? {}),
        });

        try {
            const { result, projection } = await consume(stream, (event) => {
                if (event.domain === "model" && event.responseId) {
                    callbacksRef.current.onResponseId?.(event.responseId);
                }
                route(event, chatRef.current, callbacksRef, textBlockRef, blockSeqRef);
            });
            finish(chatRef.current, args.assistantId, projection.text, null, callbacksRef, projection.structuredOutput);
            if (result.receipt) callbacksRef.current.onReceipt?.(result.receipt);
        } catch (err) {
            fail(err, chatRef.current, args.assistantId, callbacksRef);
        } finally {
            cleanup();
            if (responseControllerRef.current === controller) responseControllerRef.current = null;
        }
    }, [append, cancelStandardResponses, runRealtimeResponses]);

    const appendResponses = useCallback(async (args: ResponsesAppendArgs): Promise<void> => {
        await sdk.inference.responses.append(args.responseId, {
            input: args.input,
            ...(args.params ? { params: args.params } : {}),
        }, {
            signal: args.signal,
            ...(args.options ?? {}),
        });
    }, []);

    // Global plan-watch: after a decision (or any moment the page needs
    // follow-through), subscribe to the run's watch SSE and route its
    // events through the same dispatch pipeline as the live stream —
    // approved-plan execution, connector gates, the completion turn, and
    // the delivery artifact become visible without a follow-up chat
    // message.
    //
    // Watch-origin routing (agent<>user chat):
    //   - the user-facing agent's own model deltas (completion turn, runId
    //     not a sub-run) render as chat text on a watch-created assistant
    //     message — the agent speaks to the user;
    //   - sub-agent model deltas NEVER render in chat — their work shows in
    //     mission control's activity tree only;
    //   - sub-agent tasks/plans never merge into the user's plan card —
    //     only the user-facing plan (runId not a sub-run) renders;
    //   - activity events attach to the activity tree (mission control).
    //
    // The watch is resilient: on transport failure or stream end it
    // reconnects with capped backoff until a terminal plan state is
    // observed (or the total watch window elapses), because plan execution
    // outlives any single SSE connection.
    const watchPlan = useCallback(async (params: { agentWallet: string; runId: string; threadId: string }): Promise<void> => {
        const WATCH_RECONNECT_BASE_MS = 1_000;
        const WATCH_RECONNECT_MAX_MS = 30_000;
        const WATCH_TOTAL_MS = 2 * 60 * 60 * 1_000;
        const TERMINAL_PLAN_STATES = new Set(["completed", "failed", "cancelled", "expired", "rejected"]);
        const startedAt = Date.now();
        let backoff = WATCH_RECONNECT_BASE_MS;
        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

        const isTerminal = (event: RunEvent): boolean => {
            if (event.domain !== "activity") return false;
            const record = event as unknown as { type?: string; payload?: Record<string, unknown> };
            if (record.type === "activity.run" && isRecord(record.payload)) {
                const status = str(record.payload.status);
                return status !== undefined && TERMINAL_PLAN_STATES.has(status);
            }
            if (record.type === "activity.plan" && isRecord(record.payload)) {
                const state = str(record.payload.state);
                return state !== undefined && TERMINAL_PLAN_STATES.has(state);
            }
            return false;
        };

        const isSubRun = (event: RunEvent): boolean => {
            const runId = (event as unknown as { runId?: unknown }).runId;
            return typeof runId === "string" && runId.startsWith("sub:");
        };

        // Nested sub-plan completion turns (complete-sub:*) are sub-agent
        // speech — mission control's activity tree only, never the user's chat.
        const isNestedCompletion = (event: RunEvent): boolean => {
            const runId = (event as unknown as { runId?: unknown }).runId;
            return typeof runId === "string" && runId.startsWith("complete-sub:");
        };

        const routeWatchEvent = (event: RunEvent): void => {
            const chat = chatRef.current;
            if (event.domain === "model") {
                // Sub-agent model output never renders in the user's chat —
                // but its reasoning/answer folds into the child agent's
                // mission-control tree node.
                if (isSubRun(event)) {
                    routeChildModelToTree(event, chat);
                    return;
                }
                if (isNestedCompletion(event)) {
                    routeChildModelToTree(event, chat);
                    return;
                }
                // The user-facing agent's own words (the completion turn)
                // need an assistant message when no live turn is running.
                if (!chat.currentAssistantIdRef.current && (event.type === "model.text.delta" || event.type === "model.reasoning.delta")) {
                    const assistantId = chat.createAssistantPlaceholder();
                    chat.currentAssistantIdRef.current = assistantId;
                    chat.streamedTextRef.current = "";
                    textBlockRef.current = null;
                }
                route(event, chat, callbacksRef, textBlockRef, blockSeqRef);
                return;
            }
            if (event.domain === "activity" && event.type === "activity.plan") {
                // Only the user-facing plan renders in chat — sub-agent
                // proposals are their parents' business, not the user's UI.
                const payload = (event as unknown as { payload?: Record<string, unknown> }).payload;
                const planRunId = str(payload?.runId);
                if (planRunId !== undefined && planRunId.startsWith("sub:")) return;
                route(event, chat, callbacksRef, textBlockRef, blockSeqRef);
                return;
            }
            route(event, chat, callbacksRef, textBlockRef, blockSeqRef);
        };

        for (; ;) {
            let terminal = false;
            try {
                const stream = sdk.agent.watch({ ...params, timeoutMs: 3_600_000 });
                for (; ;) {
                    const next = await stream.next();
                    if (next.done) break;
                    routeWatchEvent(next.value);
                    if (isTerminal(next.value)) {
                        terminal = true;
                        break;
                    }
                }
            } catch {
                // Watch transport failures leave durable state untouched;
                // reconnect below and re-derive from the snapshot replay.
            }
            if (terminal) return;
            if (Date.now() - startedAt >= WATCH_TOTAL_MS) return;
            await sleep(backoff);
            backoff = Math.min(backoff * 2, WATCH_RECONNECT_MAX_MS);
            if (Date.now() - startedAt >= WATCH_TOTAL_MS) return;
        }
    }, []);

    return useMemo(() => ({ runAgent, runWorkflow, runResponses, appendResponses, cancelResponses, watchPlan }), [runAgent, runWorkflow, runResponses, appendResponses, cancelResponses, watchPlan]);
}

async function consume(
    stream: AsyncGenerator<RunEvent, StreamResult, void>,
    handle: (event: RunEvent) => void,
): Promise<{ result: StreamResult; projection: RunProjection }> {
    let projection = createRunProjection();
    let next = await stream.next();
    while (!next.done) {
        projection = reduceRunProjection(projection, next.value);
        handle(next.value);
        next = await stream.next();
    }
    return { result: next.value, projection };
}

function route(
    event: RunEvent,
    chat: UseChatReturn,
    cbRef: React.MutableRefObject<StreamCallbacks>,
    textBlockRef: React.MutableRefObject<string | null>,
    blockSeqRef: React.MutableRefObject<number>,
): void {
    if (event.domain === "model") {
        dispatchModel(event, chat, cbRef, textBlockRef, blockSeqRef);
    } else {
        dispatchActivity(event, chat, cbRef, textBlockRef, blockSeqRef);
    }
}

/**
 * Sub-agent model output never renders in the user's chat, but its work
 * belongs in mission control: child reasoning and answer deltas fold into
 * the child agent's tree node (agent:<runKey>) so each task fold shows what
 * its assigned agent is thinking and saying.
 */
function routeChildModelToTree(event: ModelEvent, chat: UseChatReturn): void {
    const assistantId = chat.currentAssistantIdRef.current;
    const runId = typeof event.runId === "string" ? event.runId : undefined;
    if (!assistantId || !runId) return;
    // Nested sub-plan completion turns run as `complete-<sub runKey>` — their
    // speech folds under the SAME agent node as the sub-agent's task run.
    const agentRunKey = runId.startsWith("complete-") ? runId.slice("complete-".length) : runId;

    if (event.type === "model.reasoning.delta" && event.delta) {
        chat.applyAssistantActivityEvent(assistantId, {
            domain: "activity",
            type: "activity.thinking",
            id: `thinking:${runId}`,
            ts: event.ts,
            kind: "thinking",
            status: "running",
            parentId: `agent:${agentRunKey}`,
            spanId: `thinking:${runId}`,
            delta: event.delta,
        });
        return;
    }
    if (event.type === "model.reasoning.done") {
        chat.applyAssistantActivityEvent(assistantId, {
            domain: "activity",
            type: "activity.thinking",
            id: `thinking:${runId}`,
            ts: event.ts,
            kind: "thinking",
            status: "completed",
            parentId: `agent:${agentRunKey}`,
            spanId: `thinking:${runId}`,
        });
        return;
    }
    if (event.type === "model.text.delta" && event.delta) {
        chat.applyAssistantActivityEvent(assistantId, {
            domain: "activity",
            type: "activity.message",
            id: `message:${runId}`,
            ts: event.ts,
            kind: "message",
            status: "running",
            parentId: `agent:${agentRunKey}`,
            spanId: `message:${runId}`,
            delta: event.delta,
        });
    }
}

function dispatchModel(
    event: ModelEvent,
    chat: UseChatReturn,
    cbRef: React.MutableRefObject<StreamCallbacks>,
    textBlockRef: React.MutableRefObject<string | null>,
    blockSeqRef: React.MutableRefObject<number>,
): void {
    const assistantId = chat.currentAssistantIdRef.current;
    if (!assistantId) return;

    // Agent<>user chat: sub-agent model output never renders in the
    // user's chat — the user-facing agent's own words are the chat; the
    // swarm's work shows in mission control's activity tree.
    if (typeof event.runId === "string" && event.runId.startsWith("sub:")) {
        routeChildModelToTree(event, chat);
        return;
    }

    chat.applyAssistantModelEvent(assistantId, event);

    const phase = event.phase;
    if (event.type === "model.status" && phase === "finalizing_payment") {
        chat.clearActivityStateUnlessError();
        return;
    }

    if (event.type === "model.text.delta" && event.delta) {
        const blockId = textBlockRef.current ?? nextBlock("text", blockSeqRef);
        textBlockRef.current = blockId;
        chat.appendAssistantBlockText(assistantId, blockId, "text", event.delta);
        chat.streamedTextRef.current += event.delta;
        chat.scheduleStreamUpdate(chat.streamedTextRef.current);
        chat.setActivityPhase("streaming", "Responding");
        return;
    }

    if (event.type === "model.text.done" && event.text) {
        const current = chat.streamedTextRef.current;
        const append = event.text.startsWith(current) ? event.text.slice(current.length) : current.includes(event.text) ? "" : event.text;
        if (append) {
            const blockId = textBlockRef.current ?? nextBlock("text", blockSeqRef);
            textBlockRef.current = blockId;
            chat.appendAssistantBlockText(assistantId, blockId, "text", append);
            chat.streamedTextRef.current += append;
            chat.scheduleStreamUpdate(chat.streamedTextRef.current);
        }
        return;
    }

    if (event.type === "model.reasoning.done" && event.text) {
        const blockId = `reasoning:${event.responseId ?? "main"}`;
        chat.upsertAssistantBlock(assistantId, { id: blockId, type: "reasoning", text: event.text });
        return;
    }

    if (event.type === "model.done") {
        chat.stopRealtimeArtifacts(event.responseId);
        chat.clearActivityStateUnlessError();
        cbRef.current.onDone?.();
        return;
    }

    if (event.type === "model.reasoning.delta" && event.delta) {
        const blockId = `reasoning:${event.responseId ?? "main"}`;
        chat.appendAssistantBlockText(assistantId, blockId, "reasoning", event.delta);
        chat.setActivityPhase("thinking", "Reasoning");
        return;
    }

    if (event.type === "model.asset") {
        textBlockRef.current = null;
        const item = artifactFromModelEvent(event);
        chat.upsertAssistantArtifact(assistantId, item);
        if (item.partial !== true && !item.url && item.responseId && (item.inline || (item.artifactType === "embedding" && !item.embedding))) {
            chat.upsertAssistantArtifact(assistantId, { ...item, hydrating: true });
            void hydrateArtifact(chat, assistantId, item);
        }
        if (item.artifactType === "video" && item.jobId && item.status) {
            cbRef.current.onVideoStatus?.({
                jobId: item.jobId,
                status: item.status as "queued" | "processing" | "completed" | "failed",
                progress: item.progress,
                url: item.url,
                error: item.error,
            });
        }
        if (item.status === "failed") {
            const message = item.error || `${item.artifactType} generation failed`;
            chat.setActivityPhase("error", message);
            cbRef.current.onError?.({ message });
        } else {
            chat.setActivityPhase("streaming", item.partial === true || item.status === "running" ? `Generating ${item.artifactType}` : `Generated ${item.artifactType}`);
        }
        return;
    }

    if (event.type === "model.error") {
        textBlockRef.current = null;
        const message = event.error?.message || "Model stream error";
        chat.upsertAssistantBlock(assistantId, { id: noticeId("error", message), type: "notice", tone: "error", text: message });
        chat.setActivityPhase("error", message);
        cbRef.current.onError?.({ message });
        return;
    }
}

function dispatchActivity(
    event: ActivityEvent,
    chat: UseChatReturn,
    cbRef: React.MutableRefObject<StreamCallbacks>,
    textBlockRef: React.MutableRefObject<string | null>,
    blockSeqRef: React.MutableRefObject<number>,
): void {
    // Plan delivery artifacts are the run's FINAL product — they render
    // inline like a picture even when the agent chose to speak nothing
    // (speech is optional; the delivery never is). Without a live assistant
    // message, the delivery creates its own carrier message.
    if (event.type === "activity.tool" && event.status === "completed") {
        const deliveryArtifact = artifactFromActivityEvent(event);
        if (deliveryArtifact?.artifactType === "delivery" && !chat.currentAssistantIdRef.current) {
            const carrierId = chat.createAssistantPlaceholder();
            chat.streamedTextRef.current = "";
            chat.upsertAssistantArtifact(carrierId, deliveryArtifact);
        }
    }

    const assistantId = chat.currentAssistantIdRef.current;
    if (!assistantId) return;

    chat.applyAssistantActivityEvent(assistantId, event);

    if (event.type === "activity.tool") {
        const toolName = event.name || "tool";
        const summary = event.target?.summary || str(event.payload?.message);
        const displayName = event.target?.name;
        if (event.status === "running") {
            chat.startToolActivity(toolName, summary, displayName);
        } else {
            chat.finishToolActivity(toolName, summary, event.status === "failed", displayName);
        }
        const artifact = artifactFromActivityEvent(event);
        if (artifact) chat.upsertAssistantArtifact(assistantId, artifact);
    }

    if (event.type === "activity.message" && event.delta && !event.parentId) {
        const blockId = textBlockRef.current ?? nextBlock("text", blockSeqRef);
        textBlockRef.current = blockId;
        chat.appendAssistantBlockText(assistantId, blockId, "text", event.delta);
        chat.streamedTextRef.current += event.delta;
        chat.scheduleStreamUpdate(chat.streamedTextRef.current);
        return;
    }

    if (event.type === "activity.thinking" && event.delta) {
        chat.appendAssistantBlockText(assistantId, `reasoning:${event.runId ?? "main"}`, "reasoning", event.delta);
        return;
    }

    if (event.type !== "activity.trace") textBlockRef.current = null;

    if (event.type === "activity.plan") {
        const plan = planFromActivityEvent(event);
        mergePlan(chat, assistantId, plan, chat.streamedTextRef.current);
        chat.upsertAssistantBlock(assistantId, { id: `plan`, type: "plan", planId: plan.proposalId });
        // State-based phase label — the decision stays "approved" forever,
        // so a decision-based label would freeze at "Plan approved" even
        // after execution completes.
        chat.setActivityPhase("thinking", planPhaseLabel(plan));
        return;
    }

    if (event.type === "activity.connector") {
        const request = connectorFromActivityEvent(event);
        if (request) {
            mergeConnectorRequest(chat, assistantId, request);
            chat.setActivityPhase(
                "thinking",
                request.state === "requested"
                    ? `Awaiting connector decision: ${request.slug}`
                    : `Connector ${request.state}: ${request.slug}`,
            );
        }
        return;
    }

    if (isTaskEvent(event)) {
        mergePlanTasks(chat, assistantId, event);
    }

    if (event.type === "activity.error") {
        const message = str(event.payload?.message) ?? "Activity stream error";
        chat.upsertAssistantBlock(assistantId, { id: noticeId("error", message), type: "notice", tone: "error", text: message });
        chat.setActivityPhase("error", message);
        cbRef.current.onError?.({ message });
        return;
    }

    if (event.type === "activity.trace") return;

    const title = event.target?.name || event.name || event.kind;
    const summary = event.target?.summary || str(event.payload?.message) || title;
    if (event.status === "failed") {
        chat.setActivityPhase("error", summary);
    } else if (event.status === "completed") {
        chat.setActivityPhase("thinking", `${title} completed`);
    } else {
        chat.setActivityPhase(event.kind === "tool" ? "tool" : "thinking", summary);
    }
}

function nextBlock(type: "text" | "reasoning", ref: React.MutableRefObject<number>): string {
    ref.current += 1;
    return `${type}:${ref.current}`;
}

function finish(
    chat: UseChatReturn,
    assistantId: string,
    text: string,
    requestId: string | null,
    cbRef: React.MutableRefObject<StreamCallbacks>,
    structuredOutput?: unknown,
): void {
    const finalText = text || chat.streamedTextRef.current;
    chat.flushStreamContent(assistantId, finalText);
    callbacks(cbRef).onFinal?.({ text: finalText, requestId, structuredOutput });
    if (chat.currentAssistantIdRef.current === assistantId) {
        chat.clearActivityStateUnlessError();
    }
}

function callbacks(ref: React.MutableRefObject<StreamCallbacks>): StreamCallbacks {
    return ref.current;
}

function fail(
    err: unknown,
    chat: UseChatReturn,
    assistantId: string,
    cbRef: React.MutableRefObject<StreamCallbacks>,
): void {
    if (err instanceof DOMException && err.name === "AbortError" && !(err as any).timeout) return;
    if (err instanceof Error && err.name === "AbortError" && !(err as any).timeout) return;
    const message = err instanceof Error ? err.message : String(err);
    chat.setActivityPhase("error", message);
    chat.failAssistant(assistantId, message);
    cbRef.current.onError?.({ message });
}

/** State-based phase label for a plan — never decision-based. */
function planPhaseLabel(plan: Plan): string {
    if (plan.state === "completed") return "Plan completed";
    if (plan.state === "failed" || plan.state === "blocked") return "Plan failed";
    if (plan.state === "executing" || plan.state === "monitoring") return "Plan executing";
    if (plan.state === "approved") return "Plan executing";
    if (plan.state === "awaiting_approval") return "Awaiting plan decision";
    if (plan.state === "changes_requested") return "Plan feedback requested";
    if (plan.decision) return `Plan ${plan.decision}`;
    return "Awaiting plan decision";
}

function planFromActivityEvent(event: ActivityEvent): Plan {
    const payload = event.payload ?? {};
    const planType: Plan["type"] = decision(payload.decision)
        ? "approval.decided"
        : str(payload.feedback)
            ? "plan.feedback_requested"
            : "plan.proposed";
    // Live task rows (payload.tasks) win — statuses, forks, retries, errors
    // update post-approval; the proposal snapshot is the fallback.
    const liveTasks = proposalTasks(payload.tasks);
    const snapshotTasks = proposalTasks(payload.proposal);
    return {
        type: planType,
        proposalId: str(payload.proposalId) ?? event.id,
        version: num(payload.version) ?? 1,
        state: str(payload.state) ?? event.status ?? "pending",
        decision: decision(payload.decision),
        rootRunId: event.rootId,
        runId: event.runId,
        proposal: proposalSnapshot(payload.proposal),
        tasks: liveTasks.length > 0 ? liveTasks : snapshotTasks.length > 0 ? snapshotTasks : undefined,
        markdown: str(payload.markdown),
        approver: str(payload.approver),
        reason: str(payload.reason),
        feedback: str(payload.feedback),
        ...(str(payload.failureReason) ? { failureReason: str(payload.failureReason) } : {}),
        ts: event.ts,
        updatedAt: event.ts,
    };
}

function mergePlan(chat: UseChatReturn, assistantId: string, plan: Plan, content: string): void {
    chat.setMessages((messages) => messages.map((message) => {
        if (message.id !== assistantId) return message;
        const current = message.proposal;
        const same = current?.proposalId === plan.proposalId && current.version === plan.version;
        return {
            ...message,
            content,
            proposal: {
                ...(same ? current : {}),
                ...plan,
                tasks: plan.tasks?.length ? plan.tasks : same ? current?.tasks : undefined,
            },
        };
    }));
}

function connectorFromActivityEvent(event: ActivityEvent): ConnectorRequest | null {
    const payload = event.payload ?? {};
    const requestId = str(payload.requestId);
    const slug = str(payload.slug);
    if (!requestId || !slug) return null;
    const decisionValue = str(payload.decision);
    const state: ConnectorRequest["state"] = decisionValue === "connected" || decisionValue === "discarded"
        ? decisionValue
        : "requested";
    const actions = Array.isArray(payload.actions)
        ? payload.actions.filter((action): action is string => typeof action === "string")
        : undefined;
    return {
        requestId,
        slug,
        bindingId: str(payload.bindingId),
        runId: str(payload.runId) ?? event.runId,
        rootRunId: str(payload.rootRunId) ?? event.rootId,
        userAddress: str(payload.userAddress),
        agentWallet: str(payload.agentWallet),
        ...(actions?.length ? { actions } : {}),
        reason: str(payload.reason),
        state,
        ts: event.ts,
    };
}

function mergeConnectorRequest(chat: UseChatReturn, assistantId: string, request: ConnectorRequest): void {
    chat.setMessages((messages) => messages.map((message) => {
        if (message.id !== assistantId) return message;
        const existing = message.connectorRequests ?? [];
        const index = existing.findIndex((entry) => entry.requestId === request.requestId);
        const next = existing.slice();
        if (index >= 0) {
            next[index] = { ...next[index], ...request };
        } else {
            next.push(request);
        }
        return { ...message, connectorRequests: next };
    }));
}

function isTaskEvent(event: ActivityEvent): boolean {
    const result = event.payload?.result;
    if (!isRecord(result) || !isRecord(result.plan)) return false;
    const tasks = result.plan.tasks;
    return Array.isArray(tasks);
}

function mergePlanTasks(chat: UseChatReturn, assistantId: string, event: ActivityEvent): void {
    const result = isRecord(event.payload?.result) ? event.payload.result : undefined;
    const planState = result && isRecord(result.plan) ? result.plan : undefined;
    const tasks = proposalTasks(planState?.tasks);
    if (!tasks.length) return;
    chat.setMessages((messages) => messages.map((message) => {
        if (message.id !== assistantId || !message.proposal) return message;
        const proposalId = str(planState?.proposalId);
        const version = num(planState?.proposalVersion);
        if (proposalId && proposalId !== message.proposal.proposalId) return message;
        if (version !== undefined && version !== message.proposal.version) return message;
        return { ...message, proposal: { ...message.proposal, tasks } };
    }));
}

function proposalTasks(value: unknown): Task[] {
    const source = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value.tasks)
            ? value.tasks
            : [];
    return source.filter((task): task is Task => {
        if (!isRecord(task)) return false;
        return typeof task.id === "string"
            && typeof task.title === "string"
            && ["todo", "doing", "blocked", "done", "failed"].includes(String(task.status));
    });
}

function proposalSnapshot(value: unknown): Plan["proposal"] | undefined {
    if (!isRecord(value) || !Array.isArray(value.tasks) || !Array.isArray(value.participants)) return undefined;
    if (typeof value.goal !== "string" || typeof value.request !== "string") return undefined;
    if (value.mode !== "solo" && value.mode !== "swarm") return undefined;
    return value as unknown as NonNullable<Plan["proposal"]>;
}

function artifactFromActivityEvent(event: ActivityEvent): Artifact | null {
    const payload = event.payload ?? {};
    if (!isRecord(payload.artifact) || !str(payload.artifactId)) return null;
    const raw = payload.artifact;
    const kind = artifactKind(raw.type);
    if (kind === "delivery") {
        return {
            id: str(raw.id) ?? str(payload.artifactId) ?? event.id,
            artifactType: "delivery",
            deliverableId: str(raw.deliverableId) ?? str(payload.artifactId),
            title: str(raw.title),
            content: str(raw.content),
            summary: str(raw.summary),
            contentHash: str(raw.contentHash),
            taskId: str(raw.taskId),
            taskTitle: str(raw.taskTitle),
            agentWallet: str(raw.agentWallet) ?? str(raw.createdBy),
            bytes: num(raw.bytes),
            mimeType: "text/markdown",
            status: str(raw.status) ?? "completed",
            sourceTool: event.target?.name ?? "deliverable_create",
            source: "agent",
            runKey: str(raw.runId) ?? event.runId,
            raw,
        };
    }
    return {
        id: str(raw.id) ?? str(payload.artifactId) ?? event.id,
        artifactType: kind,
        url: str(raw.url),
        inline: raw.inline === true,
        mimeType: str(raw.mimeType),
        bytes: num(raw.bytes),
        responseId: str(raw.responseId),
        status: str(raw.status),
        jobId: str(raw.jobId),
        sourceTool: event.target?.name,
        source: "agent",
        runKey: str(raw.runId) ?? event.runId,
        raw,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decision(value: unknown): Plan["decision"] | undefined {
    return value === "approved" || value === "rejected" || value === "changes_requested" ? value : undefined;
}

function artifactFromModelEvent(event: ModelEvent): Artifact {
    const asset = event.asset ?? { kind: "artifact" as const };
    const kind = artifactKind(asset.kind);
    const mimeType = asset.mimeType;
    const base64 = asset.base64;
    const live = kind === "audio" && asset.partial === true && Boolean(base64);
    const url = live
        ? undefined
        : asset.url ?? (base64 ? `data:${mimeType || defaultMime(kind)};base64,${base64}` : undefined);
    return {
        id: event.id,
        artifactType: kind,
        url,
        inline: asset.inline === true,
        partial: asset.partial === true,
        embedding: embedding(asset.embedding),
        mimeType,
        bytes: asset.bytes,
        responseId: asset.responseId ?? event.responseId,
        outputIndex: asset.outputIndex ?? event.outputIndex,
        status: asset.status ?? event.status,
        progress: asset.progress,
        jobId: asset.jobId,
        sourceTool: event.toolCallId,
        ...(event.runId ? { source: "agent" as const } : {}),
        runKey: event.runId,
        raw: asset as unknown as Record<string, unknown>,
    };
}

function artifactKind(value: unknown): Artifact["artifactType"] {
    const raw = typeof value === "string" ? value.toLowerCase() : "";
    if (raw === "image" || raw === "output_image") return "image";
    if (raw === "audio" || raw === "output_audio") return "audio";
    if (raw === "video" || raw === "output_video") return "video";
    if (raw === "embedding" || raw === "output_embedding") return "embedding";
    if (raw === "realtime" || raw === "output_realtime" || raw === "realtime_session") return "realtime";
    if (raw === "file") return "file";
    if (raw === "delivery") return "delivery";
    return "artifact";
}

function defaultMime(kind: Artifact["artifactType"]): string {
    if (kind === "image") return "image/png";
    if (kind === "audio") return "audio/mpeg";
    if (kind === "video") return "video/mp4";
    return "application/octet-stream";
}

async function hydrateArtifact(chat: UseChatReturn, assistantId: string, item: Artifact): Promise<void> {
    if (!item.responseId) return;
    try {
        const response = await sdk.inference.responses.get(item.responseId);
        const output = Array.isArray(response.output) ? response.output : [];
        for (const raw of output) {
            const view = hydrateOutputItem(raw, item.artifactType, item.mimeType);
            if (!view) continue;
            const url = outputItemUrl(view);
            chat.upsertAssistantArtifact(assistantId, {
                ...item,
                ...(url ? { url } : {}),
                ...(view.embedding ? { embedding: view.embedding } : {}),
                raw: { ...(item.raw ?? {}), hydrated: view },
                hydrating: false,
            });
            return;
        }
        chat.upsertAssistantArtifact(assistantId, { ...item, hydrating: false });
    } catch (error) {
        chat.upsertAssistantArtifact(assistantId, {
            ...item,
            hydrating: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

interface ResponseOutputItem {
    type: string;
    role?: "assistant";
    text?: string;
    image_url?: string;
    audio_url?: string;
    video_url?: string;
    embedding?: number[];
    job_id?: string;
    status?: string;
    progress?: number;
    mime_type?: string;
    [key: string]: unknown;
}

function hydrateOutputItem(
    raw: Record<string, unknown>,
    kind: Artifact["artifactType"],
    fallbackMime?: string,
): ResponseOutputItem | null {
    const type = typeof raw.type === "string" ? raw.type : "";
    const normalized = type === "output_image"
        ? "image"
        : type === "output_audio"
            ? "audio"
            : type === "output_video"
                ? "video"
                : type === "output_embedding"
                    ? "embedding"
                    : "";
    if (normalized && normalized !== kind) return null;
    if (kind === "image") {
        const url = mediaUrl(raw, "image", mediaMime(raw, fallbackMime, "image/png"));
        return url ? { type: "output_image", image_url: url, text: typeof raw.text === "string" ? raw.text : undefined } : null;
    }
    if (kind === "audio") {
        const url = mediaUrl(raw, "audio", mediaMime(raw, fallbackMime, "audio/mpeg"));
        return url ? { type: "output_audio", audio_url: url } : null;
    }
    if (kind === "video") {
        const url = mediaUrl(raw, "video", mediaMime(raw, fallbackMime, "video/mp4"));
        return url ? { type: "output_video", video_url: url, status: typeof raw.status === "string" ? raw.status : undefined } : null;
    }
    if (kind === "embedding") {
        const embedding = Array.isArray(raw.embedding) ? raw.embedding as number[] : undefined;
        return embedding ? { type: "output_embedding", embedding } : null;
    }
    return null;
}

function mediaMime(raw: Record<string, unknown>, fallback: string | undefined, defaultValue: string): string {
    return fallback ?? (typeof raw.mime_type === "string" ? raw.mime_type : defaultValue);
}

function mediaUrl(raw: Record<string, unknown>, kind: "image" | "audio" | "video", mimeType: string): string | undefined {
    const key = kind === "image" ? "image_url" : kind === "audio" ? "audio_url" : "video_url";
    const value = raw[key] ?? raw.url;
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
        return (value as { url: string }).url;
    }
    const data = typeof raw.data === "string" ? raw.data : typeof raw.base64 === "string" ? raw.base64 : undefined;
    return data ? `data:${mimeType};base64,${data}` : undefined;
}

function outputItemUrl(item: ResponseOutputItem): string | undefined {
    if (typeof item.image_url === "string") return item.image_url;
    if (typeof item.audio_url === "string") return item.audio_url;
    if (typeof item.video_url === "string") return item.video_url;
    for (const key of ["image_url", "audio_url", "video_url", "url"] as const) {
        const value = item[key];
        if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
            return (value as { url: string }).url;
        }
    }
    return undefined;
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function embedding(value: unknown): Artifact["embedding"] | undefined {
    if (Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item))) {
        return value as number[];
    }
    if (Array.isArray(value) && value.every((item) => Array.isArray(item) && item.every((entry) => typeof entry === "number" && Number.isFinite(entry)))) {
        return value as number[][];
    }
    return undefined;
}
