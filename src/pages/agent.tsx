/**
 * Agent Workspace Page
 *
 * Balanced 2-zone human-agentic studio powered by the 3-surface SSE architecture:
 * - Surface 1 (MultimodalCanvas): Inline CoT, Plan & Clarify gates, Connector gates,
 *   media/deliveries/snippets, and per-turn x402 settlement receipt pill.
 * - Surface 2 (Pulse): Above-composer spring-animated live action rail with Stop & Flow drawer trigger.
 * - Surface 3 (Trace): On-demand full-readability slide-over / bottom snap-sheet for all
 *   Agent ↔ Sub-Agent, Agent ↔ Connector, Swarm Bus, Memory, Plan versions, and x402 bills.
 * - Companion Info Rail: AgentCard + live 3D Activity Graph filling the side-panel height.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { hasSessionAuth, sdk } from "@/lib/sdk";
import { uploadWorkspaceFiles } from "@/lib/workspace";
import { useChain } from "@/contexts/Network";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { SessionBudgetDialog } from "@/components/session";
import { useAgentByIdentifier } from "@/hooks/use-agents";
import { MultimodalCanvas } from "@/components/chat";
import {
  Threads,
  hydrateThreadMessages,
  listAgentThreads,
  loadAgentThread,
  type ThreadSummary,
} from "@/components/threads";
import { Trace } from "@/components/trace";
import { toAttachment, useChat, type ConnectorRequest, type Plan } from "@/hooks/use-chat";
import { useTurnReceipts } from "@/hooks/use-receipts";
import { useConversationThread, type ThreadKey } from "@/hooks/use-thread";
import { useStream } from "@/hooks/use-stream";
import {
  getCachedPermissions,
  resolveBackpackUserId,
} from "@/lib/backpack";
import { AgentCard, AgentCardSkeleton, sizedAvatarUrl } from "@/components/identikit";
import { Graph, type GraphPhase } from "@/motion/graph";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pockets } from "@/components/control";
import {
  ArrowLeft,
  Download,
  GitBranch,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Shield,
  X,
} from "lucide-react";

const TERMINAL_PLAN_STATES = new Set(["completed", "failed", "cancelled", "expired", "rejected"]);

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
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
  const { sessionActive, budgetRemaining, formatBudget, keyToken, resolveActiveKeyToken } = useSession();

  const agentWallet = agent?.walletAddress;

  const chat = useChat({
    conversationId: `agent-${agentWallet || "unknown"}`,
    onError: (err) => setChatError(err),
  });
  const {
    messages,
    setMessages,
    clearMessages,
    scrollContainerRef,
    messagesEndRef,
    addUserMessage,
    createAssistantPlaceholder,
    updateAssistantMessage,
    failAssistant,
    activityState,
    latestActivity,
    latestPlan,
    latestReceipt,
    latestReceipts,
    latestUsage,
    reconcileAssistantReceipts,
    attachedFiles,
    fileInputRef,
    handleFileSelect,
    handleRemoveFile,
    clearFiles,
    isRecording,
    recordingSupported,
    startRecording,
    stopRecording,
  } = chat;

  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [watching, setWatching] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<File[]>([]);
  const [workspaceUploading, setWorkspaceUploading] = useState(false);
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const streamer = useStream(chat, {
    onError: (e) => setChatError(e.message),
    onDone: () => setSending(false),
    onWatchingChange: (active) => setWatching(active),
  });

  const isStreamingActive = sending || watching;

  // Responsive pockets (mobile) + desktop rail toggle + on-demand Surface 3 Trace sheet
  const [pocket, setPocket] = useState<"chat" | "agent">("chat");
  const [paneCollapsed, setPaneCollapsed] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [inspectedMessageId, setInspectedMessageId] = useState<string | null>(null);
  const [graphPaused, setGraphPaused] = useState(false);

  useTurnReceipts({
    messages,
    userAddress: selectedUserAddress,
    network: paymentNetwork,
    mode: "agent",
    isStreaming: isStreamingActive,
    onReconcile: reconcileAssistantReceipts,
  });

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

  const {
    threadId,
    restoredRun,
    threadIdRef,
    rootRunIdRef,
    markWatchableRun,
    clearWatchableRun,
    resetConversationThread,
    selectConversationThread,
    ensureConversationThread,
    createTurnRunId,
  } = useConversationThread(getConversationThreadKey);

  const backpackUser = useMemo(
    () => (selectedUserAddress ? resolveBackpackUserId(selectedUserAddress) : ""),
    [selectedUserAddress],
  );

  const hasAuth = Boolean(keyToken || hasSessionAuth(backpackUser, paymentNetwork));

  const refreshThreads = useCallback(async () => {
    if (!agentWallet || !backpackUser || !hasAuth) {
      setThreads([]);
      return;
    }
    setThreadsLoading(true);
    try {
      const list = await listAgentThreads(agentWallet, backpackUser);
      setThreads(list);
    } catch {
      // Keep existing list on transient error
    } finally {
      setThreadsLoading(false);
    }
  }, [agentWallet, backpackUser, hasAuth]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const handleSelectThread = useCallback(async (item: ThreadSummary) => {
    if (!agentWallet || isStreamingActive) return;
    streamer.stopWatch();
    setChatError(null);
    chat.clearActivityState();
    selectConversationThread(item.threadId, item.rootRunId ?? item.runId);
    rehydratedKeyRef.current = `${agentWallet}:${item.threadId}:${item.rootRunId ?? item.runId ?? ""}`;
    try {
      const loaded = await loadAgentThread(agentWallet, item.threadId, backpackUser);
      if (!loaded) {
        clearMessages();
        return;
      }
      const hydrated = hydrateThreadMessages(loaded);
      setMessages(hydrated);
      const lastPlanMsg = [...hydrated].reverse().find((m) => m.proposal);
      chat.planMessageIdRef.current = lastPlanMsg?.id ?? null;
      const hasActivePlan = Boolean(
        lastPlanMsg?.proposal
        && !TERMINAL_PLAN_STATES.has(lastPlanMsg.proposal.state),
      );
      const pendingConnector = [...hydrated]
        .reverse()
        .flatMap((m) => m.connectorRequests ?? [])
        .find((req) => req.state === "requested" || req.state === "escalated");
      const runToWatch = lastPlanMsg?.proposal?.rootRunId
        ?? lastPlanMsg?.proposal?.runId
        ?? pendingConnector?.runId
        ?? loaded.rootRunId
        ?? loaded.runId
        ?? item.rootRunId
        ?? item.runId;
      if ((hasActivePlan || pendingConnector) && runToWatch) {
        markWatchableRun(runToWatch, item.threadId);
        void streamer.rehydrateRun({
          agentWallet,
          runId: runToWatch,
          threadId: item.threadId,
        }).then((activeRun) => {
          if (!activeRun) clearWatchableRun();
        });
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not load thread");
    }
  }, [agentWallet, backpackUser, chat, clearMessages, clearWatchableRun, isStreamingActive, markWatchableRun, selectConversationThread, setMessages, streamer]);

  // Clean up any active watch stream on unmount
  useEffect(() => () => streamer.stopWatch(), [streamer]);

  // Keep watchable run persistence scoped strictly to non-terminal plans and pending connector gates
  useEffect(() => {
    const activePlanRunId = latestPlan && !TERMINAL_PLAN_STATES.has(latestPlan.state)
      ? (latestPlan.rootRunId ?? latestPlan.runId)
      : undefined;
    const pendingConnectorRunId = [...messages]
      .reverse()
      .flatMap((m) => m.connectorRequests ?? [])
      .find((req) => req.state === "requested" || req.state === "escalated")
      ?.runId;
    const watchRunId = activePlanRunId ?? pendingConnectorRunId;
    if (watchRunId && threadId) {
      markWatchableRun(watchRunId, threadId);
    } else if (messages.length > 0) {
      clearWatchableRun();
    }
  }, [clearWatchableRun, latestPlan, markWatchableRun, messages, threadId]);

  // Rehydrate any live/gated run restored from sessionStorage so reload never orphans an active execution
  const rehydratedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!agentWallet || !restoredRun || !hasAuth) return;
    const key = `${agentWallet}:${restoredRun.threadId}:${restoredRun.rootRunId}`;
    if (rehydratedKeyRef.current === key) return;
    rehydratedKeyRef.current = key;
    void streamer.rehydrateRun({
      agentWallet,
      runId: restoredRun.rootRunId,
      threadId: restoredRun.threadId,
    }).then((activeRun) => {
      if (!activeRun) clearWatchableRun();
    });
  }, [agentWallet, clearWatchableRun, hasAuth, restoredRun, streamer]);

  // Collect all plan versions in chronological order for Surface 3 Trace version switcher
  const planVersions = useMemo(() => {
    const byKey = new Map<string, Plan>();
    for (const msg of messages) {
      if (msg.proposal) {
        const key = `${msg.proposal.proposalId}:${msg.proposal.version}`;
        byKey.set(key, msg.proposal);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.version - b.version);
  }, [messages]);

  // Count visible steps for Pulse badge & Live Activity graph
  const activity = useMemo(() => {
    const nodes = latestActivity ? Object.values(latestActivity.nodes) : [];
    const visible = nodes.filter((n) => {
      if (n.kind === "trace" || n.kind === "plan" || n.kind === "connector") return false;
      if (n.kind === "message" && !n.parentId) return false;
      return true;
    });
    const activeChildren = visible.filter((n) => n.kind === "agent" && n.status === "running").length;
    const activeTools = visible.filter((n) => (n.kind === "tool" || n.kind === "connector") && n.status === "running").length;
    const hasConclave = visible.some((n) => n.kind === "conclave" && n.status === "running");

    let phase: GraphPhase = "idle";
    if (chatError || activityState.phase === "error") phase = "error";
    else if (latestPlan?.state === "awaiting_approval" || latestPlan?.state === "clarify") phase = "awaiting_gate";
    else if (hasConclave) phase = "conclave";
    else if (activeChildren > 0) phase = "delegating";
    else if (activeTools > 0 || activityState.phase === "tool") phase = "tool";
    else if (latestPlan?.state === "executing" || latestPlan?.state === "monitoring" || latestPlan?.state === "refining") phase = "planning";
    else if (isStreamingActive || activityState.phase === "thinking" || activityState.phase === "streaming") phase = "thinking";
    else if (latestReceipt) phase = "settled";

    return {
      stepCount: Math.max(visible.length, activityState.tools.length),
      activeChildren,
      activeTools,
      phase,
    };
  }, [activityState.phase, activityState.tools.length, chatError, isStreamingActive, latestActivity, latestPlan?.state, latestReceipt]);

  const openTrace = useCallback((nodeId?: string, messageId?: string) => {
    setFocusedNodeId(nodeId ?? null);
    setInspectedMessageId(messageId ?? null);
    setTraceOpen(true);
  }, []);

  const inspectedMessage = useMemo(
    () => (inspectedMessageId ? messages.find((m) => m.id === inspectedMessageId) ?? null : null),
    [inspectedMessageId, messages],
  );

  const handleStop = useCallback(async () => {
    if (!agentWallet) return;
    const planActive = Boolean(
      latestPlan
      && (latestPlan.state === "approved"
        || latestPlan.state === "executing"
        || latestPlan.state === "monitoring"
        || latestPlan.state === "refining"),
    );
    const targetRunId = (planActive ? latestPlan?.runId : undefined)
      ?? rootRunIdRef.current
      ?? latestPlan?.rootRunId
      ?? undefined;
    await streamer.stopAgent(
      agentWallet,
      targetRunId,
      threadIdRef.current ?? undefined,
    );
    if (planActive && latestPlan) {
      setMessages((prev) => prev.map((msg) => {
        if (msg.proposal?.proposalId !== latestPlan.proposalId) return msg;
        const settledTasks = msg.proposal.tasks?.map((task) => (
          task.status === "doing" ? { ...task, status: "failed" as const } : task
        ));
        const settledActivity = msg.activity
          ? {
            ...msg.activity,
            nodes: Object.fromEntries(
              Object.entries(msg.activity.nodes).map(([nodeId, node]) => [
                nodeId,
                node.status === "running"
                  ? { ...node, status: "failed" as const, updatedAt: Date.now() }
                  : node,
              ]),
            ),
          }
          : msg.activity;
        return {
          ...msg,
          activity: settledActivity,
          proposal: {
            ...msg.proposal,
            state: "cancelled",
            pending: false,
            failureReason: "Stopped by user",
            ...(settledTasks ? { tasks: settledTasks } : {}),
          },
        };
      }));
    }
    clearWatchableRun();
    chat.clearActivityState();
    setSending(false);
    setWatching(false);
    toast({ title: "Run stopped" });
    void refreshThreads();
  }, [agentWallet, chat, clearWatchableRun, latestPlan, refreshThreads, rootRunIdRef, setMessages, streamer, threadIdRef, toast]);

  const handleClearChat = useCallback(() => {
    streamer.stopWatch();
    clearMessages();
    clearFiles();
    chat.clearActivityState();
    setChatError(null);
    resetConversationThread();
    rehydratedKeyRef.current = null;
  }, [chat, clearFiles, clearMessages, resetConversationThread, streamer]);

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
    if (selected.length === 0) return;

    setWorkspaceFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...prev];
      for (const file of selected) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) continue;
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
    } catch (err) {
      toast({
        title: "Workspace upload failed",
        description: err instanceof Error ? err.message : "Unable to index workspace knowledge",
        variant: "destructive",
      });
    } finally {
      setWorkspaceUploading(false);
    }
  }, [account, agentWallet, keyToken, resolveActiveKeyToken, selectedUserAddress, toast, userAddressResolving, workspaceFiles]);

  const handleSendMessage = useCallback(async (selectedSlashCommands: string[] = []) => {
    if (attachedFiles.some((f) => f.uploading)) return false;
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
    if (!sessionActive || budgetRemaining <= 0) {
      toast({
        title: "Session Required",
        description: "Please create a session to continue. Sessions enable faster responses.",
        variant: "destructive",
      });
      setShowSessionDialog(true);
      return false;
    }

    const attached = attachedFiles[0];
    const userAddress = selectedUserAddress;
    const backpackUserId = resolveBackpackUserId(userAddress);
    const prompt = inputValue.trim();

    let message = prompt;
    const attachedSource = attached?.file && /\.sol$/i.test(attached.file.name)
      ? await attached.file.text().catch(() => "")
      : "";
    if (attachedSource && attachedSource.length <= 100_000) {
      message = [
        prompt || "Audit the attached smart contract.",
        "```solidity",
        attachedSource.trim(),
        "```",
      ].join("\n\n");
    }

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

    const assistantId = createAssistantPlaceholder();
    const runId = createTurnRunId();

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
        message,
        threadId,
        userAddress: backpackUserId,
        runId,
        cloudPermissions: getCachedPermissions(agentWallet),
        ...(attachmentPart ? { attachment: attachmentPart } : {}),
        ...selectedControls,
        assistantId,
        options: {
          key: activeKeyToken,
          userAddress,
          ...(paymentNetwork ? { network: paymentNetwork } : {}),
        },
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setChatError(errorMsg);
        failAssistant(assistantId, errorMsg);
      }
    } finally {
      setSending(false);
      void refreshThreads();
    }
    return true;
  }, [inputValue, sending, agentWallet, wallet, account, toast, agent, attachedFiles, addUserMessage, clearFiles, createAssistantPlaceholder, failAssistant, paymentNetwork, sessionActive, budgetRemaining, keyToken, resolveActiveKeyToken, ensureConversationThread, createTurnRunId, streamer, selectedUserAddress, userAddressResolving, refreshThreads]);

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
      if (decision === "cancelled") {
        await streamer.stopAgent(
          agentWallet,
          runId,
          threadIdRef.current ?? undefined,
        );
        setMessages((prev) => prev.map((msg) => {
          if (msg.id !== messageId) return msg;
          const settledTasks = msg.proposal?.tasks?.map((task) => (
            task.status === "doing" ? { ...task, status: "failed" as const } : task
          ));
          const settledActivity = msg.activity
            ? {
              ...msg.activity,
              nodes: Object.fromEntries(
                Object.entries(msg.activity.nodes).map(([nodeId, node]) => [
                  nodeId,
                  node.status === "running"
                    ? { ...node, status: "failed" as const, updatedAt: Date.now() }
                    : node,
                ]),
              ),
            }
            : msg.activity;
          return {
            ...msg,
            activity: settledActivity,
            proposal: {
              ...(msg.proposal ?? plan),
              state: "cancelled",
              decision: "cancelled",
              pending: false,
              error: undefined,
              failureReason: "Cancelled by user",
              clarify: undefined,
              questions: undefined,
              missingInputs: undefined,
              ...(settledTasks ? { tasks: settledTasks } : {}),
            },
          };
        }));
        clearWatchableRun();
        chat.clearActivityState();
        setSending(false);
        setWatching(false);
        toast({ title: "Plan cancelled" });
        void refreshThreads();
        return;
      }

      const activeKeyToken = await resolveActiveKeyToken();
      if (activeKeyToken) sdk.keys.use(activeKeyToken);
      const trimmedFeedback = feedback?.trim() || undefined;
      if (decision === "clarify" && !trimmedFeedback) {
        updateAssistantMessage(messageId, {
          proposal: { ...plan, pending: false, error: "Provide an answer before submitting." },
        });
        return;
      }
      await sdk.agent.decide({
        agentWallet,
        runId,
        proposalId: plan.proposalId,
        proposalVersion: plan.version,
        decision,
        approver: selectedUserAddress ?? undefined,
        ...(decision === "clarify" && trimmedFeedback
          ? { answer: trimmedFeedback, feedback: trimmedFeedback }
          : trimmedFeedback
            ? { feedback: trimmedFeedback, reason: trimmedFeedback }
            : {}),
      });
      chat.planMessageIdRef.current = messageId;
      const nextState = decision === "approved"
        ? "executing"
        : decision === "clarify"
          ? "refining"
          : decision;
      updateAssistantMessage(messageId, {
        proposal: {
          ...plan,
          pending: false,
          decision,
          state: nextState,
          feedback: trimmedFeedback,
          ...(decision === "clarify" || decision === "approved"
            ? { clarify: undefined, questions: undefined, missingInputs: undefined }
            : {}),
        },
      });
      if (decision === "approved" || decision === "clarify" || decision === "changes_requested") {
        setWatching(true);
        chat.clearActivityState();
        chat.setActivityPhase(
          "thinking",
          decision === "approved"
            ? "Executing plan"
            : decision === "clarify"
              ? "Applying clarification"
              : "Revising plan",
        );
      }
      // Resume watch stream on ALL decisions (approved, changes_requested, rejected, clarify)
      // so revised plans, post-clarify execution, and final receipts stream live!
      const threadId = threadIdRef.current ?? ensureConversationThread();
      if (threadId) {
        void streamer.watchPlan({ agentWallet, runId, threadId });
      }
      toast({
        title:
          decision === "approved"
            ? "Plan approved"
            : decision === "changes_requested"
              ? "Changes requested"
              : decision === "clarify"
                ? "Clarification submitted"
                : "Plan rejected",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateAssistantMessage(messageId, {
        proposal: { ...plan, pending: false, error: msg },
      });
      toast({
        title: "Plan decision failed",
        description: msg,
        variant: "destructive",
      });
    }
  }, [agentWallet, chat, clearWatchableRun, ensureConversationThread, refreshThreads, resolveActiveKeyToken, selectedUserAddress, setMessages, streamer, threadIdRef, toast, updateAssistantMessage]);

  const handleConnectorDecided = useCallback((request: ConnectorRequest) => {
    if (!agentWallet || !request.runId) return;
    const threadId = threadIdRef.current ?? ensureConversationThread();
    if (threadId) {
      void streamer.watchPlan({ agentWallet, runId: request.runId, threadId });
    }
  }, [agentWallet, ensureConversationThread, streamer, threadIdRef]);

  const handleTracePlanDecision = useCallback(
    (plan: Plan, decision: NonNullable<Plan["decision"]>, feedback?: string) => {
      const targetMsg = [...messages].reverse().find((m) => m.proposal?.proposalId === plan.proposalId);
      if (targetMsg) {
        void handlePlanDecision(targetMsg.id, plan, decision, feedback);
      }
    },
    [handlePlanDecision, messages],
  );

  const copyEndpoint = useCallback(() => {
    toast({
      title: "Copied!",
      description: "Agent endpoint copied to clipboard",
    });
  }, [toast]);

  const handleStartSession = useCallback(() => {
    setShowSessionDialog(true);
  }, []);

  const handleFileSelectClick = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  const handleStopClick = useCallback(() => {
    void handleStop();
  }, [handleStop]);

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

  const handleToggleGraphPaused = useCallback(() => {
    setGraphPaused((p) => !p);
  }, []);

  const handleCloseTrace = useCallback(() => {
    setTraceOpen(false);
    setInspectedMessageId(null);
  }, []);

  if (isLoading) {
    return (
      <div className="cm-chat-workspace">
        <div className="shrink-0 mb-3 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-6 w-20" />
        </div>
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
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-3 w-fit" onClick={() => history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className={`flex-1 flex items-center justify-center border border-dashed rounded-lg ${isIndexing ? "border-cyan-500/30" : "border-red-500/30"}`}>
          <div className="text-center p-6">
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

  const rawAvatarUrl = typeof (agent.metadata as { avatarUrl?: string | null } | undefined)?.avatarUrl === "string"
    && /^(https?:\/\/|data:image\/|blob:)/i.test((agent.metadata as { avatarUrl?: string }).avatarUrl || "")
    ? (agent.metadata as { avatarUrl: string }).avatarUrl
    : null;
  const avatarUrl = sizedAvatarUrl(rawAvatarUrl, "full");

  const agentInitials = agentLabel
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const hasFlowData = isStreamingActive || activity.stepCount > 0 || Boolean(latestPlan) || Boolean(latestReceipt);

  return (
    <div className="cm-chat-workspace">
      {/* ── Compact Control Rail ── */}
      <div className="cm-control-rail cm-control-rail--compact cm-control-rail--inline">
        <Button
          variant="ghost"
          size="sm"
          className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm"
          onClick={() => history.back()}
        >
          <ArrowLeft className="w-3.5 h-3.5 sm:mr-1" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="cm-control-rail__main min-w-0">
          <h1 className="cm-page-header__title min-w-0 max-w-full" data-route-heading>
            <span className="text-fuchsia-500 mr-1.5 shrink-0">//</span>
            <span className="truncate">{agentLabel}</span>
          </h1>
        </div>

        <div className="cm-control-rail__actions">
          {selectedUserAddress && (
            <Threads
              threads={threads}
              activeThreadId={threadId}
              disabled={isStreamingActive}
              loading={threadsLoading}
              onSelectThread={(item) => void handleSelectThread(item)}
              onNewThread={handleClearChat}
            />
          )}

          <Pockets
            value={pocket}
            label="Agent view"
            className="cm-pocket-bar--split"
            onChange={setPocket}
            options={[
              { value: "chat", label: "Chat" },
              { value: "agent", label: "Info" },
            ]}
          />

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="cm-shell-button cm-shell-button--secondary cm-shell-button--sm"
            onClick={() => openTrace()}
            aria-label="Open activity"
          >
            <GitBranch className="w-3.5 h-3.5 sm:mr-1" />
            <span className="cm-agent-detail-install-label">
              Activity{activity.stepCount > 0 ? ` (${activity.stepCount})` : ""}
            </span>
            {hasFlowData && <span className="cm-pocket-btn__dot" aria-hidden="true" />}
          </Button>

          <Button
            asChild
            size="sm"
            variant="outline"
            className="cm-shell-button cm-shell-button--secondary cm-shell-button--sm"
          >
            <Link href={`/connect-local?agent_wallet=${encodeURIComponent(agentWallet || "")}`}>
              <Download className="w-3.5 h-3.5 sm:mr-1" />
              <span className="cm-agent-detail-install-label">Install</span>
            </Link>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm cm-split__collapse-btn"
            onClick={() => setPaneCollapsed((prev) => !prev)}
            aria-label={paneCollapsed ? "Show agent info" : "Hide agent info"}
            title={paneCollapsed ? "Show agent info" : "Hide agent info"}
          >
            {paneCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Balanced 2-Zone Split: Full-height Chat + Info & Live Activity Rail ── */}
      <div
        className={`cm-split${paneCollapsed ? " cm-split--collapsed" : ""}`}
        data-pocket={pocket === "chat" ? "main" : "side"}
        data-collapsed={paneCollapsed ? "true" : undefined}
      >
        <div className="cm-split__main cm-agent-chat-cell">
          <MultimodalCanvas
            variant="agent"
            showHeader={false}
            title={`Chat with ${agentLabel}`}
            messages={messages}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSend={handleSendMessage}
            sending={isStreamingActive}
            status={isStreamingActive ? "streaming" : "idle"}
            activityState={activityState}
            activePlan={latestPlan}
            stepCount={activity.stepCount}
            latestReceipt={latestReceipt}
            latestReceipts={latestReceipts}
            error={chatError}
            sessionActive={sessionActive}
            onStartSession={handleStartSession}
            attachedFiles={attachedFiles}
            onFileSelect={handleFileSelectClick}
            onKnowledgeUpload={openWorkspaceDialog}
            onRemoveFile={handleRemoveFile}
            fileInputRef={fileInputRef}
            onFileInputChange={handleFileSelect}
            isRecording={isRecording}
            recordingSupported={recordingSupported}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onStop={handleStopClick}
            onInspectFlow={openTrace}
            onConnectorDecided={handleConnectorDecided}
            scrollContainerRef={scrollContainerRef}
            messagesEndRef={messagesEndRef}
            showMessageActions
            onCopyMessage={handleCopyMessage}
            onRetryMessage={handleRetryMessage}
            onDeleteMessage={handleDeleteMessage}
            onPlanDecision={handlePlanDecision}
            onClearChat={handleClearChat}
            height="h-full"
            emptyStage={(
              <div className="cm-chat-hero">
                <div className="cm-chat-hero__portrait">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={agentLabel} loading="eager" fetchPriority="high" decoding="async" />
                  ) : (
                    <span>{agentInitials}</span>
                  )}
                </div>
              </div>
            )}
            emptyStateText={agentLabel}
            emptyStateSubtext={
              agent.metadata?.description?.trim()
                ? agent.metadata.description.trim()
                : sessionActive
                  ? `Balance: ${formatBudget(budgetRemaining)} · Type / for commands`
                  : "Start a session to chat"
            }
          />
        </div>

        {/* Side Rail: Agent Details + Single Live Activity Visualizer */}
        <div className="cm-split__side">
          <div className="cm-agent-panel">
            <AgentCard
              agent={agent}
              onCopyEndpoint={copyEndpoint}
              className="cm-agent-card--match-chat cm-agent-hero-anchor"
            />

            <div className="cm-agent-panel__activity">
              <div className="cm-agent-panel__activity-head">
                <span className="cm-agent-panel__activity-title">Live Activity</span>
                <div className="cm-agent-panel__activity-actions">
                  <button
                    type="button"
                    className="cm-agent-panel__activity-icon-btn"
                    onClick={handleToggleGraphPaused}
                    aria-label={graphPaused ? "Play motion" : "Pause motion"}
                    title={graphPaused ? "Play motion" : "Pause motion"}
                  >
                    {graphPaused ? <Play className="cm-agent-card__inline-svg" /> : <Pause className="cm-agent-card__inline-svg" />}
                  </button>
                  <button
                    type="button"
                    className="cm-agent-panel__activity-btn"
                    onClick={() => openTrace()}
                  >
                    <GitBranch className="cm-agent-card__inline-svg" />
                    <span>{activity.stepCount > 0 ? `Steps (${activity.stepCount})` : "View Activity"}</span>
                  </button>
                </div>
              </div>
              <Graph
                agentName={agentLabel}
                modelName={agent.metadata?.model || "Model"}
                connectorCount={agent.metadata?.connectors?.length ?? 0}
                activeChildren={activity.activeChildren}
                activeTools={activity.activeTools}
                phase={activity.phase}
                priceLabel={agent.licensePriceFormatted}
                paused={graphPaused || traceOpen}
                onTogglePause={handleToggleGraphPaused}
                className="cm-agent-panel__activity-graph"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Surface 3: Full-Readability Flow & Delegation Sheet ── */}
      <Trace
        open={traceOpen}
        onClose={handleCloseTrace}
        activity={inspectedMessage?.activity ?? latestActivity}
        plan={inspectedMessage?.proposal ?? latestPlan}
        planVersions={planVersions}
        receipt={inspectedMessage?.receipt ?? latestReceipt}
        receipts={inspectedMessage?.receipts ?? latestReceipts}
        usage={inspectedMessage?.usage ?? latestUsage}
        focusedNodeId={focusedNodeId}
        onPlanDecision={handleTracePlanDecision}
      />

      {/* Session Budget Dialog */}
      <SessionBudgetDialog open={showSessionDialog} onOpenChange={setShowSessionDialog} showTrigger={false} />

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
                      <p className="text-xs text-muted-foreground">
                        {Math.max(1, Math.round(file.size / 1024))} KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeWorkspaceFile(file)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
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
            <Button type="button" onClick={() => void handleWorkspaceUpload()} disabled={workspaceUploading || workspaceFiles.length === 0}>
              {workspaceUploading ? "Indexing..." : "Index workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
