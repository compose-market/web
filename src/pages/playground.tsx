/**
 * Playground - Test models and MCP plugins with x402 payment
 * 
 * Refactored to use shared hooks and components:
 * - useChat for message state
 * - useFileAttachment for file uploads
 * - useAudioRecording for audio capture
 * - MultimodalCanvas for chat interface
 * - PluginTester for plugin testing
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { inferencePriceWei, isCronosChain } from "@/lib/chains";
import { createPaymentFetch } from "@/lib/payment";
import { useChain } from "@/contexts/ChainContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Send,
  Bot,
  Loader2,
  Settings2,
  Sparkles,
  RefreshCw,
  Image as ImageIcon,
  Music,
  AlertCircle,
  Plug,
  ChevronsUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MultimodalCanvas } from "@/components/chat";
import { MirrorPane, type ModelParamsSchema } from "@/components/mirror-pane";
import { PluginTester } from "@/components/plugin-tester";
import { useChat } from "@/hooks/use-chat";
import { useModels } from "@/hooks/use-model";
import { useToast } from "@/hooks/use-toast";
import { fileToDataUrl } from "@/lib/pinata";
import type { AIModel } from "@/lib/models";

// =============================================================================
// Types - Use AIModel from @/lib/models for model data
// =============================================================================

// Task type color mapping for visual badges
const TASK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "text-generation": { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/40" },
  "text2text-generation": { bg: "bg-green-500/20", text: "text-green-400", border: "border-green-500/40" },
  "text-to-image": { bg: "bg-purple-500/20", text: "text-purple-400", border: "border-purple-500/40" },
  "image-to-image": { bg: "bg-fuchsia-500/20", text: "text-fuchsia-400", border: "border-fuchsia-500/40" },
  "text-to-video": { bg: "bg-pink-500/20", text: "text-pink-400", border: "border-pink-500/40" },
  "text-to-audio": { bg: "bg-violet-500/20", text: "text-violet-400", border: "border-violet-500/40" },
  "text-to-speech": { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/40" },
  "automatic-speech-recognition": { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500/40" },
  "speech-to-text": { bg: "bg-yellow-600/20", text: "text-yellow-500", border: "border-yellow-600/40" },
  "feature-extraction": { bg: "bg-cyan-500/20", text: "text-cyan-400", border: "border-cyan-500/40" },
  "sentence-similarity": { bg: "bg-sky-500/20", text: "text-sky-400", border: "border-sky-500/40" },
  "text-classification": { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/40" },
  "image-classification": { bg: "bg-indigo-500/20", text: "text-indigo-400", border: "border-indigo-500/40" },
  "conversational": { bg: "bg-teal-500/20", text: "text-teal-400", border: "border-teal-500/40" },
  "translation": { bg: "bg-rose-500/20", text: "text-rose-400", border: "border-rose-500/40" },
  "summarization": { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/40" },
  "deep-research": { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/40" },
};

function getTaskStyle(task?: string) {
  return TASK_COLORS[task || ""] || { bg: "bg-zinc-500/20", text: "text-zinc-400", border: "border-zinc-500/40" };
}

function getTaskLabel(task?: string) {
  if (!task) return "Other";
  return task.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

// =============================================================================
// Main Component
// =============================================================================

export default function PlaygroundPage() {
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const { sessionActive, budgetRemaining, formatBudget, composeKeyToken, ensureComposeKeyToken } = useSession();
  const { paymentChainId } = useChain();
  const { toast } = useToast();

  // Tab state - check URL params for pre-selected plugin
  const [activeTab, setActiveTab] = useState<"model" | "plugins">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "plugins" ? "plugins" : "model";
  });

  // Get initial plugin source and plugin from URL
  const initialPluginSource = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("source") as "goat" | "mcp" | "eliza") || "goat";
  }, []);

  const initialPlugin = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("plugin") || "";
  }, []);

  // ============ Models (from centralized hook - 6hr cache) ============
  const {
    models: rawModels,
    isLoading: modelsLoading,
    error: modelsErrorObj,
    taskCategories,
    forceRefresh: forceRefreshModels
  } = useModels();
  const models: AIModel[] = rawModels;
  const modelsError = modelsErrorObj?.message ?? null;

  // Model filtering
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedTask, setSelectedTask] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // Provider categories derived from models
  const providerCategories = useMemo(() => {
    const providerCounts = new Map<string, number>();
    models.forEach(m => {
      const source = m.source || "unknown";
      providerCounts.set(source, (providerCounts.get(source) || 0) + 1);
    });
    const categories = [{ id: "all", label: "All Providers", count: models.length }];
    // Sort by count descending
    const sortedProviders = Array.from(providerCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [source, count] of sortedProviders) {
      categories.push({ id: source, label: source.charAt(0).toUpperCase() + source.slice(1).replace("-", " "), count });
    }
    return categories;
  }, [models]);

  // Model Test State
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  // Mobile pane sheet (for settings on mobile)
  const [mobilePaneOpen, setMobilePaneOpen] = useState(false);

  // Desktop pane collapse state (persisted)
  const PANE_COLLAPSED_KEY = "playground_pane_collapsed";
  const [paneCollapsed, setPaneCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(PANE_COLLAPSED_KEY) === "true";
    }
    return false;
  });

  // Persist pane collapsed state
  useEffect(() => {
    localStorage.setItem(PANE_COLLAPSED_KEY, String(paneCollapsed));
  }, [paneCollapsed]);

  // Google Tools State (only visible for Google models)
  const [enableGoogleSearch, setEnableGoogleSearch] = useState(false);
  const [enableCodeExecution, setEnableCodeExecution] = useState(false);
  const [enableMapsGrounding, setEnableMapsGrounding] = useState(false);
  const [enableDeepResearch, setEnableDeepResearch] = useState(false);
  const [urlContextUrls, setUrlContextUrls] = useState<string>("");

  // Model Parameters State (for image/video models)
  const [modelParams, setModelParams] = useState<ModelParamsSchema | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});

  // Stable conversationId for file hooks
  const conversationId = useRef(`playground-${Date.now()}`).current;

  // Chat state from shared hook (includes messages, attachments, and recording)
  const chat = useChat({
    conversationId,
    onError: (err) => setInferenceError(err),
  });
  const { messages, setMessages, scrollContainerRef, messagesEndRef,
    streamedTextRef, currentAssistantIdRef, updateAssistantMessage, handleJsonResponse,
    scheduleStreamUpdate, flushStreamContent,
    // Attachments
    attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, uploadedCids, cleanupFiles, clearFiles,
    // Recording
    isRecording, recordingSupported, startRecording, stopRecording,
  } = chat;
  const [inputValue, setInputValue] = useState("");

  // Auto-select first model when models load
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].id);
    }
  }, [models, selectedModel]);

  // Track the index from which to include messages for current model
  // Messages before this index are visible but not sent to the model
  const [conversationStartIndex, setConversationStartIndex] = useState(0);
  const prevModelRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevModelRef.current !== null && prevModelRef.current !== selectedModel && messages.length > 0) {
      console.log(`[playground] Model switched from ${prevModelRef.current} to ${selectedModel}`);
      // Model switched: mark current position as start of new context
      // Previous messages remain visible but won't be sent to new model
      setConversationStartIndex(messages.length);
    }
    prevModelRef.current = selectedModel;
  }, [selectedModel, messages.length]);

  // Fetch model params when selectedModel changes
  useEffect(() => {
    if (!selectedModel) {
      setModelParams(null);
      setParamValues({});
      return;
    }

    const fetchParams = async () => {
      try {
        const response = await fetch(`${API_BASE}/v1/models/${encodeURIComponent(selectedModel)}/params`);
        if (response.ok) {
          const data = await response.json();
          setModelParams(data);
          // Reset param values when model changes
          setParamValues({});
        } else {
          setModelParams(null);
        }
      } catch (err) {
        console.error("[playground] Failed to fetch model params:", err);
        setModelParams(null);
      }
    };

    fetchParams();
  }, [selectedModel]);

  // Debounce search query for performance (150ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filtered models based on search, task, and provider filter
  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      if (selectedTask !== "all" && model.task !== selectedTask) return false;
      if (selectedProvider !== "all" && model.source !== selectedProvider) return false;
      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase();
        return (
          model.id.toLowerCase().includes(query) ||
          model.name.toLowerCase().includes(query) ||
          model.source.toLowerCase().includes(query) ||
          (model.ownedBy && model.ownedBy.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [models, selectedTask, selectedProvider, debouncedSearchQuery]);

  // Get selected model info
  const selectedModelInfo = useMemo(() => models.find((m) => m.id === selectedModel), [models, selectedModel]);

  // Determine output type from task
  const getOutputType = (task: string): "text" | "image" | "video" | "audio" | "embedding" => {
    const t = task.toLowerCase();
    if (t.includes("video")) return "video";
    if (t.includes("image")) return "image";
    if (t.includes("audio") || t.includes("speech")) return "audio";
    if (t.includes("embed") || t.includes("feature") || t.includes("similarity")) return "embedding";
    return "text";
  };

  const modelTask = selectedModelInfo?.task || "text-generation";
  const outputType = getOutputType(modelTask);

  // Check if selected model supports Google-specific tools based on capabilities
  // Uses model.source for Google identification and checks capabilities for specific features
  const isGoogleModel = useMemo(() => {
    return selectedModelInfo?.source === "google";
  }, [selectedModelInfo]);

  // Check if model supports specific capabilities from the backend registry
  // capabilities is a string array of positive capabilities, e.g., ["tools", "vision"]
  const modelSupportsTools = useMemo(() => selectedModelInfo?.capabilities?.includes("tools") ?? false, [selectedModelInfo]);
  const modelSupportsVision = useMemo(() => selectedModelInfo?.capabilities?.includes("vision") ?? false, [selectedModelInfo]);
  const modelSupportsCodeExecution = useMemo(() => selectedModelInfo?.capabilities?.includes("code-execution") ?? isGoogleModel, [selectedModelInfo, isGoogleModel]);
  const modelSupportsSearchGrounding = useMemo(() => selectedModelInfo?.capabilities?.includes("search-grounding") ?? isGoogleModel, [selectedModelInfo, isGoogleModel]);
  const modelSupportsReasoning = useMemo(() => selectedModelInfo?.capabilities?.includes("reasoning") ?? false, [selectedModelInfo]);

  // Build tools object for API request - only include enabled tools
  const activeGoogleTools = useMemo(() => {
    if (!isGoogleModel) return undefined;
    const tools: Record<string, unknown> = {};
    if (enableGoogleSearch && modelSupportsSearchGrounding) tools.googleSearch = true;
    if (enableCodeExecution && modelSupportsCodeExecution) tools.codeExecution = true;
    if (enableMapsGrounding) tools.mapsGrounding = true;
    if (urlContextUrls.trim()) {
      tools.urlContext = { urls: urlContextUrls.split("\n").filter(u => u.trim()) };
    }
    return Object.keys(tools).length > 0 ? tools : undefined;
  }, [isGoogleModel, enableGoogleSearch, enableCodeExecution, enableMapsGrounding, urlContextUrls, modelSupportsSearchGrounding, modelSupportsCodeExecution]);

  // ==========================================================================
  // Handlers
  // ==========================================================================

  const handleSendMessage = useCallback(async () => {
    if (attachedFiles.some(f => f.uploading)) return;
    if ((!inputValue.trim() && attachedFiles.length === 0) || streaming || !selectedModel) return;

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

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: inputValue.trim(),
      timestamp: Date.now(),
      type: outputType,
      // Use IPFS URL for all attachment types
      imageUrl: attached?.type === "image" ? attached.url : undefined,
      audioUrl: attached?.type === "audio" ? attached.url : undefined,
      videoUrl: attached?.type === "video" ? attached.url : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    clearFiles();
    setStreaming(true);
    setInferenceError(null);

    // Create assistant placeholder - MUST reset refs to prevent stale content
    const assistantId = crypto.randomUUID();
    streamedTextRef.current = "";  // Reset streaming content before new request
    currentAssistantIdRef.current = assistantId;  // Set current assistant ID

    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), type: outputType },
    ]);

    try {
      if (!wallet || !account) {
        throw new Error("Connect wallet to use inference");
      }

      let activeComposeKeyToken = await ensureComposeKeyToken();
      if (!activeComposeKeyToken) {
        activeComposeKeyToken = composeKeyToken;
      }

      if (sessionActive && budgetRemaining > 0 && !activeComposeKeyToken) {
        throw new Error("Compose session key unavailable. Re-open your session and try again.");
      }

      // Chain-aware payment: Cronos uses Cronos x402 V1, others use ThirdWeb x402 V2
      // When session is active, uses session bypass for instant <100ms latency
      const fetchWithPayment = createPaymentFetch({
        chainId: paymentChainId,
        account,
        wallet,
        maxValue: BigInt(inferencePriceWei),
        // Session bypass: skip x402 wallet flow when session is active
        sessionToken: sessionActive && budgetRemaining > 0 ? activeComposeKeyToken || undefined : undefined,
        sessionHeaders: sessionActive && budgetRemaining > 0 ? {
          'x-session-user-address': account.address,
          'x-session-active': 'true',
          'x-session-budget-remaining': budgetRemaining.toString(),
        } : undefined,
      });

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Note: Session headers are now handled by createPaymentFetch session bypass

      const toResponsesMessage = (message: typeof userMessage | typeof messages[number]) => {
        const parts: Array<Record<string, unknown>> = [];
        if (typeof message.content === "string" && message.content.trim().length > 0) {
          parts.push({ type: "text", text: message.content });
        }
        if (message.imageUrl) {
          parts.push({ type: "image_url", image_url: { url: message.imageUrl } });
        }
        if (message.audioUrl) {
          parts.push({ type: "input_audio", input_audio: { url: message.audioUrl } });
        }
        if (message.videoUrl) {
          parts.push({ type: "video_url", video_url: { url: message.videoUrl } });
        }

        if (parts.length === 0) {
          return { role: message.role, content: "" };
        }

        if (parts.length === 1 && parts[0].type === "text") {
          return { role: message.role, content: message.content };
        }

        return { role: message.role, content: parts };
      };

      const history = [...messages.slice(conversationStartIndex), userMessage];
      const input: Array<{
        role: "system" | "user" | "assistant";
        content: string | Array<Record<string, unknown>>;
      }> = history.map(toResponsesMessage);
      if (systemPrompt.trim()) {
        input.unshift({ role: "system", content: systemPrompt.trim() });
      }

      const modalities =
        outputType === "image" ? ["image"] :
        outputType === "audio" ? ["audio"] :
        outputType === "video" ? ["video"] :
        outputType === "embedding" ? ["embedding"] :
        ["text"];

      const endpoint = `${API_BASE}/v1/responses`;
      const requestBody: Record<string, unknown> = {
        model: selectedModel,
        input,
        modalities,
        stream: outputType === "text",
      };

      if (selectedModelInfo?.source) {
        requestBody.provider = selectedModelInfo.source;
      }

      if (activeGoogleTools) {
        requestBody.google_tools = activeGoogleTools;
      }

      if (Object.keys(paramValues).length > 0) {
        Object.assign(requestBody, paramValues);
      }

      const response = await fetchWithPayment(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Handle OpenAI error format: {error: {message: "...", type: "..."}}
        const errField = errorData.error;
        const errMsg = typeof errField === "string"
          ? errField
          : (errField?.message || errorData.message || JSON.stringify(errField) || `Inference failed: ${response.status}`);
        throw new Error(errMsg);
      }

      // Parse response using unified multimodal handler
      const { parseMultimodalResponse } = await import("@/lib/multimodal");
      const result = await parseMultimodalResponse(response, {
        onStreamChunk: (chunk) => {
          streamedTextRef.current += chunk;
          scheduleStreamUpdate(streamedTextRef.current);
        },
        uploadToPinata: true,
        conversationId,
        videoStatusFetch: fetchWithPayment,
        // Handle async video polling
        onVideoPolling: {
          onProgress: (status, progress) => {
            updateAssistantMessage(assistantId, {
              content: `Video generating... (${status}${progress ? ` - ${progress}%` : ""})`,
              type: "video",
            });
          },
          onComplete: (url) => {
            console.log(`[playground] Video complete:`, url);
            updateAssistantMessage(assistantId, {
              content: "Video generated:",
              type: "video",
              videoUrl: url,
            });
          },
          onError: (error) => {
            console.error(`[playground] Video error:`, error);
            updateAssistantMessage(assistantId, {
              content: `Error: ${error}`,
              type: "video",
            });
          },
        },
      });
      console.log(`[playground] Stream complete. Total content length: ${streamedTextRef.current.length}`);

      // Final flush for streaming
      flushStreamContent();

      // Handle polling result - don't update if polling is in progress
      if (result.polling) {
        console.log(`[playground] Video job submitted, polling in background: ${result.jobId}`);
        updateAssistantMessage(assistantId, {
          content: `Video generating... (${result.type === "video" ? "queued" : "processing"})`,
          type: "video",
        });
        // Polling callbacks will handle the rest
        return;
      }

      if (result.success) {
        const content = result.content || (result.type === "text" ? "" : `Generated ${result.type}:`);
        updateAssistantMessage(assistantId, {
          content,
          type: result.type,
          imageUrl: result.type === "image" ? result.url : undefined,
          audioUrl: result.type === "audio" ? result.url : undefined,
          videoUrl: result.type === "video" ? result.url : undefined,
        });
      } else {
        throw new Error(result.error || "Request failed");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setInferenceError(errorMsg);
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: `Error: ${errorMsg}` } : m)
      );
    } finally {
      setStreaming(false);
    }
  }, [inputValue, streaming, selectedModel, selectedModelInfo, messages, systemPrompt, wallet, account, budgetRemaining, outputType, attachedFiles, clearFiles, sessionActive, composeKeyToken, ensureComposeKeyToken, activeGoogleTools, paymentChainId, paramValues, toast, setShowSessionDialog]);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setInferenceError(null);
    clearFiles();
    setConversationStartIndex(0);
    if (uploadedCids.length > 0) cleanupFiles();
  }, [uploadedCids, cleanupFiles, clearFiles, setMessages]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 p-3 lg:p-4">
        {/* Mobile: Settings toggle - opens Sheet */}
        <div className="flex sm:hidden items-center justify-end gap-2 mb-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobilePaneOpen(true)}
            className="h-9 w-9 lg:hidden"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Top row: Title, Tabs, and Settings toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-cyan-400" />
              <h1 className="text-base sm:text-lg font-semibold text-white font-mono">PLAYGROUND</h1>
            </div>

            {/* Tab switcher */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "model" | "plugins")}>
              <TabsList className="bg-zinc-900 h-8 sm:h-9">
                <TabsTrigger value="model" className="gap-1 sm:gap-1.5 text-xs sm:text-sm px-2 sm:px-3">
                  <Bot className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden xs:inline">Models</span>
                  <span className="xs:hidden">AI</span>
                </TabsTrigger>
                <TabsTrigger value="plugins" className="gap-1 sm:gap-1.5 text-xs sm:text-sm px-2 sm:px-3">
                  <Plug className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden xs:inline">Plugins</span>
                  <span className="xs:hidden">Tools</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Model task indicator */}
            {activeTab === "model" && selectedModelInfo && (
              <Badge variant="outline" className="gap-1 border-zinc-700 text-zinc-400 hidden md:flex text-[10px] sm:text-xs">
                {selectedModelInfo.task || "text-generation"}
              </Badge>
            )}
          </div>

          {/* Empty right side - settings moved to MirrorPane */}
          <div className="hidden" />
        </div>

        {/* Model Test: Model selector row */}
        {activeTab === "model" && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
            {/* Task filter dropdown */}
            <Select value={selectedTask} onValueChange={setSelectedTask} disabled={taskCategories.length === 0}>
              <SelectTrigger className="w-full sm:w-36 lg:w-44 bg-zinc-900 border-zinc-700 h-9">
                <SelectValue placeholder={modelsLoading ? "Loading..." : "All tasks"} />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700 max-h-80">
                {taskCategories.length === 0 ? (
                  <div className="p-2 text-zinc-500 text-sm">Loading tasks...</div>
                ) : (
                  taskCategories.map((cat) => {
                    const taskStyle = getTaskStyle(cat.id);
                    const isAll = cat.id === "all";
                    return (
                      <SelectItem key={cat.id} value={cat.id}>
                        <div className="flex items-center gap-2">
                          {!isAll && (
                            <div className={cn("w-2 h-2 rounded-full", taskStyle.bg.replace("/20", ""))} />
                          )}
                          <span className={isAll ? "" : taskStyle.text}>{cat.label}</span>
                          <span className="text-zinc-500 text-xs">({cat.count})</span>
                        </div>
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>

            {/* Provider filter dropdown */}
            <Select value={selectedProvider} onValueChange={setSelectedProvider} disabled={providerCategories.length <= 1}>
              <SelectTrigger className="w-full sm:w-32 lg:w-36 bg-zinc-900 border-zinc-700 h-9">
                <SelectValue placeholder="All Providers" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700 max-h-80">
                {providerCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <div className="flex items-center gap-2">
                      <span>{cat.label}</span>
                      <span className="text-zinc-500 text-xs">({cat.count})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Model Selector with search - Combobox pattern (narrower to fit provider dropdown) */}
            <Popover open={modelDropdownOpen} onOpenChange={setModelDropdownOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={modelDropdownOpen}
                  className="w-full sm:flex-1 lg:w-64 xl:w-72 bg-zinc-900 border-zinc-700 h-9 justify-between text-left font-normal"
                >
                  <span className="truncate">
                    {modelsLoading ? "Loading..." : selectedModelInfo?.name || "Select model..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0 bg-zinc-900 border-zinc-700" align="start">
                <Command className="bg-zinc-900" shouldFilter={false}>
                  <CommandInput
                    placeholder="Search models..."
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                    className="h-9"
                  />
                  <CommandList className="max-h-[300px]">
                    {modelsLoading ? (
                      <div className="p-4 text-center text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                        Loading {models.length > 0 ? `${models.length}+` : ""} models...
                      </div>
                    ) : modelsError ? (
                      <div className="p-4 text-center text-red-400">
                        <AlertCircle className="h-4 w-4 mx-auto mb-2" />
                        {modelsError}
                      </div>
                    ) : filteredModels.length === 0 ? (
                      <CommandEmpty>
                        {models.length === 0 ? "No models available" : `No models match "${searchQuery}"`}
                      </CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {filteredModels.slice(0, 100).map((model) => {
                          const taskStyle = getTaskStyle(model.task);
                          return (
                            <CommandItem
                              key={model.id}
                              value={model.id}
                              onSelect={() => {
                                setSelectedModel(model.id);
                                setModelDropdownOpen(false);
                              }}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4 shrink-0",
                                  selectedModel === model.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="truncate max-w-32 sm:max-w-48">{model.name}</span>
                              {model.task && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] shrink-0 px-1.5 py-0 font-normal border hidden sm:flex",
                                    taskStyle.bg,
                                    taskStyle.text,
                                    taskStyle.border
                                  )}
                                >
                                  {getTaskLabel(model.task).replace("To ", "→")}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-[10px] shrink-0 px-1.5 py-0 font-normal text-zinc-500 border-zinc-700">
                                {model.source}
                              </Badge>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}
                    {filteredModels.length > 100 && (
                      <div className="p-2 text-xs text-zinc-500 text-center border-t border-zinc-800">
                        Showing 100 of {filteredModels.length} — use search to narrow down
                      </div>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => forceRefreshModels()}
                disabled={modelsLoading}
                className="text-zinc-400 hover:text-white h-8 w-8 sm:h-9 sm:w-9"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", modelsLoading && "animate-spin")} />
              </Button>
              <span className="text-[10px] sm:text-xs text-zinc-500">
                {filteredModels.length} models
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Model Test: Canvas + MirrorPane Grid Layout (same as agent.tsx) */}
      {activeTab === "model" && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Chat Section (2/3 width on desktop, full on mobile) */}
          <div className={cn(
            "min-h-0 flex flex-col",
            paneCollapsed ? "lg:col-span-3" : "lg:col-span-2"
          )}>
            <MultimodalCanvas
              variant="playground"
              showHeader={false}
              messages={messages}
              setMessages={setMessages}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSend={handleSendMessage}
              sending={streaming}
              error={inferenceError}
              sessionActive={sessionActive}
              attachedFiles={attachedFiles}
              onFileSelect={() => fileInputRef.current?.click()}
              onRemoveFile={handleRemoveFile}
              fileInputRef={fileInputRef}
              onFileInputChange={handleFileSelect}
              isRecording={isRecording}
              recordingSupported={recordingSupported}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onClearChat={handleClearChat}
              scrollContainerRef={scrollContainerRef}
              messagesEndRef={messagesEndRef}
              height="h-full"
              selectedModel={selectedModel}
              placeholder={
                !sessionActive
                  ? "Start a session first"
                  : outputType === "image"
                    ? "Describe the image you want to generate..."
                    : outputType === "audio" || selectedModel?.toLowerCase().includes("lyria")
                      ? "Enter text to convert to speech or describe music to generate..."
                      : attachedFiles.length > 0
                        ? "Describe the uploaded file..."
                        : "Type your message..."
              }
              emptyStateIcon={
                outputType === "image" ? (
                  <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50 text-zinc-500" />
                ) : outputType === "audio" || selectedModel?.toLowerCase().includes("lyria") ? (
                  <Music className="h-12 w-12 mx-auto mb-4 opacity-50 text-zinc-500" />
                ) : (
                  <Bot className="h-12 w-12 mx-auto mb-4 opacity-50 text-zinc-500" />
                )
              }
              emptyStateText={
                outputType === "image"
                  ? "Describe an image to generate"
                  : outputType === "audio" || selectedModel?.toLowerCase().includes("lyria")
                    ? "Enter text to convert to audio or describe music to generate"
                    : `Start a conversation with ${selectedModelInfo?.name || "AI"}`
              }
              emptyStateSubtext={
                sessionActive
                  ? `Budget remaining: ${formatBudget(budgetRemaining)}`
                  : "Start a session to begin"
              }
            />
          </div>

          {/* MirrorPane Sidebar (1/3 width on desktop, hidden on mobile) */}
          {!paneCollapsed && (
            <div className="lg:col-span-1 hidden lg:flex flex-col min-h-0 relative">
              {/* Fold toggle button */}
              <button
                onClick={() => setPaneCollapsed(true)}
                className="absolute -left-3 top-4 flex items-center justify-center w-6 h-6 rounded-full bg-sidebar-border hover:bg-cyan-950 border border-sidebar-border hover:border-cyan-400 text-muted-foreground hover:text-cyan-400 transition-all duration-200 shadow-lg z-10"
                aria-label="Collapse settings pane"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <MirrorPane
                selectedModel={selectedModel}
                modelInfo={selectedModelInfo || null}
                isGoogleModel={isGoogleModel}
                systemPrompt={systemPrompt}
                onSystemPromptChange={setSystemPrompt}
                googleTools={isGoogleModel ? {
                  enableGoogleSearch,
                  setEnableGoogleSearch,
                  enableCodeExecution,
                  setEnableCodeExecution,
                  enableMapsGrounding,
                  setEnableMapsGrounding,
                  urlContextUrls,
                  setUrlContextUrls,
                } : undefined}
                modelParams={modelParams}
                paramValues={paramValues}
                onParamValuesChange={setParamValues}
              />
            </div>
          )}

          {/* Expand button when pane is collapsed */}
          {paneCollapsed && (
            <button
              onClick={() => setPaneCollapsed(false)}
              className="hidden lg:flex fixed right-4 top-1/2 -translate-y-1/2 items-center justify-center w-8 h-16 rounded-l-lg bg-sidebar-border hover:bg-cyan-950 border border-sidebar-border hover:border-cyan-400 text-muted-foreground hover:text-cyan-400 transition-all duration-200 shadow-lg z-40"
              aria-label="Expand settings pane"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Plugins Test: Using extracted PluginTester component */}
      {activeTab === "plugins" && (
        <div className="flex-1 min-h-0">
          <PluginTester
            sessionActive={sessionActive}
            budgetRemaining={budgetRemaining}
            formatBudget={formatBudget}
            initialSource={initialPluginSource}
            initialPlugin={initialPlugin}
          />
        </div>
      )}

      {/* Session Dialog */}
      <SessionBudgetDialog
        open={showSessionDialog}
        onOpenChange={setShowSessionDialog}
        showTrigger={false}
      />

      {/* Mobile MirrorPane Sheet - same pattern as agent.tsx/manowar.tsx */}
      <Sheet open={mobilePaneOpen} onOpenChange={setMobilePaneOpen}>
        <SheetContent side="right" className="w-[340px] sm:w-[400px] p-0 overflow-y-auto">
          <SheetHeader className="p-4 border-b border-sidebar-border">
            <SheetTitle className="font-display text-cyan-400 flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Model Settings
            </SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <MirrorPane
              selectedModel={selectedModel}
              modelInfo={selectedModelInfo || null}
              isGoogleModel={isGoogleModel}
              systemPrompt={systemPrompt}
              onSystemPromptChange={setSystemPrompt}
              googleTools={isGoogleModel ? {
                enableGoogleSearch,
                setEnableGoogleSearch,
                enableCodeExecution,
                setEnableCodeExecution,
                enableMapsGrounding,
                setEnableMapsGrounding,
                urlContextUrls,
                setUrlContextUrls,
              } : undefined}
              modelParams={modelParams}
              paramValues={paramValues}
              onParamValuesChange={setParamValues}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
