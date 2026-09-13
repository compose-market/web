/**
 * Agent Detail Page with Chat Interface
 * 
 * Shows agent info and provides interactive chat with x402 payments.
 * Includes knowledge upload and file attachments.
 * 
 * Layout: Chat on left, AgentCard on right
 * Uses shared MultimodalCanvas component and hooks for the chat interface.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { usePostHog } from "@posthog/react";
import { mpTrack, mpError } from "@/lib/mixpanel";
import { useParams } from "wouter";
import { Link } from "wouter";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { sdk } from "@/lib/sdk";
import { uploadWorkspaceFiles } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { useChain } from "@/contexts/Network";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint, ShellButton } from "@compose-market/theme/shell";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { SessionBudgetDialog } from "@/components/session";
import { BackpackDialog } from "@/components/backpack";
import { useAgentByIdentifier } from "@/hooks/use-agents";
import { MultimodalCanvas } from "@/components/chat";
import { toAttachment, useChat, type Plan } from "@/hooks/use-chat";
import { useConversationThread, type ThreadKey } from "@/hooks/use-thread";
import { useStream } from "@/hooks/use-stream";
import { MissionControlSidePanel } from "@/components/mission-control";
import { CostReceiptIndicator } from "@/components/receipt-indicator";
import {
  getCachedBackpackPermissions,
  resolveBackpackUserId,
  type BackpackCloudPermission,
} from "@/lib/backpack";
import { AgentCard, AgentCardSkeleton } from "@/components/agent-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowLeft,
  Sparkles,
  Shield,
  Download,
  X,
  IdCard,
  Backpack,
  Activity,
  Loader2,
} from "lucide-react";

export default function AgentDetailPage() {
  const posthog = usePostHog();
  const params = useParams<{ id: string }>();
  // id is always the wallet address (preferred)
  const identifier = params.id || null;
  const { data: agent, isLoading, error, isIndexing } = useAgentByIdentifier(identifier);
  const { toast } = useToast();
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const { paymentNetwork } = useChain();
  const {
    userAddress: selectedUserAddress,
    isResolving: userAddressResolving,
  } = useSelectedUserAddress();
  const { sessionActive, budgetRemaining, keyToken, resolveActiveKeyToken } = useSession();

  // Build the A2A-compatible endpoint URL using wallet address (canonical identifier)
  const agentWallet = agent?.walletAddress;

  // Chat state from shared hook (includes messages, attachments, and recording)
  const chat = useChat({
    conversationId: `agent-${agentWallet || 'unknown'}`,
    onError: (err) => setChatError(err),
  });
  const { messages, setMessages, clearMessages, scrollContainerRef, messagesEndRef,
    addUserMessage, createAssistantPlaceholder, updateAssistantMessage,
    failAssistant,
    activityState,
    latestActivity, latestPlan,
    // Attachments
    attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, clearFiles,
    // Recording
    isRecording, recordingSupported, startRecording, stopRecording,
  } = chat;

  // Shared SDK streaming dispatcher. All rich SSE events (text, thinking,
  // tool-use, receipts, budget, sessionInvalid) are dispatched into the
  // chat activity sink + the sdk.events bus — nothing handled per-page.
  const streamer = useStream(chat, {
    onError: (e) => setChatError(e.message),
    onDone: () => setSending(false),
  });
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<File[]>([]);
  const [workspaceUploading, setWorkspaceUploading] = useState(false);

  // Session dialog
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [backpackOpen, setBackpackOpen] = useState(false);

  // Side panel tab state — both AgentCard and MissionControl always accessible
  const [activeSideTab, setActiveSideTab] = useState<"agent" | "mission">("agent");
  const [mobileSideOpen, setMobileSideOpen] = useState(false);

  const getConversationThreadKey = useCallback((): ThreadKey | null => {
    if (!agentWallet || !selectedUserAddress || userAddressResolving) {
      return null;
    }
    const backpackUserId = resolveBackpackUserId(selectedUserAddress);
    return {
      key: `agent-thread-${backpackUserId}-${agentWallet}`,
      idPrefix: `thread-${backpackUserId}-${agentWallet}`,
    };
  }, [agentWallet, selectedUserAddress, userAddressResolving]);

  const { threadIdRef, rootRunIdRef, resetConversationThread, ensureConversationThread, ensureConversationRootRun } = useConversationThread(getConversationThreadKey);

  const showMissionControl = sending || Boolean(latestActivity) || Boolean(latestPlan);

  // Auto-switch to mission tab when streaming starts
  const prevSending = useRef(sending);
  useEffect(() => {
    if (sending && !prevSending.current) {
      setActiveSideTab("mission");
    }
    prevSending.current = sending;
  }, [sending]);

  const handleClearChat = useCallback(() => {
    clearMessages();
    clearFiles();
    setChatError(null);
    resetConversationThread();
  }, [clearFiles, clearMessages, resetConversationThread]);

  const openBackpack = useCallback(() => {
    if (!agentWallet) {
      toast({
        title: "Agent unavailable",
        description: "Wait for the agent to load before opening your backpack.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedUserAddress || userAddressResolving) {
      toast({
        title: "Connect wallet",
        description: "Wait for the selected network account before opening your backpack.",
        variant: "destructive",
      });
      return;
    }
    setBackpackOpen(true);
  }, [agentWallet, selectedUserAddress, toast, userAddressResolving]);

  const openWorkspaceDialog = useCallback(() => {
    if (!sessionActive || budgetRemaining <= 0) {
      toast({
        title: "Session Required",
        description: "Create a session before indexing private workspace knowledge.",
        variant: "destructive",
      });
      setShowSessionDialog(true);
      return;
    }

    setWorkspaceOpen(true);
  }, [budgetRemaining, sessionActive, toast]);

  const handleWorkspaceFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) {
      return;
    }

    setWorkspaceFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...prev];
      for (const file of selected) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        next.push(file);
      }
      return next;
    });

    e.target.value = "";
  }, []);

  const removeWorkspaceFile = useCallback((target: File) => {
    setWorkspaceFiles((prev) => prev.filter((file) => (
      file.name !== target.name
      || file.size !== target.size
      || file.lastModified !== target.lastModified
    )));
  }, []);

  const handleWorkspaceUpload = useCallback(async () => {
    if (!agentWallet || !account) {
      toast({
        title: "Connect wallet",
        description: "Please connect your wallet to upload workspace knowledge.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedUserAddress || userAddressResolving) {
      toast({
        title: "Account resolving",
        description: "Wait for the selected network account before uploading workspace knowledge.",
        variant: "destructive",
      });
      return;
    }

    if (workspaceFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Choose at least one knowledge file first.",
        variant: "destructive",
      });
      return;
    }

    const activeKeyToken = await resolveActiveKeyToken();

    if (!activeKeyToken) {
      toast({
        title: "Session Sync Required",
        description: "Compose session key unavailable. Re-open your session and try again.",
        variant: "destructive",
      });
      setShowSessionDialog(true);
      return;
    }

    setWorkspaceUploading(true);
    try {
      const result = await uploadWorkspaceFiles(workspaceFiles, {
        agentWallet,
        userAddress: selectedUserAddress,
      });

      toast({
        title: "Workspace indexed",
        description: `Indexed ${result.indexed} private knowledge chunks for this user-agent pair.`,
      });
      setWorkspaceFiles([]);
      setWorkspaceOpen(false);
    } catch (error) {
      toast({
        title: "Workspace upload failed",
        description: error instanceof Error ? error.message : "Unable to index workspace knowledge",
        variant: "destructive",
      });
    } finally {
      setWorkspaceUploading(false);
    }
  }, [account, agentWallet, keyToken, resolveActiveKeyToken, selectedUserAddress, toast, userAddressResolving, workspaceFiles]);

  // Send chat message with x402 payment
  const handleSendMessage = useCallback(async (selectedSlashCommands: string[] = []) => {
    if (attachedFiles.some(f => f.uploading)) return false;
    if ((!inputValue.trim() && attachedFiles.length === 0) || sending || !agentWallet) return false;

    if (!wallet || !account) {
      toast({ title: "Connect wallet", description: "Please connect your wallet to chat", variant: "destructive" });
      return false;
    }

    if (!selectedUserAddress || userAddressResolving) {
      toast({
        title: "Account resolving",
        description: "Wait for the selected network account before chatting.",
        variant: "destructive",
      });
      return false;
    }

    // Require active session for all chains (enables session bypass for <100ms latency)
    if (!sessionActive || budgetRemaining <= 0) {
      toast({
        title: "Session Required",
        description: "Please create a session to continue. Sessions enable faster responses.",
        variant: "destructive"
      });
      setShowSessionDialog(true);
      return false;
    }

    const attached = attachedFiles[0];
    const userAddress = selectedUserAddress;
    const backpackUserId = resolveBackpackUserId(userAddress);
    const prompt = inputValue.trim();
    const selected = new Set(selectedSlashCommands);
    const selectedControls = {
      ...(selected.has("plan") ? { plan: true } : {}),
      ...(selected.has("sandbox") ? { sandbox: true } : {}),
      ...(selected.has("proof") ? { proof: true } : {}),
      ...(selected.has("goal") ? {
        action: {
          name: "goal",
          source: "slash",
          args: { objective: prompt },
        },
      } : {}),
    };
    let accepted = false;

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
    accepted = true;

    posthog?.capture("agent_chat_sent", {
      agent_wallet: agentWallet,
      agent_name: agent?.metadata?.name,
      has_attachment: attachedFiles.length > 0,
      attachment_type: attachedFiles[0]?.type ?? null,
      network: paymentNetwork,
    });

    mpTrack("Launch AI");
    mpTrack("AI Prompt Sent and Prompt Text", {
      "Prompt Text": inputValue.trim().slice(0, 500),
    });

    const assistantId = createAssistantPlaceholder();
    // Stable per-thread root run: every turn of this conversation lands in
    // one runstate namespace (archive, conclave, watch); the runtime mints
    // a fresh child runId per turn.
    const runId = ensureConversationRootRun();

    try {
      if (!agent) throw new Error("Agent not loaded");
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

      const threadId = ensureConversationThread();

      const attachmentPart = toAttachment(attached);
      await streamer.runAgent({
        agentWallet,
        message: prompt,
        threadId,
        userAddress: backpackUserId,
        runId: runId,
        cloudPermissions: getCachedBackpackPermissions(agentWallet),
        ...(attachmentPart ? { attachment: attachmentPart } : {}),
        ...selectedControls,
        assistantId,
        options: {
          key: activeKeyToken,
          userAddress,
          network: paymentNetwork,
        },
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setChatError(errorMsg);
        failAssistant(assistantId, errorMsg);
        mpError("agent_chat", errorMsg, { agent_wallet: agentWallet });
      }
    } finally {
      setSending(false);
    }
    return accepted;
  }, [inputValue, sending, agentWallet, wallet, account, toast, agent, attachedFiles, addUserMessage, clearFiles, createAssistantPlaceholder, failAssistant, paymentNetwork, sessionActive, budgetRemaining, keyToken, resolveActiveKeyToken, ensureConversationThread, ensureConversationRootRun, streamer, posthog, selectedUserAddress, userAddressResolving]);

  const handlePlanDecision = useCallback(async (
    messageId: string,
    plan: Plan,
    decision: NonNullable<Plan["decision"]>,
    feedback?: string,
  ) => {
    if (!agentWallet) return;
    const runId = plan.runId;
    if (!runId) {
      updateAssistantMessage(messageId, {
        proposal: { ...plan, error: "Plan decision is missing runId." },
      });
      return;
    }
    updateAssistantMessage(messageId, { proposal: { ...plan, pending: true, error: undefined } });
    try {
      const activeKeyToken = await resolveActiveKeyToken();
      if (activeKeyToken) sdk.keys.use(activeKeyToken);
      await sdk.agent.decide({
        agentWallet,
        runId,
        proposalId: plan.proposalId,
        proposalVersion: plan.version,
        decision,
        approver: selectedUserAddress ?? undefined,
        ...(feedback ? { feedback, reason: feedback } : {}),
      });
      updateAssistantMessage(messageId, {
        proposal: {
          ...plan,
          pending: false,
          decision,
          state: decision === "approved" ? "approved" : decision,
          feedback,
        },
      });
      if (decision === "approved" && threadIdRef.current) {
        void streamer.watchPlan({ agentWallet, runId, threadId: threadIdRef.current });
      }
      toast({
        title: decision === "approved" ? "Plan approved" : decision === "changes_requested" ? "Changes requested" : "Plan rejected",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAssistantMessage(messageId, {
        proposal: { ...plan, pending: false, error: message },
      });
      toast({
        title: "Plan decision failed",
        description: message,
        variant: "destructive",
      });
    }
  }, [agentWallet, keyToken, resolveActiveKeyToken, selectedUserAddress, toast, updateAssistantMessage]);

  const copyEndpoint = () => {
    toast({
      title: "Copied!",
      description: "Agent endpoint copied to clipboard",
    });
  };

  if (isLoading) {
    return (
      <div className="cm-chat-workspace">
        {/* Header */}
        <div className="shrink-0 mb-3 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-6 w-20" />
        </div>
        {/* Main Grid */}
        <div className="cm-split">
          <div className="cm-split__main">
            <Skeleton className="h-full w-full rounded-lg" />
          </div>
          <div className="cm-split__side">
            <AgentCardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    const notFound = !error && !agent;
    return (
      <div className="cm-chat-workspace">
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-3" onClick={() => history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className={`flex-1 flex items-center justify-center border border-dashed rounded-lg ${isIndexing ? "border-cyan-500/30" : "border-red-500/30"}`}>
          <div className="text-center">
            {isIndexing ? (
              <>
                <Loader2 className="w-10 h-10 mx-auto text-cyan-400/70 mb-3 animate-spin" />
                <p className="text-cyan-400 font-mono">Indexing agent…</p>
                <p className="text-muted-foreground text-xs mt-1">This agent was just created — the catalog is publishing it now.</p>
              </>
            ) : notFound ? (
              <>
                <Shield className="w-10 h-10 mx-auto text-red-400/50 mb-3" />
                <p className="text-red-400 font-mono">Agent not found</p>
                <p className="text-muted-foreground text-xs mt-1">This agent may not exist yet.</p>
              </>
            ) : (
              <>
                <Shield className="w-10 h-10 mx-auto text-yellow-400/50 mb-3" />
                <p className="text-yellow-400 font-mono">Agent temporarily unavailable</p>
                <p className="text-muted-foreground text-xs mt-1">{error instanceof Error ? error.message : "The agents catalog could not be reached."}</p>
                <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
                  Try Again
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const agentLabel = agent.metadata?.name
    || (agentWallet ? `${agentWallet.slice(0, 6)}...${agentWallet.slice(-4)}` : agent.id > 0 ? `Agent #${agent.id}` : "Agent");

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

        <div className="cm-control-rail__main" />
        <Hint label="Backpack">
          <ShellButton
            size="sm"
            tone="secondary"
            iconOnly
            aria-label="Backpack"
            onClick={openBackpack}
          >
            <Backpack size={14} />
          </ShellButton>
        </Hint>
        <div className="cm-control-rail__actions">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="cm-shell-button cm-shell-button--secondary cm-shell-button--sm"
          >
            <Link href={`/connect-local?agent_wallet=${encodeURIComponent(agentWallet || "")}`}>
              <Download className="w-3 h-3 sm:mr-1" />
              <span className="hidden sm:inline">Install locally</span>
            </Link>
          </Button>
          {/* Mobile Side Panel Button — opens tabbed side panel */}
          <Button
            variant="ghost"
            size="sm"
            className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm cm-agent-detail-card-button"
            onClick={() => setMobileSideOpen(true)}
            aria-label="View side panel"
          >
            {activeSideTab === "mission" ? <Activity className="w-4 h-4" /> : <IdCard className="w-4 h-4" />}
          </Button>
        </div>
      </div>


      {/* Main Layout: Chat on Left, Card on Right - fills remaining space */}
      <div className="cm-split">
        {/* Chat Section (2/3 width on desktop, full on mobile) */}
        <div className="cm-split__main">
          <MultimodalCanvas
            variant="agent"
            title={`Chat with ${agentLabel}`}
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
            onKnowledgeUpload={openWorkspaceDialog}
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
            onPlanDecision={handlePlanDecision}
            onClearChat={handleClearChat}
            onFocusMissionControl={() => { setActiveSideTab("mission"); setMobileSideOpen(true); }}
            height="h-full"
            emptyStateText="Start a conversation with this agent."
            emptyStateSubtext="Requires x402 payment session."
          />
        </div>

        {/* Side Panel: Tabbed — AgentCard and Mission Control both always accessible */}
        <div className="cm-split__side">
          <div className="cm-side-panel-tabs" data-tab={activeSideTab}>
            <div className="cm-model-card__toolbar">
              <button
                type="button"
                className={cn(
                  "cm-model-card__toolbar-btn",
                  activeSideTab === "agent" && "cm-model-card__toolbar-btn--active-cyan",
                )}
                onClick={() => setActiveSideTab("agent")}
                aria-pressed={activeSideTab === "agent"}
              >
                <IdCard className="w-3.5 h-3.5" />
                <span className="cm-model-card__toolbar-label">Agent</span>
              </button>
              <button
                type="button"
                className={cn(
                  "cm-model-card__toolbar-btn",
                  activeSideTab === "mission" && "cm-model-card__toolbar-btn--active-fuchsia",
                )}
                onClick={() => setActiveSideTab("mission")}
                aria-pressed={activeSideTab === "mission"}
              >
                <Activity className="w-3.5 h-3.5" />
                <span className="cm-model-card__toolbar-label">Mission</span>
                {showMissionControl && activeSideTab !== "mission" && (
                  <span className="cm-side-panel-tabs__badge" />
                )}
              </button>
            </div>
            <div className="cm-side-panel-tabs__body">
              {activeSideTab === "agent" && (
                <AgentCard agent={agent} onCopyEndpoint={copyEndpoint} />
              )}
              {activeSideTab === "mission" && (
                showMissionControl ? (
                  <MissionControlSidePanel
                    activity={latestActivity}
                    plan={latestPlan}
                    messages={messages}
                    phase={activityState?.phase}
                    phaseLabel={activityState?.label}
                    agentLabel={agentLabel}
                    onPlanDecision={handlePlanDecision}
                  />
                ) : (
                  <div className="cm-side-panel-tabs__empty">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs text-muted-foreground">No active missions. Start a conversation to see live activity.</p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Session Budget Dialog */}
      <SessionBudgetDialog open={showSessionDialog} onOpenChange={setShowSessionDialog} showTrigger={false} />
      {selectedUserAddress && agentWallet ? (
        <BackpackDialog
          open={backpackOpen}
          onOpenChange={setBackpackOpen}
          userAddress={selectedUserAddress}
          agentWallet={agentWallet}
          agentName={agentLabel}
          showTrigger={false}
        />
      ) : null}

      <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Private Workspace</DialogTitle>
            <DialogDescription>
              Files uploaded here are indexed only for this exact user and this exact agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.json,.csv,.html,.xml,text/*,application/json,application/pdf"
              onChange={handleWorkspaceFileSelect}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-sm file:border-0 file:bg-cyan-500/20 file:px-3 file:py-2 file:text-xs file:font-mono file:text-cyan-300"
            />
            {workspaceFiles.length > 0 ? (
              <div className="cm-file-list space-y-2">
                {workspaceFiles.map((file) => (
                  <div
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    className="flex items-center justify-between gap-3 rounded-sm border border-sidebar-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-foreground">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {Math.max(1, Math.round(file.size / 1024))} KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeWorkspaceFile(file)}
                      className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add PDFs or text files to build a private workspace for this user:agent pair.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWorkspaceOpen(false)} disabled={workspaceUploading}>
              Cancel
            </Button>
            <Button type="button" onClick={handleWorkspaceUpload} disabled={workspaceUploading || workspaceFiles.length === 0}>
              {workspaceUploading ? "Indexing..." : "Index workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mobile Side Panel Sheet — unified with tabs */}
      <Sheet open={mobileSideOpen} onOpenChange={setMobileSideOpen}>
        <SheetContent side="right" className="cm-sheet-panel cm-sheet-panel--inspect p-0">
          <SheetHeader className="p-4 border-b border-sidebar-border shrink-0">
            <SheetTitle className="font-display text-cyan-400 flex items-center gap-2">
              {activeSideTab === "mission" ? <Activity className="w-4 h-4" /> : <IdCard className="w-4 h-4" />}
              {activeSideTab === "mission" ? "Mission Control" : "Agent Details"}
            </SheetTitle>
          </SheetHeader>
          <div className="cm-sheet-body cm-sheet-body--inspect">
            <div className="cm-side-panel-tabs" data-tab={activeSideTab}>
              <div className="cm-model-card__toolbar">
                <button
                  type="button"
                  className={cn(
                    "cm-model-card__toolbar-btn",
                    activeSideTab === "agent" && "cm-model-card__toolbar-btn--active-cyan",
                  )}
                  onClick={() => setActiveSideTab("agent")}
                  aria-pressed={activeSideTab === "agent"}
                >
                  <IdCard className="w-3.5 h-3.5" />
                  <span className="cm-model-card__toolbar-label">Agent</span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "cm-model-card__toolbar-btn",
                    activeSideTab === "mission" && "cm-model-card__toolbar-btn--active-fuchsia",
                  )}
                  onClick={() => setActiveSideTab("mission")}
                  aria-pressed={activeSideTab === "mission"}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span className="cm-model-card__toolbar-label">Mission</span>
                </button>
              </div>
              <div className="cm-side-panel-tabs__body">
                {activeSideTab === "agent" && (
                  <AgentCard agent={agent} onCopyEndpoint={copyEndpoint} className="cm-agent-card--match-chat" />
                )}
                {activeSideTab === "mission" && (
                  showMissionControl ? (
                    <MissionControlSidePanel
                      activity={latestActivity}
                      plan={latestPlan}
                      messages={messages}
                      phase={activityState?.phase}
                      phaseLabel={activityState?.label}
                      agentLabel={agentLabel}
                      onPlanDecision={handlePlanDecision}
                      className="cm-mission-control--mobile"
                    />
                  ) : (
                    <div className="cm-side-panel-tabs__empty">
                      <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs text-muted-foreground">No active missions. Start a conversation to see live activity.</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
