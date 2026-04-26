/**
 * Playground — Unified Multi-Model Chat Dashboard
 *
 * Zero-scroll, single-screen layout with:
 * - CapabilityChips for type/provider filtering
 * - ModelBadge for active model display
 * - CommandBar (⌘K) for model selection
 * - MultimodalCanvas for chat
 * - MirrorPane for settings
 *
 * Shared hooks: useChat, useModels, useSession
 */
import "@/styles/playground.css";
import { Suspense, lazy, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePostHog } from "@posthog/react";
import { mpTrack } from "@/lib/mixpanel";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { sdk } from "@/lib/sdk";
import { useChain } from "@/contexts/ChainContext";
import { Button } from "@/components/ui/button";
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
import { MultimodalCanvas } from "@/components/chat";
import { MirrorPane, type ModelParamsSchema } from "@/components/mirror-pane";
import { CommandBar } from "@/components/command-bar";
import { ModelBadge } from "@/components/model-badge";
import { useChat } from "@/hooks/use-chat";
import { useComposeStream } from "@/hooks/use-stream";
import { useModels } from "@/hooks/use-model";
import { CostReceiptIndicator } from "@/components/receipt-indicator";
import { ToolTimeline } from "@/components/tool-timeline";
import { useToast } from "@/hooks/use-toast";
import {
  buildProviderCategories,
  buildTypeCategories,
  formatModelTypeLabel,
  getModelOutputType,
  getModelTypeValues,
  getPrimaryModelType,
  isGoogleModel as isGoogleCatalogModel,
} from "@/lib/models";

const PANE_COLLAPSED_KEY = "playground_pane_collapsed";

const LazyPluginTester = lazy(() =>
  import("@/components/plugin-tester").then((module) => ({ default: module.PluginTester }))
);

function getDefaultParamValues(schema: ModelParamsSchema | null): Record<string, unknown> {
  if (!schema) return {};
  return schema.defaults || {};
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

  // Tab state
  const [activeTab, setActiveTab] = useState<"model" | "plugins">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "plugins" ? "plugins" : "model";
  });

  const initialPluginSource = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("source") as "goat" | "mcp" | "eliza") || "goat";
  }, []);

  const initialPlugin = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("plugin") || "";
  }, []);

  // ============ Filter State ============
  const [selectedType, setSelectedType] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState("all");

  // ============ Models (single source — filters cascade to all consumers) ============
  const {
    models,
    filteredModels,
    isLoading: modelsLoading,
    forceRefresh: forceRefreshModels,
  } = useModels({
    type: selectedType === "all" ? undefined : selectedType,
    provider: selectedProvider === "all" ? undefined : selectedProvider,
  });

  // ── Interconnected filters: each category list reflects the OTHER filter's selection ──
  // Type categories built from models filtered ONLY by provider (so type-counts update when provider changes)
  const typeCategories = useMemo(() => {
    if (selectedProvider === "all") return buildTypeCategories(models);
    return buildTypeCategories(models.filter((m) => m.provider === selectedProvider));
  }, [models, selectedProvider]);

  // Provider categories built from models filtered ONLY by type (so provider-counts update when type changes)
  const providerCategories = useMemo(() => {
    if (selectedType === "all") return buildProviderCategories(models);
    return buildProviderCategories(models.filter((m) => getModelTypeValues(m).includes(selectedType)));
  }, [models, selectedType]);

  // ── Filter interconnection guards: auto-reset invalid selections ──
  useEffect(() => {
    if (selectedType !== "all" && typeCategories.length > 0) {
      const stillValid = typeCategories.some((c) => c.id === selectedType);
      if (!stillValid) setSelectedType("all");
    }
  }, [typeCategories, selectedType]);

  useEffect(() => {
    if (selectedProvider !== "all" && providerCategories.length > 0) {
      const stillValid = providerCategories.some((c) => c.id === selectedProvider);
      if (!stillValid) setSelectedProvider("all");
    }
  }, [providerCategories, selectedProvider]);

  // ============ Model Selection ============
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  // Mobile pane sheet
  const [mobilePaneOpen, setMobilePaneOpen] = useState(false);

  // Desktop pane collapse (persisted)
  const [paneCollapsed, setPaneCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(PANE_COLLAPSED_KEY) === "true";
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem(PANE_COLLAPSED_KEY, String(paneCollapsed));
  }, [paneCollapsed]);

  // Google Tools State
  const [enableGoogleSearch, setEnableGoogleSearch] = useState(false);
  const [enableCodeExecution, setEnableCodeExecution] = useState(false);
  const [enableMapsGrounding, setEnableMapsGrounding] = useState(false);
  const [urlContextUrls, setUrlContextUrls] = useState<string>("");

  // Model Parameters State
  const [modelParams, setModelParams] = useState<ModelParamsSchema | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const modelParamsCacheRef = useRef<Map<string, ModelParamsSchema | null>>(new Map());

  // Chat state
  const conversationId = useRef(`playground-${Date.now()}`).current;
  const chat = useChat({
    conversationId,
    onError: (err) => setInferenceError(err),
  });
  const { messages, setMessages, scrollContainerRef, messagesEndRef,
    activityState, clearMessages,
    attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, uploadedCids, cleanupFiles, clearFiles,
    isRecording, recordingSupported, startRecording, stopRecording,
  } = chat;

  // Shared SDK streaming dispatcher. Handles text + video polling; all
  // rich SSE events (text/reasoning/tool-call/receipt) route through the
  // shared `useComposeStream` hook and the sdk.events bus.
  const streamer = useComposeStream(chat, {
    onError: (e) => setInferenceError(e.message),
  });
  const [inputValue, setInputValue] = useState("");

  // ============ ⌘K Global Shortcut ============
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandBarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-select first model from FILTERED list when filters change
  useEffect(() => {
    if (filteredModels.length > 0 && (!selectedModel || !filteredModels.some((m) => m.modelId === selectedModel))) {
      const preferredModel = filteredModels.find((m) => getModelOutputType(m) === "text") || filteredModels[0];
      setSelectedModel(preferredModel.modelId);
    }
  }, [filteredModels, selectedModel]);

  // Track conversation context boundary on model switch
  const [conversationStartIndex, setConversationStartIndex] = useState(0);
  const prevModelRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevModelRef.current !== null && prevModelRef.current !== selectedModel && messages.length > 0) {
      setConversationStartIndex(messages.length);
    }
    prevModelRef.current = selectedModel;
  }, [selectedModel, messages.length]);

  // Selected model info
  const selectedModelInfo = useMemo(
    () => models.find((m) => m.modelId === selectedModel) || null,
    [models, selectedModel],
  );
  const modelType = selectedModelInfo ? getPrimaryModelType(selectedModelInfo) : "chat-completions";
  const outputType = getModelOutputType(selectedModelInfo);
  const isGoogleModel = useMemo(() => isGoogleCatalogModel(selectedModelInfo), [selectedModelInfo]);

  // Fetch model params
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
        const data = await sdk.models.getParams(selectedModel);
        if (abortController.signal.aborted) return;
        const normalizedData = Object.keys(data.params).length > 0 ? (data as unknown as ModelParamsSchema) : null;
        modelParamsCacheRef.current.set(selectedModel, normalizedData);
        setModelParams(normalizedData);
        setParamValues(getDefaultParamValues(normalizedData));
      } catch (err) {
        if (abortController.signal.aborted) return;
        console.error("[playground] Failed to fetch model params:", err);
        modelParamsCacheRef.current.set(selectedModel, null);
        setModelParams(null);
        setParamValues({});
      }
    };
    void fetchParams();
    return () => { abortController.abort(); };
  }, [outputType, selectedModel, selectedModelInfo]);

  // Google tools
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
  // Handlers (unchanged from original)
  // ==========================================================================

  const handleSendMessage = useCallback(async () => {
    if (attachedFiles.some(f => f.uploading)) return;
    if ((!inputValue.trim() && attachedFiles.length === 0) || streaming || !selectedModel) return;

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
    chat.clearActivityState();
    chat.setActivityPhase(
      "thinking",
      outputType === "text" ? "Preparing request..." : `Preparing ${outputType} generation...`,
    );

    const assistantId = crypto.randomUUID();
    chat.streamedTextRef.current = "";
    chat.currentAssistantIdRef.current = assistantId;

    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), type: outputType },
    ]);

    try {
      if (!wallet || !account) throw new Error("Connect wallet to use inference");

      // Make sure the SDK has the freshly-minted Compose Key JWT cached
      // in-memory before any billable call fires.
      const activeComposeKeyToken = await ensureComposeKeyToken() ?? composeKeyToken;
      if (sessionActive && budgetRemaining > 0 && !activeComposeKeyToken) {
        throw new Error("Compose session key unavailable. Re-open your session and try again.");
      }
      if (activeComposeKeyToken) {
        sdk.keys.use(activeComposeKeyToken);
      }

      const toResponsesMessage = (message: typeof userMessage | typeof messages[number]) => {
        const parts: Array<Record<string, unknown>> = [];
        if (typeof message.content === "string" && message.content.trim().length > 0) {
          parts.push({ type: "text", text: message.content });
        }
        if (message.imageUrl) parts.push({ type: "image_url", image_url: { url: message.imageUrl } });
        if (message.audioUrl) parts.push({ type: "input_audio", input_audio: { url: message.audioUrl } });
        if (message.videoUrl) parts.push({ type: "video_url", video_url: { url: message.videoUrl } });
        if (parts.length === 0) return { role: message.role, content: "" };
        if (parts.length === 1 && parts[0].type === "text") return { role: message.role, content: message.content };
        return { role: message.role, content: parts };
      };

      const history = [...messages.slice(conversationStartIndex), userMessage];
      const input: Array<{
        role: "system" | "user" | "assistant";
        content: string | Array<Record<string, unknown>>;
      }> = history.map(toResponsesMessage);
      if (systemPrompt.trim()) input.unshift({ role: "system", content: systemPrompt.trim() });

      const modalities =
        outputType === "image" ? ["image"] :
          outputType === "audio" ? ["audio"] :
            outputType === "video" ? ["video"] :
              outputType === "embedding" ? ["embedding", "feature-extraction"] :
                ["text"];

      // Text + image streaming — SDK responses.stream dispatches every rich
      // SSE event (text delta, reasoning, tool-call delta, compose.receipt,
      // compose.error, and image partial/completed events where the provider
      // supports them) via the shared streamer hook.
      if (outputType === "text" || outputType === "image") {
        await streamer.runResponses({
          params: {
            model: selectedModel,
            input,
            modalities: modalities as Array<"text" | "image" | "audio" | "video">,
            stream: true,
            ...(selectedModelInfo?.provider ? { provider: selectedModelInfo.provider } : {}),
            ...(activeGoogleTools ? { google_tools: activeGoogleTools } : {}),
            ...(Object.keys(paramValues).length > 0 ? { custom_params: paramValues } : {}),
          },
          assistantId,
          options: {
            ...(activeComposeKeyToken ? { composeKey: activeComposeKeyToken } : {}),
            userAddress: account.address,
            chainId: paymentChainId,
          },
        });
        return;
      }

      // Remaining non-streaming modalities — submit via sdk.fetch then delegate
      // Pinata upload to the multimodal helper. Video jobs drive polling
      // through the SDK's typed video-status stream.
      const endpoint = outputType === "embedding" ? "/v1/embeddings" : "/v1/responses";
      const requestBody: Record<string, unknown> = outputType === "embedding"
        ? { model: selectedModel, input: userMessage.content }
        : { model: selectedModel, input, modalities, stream: false };
      if (selectedModelInfo?.provider) requestBody.provider = selectedModelInfo.provider;
      if (activeGoogleTools) requestBody.google_tools = activeGoogleTools;
      if (Object.keys(paramValues).length > 0) requestBody.custom_params = paramValues;

      const response = await sdk.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errField = errorData.error;
        const errMsg = typeof errField === "string"
          ? errField
          : (errField?.message || errorData.message || JSON.stringify(errField) || `Inference failed: ${response.status}`);
        throw new Error(errMsg);
      }

      const { parseMultimodalResponse } = await import("@/lib/multimodal");
      const result = await parseMultimodalResponse(response, {
        uploadToPinata: true,
        conversationId,
        videoStatusFetch: sdk.fetch.bind(sdk),
      });

      if (result.polling && result.jobId) {
        chat.updateAssistantMessage(assistantId, {
          content: `Video generating... (queued)`,
          type: "video",
        });
        await streamer.runVideo({ videoId: result.jobId, assistantId });
        return;
      }

      if (result.success) {
        const content = result.content || (result.type === "text" ? "" : `Generated ${result.type}:`);
        chat.updateAssistantMessage(assistantId, {
          content,
          type: result.type,
          imageUrl: result.type === "image" ? result.url : undefined,
          audioUrl: result.type === "audio" ? result.url : undefined,
          videoUrl: result.type === "video" ? result.url : undefined,
        });
        chat.clearActivityState();
      } else {
        throw new Error(result.error || "Request failed");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setInferenceError(errorMsg);
      chat.setActivityPhase("error", errorMsg);
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: `Error: ${errorMsg}` } : m)
      );
    } finally {
      setStreaming(false);
    }
  }, [inputValue, streaming, selectedModel, selectedModelInfo, messages, systemPrompt, wallet, account, budgetRemaining, outputType, attachedFiles, clearFiles, sessionActive, composeKeyToken, ensureComposeKeyToken, activeGoogleTools, paymentChainId, paramValues, toast, setShowSessionDialog, conversationId, posthog, chat, streamer, setMessages, conversationStartIndex]);
  const handleClearChat = useCallback(() => {
    clearMessages();
    setInferenceError(null);
    clearFiles();
    setConversationStartIndex(0);
    if (uploadedCids.length > 0) cleanupFiles();
  }, [uploadedCids, cleanupFiles, clearFiles, clearMessages]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="cm-playground">
      {/* ── Top-Level Toolbar: Page info only ─────────────────── */}
      <div className="cm-playground__toolbar">
        <div className="cm-playground__title">
          <Sparkles className="cm-playground__title-icon" />
          <span className="cm-playground__title-text">Playground</span>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "model" | "plugins")}>
          <TabsList className="bg-zinc-900/80" style={{ height: 'clamp(1.375rem, 1.1rem + 0.5vw, 2.125rem)' }}>
            <TabsTrigger value="model" className="gap-1 px-2" style={{ fontSize: 'clamp(0.5rem, 0.4rem + 0.25vw, 0.75rem)', height: 'clamp(1.125rem, 0.9rem + 0.45vw, 1.875rem)' }}>
              <Bot style={{ width: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)', height: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)' }} />
              Models
            </TabsTrigger>
            <TabsTrigger value="plugins" className="gap-1 px-2" style={{ fontSize: 'clamp(0.5rem, 0.4rem + 0.25vw, 0.75rem)', height: 'clamp(1.125rem, 0.9rem + 0.45vw, 1.875rem)' }}>
              <Plug style={{ width: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)', height: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)' }} />
              Plugins
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="cm-playground__toolbar-right">
          <ToolTimeline />
          <CostReceiptIndicator />
          {activeTab === "model" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobilePaneOpen(true)}
              className="lg:hidden text-zinc-400 hover:text-white"
              style={{ width: 'clamp(1.25rem, 1rem + 0.5vw, 1.875rem)', height: 'clamp(1.25rem, 1rem + 0.5vw, 1.875rem)' }}
            >
              <Settings2 style={{ width: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)', height: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)' }} />
            </Button>
          )}
        </div>
      </div>

      {/* ── Chat + MirrorPane — equi-heighted sibling grid ─────── */}
      {activeTab === "model" && (
        <div className={`cm-playground__grid${paneCollapsed ? " cm-playground__grid--collapsed" : ""}`}>
          {/* Chat cell — contains its own filter toolbar + caps + canvas */}
          <div className="cm-playground__chat-cell">
            {/* ── Chat-internal toolbar: badge, filters, count ── */}
            <div className="cm-playground__chat-toolbar">
              <ModelBadge
                model={selectedModelInfo}
                onClick={() => setCommandBarOpen(true)}
              />

              <div className="cm-playground__filter-wrap">
                <select
                  className={`cm-playground__filter-select ${selectedType !== "all" ? "cm-playground__filter-select--active" : ""}`}
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                >
                  {typeCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label} ({cat.count})
                    </option>
                  ))}
                </select>

                <select
                  className={`cm-playground__filter-select ${selectedProvider !== "all" ? "cm-playground__filter-select--active" : ""}`}
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                >
                  {providerCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label} ({cat.count})
                    </option>
                  ))}
                </select>
              </div>

              <span className="cm-playground__model-count">
                {filteredModels.length}/{models.length}
              </span>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => forceRefreshModels()}
                disabled={modelsLoading}
                className="text-zinc-400 hover:text-white"
                style={{ width: 'clamp(1.25rem, 1rem + 0.5vw, 1.875rem)', height: 'clamp(1.25rem, 1rem + 0.5vw, 1.875rem)' }}
              >
                <RefreshCw className={modelsLoading ? "animate-spin" : ""} style={{ width: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)', height: 'clamp(0.625rem, 0.5rem + 0.25vw, 1rem)' }} />
              </Button>
            </div>

            {/* ── Chat-internal capabilities row ── */}
            {selectedModelInfo && (() => {
              const caps = getModelTypeValues(selectedModelInfo);
              const uniqueCaps = [...new Set(caps)];
              return uniqueCaps.length > 0 ? (
                <div className="cm-playground__caps-row">
                  <span className="cm-playground__caps-label">Capabilities</span>
                  {uniqueCaps.map((cap) => {
                    const c = cap.toLowerCase();
                    let colorClass = "cm-playground__cap-tag--text";
                    if (c.includes("image")) colorClass = "cm-playground__cap-tag--image";
                    else if (c.includes("audio") || c.includes("speech")) colorClass = "cm-playground__cap-tag--audio";
                    else if (c.includes("video")) colorClass = "cm-playground__cap-tag--video";
                    else if (c.includes("embed") || c.includes("feature")) colorClass = "cm-playground__cap-tag--embedding";
                    else if (c.includes("code")) colorClass = "cm-playground__cap-tag--code";
                    return (
                      <span key={cap} className={`cm-playground__cap-tag ${colorClass}`}>
                        {formatModelTypeLabel(cap)}
                      </span>
                    );
                  })}
                </div>
              ) : null;
            })()}

            {/* ── The actual chat canvas ── */}
            <MultimodalCanvas
              variant="playground"
              showHeader={false}
              messages={messages}
              setMessages={setMessages}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSend={handleSendMessage}
              sending={streaming}
              activityState={activityState}
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
                  <ImageIcon className="mx-auto mb-4 opacity-50 text-zinc-500" style={{ width: 'clamp(2rem, 1.5rem + 2vw, 4rem)', height: 'clamp(2rem, 1.5rem + 2vw, 4rem)' }} />
                ) : outputType === "audio" || selectedModel?.toLowerCase().includes("lyria") ? (
                  <Music className="mx-auto mb-4 opacity-50 text-zinc-500" style={{ width: 'clamp(2rem, 1.5rem + 2vw, 4rem)', height: 'clamp(2rem, 1.5rem + 2vw, 4rem)' }} />
                ) : (
                  <Bot className="mx-auto mb-4 opacity-50 text-zinc-500" style={{ width: 'clamp(2rem, 1.5rem + 2vw, 4rem)', height: 'clamp(2rem, 1.5rem + 2vw, 4rem)' }} />
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

          {/* MirrorPane — independent equi-heighted sibling cell */}
          {!paneCollapsed && (
            <div className="cm-playground__pane-cell">
              <button
                onClick={() => setPaneCollapsed(true)}
                className="cm-playground__pane-toggle"
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
        </div>
      )}

      {/* Expand button when MirrorPane collapsed */}
      {activeTab === "model" && paneCollapsed && (
        <button
          onClick={() => setPaneCollapsed(false)}
          className="cm-playground__pane-expand"
          aria-label="Expand settings pane"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      {/* ── Plugins Tab ──────────────────────────────────────────── */}
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

      {/* ── Command Bar (⌘K) ─────────────────────────────────────── */}
      <CommandBar
        open={commandBarOpen}
        onOpenChange={setCommandBarOpen}
        value={selectedModel}
        onSelect={setSelectedModel}
        type={selectedType === "all" ? undefined : selectedType}
        provider={selectedProvider === "all" ? undefined : selectedProvider}
      />

      {/* ── Session Dialog ────────────────────────────────────────── */}
      <SessionBudgetDialog
        open={showSessionDialog}
        onOpenChange={setShowSessionDialog}
        showTrigger={false}
      />

      {/* ── Mobile MirrorPane Sheet ───────────────────────────────── */}
      <Sheet open={mobilePaneOpen} onOpenChange={setMobilePaneOpen}>
        <SheetContent side="right" className="p-0 overflow-y-auto" style={{ width: 'clamp(16rem, 14rem + 10vw, 28rem)' }}>
          <SheetHeader className="border-b border-sidebar-border" style={{ padding: 'clamp(0.5rem, 0.4rem + 0.5vw, 1.25rem)' }}>
            <SheetTitle className="font-display text-cyan-400 flex items-center" style={{ gap: 'clamp(0.375rem, 0.3rem + 0.2vw, 0.625rem)', fontSize: 'clamp(0.75rem, 0.6rem + 0.35vw, 1.125rem)' }}>
              <Settings2 style={{ width: 'clamp(0.75rem, 0.6rem + 0.3vw, 1.25rem)', height: 'clamp(0.75rem, 0.6rem + 0.3vw, 1.25rem)' }} />
              Model Settings
            </SheetTitle>
          </SheetHeader>
          <div style={{ padding: 'clamp(0.5rem, 0.4rem + 0.5vw, 1.25rem)' }}>
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
