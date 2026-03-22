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
import { Suspense, lazy, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePostHog } from "@posthog/react";
import { mpTrack } from "@/lib/mixpanel";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { createPaymentFetch } from "@/lib/payment";
import { useChain } from "@/contexts/ChainContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Bot,
  Settings2,
  Sparkles,
  RefreshCw,
  Image as ImageIcon,
  Music,
  Plug,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MultimodalCanvas } from "@/components/chat";
import { MirrorPane, type ModelParamsSchema } from "@/components/mirror-pane";
import { ModelSelector } from "@/components/model-selector";
import { useChat } from "@/hooks/use-chat";
import { useModels } from "@/hooks/use-model";
import { useToast } from "@/hooks/use-toast";
import {
  buildProviderCategories,
  formatModelTypeLabel,
  getModelOutputType,
  getPrimaryModelType,
  isGoogleModel as isGoogleCatalogModel,
} from "@/lib/models";

// Type color mapping for visual badges
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

const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");
const PANE_COLLAPSED_KEY = "playground_pane_collapsed";

const LazyPluginTester = lazy(() =>
  import("@/components/plugin-tester").then((module) => ({ default: module.PluginTester }))
);

function getDefaultParamValues(schema: ModelParamsSchema | null): Record<string, unknown> {
  if (!schema) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schema.params)
      .filter(([, definition]) => definition.default !== undefined)
      .map(([key, definition]) => [key, definition.default]),
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function PlaygroundPage() {
  const posthog = usePostHog();
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

  const [selectedType, setSelectedType] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState("all");

  // ============ Models (single raw catalog source) ============
  const {
    models,
    filteredModels,
    isLoading: modelsLoading,
    typeCategories,
    forceRefresh: forceRefreshModels,
  } = useModels({
    type: selectedType === "all" ? undefined : selectedType,
    provider: selectedProvider === "all" ? undefined : selectedProvider,
  });
  const providerCategories = useMemo(() => buildProviderCategories(models), [models]);

  // Model Test State
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  // Mobile pane sheet (for settings on mobile)
  const [mobilePaneOpen, setMobilePaneOpen] = useState(false);

  // Desktop pane collapse state (persisted)
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
  const [urlContextUrls, setUrlContextUrls] = useState<string>("");

  // Model Parameters State (for image/video models)
  const [modelParams, setModelParams] = useState<ModelParamsSchema | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const modelParamsCacheRef = useRef<Map<string, ModelParamsSchema | null>>(new Map());

  // Stable conversationId for file hooks
  const conversationId = useRef(`playground-${Date.now()}`).current;

  // Chat state from shared hook (includes messages, attachments, and recording)
  const chat = useChat({
    conversationId,
    onError: (err) => setInferenceError(err),
  });
  const { messages, setMessages, scrollContainerRef, messagesEndRef,
    streamedTextRef, currentAssistantIdRef, updateAssistantMessage,
    scheduleStreamUpdate, flushStreamContent,
    // Attachments
    attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, uploadedCids, cleanupFiles, clearFiles,
    // Recording
    isRecording, recordingSupported, startRecording, stopRecording,
  } = chat;
  const [inputValue, setInputValue] = useState("");

  // Auto-select first model when models load
  useEffect(() => {
    if (models.length > 0 && (!selectedModel || !models.some((model) => model.modelId === selectedModel))) {
      const preferredModel = models.find((model) => getModelOutputType(model) === "text") || models[0];
      setSelectedModel(preferredModel.modelId);
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

  // Get selected model info
  const selectedModelInfo = useMemo(
    () => models.find((model) => model.modelId === selectedModel) || null,
    [models, selectedModel],
  );
  const modelType = selectedModelInfo ? getPrimaryModelType(selectedModelInfo) : "chat-completions";
  const outputType = getModelOutputType(selectedModelInfo);
  const isGoogleModel = useMemo(() => isGoogleCatalogModel(selectedModelInfo), [selectedModelInfo]);

  // Fetch model params when selectedModel changes
  useEffect(() => {
    if (!selectedModel || !selectedModelInfo) {
      setModelParams(null);
      setParamValues({});
      return;
    }

    if (outputType !== "image" && outputType !== "video") {
      setModelParams(null);
      setParamValues({});
      return;
    }

    const cached = modelParamsCacheRef.current.get(selectedModel);
    if (cached !== undefined) {
      setModelParams(cached);
      setParamValues(getDefaultParamValues(cached));
      return;
    }

    const abortController = new AbortController();

    const fetchParams = async () => {
      try {
        const response = await fetch(`${API_BASE}/v1/models/${encodeURIComponent(selectedModel)}/params`, {
          signal: abortController.signal,
        });
        if (response.ok) {
          const data = await response.json() as ModelParamsSchema;
          const normalizedData = Object.keys(data.params).length > 0 ? data : null;
          modelParamsCacheRef.current.set(selectedModel, normalizedData);
          setModelParams(normalizedData);
          setParamValues(getDefaultParamValues(normalizedData));
        } else {
          modelParamsCacheRef.current.set(selectedModel, null);
          setModelParams(null);
          setParamValues({});
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          return;
        }
        console.error("[playground] Failed to fetch model params:", err);
        setModelParams(null);
        setParamValues({});
      }
    };

    void fetchParams();

    return () => {
      abortController.abort();
    };
  }, [outputType, selectedModel, selectedModelInfo]);

  // Build tools object for API request - only include enabled tools
  const activeGoogleTools = useMemo(() => {
    if (!isGoogleModel) return undefined;
    const tools: Record<string, unknown> = {};
    if (enableGoogleSearch) tools.googleSearch = true;
    if (enableCodeExecution) tools.codeExecution = true;
    if (enableMapsGrounding) tools.mapsGrounding = true;
    if (urlContextUrls.trim()) {
      tools.urlContext = { urls: urlContextUrls.split("\n").filter(u => u.trim()) };
    }
    return Object.keys(tools).length > 0 ? tools : undefined;
  }, [isGoogleModel, enableGoogleSearch, enableCodeExecution, enableMapsGrounding, urlContextUrls]);

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

    posthog?.capture("playground_message_sent", {
      model_id: selectedModel,
      has_attachment: attachedFiles.length > 0,
      attachment_type: attachedFiles[0]?.type ?? null,
      output_type: outputType,
      chain_id: paymentChainId,
    });

    mpTrack("Launch AI");
    mpTrack("AI Prompt Sent and Prompt Text", {
      "Prompt Text": inputValue.trim().slice(0, 500),
    });

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

      // Chain-aware payment: routes to selected chain
      // When session is active, uses session bypass for instant <100ms latency
      const fetchWithPayment = createPaymentFetch({
        chainId: paymentChainId,
        sessionToken: activeComposeKeyToken!,
        sessionUserAddress: sessionActive ? account.address : undefined,
        sessionBudgetRemaining: sessionActive ? budgetRemaining : undefined,
      });

      const headers: Record<string, string> = { "Content-Type": "application/json" };

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
              outputType === "embedding" ? ["embedding", "feature-extraction"] :
                ["text"];

      const endpoint = outputType === "embedding"
        ? `${API_BASE}/v1/embeddings`
        : `${API_BASE}/v1/responses`;
      const requestBody: Record<string, unknown> = outputType === "embedding"
        ? {
          model: selectedModel,
          input: userMessage.content,
        }
        : {
          model: selectedModel,
          input,
          modalities,
          stream: outputType === "text",
        };

      if (selectedModelInfo?.provider) {
        requestBody.provider = selectedModelInfo.provider;
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
                {formatModelTypeLabel(modelType)}
              </Badge>
            )}
          </div>

          {/* Empty right side - settings moved to MirrorPane */}
          <div className="hidden" />
        </div>

        {/* Model Test: Model selector row */}
        {activeTab === "model" && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
            <Select value={selectedType} onValueChange={setSelectedType} disabled={typeCategories.length === 0}>
              <SelectTrigger className="w-full sm:w-36 lg:w-44 bg-zinc-900 border-zinc-700 h-9">
                <SelectValue placeholder={modelsLoading ? "Loading..." : "All types"} />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700 max-h-80">
                {typeCategories.length === 0 ? (
                  <div className="p-2 text-zinc-500 text-sm">Loading types...</div>
                ) : (
                  typeCategories.map((cat) => {
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

            <ModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              placeholder="Select model..."
              className="w-full sm:flex-1 lg:w-64 xl:w-72 bg-zinc-900 border-zinc-700 h-9 justify-between text-left font-normal"
              type={selectedType === "all" ? undefined : selectedType}
              provider={selectedProvider === "all" ? undefined : selectedProvider}
              showTypeFilter={false}
            />

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
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading plugin tester...
              </div>
            }
          >
            <LazyPluginTester
              sessionActive={sessionActive}
              budgetRemaining={budgetRemaining}
              formatBudget={formatBudget}
              initialSource={initialPluginSource}
              initialPlugin={initialPlugin}
            />
          </Suspense>
        </div>
      )}

      {/* Session Dialog */}
      <SessionBudgetDialog
        open={showSessionDialog}
        onOpenChange={setShowSessionDialog}
        showTrigger={false}
      />

      {/* Mobile MirrorPane Sheet - same pattern as agent.tsx/workflow.tsx */}
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
