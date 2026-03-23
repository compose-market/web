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
import { createPaymentFetch } from "@/lib/payment";
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
import { API_BASE_URL, buildAttachmentPart, parseEventStream } from "@/lib/api";
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
  Loader2,
  Upload,
  Download,
  Plus,
  Link2,
  FileText,
  X,
  BookOpen,
  IdCard,
} from "lucide-react";

const API_URL = API_BASE_URL;

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
    streamedTextRef, currentAssistantIdRef, updateAssistantMessage,
    scheduleStreamUpdate, flushStreamContent,
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

  // Knowledge upload state (agent-specific)
  const [showKnowledgeDialog, setShowKnowledgeDialog] = useState(false);
  const [knowledgeKey, setKnowledgeKey] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [uploadingKnowledge, setUploadingKnowledge] = useState(false);
  const [knowledgeUrls, setKnowledgeUrls] = useState<string[]>([]);
  const [newKnowledgeUrl, setNewKnowledgeUrl] = useState("");
  const knowledgeFileInputRef = useRef<HTMLInputElement>(null);

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
    clearActivityState();
    setActivityPhase("thinking", "Preparing request...");

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
      if (!agent) {
        throw new Error("Agent not loaded");
      }

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
        const threadId = ensureConversationThread();

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        const requestBody: Record<string, unknown> = {
          message: userMessage.content,
          threadId: threadId,
          composeRunId,
          userId: backpackUserId,
          cloudPermissions: getCachedBackpackPermissions(),
        };
        sessionStorage.setItem(runStorageKey, JSON.stringify({
          runId: composeRunId,
          threadId,
          startedAt: Date.now(),
        }));

        if (attachmentPart) {
          requestBody.attachment = attachmentPart;
        }

        return fetchWithPayment(`${API_URL}/agent/${agentWallet}/stream`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });
      };

      let response = await makeChatRequest();

      // If runtime is still warming, retry once after bounded delay
      if (response.status === 503) {
        const warmupPayload = await response.clone().json().catch(() => null) as
          | { code?: string; retryAfterMs?: number }
          | null;
        if (warmupPayload?.code === "AGENT_WARMING") {
          const retryAfterMs = Math.min(Math.max(warmupPayload.retryAfterMs || 2000, 1000), 10000);
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          response = await makeChatRequest();
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Chat failed: ${response.status}`);
      }

      // Handle streaming response - same pattern as playground.tsx
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream") || contentType.includes("text/plain")) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        setChatStatus("streaming");
        let fullResponse = "";
        const cancelStream = async () => {
          try {
            await reader.cancel();
          } catch {
            // Ignore reader cancellation failures; the request is already terminal.
          }
        };

        // Store assistant ID for RAF flush callback
        currentAssistantIdRef.current = assistantId;
        streamedTextRef.current = "";

        setActivityPhase("thinking", "Thinking...");

        for await (const block of parseEventStream(reader)) {
          const data = block.data.trim();
          if (!data || data === "[DONE]") {
            continue;
          }

          let payload: Record<string, unknown> | null = null;
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            fullResponse += data;
            scheduleStreamUpdate(fullResponse);
            setActivityPhase("streaming", "Responding...");
            continue;
          }

          const delta = payload.choices as Array<{ delta?: { content?: string } }> | undefined;
          const streamedChunk = typeof delta?.[0]?.delta?.content === "string" ? delta[0].delta.content : null;
          if (streamedChunk) {
            fullResponse += streamedChunk;
            scheduleStreamUpdate(fullResponse);
            setActivityPhase("streaming", "Responding...");
            continue;
          }

          if (payload.type === "thinking_start") {
            setActivityPhase("thinking", typeof payload.message === "string" ? payload.message : "Thinking...");
            continue;
          }

          if (payload.type === "thinking_end") {
            setActivityPhase("streaming", "Responding...");
            continue;
          }

          if (payload.type === "tool_start") {
            const summary = typeof payload.content === "string" ? payload.content : undefined;
            if (summary) {
              fullResponse += summary;
              scheduleStreamUpdate(fullResponse);
            }
            const toolName = typeof payload.toolName === "string" ? payload.toolName : "tool";
            startToolActivity(toolName, summary);
            setActivityPhase("tool", `Using ${toolName}...`);
            continue;
          }

          if (payload.type === "tool_end") {
            const toolName = typeof payload.toolName === "string" ? payload.toolName : "tool";
            finishToolActivity(toolName);
            setActivityPhase("thinking", `Processing ${toolName} result...`);
            continue;
          }

          if (payload.type === "error") {
            const errorText = typeof payload.content === "string"
              ? payload.content
              : typeof payload.error === "string"
                ? payload.error
                : "Agent stream failed";
            setActivityPhase("error", errorText);
            fullResponse += errorText;
            scheduleStreamUpdate(fullResponse);
            await cancelStream();
            break;
          }

          if (payload.type === "done") {
            clearActivityState();
            await cancelStream();
            break;
          }

          if (typeof payload.content === "string") {
            fullResponse += payload.content;
            scheduleStreamUpdate(fullResponse);
            setActivityPhase("streaming", "Responding...");
          } else if (typeof payload.text === "string") {
            fullResponse += payload.text;
            scheduleStreamUpdate(fullResponse);
            setActivityPhase("streaming", "Responding...");
          }
        }

        flushStreamContent();
        updateAssistantMessage(assistantId, { content: fullResponse });

        if (!fullResponse) {
          updateAssistantMessage(assistantId, { content: "No response received" });
        }
        clearActivityState();
      } else {
        // Non-streaming response (image/audio/video/json) - use unified handler
        const { parseMultimodalResponse } = await import("@/lib/multimodal");
        const result = await parseMultimodalResponse(response, {
          uploadToPinata: true,
          conversationId: `agent-${agentWallet}`,
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
          console.log(`[agent] Video job submitted, polling: ${result.jobId}`);
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
        } else {
          throw new Error(result.error || "Request failed");
        }
      }
    } catch (err) {
      // Silent return for user-initiated abort
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      let errorMsg = err instanceof Error ? err.message : "Unknown error";

      // Note: Recovery loops removed - rely on backend Temporal state persistence
      // Frontend simply displays errors immediately for better UX
      // Backend handles state via Temporal workflows (resumable via run state endpoint)

      // Check for CONSENT_REQUIRED error from agent
      try {
        const parsedError = JSON.parse(errorMsg);
        if (parsedError.code === "CONSENT_REQUIRED") {
          const consentType = parsedError.consentType as string;
          console.log(`[agent] Consent required: ${consentType}`);

          // Trigger native browser permission prompt based on consent type
          try {
            if (consentType === "filesystem") {
              // Use File System Access API
              if ('showDirectoryPicker' in window) {
                await (window as any).showDirectoryPicker();
                // User granted filesystem access - retry the message
                toast({ title: "Access Granted", description: "You can now interact with your files." });
                await grantBackpackPermission(backpackUserId, consentType as BackpackCloudPermission);
                // Retry by calling handleSendMessage again (user can resend)
                setInputValue(userMessage.content || "");
                setMessages(prev => prev.filter(m => m.id !== assistantId));
                errorMsg = "Filesystem access granted. Please resend your message.";
              } else {
                errorMsg = "This browser doesn't support filesystem access. Try Chrome or Edge.";
              }
            } else if (consentType === "camera" || consentType === "microphone") {
              // Use MediaDevices API
              const constraints = consentType === "camera"
                ? { video: true }
                : { audio: true };
              await navigator.mediaDevices.getUserMedia(constraints);
              toast({ title: "Access Granted", description: `${consentType} access enabled.` });
              await grantBackpackPermission(backpackUserId, consentType as BackpackCloudPermission);
              setInputValue(userMessage.content || "");
              setMessages(prev => prev.filter(m => m.id !== assistantId));
              errorMsg = `${consentType} access granted. Please resend your message.`;
            } else if (consentType === "geolocation") {
              // Use Geolocation API
              await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject);
              });
              toast({ title: "Access Granted", description: "Location access enabled." });
              await grantBackpackPermission(backpackUserId, consentType as BackpackCloudPermission);
              setInputValue(userMessage.content || "");
              setMessages(prev => prev.filter(m => m.id !== assistantId));
              errorMsg = "Location access granted. Please resend your message.";
            } else {
              errorMsg = parsedError.message;
            }
          } catch (permErr) {
            // User denied permission or API not available
            errorMsg = `Permission denied for ${consentType} access. This feature requires your consent.`;
          }
        }
      } catch {
        // Not a JSON error, use as-is
      }

      setChatError(errorMsg);
      setActivityPhase("error", errorMsg);
      mpError("agent_chat", errorMsg, { agent_wallet: agentWallet });
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${errorMsg}` } : m)
      );

    } finally {
      sessionStorage.removeItem(runStorageKey);
      setSending(false);
      setChatStatus("idle");
    }
  }, [inputValue, sending, agentWallet, wallet, account, toast, agent, attachedFiles, clearFiles, paymentChainId, sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken, setShowSessionDialog, ensureConversationThread, parseEventStream, scheduleStreamUpdate, flushStreamContent, updateAssistantMessage, posthog, clearActivityState, setActivityPhase, startToolActivity, finishToolActivity]);

  // Upload knowledge
  const handleUploadKnowledge = useCallback(async () => {
    if (!agentWallet || !knowledgeKey.trim() || !knowledgeContent.trim()) return;

    setUploadingKnowledge(true);
    try {
      const response = await fetch(`${API_URL}/agent/${agentWallet}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: knowledgeKey.trim(),
          content: knowledgeContent.trim(),
          metadata: { source: "manual-upload", type: "document" }
        }),
      });

      if (!response.ok) throw new Error("Upload failed");

      const result = await response.json();
      posthog?.capture("agent_knowledge_uploaded", {
        agent_wallet: agentWallet,
        knowledge_key: knowledgeKey.trim(),
        content_length: result.contentLength,
        url_count: knowledgeUrls.length,
      });
      toast({
        title: "Knowledge Uploaded!",
        description: `Added "${knowledgeKey}" (${result.contentLength} chars) to agent's knowledge base.`,
      });
      setShowKnowledgeDialog(false);
      setKnowledgeKey("");
      setKnowledgeContent("");
    } catch (err) {
      toast({
        title: "Upload Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploadingKnowledge(false);
    }
  }, [agentWallet, knowledgeKey, knowledgeContent, knowledgeUrls, toast, posthog]);

  // ==========================================================================
  // Knowledge File/URL Handlers
  // ==========================================================================

  const handleKnowledgeFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setKnowledgeContent((prev) => prev + (prev ? "\n\n" : "") + text);
        setKnowledgeKey(file.name.replace(/\.[^/.]+$/, ""));
      };
      reader.readAsText(file);
    }
  }, []);

  const handleAddKnowledgeUrl = useCallback(() => {
    if (newKnowledgeUrl.trim() && !knowledgeUrls.includes(newKnowledgeUrl.trim())) {
      setKnowledgeUrls((prev) => [...prev, newKnowledgeUrl.trim()]);
      setNewKnowledgeUrl("");
    }
  }, [newKnowledgeUrl, knowledgeUrls]);

  const handleRemoveKnowledgeUrl = useCallback((url: string) => {
    setKnowledgeUrls((prev) => prev.filter((u) => u !== url));
  }, []);

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
            onKnowledgeUpload={() => setShowKnowledgeDialog(true)}
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

      {/* Knowledge Upload Dialog */}
      <Dialog open={showKnowledgeDialog} onOpenChange={setShowKnowledgeDialog}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-fuchsia-400" />
              Upload Knowledge
            </DialogTitle>
            <DialogDescription>
              Add documents or URLs to this agent's knowledge base.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* File Upload Section */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Upload File (.txt, .md)
              </Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => knowledgeFileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Choose File
                </Button>
                <input
                  type="file"
                  ref={knowledgeFileInputRef}
                  onChange={handleKnowledgeFileSelect}
                  accept=".txt,.md,.text"
                  className="hidden"
                />
              </div>
            </div>

            {/* URL Input Section */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Add URLs (optional)
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://example.com/docs"
                  value={newKnowledgeUrl}
                  onChange={(e) => setNewKnowledgeUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddKnowledgeUrl()}
                />
                <Button variant="outline" size="icon" onClick={handleAddKnowledgeUrl}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {knowledgeUrls.length > 0 && (
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {knowledgeUrls.map((url) => (
                    <div key={url} className="flex items-center gap-2 text-xs bg-zinc-900 px-2 py-1 rounded">
                      <span className="truncate flex-1 text-zinc-400">{url}</span>
                      <button onClick={() => handleRemoveKnowledgeUrl(url)} className="text-zinc-500 hover:text-red-400">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Document Key */}
            <div className="space-y-2">
              <Label htmlFor="key">Document Key</Label>
              <Input
                id="key"
                placeholder="e.g., project-readme, api-docs"
                value={knowledgeKey}
                onChange={(e) => setKnowledgeKey(e.target.value)}
              />
            </div>

            {/* Document Content */}
            <div className="space-y-2">
              <Label htmlFor="content">Content (paste or loaded from file)</Label>
              <Textarea
                id="content"
                placeholder="Paste or upload document content..."
                value={knowledgeContent}
                onChange={(e) => setKnowledgeContent(e.target.value)}
                rows={8}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowKnowledgeDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUploadKnowledge}
              disabled={!knowledgeKey.trim() || !knowledgeContent.trim() || uploadingKnowledge}
              className="bg-fuchsia-500 hover:bg-fuchsia-600"
            >
              {uploadingKnowledge ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" /> Upload</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session Budget Dialog */}
      <SessionBudgetDialog open={showSessionDialog} onOpenChange={setShowSessionDialog} showTrigger={false} />

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
