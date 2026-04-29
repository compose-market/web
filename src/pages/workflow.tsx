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
import { usePostHog } from "@posthog/react";
import { mpTrack, mpError } from "@/lib/mixpanel";
import { useParams } from "wouter";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { sdk } from "@/lib/sdk";
import { useChain } from "@/contexts/ChainContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { useOnchainWorkflowByIdentifier } from "@/hooks/use-onchain";
import { MultimodalCanvas } from "@/components/chat";
import { toComposeAttachment, useChat } from "@/hooks/use-chat";
import { useComposeStream } from "@/hooks/use-stream";
import { CostReceiptIndicator } from "@/components/receipt-indicator";
import { ToolTimeline } from "@/components/tool-timeline";
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
        addUserMessage, createAssistantPlaceholder, updateAssistantMessage,
        activityState,
        // Attachments
        attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, clearFiles,
        // Recording
        isRecording, recordingSupported, startRecording, stopRecording,
    } = chat;

    // Shared SDK streaming dispatcher for every workflow run.
    const streamer = useComposeStream(chat, {
        onError: (e) => setChatError(e.message),
        onDone: () => setSending(false),
    });

    const [inputValue, setInputValue] = useState("");
    const [sending, setSending] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
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

        const assistantId = createAssistantPlaceholder();
        const composeRunId = crypto.randomUUID();
        const replayEventIndex = 0;

        try {
            const activeComposeKeyToken = composeKeyToken || sdk.keys.currentToken() || await ensureComposeKeyToken();
            if (!activeComposeKeyToken) {
                toast({
                    title: "Session Sync Required",
                    description: "Compose session key unavailable. Re-open your session and try again.",
                    variant: "destructive",
                });
                setShowSessionDialog(true);
                throw new Error("Compose session key unavailable. Re-open your session and try again.");
            }
            sdk.keys.use(activeComposeKeyToken);

            abortControllerRef.current = new AbortController();

            // Persistent thread ID scoped to user + workflow
            const userAddress = wallet.getAccount()?.address ?? account.address;
            const threadKey = `workflow-thread-${userAddress}-${workflowWallet}`;
            let threadId = sessionStorage.getItem(threadKey);
            if (!threadId) {
                threadId = `workflow-${workflowWallet}-user-${userAddress}-${crypto.randomUUID()}`;
                sessionStorage.setItem(threadKey, threadId);
            }
            setActiveThreadId(threadId);

            const attachmentPart = toComposeAttachment(attached);
            await streamer.runWorkflow({
                workflowWallet,
                message: prompt,
                threadId,
                userAddress,
                composeRunId,
                continuous: continuousEnabled,
                lastEventIndex: replayEventIndex,
                ...(attachmentPart ? { attachment: attachmentPart } : {}),
                assistantId,
                signal: abortControllerRef.current.signal,
                options: {
                    composeKey: activeComposeKeyToken,
                    userAddress,
                    chainId: paymentChainId,
                },
            });
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                return;
            }
            const errorMsg = err instanceof Error ? err.message : String(err);
            setChatError(errorMsg);
            updateAssistantMessage(assistantId, { content: `Error: ${errorMsg}` });
            mpError("workflow_execution", errorMsg, { workflow_wallet: workflowWallet });
        } finally {
            setSending(false);
            abortControllerRef.current = null;
        }
    }, [inputValue, sending, workflow, workflowWallet, wallet, account, toast, attachedFiles, addUserMessage, clearFiles, createAssistantPlaceholder, updateAssistantMessage, paymentChainId, sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken, continuousEnabled, streamer, posthog]);

    const handleStopExecution = useCallback(async () => {
        if (!workflow?.walletAddress || !activeThreadId) return;
        try {
            abortControllerRef.current?.abort();
            await sdk.fetch(`/workflow/${workflow.walletAddress}/stop`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId: activeThreadId }),
            });
            posthog?.capture("workflow_stopped", {
                workflow_wallet: workflow.walletAddress,
                workflow_title: workflow.title,
                thread_id: activeThreadId,
            });
            chat.clearActivityState();
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
                    <ToolTimeline />
                    <CostReceiptIndicator />
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
                        disabled={!sending}
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
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="lg:hidden text-muted-foreground hover:text-fuchsia-400 h-7 w-7 p-0"
                        onClick={() => setMobileCardOpen(true)}
                        aria-label="View workflow details"
                    >
                        <IdCard className="w-4 h-4" />
                    </Button>
                </div>
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
                            status={sending ? "streaming" : "idle"}
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

                {/* Workflow Card (1/3 width on desktop, hidden on mobile) */}
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
