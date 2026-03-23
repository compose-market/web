/**
 * Manowar Workflow Page
 * 
 * Provides interactive chat/execution interface for Manowar workflows.
 * Fetches Manowar data -> Coordinator Agent -> Executes chat via Coordinator.
 * 
 * Layout: Chat on left, ManowarCard on right (matching agent.tsx pattern)
 * Uses shared MultimodalCanvas component and hooks for the chat interface.
 */
import { useState, useCallback, useRef } from "react";
import { usePostHog } from "@posthog/react";
import { mpTrack, mpError } from "@/lib/mixpanel";
import { useParams } from "wouter";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { createPaymentFetch } from "@/lib/payment";
import { useChain } from "@/contexts/ChainContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { useOnchainWorkflowByIdentifier } from "@/hooks/use-onchain";
import { MultimodalCanvas, type ChatMessage } from "@/components/chat";
import { useChat } from "@/hooks/use-chat";
import { API_BASE_URL, buildAttachmentPart, parseEventStream } from "@/lib/api";
import { WorkflowCard, WorkflowCardSkeleton } from "@/components/workflow-card";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    ArrowLeft,
    Shield,
    Layers,
    IdCard,
    StopCircle,
} from "lucide-react";

const API_URL = API_BASE_URL;

export default function ManowarPage() {
    const posthog = usePostHog();
    const params = useParams<{ id: string }>();
    const workflowIdentifier = params.id || null;

    // Use identifier-based lookup (supports both wallet address and numeric ID)
    const { data: workflow, isLoading, error: workflowError } = useOnchainWorkflowByIdentifier(workflowIdentifier);

    // Coordinator exists if hasCoordinator is true
    const hasCoordinator = !!workflow?.hasCoordinator;

    const { toast } = useToast();
    const wallet = useActiveWallet();
    const account = useActiveAccount();
    const { paymentChainId } = useChain();
    const { sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken } = useSession();

    // Chat state from shared hook (includes messages, attachments, and recording)
    const workflowWallet = workflow?.walletAddress;
    const chat = useChat({
        conversationId: `workflow-${workflowWallet || 'unknown'}`,
        onError: (err) => setChatError(err),
    });
    const { messages, setMessages, scrollContainerRef, messagesEndRef,
        streamedTextRef, currentAssistantIdRef, handleJsonResponse,
        updateAssistantMessage, scheduleStreamUpdate, flushStreamContent,
        activityState, clearActivityState, setActivityPhase, startToolActivity, finishToolActivity,
        // Attachments
        attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, clearFiles,
        // Recording
        isRecording, recordingSupported, startRecording, stopRecording,
    } = chat;
    const [inputValue, setInputValue] = useState("");
    const [sending, setSending] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const [chatStatus, setChatStatus] = useState<"idle" | "paying" | "waiting" | "streaming">("idle");
    const [continuousEnabled, setContinuousEnabled] = useState(false);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Session dialog
    const [showSessionDialog, setShowSessionDialog] = useState(false);

    // Mobile card sheet
    const [mobileCardOpen, setMobileCardOpen] = useState(false);

    // Send chat message with x402 payment
    const handleSendMessage = useCallback(async () => {
        if (attachedFiles.some(f => f.uploading)) return;
        if ((!inputValue.trim() && attachedFiles.length === 0) || sending || !workflow || !workflowWallet) return;

        if (!wallet || !account) {
            toast({ title: "Connect wallet", description: "Please connect your wallet to execute workflow", variant: "destructive" });
            return;
        }

        // Require active session for all chains (enables session bypass for <100ms latency)
        if (!sessionActive || budgetRemaining <= 0) {
            toast({
                title: "Session Required",
                description: "Please create a session to continue. Sessions enable faster responses.",
                variant: "destructive"
            });
            setShowSessionDialog(true);
            return;
        }

        let activeComposeKeyToken = await ensureComposeKeyToken();
        if (!activeComposeKeyToken) {
            activeComposeKeyToken = composeKeyToken;
        }

        if (!activeComposeKeyToken) {
            toast({
                title: "Session Sync Required",
                description: "Compose session key unavailable. Re-open your session and try again.",
                variant: "destructive",
            });
            setShowSessionDialog(true);
            return;
        }

        const attached = attachedFiles[0];
        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: inputValue.trim(),
            timestamp: Date.now(),
            type: attached?.type || "text",
            // Use IPFS URL (attached.url) instead of local preview (attached.preview)
            // This ensures the displayed attachment matches what's sent to the model
            imageUrl: attached?.type === "image" ? attached.url : undefined,
            audioUrl: attached?.type === "audio" ? attached.url : undefined,
            videoUrl: attached?.type === "video" ? attached.url : undefined,
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue("");
        clearFiles();
        setSending(true);
        setChatError(null);
        setChatStatus("paying");
        clearActivityState();
        setActivityPhase("thinking", "Preparing workflow...");
        abortControllerRef.current = new AbortController();

        posthog?.capture("workflow_executed", {
            workflow_wallet: workflowWallet,
            workflow_title: workflow?.title,
            has_attachment: attachedFiles.length > 0,
            continuous: continuousEnabled,
            chain_id: paymentChainId,
        });

        mpTrack("Launch AI");
        mpTrack("AI Prompt Sent and Prompt Text", {
            "Prompt Text": inputValue.trim().slice(0, 500),
        });

        // Create assistant placeholder
        const assistantId = crypto.randomUUID();
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: Date.now() }]);
        const composeRunId = crypto.randomUUID();
        const runStorageKey = `workflow-active-run:${workflowWallet}`;
        let resolvedThreadId: string | null = null;
        let replayEventIndex = 0;

        try {
            setChatStatus("waiting");

            // Chain-aware payment: routes to selected chain
            // When session is active, uses session bypass for instant <100ms latency
            const fetchWithPayment = createPaymentFetch({
                chainId: paymentChainId,
                sessionToken: activeComposeKeyToken,
                sessionUserAddress: sessionActive ? account.address : undefined,
                sessionBudgetRemaining: sessionActive ? budgetRemaining : undefined,
            });

            const attachmentPart = buildAttachmentPart(attached);

            const makeChatRequest = async (): Promise<Response> => {
                // Persistent thread ID scoped to user and workflow workflow
                const userAddress = wallet.getAccount()?.address;
                const threadKey = `workflow-thread-${userAddress}-${workflowWallet}`;
                let threadId = sessionStorage.getItem(threadKey);
                if (!threadId) {
                    threadId = `workflow-${workflowWallet}-user-${userAddress}-${crypto.randomUUID()}`;
                    sessionStorage.setItem(threadKey, threadId);
                }
                resolvedThreadId = threadId;
                setActiveThreadId(threadId);

                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                };

                // Build request body with Pinata URL for attachments
                const requestBody: Record<string, unknown> = {
                    message: userMessage.content,
                    threadId: threadId,
                    composeRunId,
                    lastEventIndex: replayEventIndex,
                    continuous: continuousEnabled,
                };
                sessionStorage.setItem(runStorageKey, JSON.stringify({
                    runId: composeRunId,
                    threadId,
                    lastEventIndex: replayEventIndex,
                    startedAt: Date.now(),
                }));

                if (attachmentPart) {
                    requestBody.attachment = attachmentPart;
                }

                // Use the /workflow/:id/chat endpoint - prefer wallet address for routing
                return fetchWithPayment(`${API_URL}/workflow/${workflowWallet}/chat`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(requestBody),
                    signal: abortControllerRef.current?.signal,
                });
            };

            const response = await makeChatRequest();

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Execution failed: ${response.status}`);
            }

            // Handle streaming response - same pattern as agent.tsx
            const contentType = response.headers.get("content-type") || "";

            if (contentType.includes("text/event-stream") || contentType.includes("text/plain")) {
                const reader = response.body?.getReader();
                if (!reader) throw new Error("No response body");

                setChatStatus("streaming");
                let finalOutput = "";
                let handledStructuredResult = false;

                currentAssistantIdRef.current = assistantId;
                streamedTextRef.current = "";

                const persistReplayCursor = () => {
                    replayEventIndex += 1;
                    if (resolvedThreadId) {
                        sessionStorage.setItem(runStorageKey, JSON.stringify({
                            runId: composeRunId,
                            threadId: resolvedThreadId,
                            lastEventIndex: replayEventIndex,
                            startedAt: Date.now(),
                        }));
                    }
                };

                for await (const block of parseEventStream(reader)) {
                    const dataPayload = block.data.trim();
                    if (!dataPayload || dataPayload === "[DONE]") {
                        continue;
                    }

                    let data: Record<string, unknown>;
                    try {
                        data = JSON.parse(dataPayload) as Record<string, unknown>;
                    } catch {
                        continue;
                    }

                    if (block.event === "start") {
                        const message = typeof data.message === "string" ? data.message : "Starting workflow...";
                        streamedTextRef.current = message;
                        scheduleStreamUpdate(message);
                        setActivityPhase("thinking", message);
                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "step" || block.event === "agent") {
                        const message = typeof data.message === "string"
                            ? data.message
                            : `Processing ${String(data.agentName || data.stepName || "workflow step")}...`;
                        streamedTextRef.current = message;
                        scheduleStreamUpdate(message);
                        setActivityPhase("thinking", message);
                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "progress") {
                        const message = typeof data.message === "string"
                            ? data.message
                            : streamedTextRef.current || "Running workflow...";
                        streamedTextRef.current = message;
                        scheduleStreamUpdate(message);
                        setActivityPhase("thinking", message);
                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "tool_start") {
                        const toolName = typeof data.toolName === "string" ? data.toolName : "tool";
                        const summary = typeof data.content === "string"
                            ? data.content
                            : typeof data.message === "string"
                                ? data.message
                                : undefined;
                        if (summary) {
                            streamedTextRef.current = summary;
                            scheduleStreamUpdate(summary);
                        }
                        startToolActivity(toolName, summary);
                        setActivityPhase("tool", `Using ${toolName}...`);
                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "tool_end") {
                        const toolName = typeof data.toolName === "string" ? data.toolName : "tool";
                        const summary = typeof data.message === "string" ? data.message : undefined;
                        const failed = typeof data.error === "string" && data.error.length > 0;
                        finishToolActivity(toolName, summary, failed);
                        setActivityPhase(failed ? "error" : "thinking", failed ? (data.error as string) : `Processed ${toolName}`);
                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "result") {
                        finalOutput = typeof data.output === "string"
                            ? data.output
                            : typeof data.output === "object" && data.output !== null
                                ? JSON.stringify(data.output)
                                : "";

                        try {
                            const parsed = typeof finalOutput === "string" ? JSON.parse(finalOutput) : finalOutput;
                            if (parsed && typeof parsed === "object" && "type" in parsed && ("url" in parsed || "data" in parsed || "base64" in parsed)) {
                                handledStructuredResult = true;
                                handleJsonResponse(assistantId, parsed);
                                setActivityPhase("streaming", `Generated ${String((parsed as { type?: unknown }).type || "output")}...`);
                            } else if (parsed && typeof parsed === "object" && (parsed as { success?: unknown; error?: unknown }).success === false && typeof (parsed as { error?: unknown }).error === "string") {
                                const errorText = `Error: ${String((parsed as { error: string }).error)}`;
                                streamedTextRef.current = errorText;
                                scheduleStreamUpdate(errorText);
                                setActivityPhase("error", errorText);
                            } else {
                                streamedTextRef.current = finalOutput;
                                scheduleStreamUpdate(finalOutput);
                                setActivityPhase("streaming", "Finalizing response...");
                            }
                        } catch {
                            streamedTextRef.current = finalOutput;
                            scheduleStreamUpdate(finalOutput);
                            setActivityPhase("streaming", "Finalizing response...");
                        }

                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "error") {
                        const errorText = typeof data.error === "string" ? data.error : "Unknown workflow error";
                        streamedTextRef.current = `Error: ${errorText}`;
                        scheduleStreamUpdate(streamedTextRef.current);
                        setActivityPhase("error", errorText);
                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "complete") {
                        const message = typeof data.message === "string" ? data.message : "Workflow complete!";
                        streamedTextRef.current = message;
                        scheduleStreamUpdate(message);
                        setActivityPhase("thinking", message);
                        persistReplayCursor();
                        continue;
                    }

                    if (block.event === "done") {
                        clearActivityState();
                        persistReplayCursor();
                        continue;
                    }
                }

                // Final flush and update
                flushStreamContent();

                if (!handledStructuredResult) {
                    updateAssistantMessage(assistantId, { content: finalOutput || streamedTextRef.current || "Workflow completed" });
                }

                if (!finalOutput && !streamedTextRef.current) {
                    updateAssistantMessage(assistantId, { content: "No response received" });
                }
                sessionStorage.removeItem(runStorageKey);
                clearActivityState();
            } else {
                // Non-streaming response (image/audio/video/json) - use unified handler
                const { parseMultimodalResponse } = await import("@/lib/multimodal");
                const result = await parseMultimodalResponse(response, {
                    uploadToPinata: true,
                    conversationId: `workflow-${workflowWallet}`,
                    // Handle async video polling
                    onVideoPolling: {
                        onProgress: (status, progress) => {
                            setMessages(prev =>
                                prev.map(m => m.id === assistantId ? {
                                    ...m,
                                    content: `Video generating... (${status}${progress ? ` - ${progress}%` : ""})`,
                                } : m)
                            );
                        },
                        onComplete: (url) => {
                            setMessages(prev =>
                                prev.map(m => m.id === assistantId ? {
                                    ...m,
                                    content: "Video generated:",
                                    type: "video",
                                    videoUrl: url,
                                } : m)
                            );
                        },
                        onError: (error) => {
                            setMessages(prev =>
                                prev.map(m => m.id === assistantId ? {
                                    ...m,
                                    content: `Error: ${error}`,
                                } : m)
                            );
                        },
                    },
                });

                // Handle polling - don't update if polling in progress
                if (result.polling) {
                    console.log(`[workflow] Video job submitted, polling: ${result.jobId}`);
                    return;
                }

                if (result.success) {
                    setMessages(prev =>
                        prev.map(m => m.id === assistantId ? {
                            ...m,
                            content: result.content || `Generated ${result.type}:`,
                            type: result.type,
                            imageUrl: result.type === "image" ? result.url : undefined,
                            audioUrl: result.type === "audio" ? result.url : undefined,
                            videoUrl: result.type === "video" ? result.url : undefined,
                        } : m)
                    );
                    sessionStorage.removeItem(runStorageKey);
                } else {
                    throw new Error(result.error || "Request failed");
                }
            }
        } catch (err) {
            // Silent return for user-initiated abort via stop button
            if (err instanceof DOMException && err.name === "AbortError") {
                clearActivityState();
                return;
            }

            let errorMsg = err instanceof Error ? err.message : "Unknown error";

            // Note: Recovery loops removed - rely on backend Temporal state persistence
            // Frontend simply displays errors immediately for better UX
            // Backend handles state via Temporal workflows (resumable via run state endpoint)

            setChatError(errorMsg);
            setActivityPhase("error", errorMsg);
            mpError("workflow_execution", errorMsg, { workflow_wallet: workflowWallet });
            setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${errorMsg}` } : m)
            );
        } finally {
            setSending(false);
            setChatStatus("idle");
            abortControllerRef.current = null;
        }
    }, [inputValue, sending, workflow, workflowWallet, wallet, account, toast, attachedFiles, clearFiles, paymentChainId, sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken, setShowSessionDialog, continuousEnabled, scheduleStreamUpdate, flushStreamContent, updateAssistantMessage, handleJsonResponse, posthog, clearActivityState, setActivityPhase, startToolActivity, finishToolActivity]);

    const handleStopExecution = useCallback(async () => {
        if (!workflow?.walletAddress || !activeThreadId) return;
        try {
            abortControllerRef.current?.abort();
            await fetch(`${API_URL}/workflow/${workflow.walletAddress}/stop`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId: activeThreadId }),
            });
            posthog?.capture("workflow_stopped", {
                workflow_wallet: workflow.walletAddress,
                workflow_title: workflow.title,
                thread_id: activeThreadId,
            });
            clearActivityState();
            setChatStatus("idle");
            setSending(false);
            toast({ title: "Stopped", description: "Workflow execution stopped" });
        } catch {
            toast({ title: "Stop failed", description: "Could not stop workflow", variant: "destructive" });
        }
    }, [workflow?.walletAddress, workflow?.title, activeThreadId, toast, posthog]);

    const copyEndpoint = () => {
        toast({
            title: "Copied!",
            description: "Manowar endpoint copied to clipboard",
        });
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-[calc(100vh-120px)]">
                <div className="shrink-0 mb-3 flex items-center justify-between">
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-6 w-24" />
                </div>
                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2">
                        <Skeleton className="h-full w-full rounded-lg" />
                    </div>
                    <div className="lg:col-span-1 hidden lg:block">
                        <WorkflowCardSkeleton />
                    </div>
                </div>
            </div>
        );
    }

    if (workflowError || !workflow) {
        return (
            <div className="flex flex-col h-[calc(100vh-120px)]">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-3" onClick={() => history.back()}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                </Button>

                <div className="flex-1 flex items-center justify-center border border-dashed border-red-500/30 rounded-lg">
                    <div className="text-center">
                        <Shield className="w-10 h-10 mx-auto text-red-400/50 mb-3" />
                        <p className="text-red-400 font-mono">Manowar not found</p>
                        <p className="text-muted-foreground text-xs mt-1">This workflow may not exist.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-120px)]">
            {/* Compact Header */}
            <div className="shrink-0 mb-3 flex items-center justify-between">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 h-7 px-2" onClick={() => history.back()}>
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                    <span className="hidden sm:inline">Back</span>
                </Button>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                            id="continuous-execution"
                            checked={continuousEnabled}
                            onCheckedChange={(val) => setContinuousEnabled(Boolean(val))}
                        />
                        <label htmlFor="continuous-execution" className="cursor-pointer select-none">
                            Continuous (max 5)
                        </label>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-red-400 h-7 w-7 p-0"
                        onClick={handleStopExecution}
                        disabled={!sending && chatStatus !== "streaming"}
                        aria-label="Stop workflow"
                    >
                        <StopCircle className="w-4 h-4" />
                    </Button>
                    <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                        <Layers className="w-3 h-3 mr-1" />
                        Manowar {workflow.walletAddress?.slice(0, 6)}…{workflow.walletAddress?.slice(-4)}
                    </Badge>
                </div>

                {/* Mobile Card Button - only visible on mobile */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="lg:hidden text-muted-foreground hover:text-fuchsia-400 h-7 w-7 p-0 ml-2"
                    onClick={() => setMobileCardOpen(true)}
                    aria-label="View workflow details"
                >
                    <IdCard className="w-4 h-4" />
                </Button>
            </div>

            {/* Main Layout: Chat on Left, Card on Right */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Chat Section (2/3 width on desktop, full on mobile) */}
                <div className="lg:col-span-2 min-h-0 flex flex-col">
                    {!hasCoordinator ? (
                        <div className="flex-1 flex items-center justify-center border border-dashed border-yellow-500/30 rounded-lg bg-yellow-500/5">
                            <div className="text-center p-6">
                                <Layers className="w-10 h-10 mx-auto text-yellow-400/50 mb-3" />
                                <p className="text-yellow-400 font-mono">No Coordinator Assigned</p>
                                <p className="text-muted-foreground text-sm mt-2 max-w-md">
                                    This workflow does not have a coordinator model. It cannot be executed interactively.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <MultimodalCanvas
                            variant="workflow"
                            title={`Execute ${workflow.title || `Manowar #${workflow.id}`}`}
                            messages={messages}
                            inputValue={inputValue}
                            onInputChange={setInputValue}
                            onSend={handleSendMessage}
                            sending={sending}
                            status={chatStatus}
                            activityState={activityState}
                            error={chatError}
                            sessionActive={sessionActive}
                            onStartSession={() => setShowSessionDialog(true)}
                            attachedFiles={attachedFiles}
                            onFileSelect={() => fileInputRef.current?.click()}
                            onRemoveFile={handleRemoveFile}
                            fileInputRef={fileInputRef}
                            onFileInputChange={handleFileSelect}
                            isRecording={isRecording}
                            recordingSupported={recordingSupported}
                            onStartRecording={startRecording}
                            onStopRecording={stopRecording}
                            scrollContainerRef={scrollContainerRef}
                            messagesEndRef={messagesEndRef}
                            showMessageActions
                            onCopyMessage={(content) => {
                                navigator.clipboard.writeText(content);
                                toast({ title: "Copied!", description: "Message copied to clipboard" });
                            }}
                            onRetryMessage={(content) => {
                                setInputValue(content);
                                toast({ title: "Retry", description: "Message loaded for re-sending" });
                            }}
                            onDeleteMessage={(id) => setMessages(prev => prev.filter(m => m.id !== id))}
                            height="h-full"
                            emptyStateText="Ready to execute workflow."
                            emptyStateSubtext={`Input will be sent to Coordinator: ${workflow.coordinatorModel || "Model"}`}
                        />
                    )}
                </div>

                {/* Manowar Card (1/3 width on desktop, hidden on mobile) */}
                <div className="lg:col-span-1 hidden lg:flex flex-col min-h-0">
                    <WorkflowCard
                        workflow={workflow}
                        onCopyEndpoint={copyEndpoint}
                    />
                </div>
            </div>

            {/* Session Budget Dialog */}
            <SessionBudgetDialog open={showSessionDialog} onOpenChange={setShowSessionDialog} showTrigger={false} />

            {/* Mobile Card Sheet */}
            <Sheet open={mobileCardOpen} onOpenChange={setMobileCardOpen}>
                <SheetContent side="right" className="w-[340px] sm:w-[400px] p-0 overflow-y-auto">
                    <SheetHeader className="p-4 border-b border-sidebar-border">
                        <SheetTitle className="font-display text-fuchsia-400 flex items-center gap-2">
                            <IdCard className="w-4 h-4" />
                            Workflow Details
                        </SheetTitle>
                    </SheetHeader>
                    <div className="p-4">
                        <WorkflowCard
                            workflow={workflow}
                            onCopyEndpoint={copyEndpoint}
                        />
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
