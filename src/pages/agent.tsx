/**
 * Agent Detail Page with Chat Interface
 * 
 * Shows agent info and provides interactive chat with x402 payments.
 * Includes knowledge upload and file attachments.
 * 
 * Layout: Chat on left, AgentCard on right
 * Uses shared MultimodalCanvas component and hooks for the chat interface.
 */
import { useState, useCallback, useRef } from "react";
import { usePostHog } from "@posthog/react";
import { mpTrack, mpError } from "@/lib/mixpanel";
import { useParams } from "wouter";
import { Link } from "wouter";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { sdk } from "@/lib/sdk";
import { uploadWorkspaceFiles } from "@/lib/workspace";
import { useChain } from "@/contexts/ChainContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { useOnchainAgentByIdentifier } from "@/hooks/use-onchain";
import { MultimodalCanvas, type ChatMessage } from "@/components/chat";
import { useChat } from "@/hooks/use-chat";
import { useComposeStream } from "@/hooks/use-stream";
import { buildAttachmentPart } from "@/lib/api";
import { CostReceiptIndicator } from "@/components/receipt-indicator";
import { ToolTimeline } from "@/components/tool-timeline";
import {
  getCachedBackpackPermissions,
  grantBackpackPermission,
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
} from "lucide-react";

export default function AgentDetailPage() {
  const posthog = usePostHog();
  const params = useParams<{ id: string }>();
  // id is always the wallet address (preferred)
  const identifier = params.id || null;
  const { data: agent, isLoading, error } = useOnchainAgentByIdentifier(identifier);
  const { toast } = useToast();
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const { paymentChainId } = useChain();
  const { sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken } = useSession();

  // Build the A2A-compatible endpoint URL using wallet address (canonical identifier)
  const agentWallet = agent?.walletAddress;

  // Chat state from shared hook (includes messages, attachments, and recording)
  const chat = useChat({
    conversationId: `agent-${agentWallet || 'unknown'}`,
    onError: (err) => setChatError(err),
  });
  const { messages, setMessages, clearMessages, scrollContainerRef, messagesEndRef,
    activityState,
    // Attachments
    attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, clearFiles,
    // Recording
    isRecording, recordingSupported, startRecording, stopRecording,
  } = chat;

  // Shared SDK streaming dispatcher. All rich SSE events (text, thinking,
  // tool-use, receipts, budget, sessionInvalid) are dispatched into the
  // chat activity sink + the sdk.events bus — nothing handled per-page.
  const streamer = useComposeStream(chat, {
    onError: (e) => setChatError(e.message),
  });
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<"idle" | "paying" | "waiting" | "streaming">("idle");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<File[]>([]);
  const [workspaceUploading, setWorkspaceUploading] = useState(false);

  // Session dialog
  const [showSessionDialog, setShowSessionDialog] = useState(false);

  // Mobile card sheet
  const [mobileCardOpen, setMobileCardOpen] = useState(false);
  const threadIdRef = useRef<string | null>(null);

  const resetConversationThread = useCallback(() => {
    const userAddress = wallet?.getAccount()?.address;
    if (!agentWallet || !userAddress) {
      threadIdRef.current = null;
      return null;
    }

    const backpackUserId = resolveBackpackUserId(userAddress);
    const nextThreadId = `thread-${backpackUserId}-${agentWallet}-${crypto.randomUUID()}`;
    threadIdRef.current = nextThreadId;
    return nextThreadId;
  }, [agentWallet, wallet]);

  const ensureConversationThread = useCallback(() => {
    if (threadIdRef.current) {
      return threadIdRef.current;
    }

    const createdThreadId = resetConversationThread();
    if (!createdThreadId) {
      throw new Error("Unable to initialize agent conversation thread");
    }
    return createdThreadId;
  }, [resetConversationThread]);

  const handleClearChat = useCallback(() => {
    clearMessages();
    clearFiles();
    setChatError(null);
    resetConversationThread();
    if (agentWallet) {
      sessionStorage.removeItem(`agent-active-run:${agentWallet}`);
    }
  }, [agentWallet, clearFiles, clearMessages, resetConversationThread]);

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

    if (workspaceFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Choose at least one knowledge file first.",
        variant: "destructive",
      });
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

    setWorkspaceUploading(true);
    try {
      const result = await uploadWorkspaceFiles(workspaceFiles, {
        agentWallet,
        userAddress: account.address,
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
  }, [account, agentWallet, budgetRemaining, composeKeyToken, ensureComposeKeyToken, paymentChainId, toast, workspaceFiles]);

  // Send chat message with x402 payment
  const handleSendMessage = useCallback(async () => {
    if (attachedFiles.some(f => f.uploading)) return;
    if ((!inputValue.trim() && attachedFiles.length === 0) || sending || !agentWallet) return;

    if (!wallet || !account) {
      toast({ title: "Connect wallet", description: "Please connect your wallet to chat", variant: "destructive" });
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
    const userAddress = wallet.getAccount()?.address;
    const backpackUserId = resolveBackpackUserId(userAddress);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: inputValue.trim(),
      timestamp: Date.now(),
      type: attached?.type || "text",
      // Use IPFS URL for all attachment types
      imageUrl: attached?.type === "image" ? attached.url : undefined,
      audioUrl: attached?.type === "audio" ? attached.url : undefined,
      videoUrl: attached?.type === "video" ? attached.url : undefined,
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    clearFiles(); // Clear attachment from input after sending
    setSending(true);
    setChatError(null);
    setChatStatus("paying");

    posthog?.capture("agent_chat_sent", {
      agent_wallet: agentWallet,
      agent_name: agent?.metadata?.name,
      has_attachment: attachedFiles.length > 0,
      attachment_type: attachedFiles[0]?.type ?? null,
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
    const runStorageKey = `agent-active-run:${agentWallet || "unknown"}`;

    try {
      if (!agent) throw new Error("Agent not loaded");
      setChatStatus("streaming");
      const threadId = ensureConversationThread();
      sessionStorage.setItem(runStorageKey, JSON.stringify({
        runId: composeRunId,
        threadId,
        startedAt: Date.now(),
      }));

      const attachmentPart = buildAttachmentPart(attached);
      await streamer.runAgent({
        agentWallet,
        message: userMessage.content,
        threadId,
        userAddress: backpackUserId,
        composeRunId,
        cloudPermissions: getCachedBackpackPermissions() as unknown as Record<string, unknown>,
        ...(attachmentPart ? { attachment: attachmentPart } : {}),
        assistantId,
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setChatError(errorMsg);
        mpError("agent_chat", errorMsg, { agent_wallet: agentWallet });
      }
    } finally {
      sessionStorage.removeItem(runStorageKey);
      setSending(false);
      setChatStatus("idle");
    }
  }, [inputValue, sending, agentWallet, wallet, account, toast, agent, attachedFiles, clearFiles, paymentChainId, sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken, setShowSessionDialog, ensureConversationThread, streamer, posthog]);

  const copyEndpoint = () => {
    toast({
      title: "Copied!",
      description: "Agent endpoint copied to clipboard",
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-120px)]">
        {/* Header */}
        <div className="shrink-0 mb-3 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-6 w-20" />
        </div>
        {/* Main Grid */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Skeleton className="h-full w-full rounded-lg" />
          </div>
          <div className="lg:col-span-1 hidden lg:block">
            <AgentCardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-col h-[calc(100vh-120px)]">
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-3" onClick={() => history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="flex-1 flex items-center justify-center border border-dashed border-red-500/30 rounded-lg">
          <div className="text-center">
            <Shield className="w-10 h-10 mx-auto text-red-400/50 mb-3" />
            <p className="text-red-400 font-mono">Agent not found</p>
            <p className="text-muted-foreground text-xs mt-1">This agent may not exist yet.</p>
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

        <div className="flex items-center gap-2">
          <ToolTimeline />
          <CostReceiptIndicator />
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs border-cyan-500/40 text-cyan-300 hover:text-cyan-200"
          >
            <Link href={`/connect-local?agent_wallet=${encodeURIComponent(agentWallet || "")}`}>
              <Download className="w-3 h-3 mr-1" />
              Install locally
            </Link>
          </Button>
          <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
            <Sparkles className="w-3 h-3 mr-1" />
            Agent #{agent.id}
          </Badge>
        </div>

        {/* Mobile Card Button - only visible on mobile */}
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden text-muted-foreground hover:text-cyan-400 h-7 w-7 p-0 ml-2"
          onClick={() => setMobileCardOpen(true)}
          aria-label="View agent details"
        >
          <IdCard className="w-4 h-4" />
        </Button>
      </div>

      {/* Main Layout: Chat on Left, Card on Right - fills remaining space */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chat Section (2/3 width on desktop, full on mobile) */}
        <div className="lg:col-span-2 min-h-0 flex flex-col">
          <MultimodalCanvas
            variant="agent"
            title={`Chat with ${agent.metadata?.name || `Agent #${agent.id}`}`}
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
            onClearChat={handleClearChat}
            height="h-full"
            emptyStateText="Start a conversation with this agent."
            emptyStateSubtext="Requires x402 payment session."
          />
        </div>

        {/* Agent Card (1/3 width on desktop, hidden on mobile by default) */}
        <div className="lg:col-span-1 hidden lg:flex flex-col min-h-0">
          <AgentCard
            agent={agent}
            onCopyEndpoint={copyEndpoint}
          />
        </div>
      </div>

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
              <div className="space-y-2 max-h-56 overflow-y-auto">
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

      {/* Mobile Card Sheet */}
      <Sheet open={mobileCardOpen} onOpenChange={setMobileCardOpen}>
        <SheetContent side="right" className="w-[340px] sm:w-[400px] p-0 overflow-hidden flex flex-col">
          <SheetHeader className="p-4 border-b border-sidebar-border shrink-0">
            <SheetTitle className="font-display text-cyan-400 flex items-center gap-2">
              <IdCard className="w-4 h-4" />
              Agent Details
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <AgentCard
              agent={agent}
              onCopyEndpoint={copyEndpoint}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
