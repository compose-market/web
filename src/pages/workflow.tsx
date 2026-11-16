/**
 * Compose Workflow Page
 * 
 * Provides interactive chat/execution interface for Compose workflows.
 * Fetches Compose data -> Coordinator Agent -> Executes chat via Coordinator.
 * 
 * Layout: Chat on left, WorkflowCard on right (matching agent.tsx pattern)
 * Uses shared MultimodalCanvas component and hooks for the chat interface.
 */
import { useState, useCallback, useRef } from "react";
import { useParams } from "wouter";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { sdk } from "@/lib/sdk";
import { useChain } from "@/contexts/Network";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { SessionBudgetDialog } from "@/components/session";
import { useOnchainWorkflowByIdentifier } from "@/hooks/use-onchain";
import { MultimodalCanvas } from "@/components/chat";
import { Trace } from "@/components/trace";
import { toAttachment, useChat } from "@/hooks/use-chat";
import { useConversationThread, type ThreadKey } from "@/hooks/use-thread";
import { useStream } from "@/hooks/use-stream";
import { WorkflowCard, WorkflowCardSkeleton } from "@/components/workflow-card";
import { Pockets } from "@/components/control";
import {
    ArrowLeft,
    Shield,
    Layers,
    StopCircle,
    PanelRightClose,
    PanelRightOpen,
} from "lucide-react";


export default function ManowarPage() {
    const params = useParams<{ id: string }>();
    const workflowIdentifier = params.id || null;

    // Use identifier-based lookup (supports both wallet address and numeric ID)
    const { data: workflow, isLoading, error: workflowError } = useOnchainWorkflowByIdentifier(workflowIdentifier);

    // Coordinator exists if hasCoordinator is true
    const hasCoordinator = !!workflow?.hasCoordinator;

    const { toast } = useToast();
    const wallet = useActiveWallet();
    const account = useActiveAccount();
    const { paymentNetwork } = useChain();
    const {
        userAddress: selectedUserAddress,
        isResolving: userAddressResolving,
    } = useSelectedUserAddress();
    const { sessionActive, budgetRemaining, keyToken, resolveActiveKeyToken } = useSession();

    // Chat state from shared hook (includes messages, attachments, and recording)
    const workflowWallet = workflow?.walletAddress;
    const chat = useChat({
        conversationId: `workflow-${workflowWallet || 'unknown'}`,
        onError: (err) => setChatError(err),
    });
    const { messages, setMessages, scrollContainerRef, messagesEndRef,
        addUserMessage, createAssistantPlaceholder,
        failAssistant,
        activityState,
        latestActivity,
        latestReceipt,
        latestUsage,
        // Attachments
        attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, clearFiles,
        // Recording
        isRecording, recordingSupported, startRecording, stopRecording,
    } = chat;

    // Shared SDK streaming dispatcher for every workflow run.
    const streamer = useStream(chat, {
        onError: (e) => setChatError(e.message),
        onDone: () => setSending(false),
    });

    const [inputValue, setInputValue] = useState("");
    const [sending, setSending] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const [continuousEnabled, setContinuousEnabled] = useState(false);
    const [traceOpen, setTraceOpen] = useState(false);
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const getWorkflowThreadKey = useCallback((): ThreadKey | null => {
        if (!workflowWallet || !selectedUserAddress) return null;
        return {
            key: `workflow-thread-${selectedUserAddress}-${workflowWallet}`,
            idPrefix: `workflow-${workflowWallet}-user-${selectedUserAddress}`,
        };
    }, [selectedUserAddress, workflowWallet]);
    const { threadIdRef, ensureConversationThread } = useConversationThread(getWorkflowThreadKey);

    // Session dialog
    const [showSessionDialog, setShowSessionDialog] = useState(false);

    // Mobile in-stage pocket + Desktop collapse state
    const [pocket, setPocket] = useState<"run" | "spec">("run");
    const [paneCollapsed, setPaneCollapsed] = useState(false);

    // Send chat message with x402 payment
    const handleSendMessage = useCallback(async () => {
        if (attachedFiles.some(f => f.uploading)) return;
        if ((!inputValue.trim() && attachedFiles.length === 0) || sending || !workflow || !workflowWallet) return;

        if (!wallet || !account) {
            toast({ title: "Connect wallet", description: "Please connect your wallet to execute workflow", variant: "destructive" });
            return;
        }

        if (!selectedUserAddress || userAddressResolving) {
            toast({
                title: "Account resolving",
                description: "Wait for the selected network account before executing workflow.",
                variant: "destructive",
            });
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

        const attached = attachedFiles[0];
        const prompt = inputValue.trim();

        addUserMessage(prompt, {
            type: attached?.type === "image" || attached?.type === "audio" || attached?.type === "video" ? attached.type : "text",
            imageUrl: attached?.type === "image" ? attached.url : undefined,
            audioUrl: attached?.type === "audio" ? attached.url : undefined,
            videoUrl: attached?.type === "video" ? attached.url : undefined,
        });
        setInputValue("");
        clearFiles();
        setSending(true);
        setChatError(null);
        abortControllerRef.current = new AbortController();

        const assistantId = createAssistantPlaceholder();
        const runId = crypto.randomUUID();
        const replayEventIndex = 0;

        try {
            const activeKeyToken = await resolveActiveKeyToken();
            if (!activeKeyToken) {
                toast({
                    title: "Session Sync Required",
                    description: "Compose session key unavailable. Re-open your session and try again.",
                    variant: "destructive",
                });
                setShowSessionDialog(true);
                throw new Error("Compose session key unavailable. Re-open your session and try again.");
            }
            sdk.keys.use(activeKeyToken);

            abortControllerRef.current = new AbortController();

            // Persistent thread ID scoped to user + workflow
            const threadId = ensureConversationThread();

            const attachmentPart = toAttachment(attached);
            await streamer.runWorkflow({
                workflowWallet,
                message: prompt,
                threadId,
                runId,
                continuous: continuousEnabled,
                lastEventIndex: replayEventIndex,
                ...(attachmentPart ? { attachment: attachmentPart } : {}),
                assistantId,
                signal: abortControllerRef.current.signal,
                options: {
                    key: activeKeyToken,
                    userAddress: selectedUserAddress,
                    ...(paymentNetwork ? { network: paymentNetwork } : {}),
                },
            });
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                return;
            }
            const errorMsg = err instanceof Error ? err.message : String(err);
            setChatError(errorMsg);
            failAssistant(assistantId, errorMsg);
        } finally {
            setSending(false);
            abortControllerRef.current = null;
        }
    }, [inputValue, sending, workflow, workflowWallet, wallet, account, toast, attachedFiles, addUserMessage, clearFiles, createAssistantPlaceholder, failAssistant, paymentNetwork, sessionActive, budgetRemaining, keyToken, resolveActiveKeyToken, continuousEnabled, ensureConversationThread, streamer, selectedUserAddress, userAddressResolving]);

    const handleStopExecution = useCallback(async () => {
        if (!workflow?.walletAddress || !threadIdRef.current) return;
        try {
            abortControllerRef.current?.abort();
            await sdk.workflow.stop(workflow.walletAddress, threadIdRef.current);
            chat.clearActivityState();
            setSending(false);
            toast({ title: "Stopped", description: "Workflow execution stopped" });
        } catch {
            toast({ title: "Stop failed", description: "Could not stop workflow", variant: "destructive" });
        }
    }, [workflow?.walletAddress, threadIdRef, toast, chat]);

    const copyEndpoint = useCallback(() => {
        toast({
            title: "Copied!",
            description: "Workflow endpoint copied to clipboard",
        });
    }, [toast]);

    const handleStartSession = useCallback(() => {
        setShowSessionDialog(true);
    }, []);

    const handleFileSelectClick = useCallback(() => {
        fileInputRef.current?.click();
    }, [fileInputRef]);

    const handleStopClick = useCallback(() => {
        void handleStopExecution();
    }, [handleStopExecution]);

    const handleInspectFlow = useCallback((nodeId?: string) => {
        setFocusedNodeId(nodeId ?? null);
        setTraceOpen(true);
    }, []);

    const handleCopyMessage = useCallback((content: string) => {
        void navigator.clipboard.writeText(content);
        toast({ title: "Copied!", description: "Message copied to clipboard" });
    }, [toast]);

    const handleRetryMessage = useCallback((content: string) => {
        setInputValue(content);
        toast({ title: "Retry", description: "Message loaded for re-sending" });
    }, [toast]);

    const handleDeleteMessage = useCallback((id: string) => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
    }, [setMessages]);

    const handleCloseTrace = useCallback(() => {
        setTraceOpen(false);
    }, []);

    if (isLoading) {
        return (
            <div className="cm-chat-workspace">
                <div className="shrink-0 mb-3 flex items-center justify-between">
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-6 w-24" />
                </div>
                <div className="cm-split">
                    <div className="cm-split__main">
                        <Skeleton className="h-full w-full rounded-lg" />
                    </div>
                    <div className="cm-split__side">
                        <WorkflowCardSkeleton />
                    </div>
                </div>
            </div>
        );
    }

    if (workflowError || !workflow) {
        return (
            <div className="cm-chat-workspace">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-3" onClick={() => history.back()}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                </Button>

                <div className="flex-1 flex items-center justify-center border border-dashed border-red-500/30 rounded-lg">
                    <div className="text-center">
                        <Shield className="w-10 h-10 mx-auto text-red-400/50 mb-3" />
                        <p className="text-red-400 font-mono">Workflow not found</p>
                        <p className="text-muted-foreground text-xs mt-1">This workflow may not exist.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="cm-chat-workspace">
            {/* Compact Header */}
            <div className="cm-control-rail cm-control-rail--compact cm-control-rail--inline">
                <Button
                    variant="ghost"
                    size="sm"
                    className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm"
                    onClick={() => history.back()}
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                    <span className="hidden sm:inline">Back</span>
                </Button>

                <div className="cm-control-rail__main flex items-center gap-3">
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
                        className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm text-muted-foreground hover:text-red-400"
                        onClick={handleStopExecution}
                        disabled={!sending}
                        aria-label="Stop workflow"
                    >
                        <StopCircle className="w-4 h-4" />
                    </Button>
                    <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                        <Layers className="w-3 h-3 mr-1" />
                        Workflow {workflow.walletAddress?.slice(0, 6)}…{workflow.walletAddress?.slice(-4)}
                    </Badge>
                </div>

                <div className="cm-control-rail__actions">
                    <Pockets
                        value={pocket}
                        label="Workflow view"
                        className="cm-pocket-bar--split"
                        onChange={setPocket}
                        options={[
                            { value: "run", label: "Run" },
                            { value: "spec", label: "Spec" },
                        ]}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm cm-split__collapse-btn"
                        onClick={() => setPaneCollapsed((prev) => !prev)}
                        aria-label={paneCollapsed ? "Show workflow spec" : "Hide workflow spec"}
                        title={paneCollapsed ? "Show workflow spec" : "Hide workflow spec"}
                    >
                        {paneCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
                    </Button>
                </div>
            </div>

            {/* Main Layout: Desktop side-by-side, Mobile in-stage pockets */}
            <div
                className="cm-split"
                data-pocket={pocket === "run" ? "main" : "side"}
                data-collapsed={paneCollapsed ? "true" : undefined}
            >
                <div className="cm-split__main flex flex-col">
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
                            title={`Execute ${workflow.title || `Workflow #${workflow.id}`}`}
                            messages={messages}
                            inputValue={inputValue}
                            onInputChange={setInputValue}
                            onSend={handleSendMessage}
                            sending={sending}
                            status={sending ? "streaming" : "idle"}
                            activityState={activityState}
                            stepCount={activityState.tools.length}
                            latestReceipt={latestReceipt}
                            error={chatError}
                            sessionActive={sessionActive}
                            onStartSession={handleStartSession}
                            attachedFiles={attachedFiles}
                            onFileSelect={handleFileSelectClick}
                            onRemoveFile={handleRemoveFile}
                            fileInputRef={fileInputRef}
                            onFileInputChange={handleFileSelect}
                            isRecording={isRecording}
                            recordingSupported={recordingSupported}
                            onStartRecording={startRecording}
                            onStopRecording={stopRecording}
                            onStop={handleStopClick}
                            onInspectFlow={handleInspectFlow}
                            scrollContainerRef={scrollContainerRef}
                            messagesEndRef={messagesEndRef}
                            showMessageActions
                            onCopyMessage={handleCopyMessage}
                            onRetryMessage={handleRetryMessage}
                            onDeleteMessage={handleDeleteMessage}
                            height="h-full"
                            emptyStateText="Ready to execute workflow."
                            emptyStateSubtext={`Input will be sent to Coordinator: ${workflow.coordinatorModel || "Model"}`}
                        />
                    )}
                </div>

                <div className="cm-split__side overflow-y-auto">
                    <WorkflowCard
                        workflow={workflow}
                        onCopyEndpoint={copyEndpoint}
                    />
                </div>
            </div>

            <Trace
                open={traceOpen}
                onClose={handleCloseTrace}
                activity={latestActivity}
                receipt={latestReceipt}
                usage={latestUsage}
                focusedNodeId={focusedNodeId}
            />

            {/* Session Budget Dialog */}
            <SessionBudgetDialog open={showSessionDialog} onOpenChange={setShowSessionDialog} showTrigger={false} />
        </div>
    );
}
