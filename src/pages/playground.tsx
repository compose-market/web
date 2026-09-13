/**
 * Playground — Unified Multi-Model Chat Dashboard
 *
 * Zero-scroll, single-screen layout with:
 * - CapabilityChips for type/provider filtering
 * - ModelBadge for active model display
 * - CommandBar (⌘K) for model selection
 * - MultimodalCanvas for chat
 * - ModelCard for settings
 *
 * Shared hooks: useChat, useModels, useSession
 */
import { Suspense, lazy, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePostHog } from "@posthog/react";
import { mpTrack } from "@/lib/mixpanel";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { sdk } from "@/lib/sdk";
import { toMessage, type ResponseMessage } from "@/hooks/use-chat";
import { useChain } from "@/contexts/Network";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Bot,
  Settings2,
  RefreshCw,
  Plug,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Mic,
  Video,
} from "lucide-react";
import { MultimodalCanvas } from "@/components/chat";
import { ModelCard, type ModelParamsSchema } from "@/components/models/card";
import { ModelSelector } from "@/components/models/selector";
import { CapabilityChips } from "@/components/models/capabilities";
import { useChat } from "@/hooks/use-chat";
import { useModelDetails, useModelParams, useModels } from "@/hooks/use-model";
import { CostReceiptIndicator } from "@/components/receipt-indicator";
import { Switcher, type Option } from "@/components/control";
import { useToast } from "@/hooks/use-toast";
import { useStream, type StreamCallOptions } from "@/hooks/use-stream";
import { useRegistryMeta } from "@/hooks/use-registry";
import { useSelectedUserAddress } from "@/hooks/use-address";
import {
  buildFamilyCategories,
  buildTypeCategories,
  formatModelTypeLabel,
  getModelTypeValues,
  getModelValueList,
  modelRequiresImageAttachment,
  type CatalogModel,
} from "@/lib/models";

const PANE_COLLAPSED_KEY = "playground_pane_collapsed";

// ── Default model before user selection.
// If it doesn't exist (e.g., deprecated) in the catalog anymore,
// the auto-select effect will fall back to the latest frontier model.
const DEFAULT_MODEL = "gemini-3.8-flash";

type PlaygroundTab = "model" | "connectors";

const tabs: Option<PlaygroundTab>[] = [
  { value: "model", label: "Models", icon: Bot },
  { value: "connectors", label: "Connectors", icon: Plug },
];

const LazyConnectorTester = lazy(() =>
  import("@/components/connectors/tester").then((module) => ({ default: module.ConnectorTester }))
);

function getDefaultParamValues(schema: ModelParamsSchema | null): Record<string, unknown> {
  if (!schema) return {};
  const values: Record<string, unknown> = { ...(schema.defaults || {}) };
  for (const [key, definition] of Object.entries(schema.params)) {
    if (definition.required === true || values[key] !== undefined) continue;
    if (definition.default !== undefined) {
      values[key] = definition.default;
      continue;
    }
    if (definition.options && definition.options.length > 0) {
      values[key] = definition.options[0];
    }
  }
  return values;
}

function getInputIcon(input: string) {
  const norm = input.toLowerCase();
  if (norm.includes("text") || norm.includes("prompt")) return <FileText className="w-3.5 h-3.5" />;
  if (norm.includes("image") || norm.includes("vision")) return <ImageIcon className="w-3.5 h-3.5" />;
  if (norm.includes("audio") || norm.includes("speech") || norm.includes("voice")) return <Mic className="w-3.5 h-3.5" />;
  if (norm.includes("video")) return <Video className="w-3.5 h-3.5" />;
  return <FileText className="w-3.5 h-3.5" />;
}

function modelOutputType(model: CatalogModel): "text" | "image" | "audio" | "video" | "embedding" {
  if (Array.isArray(model.output)) {
    const output = model.output.filter((value): value is string => typeof value === "string");
    if (output.includes("image")) return "image";
    if (output.includes("video")) return "video";
    if (output.includes("audio")) return "audio";
    if (output.includes("embedding")) return "embedding";
  }
  return "text";
}

// =============================================================================
// Main Component
// =============================================================================

export default function PlaygroundPage() {
  const posthog = usePostHog();
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const { userAddress, isResolving: userAddressResolving } = useSelectedUserAddress();
  const { sessionActive, budgetRemaining, formatBudget, keyToken, resolveActiveKeyToken } = useSession();
  const { paymentNetwork } = useChain();
  const { toast } = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState<"model" | "connectors">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "connectors" ? "connectors" : "model";
  });

  const initialConnectorSource = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("source");
    if (source === "onchain") return "onchain";
    if (source === "mcp") return "mcp";
    return "mcp";
  }, []);

  const initialConnector = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("connector") || "";
  }, []);

  // ============ Filter State ============
  const [selectedType, setSelectedType] = useState("all");
  const [selectedFamily, setSelectedFamily] = useState("all");
  const { data: registryMeta } = useRegistryMeta({ enabled: activeTab === "connectors" });

  // ============ Models (single source — filters cascade to all consumers) ============
  const {
    models,
    filteredModels,
    frontiers,
    isRefetching: modelsRefetching,
    forceRefresh: forceRefreshModels,
  } = useModels({
    type: selectedType === "all" ? undefined : selectedType,
    family: selectedFamily === "all" ? undefined : selectedFamily,
  });
  const refreshedModelsOnMount = useRef(false);
  useEffect(() => {
    if (refreshedModelsOnMount.current) return;
    refreshedModelsOnMount.current = true;
    void forceRefreshModels();
  }, [forceRefreshModels]);

  const playgroundTabs = useMemo<Option<"model" | "connectors">[]>(() => [
    { value: "model", label: "Models", icon: Bot, count: models.length > 0 ? String(models.length) : undefined },
    { value: "connectors", label: "Connectors", icon: Plug, count: registryMeta?.totalServers ? String(registryMeta.totalServers) : undefined },
  ], [models.length, registryMeta?.totalServers]);

  // ── Interconnected filters: each category list reflects the OTHER filter's selection ──
  // Type categories built from models filtered ONLY by family (so type-counts update when family changes)
  const typeCategories = useMemo(() => {
    if (selectedFamily === "all") return buildTypeCategories(models);
    return buildTypeCategories(models.filter((m) => (m.family || m.provider) === selectedFamily));
  }, [models, selectedFamily]);

  // Family categories built from models filtered ONLY by type (so family-counts update when type changes)
  const familyCategories = useMemo(() => {
    if (selectedType === "all") return buildFamilyCategories(models);
    return buildFamilyCategories(models.filter((m) => getModelTypeValues(m).includes(selectedType)));
  }, [models, selectedType]);

  // ── Filter interconnection guards: auto-reset invalid selections ──
  useEffect(() => {
    if (selectedType !== "all" && typeCategories.length > 0) {
      const stillValid = typeCategories.some((c) => c.id === selectedType);
      if (!stillValid) setSelectedType("all");
    }
  }, [typeCategories, selectedType]);

  useEffect(() => {
    if (selectedFamily !== "all" && familyCategories.length > 0) {
      const stillValid = familyCategories.some((c) => c.id === selectedFamily);
      if (!stillValid) setSelectedFamily("all");
    }
  }, [familyCategories, selectedFamily]);

  // ============ Model Selection ============
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    // Deep-link support: /playground?model=<public-catalog-id> pre-selects a model.
    const requested = new URLSearchParams(window.location.search).get("model");
    return requested && requested.trim().length > 0 ? requested.trim() : DEFAULT_MODEL;
  });
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

  // Model Parameters State
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});

  // Chat state
  const conversationId = useRef(`playground-${Date.now()}`).current;
  const chat = useChat({
    conversationId,
    onError: (err) => setInferenceError(err),
  });
  const { messages, scrollContainerRef, messagesEndRef,
    activityState, clearMessages,
    attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, uploadedCids, cleanupFiles, clearFiles,
    isRecording, recordingSupported, startRecording, stopRecording,
  } = chat;
  const streamer = useStream(chat, {
    onError: (err) => setInferenceError(err.message),
    onDone: () => setStreaming(false),
  });
  useEffect(() => () => streamer.cancelResponses(), [streamer]);

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

  // Auto-select the active modality's current frontier model; fall back to the
  // first catalog match when the frontier overlay is temporarily unavailable.
  useEffect(() => {
    if (filteredModels.length === 0 || filteredModels.some((m) => m.modelId === selectedModel)) return;
    const frontierKeys = new Set(frontiers.map((model) => `${model.provider.toLowerCase()}:${model.modelId.toLowerCase()}`));
    const frontierModel = filteredModels.find((model) =>
      frontierKeys.has(`${model.provider.toLowerCase()}:${model.modelId.toLowerCase()}`)
    );
    setSelectedModel((frontierModel ?? filteredModels[0]).modelId);
  }, [filteredModels, frontiers, selectedModel]);

  // Keep deep links truthful after user-driven model changes.
  useEffect(() => {
    if (!selectedModel) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("model") === selectedModel) return;
    url.searchParams.set("model", selectedModel);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selectedModel]);

  // Track conversation context boundary on model switch
  const [conversationStartIndex, setConversationStartIndex] = useState(0);
  const prevModelRef = useRef<string | null>(null);
  const messagesLengthRef = useRef(0);

  useEffect(() => {
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (prevModelRef.current !== null && prevModelRef.current !== selectedModel && messagesLengthRef.current > 0) {
      setConversationStartIndex(messagesLengthRef.current);
    }
    prevModelRef.current = selectedModel;
  }, [selectedModel]);

  // Selected model info
  const selectedModelIndex = useMemo(
    () => models.find((m) => m.modelId === selectedModel) || null,
    [models, selectedModel],
  );
  const { data: selectedModelDetails } = useModelDetails(selectedModel);
  // Display prefers the canonical worker catalog row (name, family, pricing,
  // frontier flags); the API card only enriches fields the worker index does
  // not carry (description, capabilities, params).
  const selectedModelInfo = useMemo(() => {
    if (selectedModelDetails && selectedModelIndex) {
      return {
        ...selectedModelDetails,
        ...selectedModelIndex,
        description: selectedModelDetails.description ?? selectedModelIndex.description,
      };
    }
    return selectedModelDetails ?? selectedModelIndex;
  }, [selectedModelDetails, selectedModelIndex]);
  const { data: rawModelParams } = useModelParams<ModelParamsSchema>(selectedModel);
  const modelParams = useMemo(() => (
    rawModelParams && Object.keys(rawModelParams.params).length > 0 ? rawModelParams : null
  ), [rawModelParams]);

  useEffect(() => {
    setParamValues(getDefaultParamValues(modelParams));
  }, [modelParams, selectedModel]);

  // Refs for hot values used in handleSendMessage (avoids callback churn)
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const attachedFilesRef = useRef(attachedFiles);
  attachedFilesRef.current = attachedFiles;
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const selectedModelInfoRef = useRef(selectedModelInfo);
  selectedModelInfoRef.current = selectedModelInfo;
  const systemPromptRef = useRef(systemPrompt);
  systemPromptRef.current = systemPrompt;
  const paramValuesRef = useRef(paramValues);
  paramValuesRef.current = paramValues;
  const conversationStartIndexRef = useRef(conversationStartIndex);
  conversationStartIndexRef.current = conversationStartIndex;

  const handleSendMessage = useCallback(async () => {
    const currentAttachedFiles = attachedFilesRef.current;
    const currentInputValue = inputValueRef.current;
    const currentStreaming = streamingRef.current;
    const currentSelectedModel = selectedModelRef.current;
    const currentSelectedModelInfo = selectedModelInfoRef.current;
    const currentMessages = messagesRef.current;
    const currentSystemPrompt = systemPromptRef.current;
    const currentParamValues = paramValuesRef.current;
    const currentConversationStartIndex = conversationStartIndexRef.current;

    if (currentAttachedFiles.some(f => f.uploading)) return;
    if ((!currentInputValue.trim() && currentAttachedFiles.length === 0) || currentStreaming || !currentSelectedModel || !selectedModelDetails || !currentSelectedModelInfo) return;
    if (
      modelRequiresImageAttachment(selectedModelDetails)
      && !currentAttachedFiles.some((file) => file.type === "image" && Boolean(file.url))
    ) return false;

    if (!sessionActive || budgetRemaining <= 0) {
      toast({
        title: "Session Required",
        description: "Please create a session to continue. Sessions enable faster responses.",
        variant: "destructive"
      });
      setShowSessionDialog(true);
      return;
    }

    const attached = currentAttachedFiles[0];
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: currentInputValue.trim(),
      timestamp: Date.now(),
      type: attached?.type ?? "text",
      imageUrl: attached?.type === "image" ? attached.url : undefined,
      audioUrl: attached?.type === "audio" ? attached.url : undefined,
      videoUrl: attached?.type === "video" ? attached.url : undefined,
    };

    posthog?.capture("playground_message_sent", {
      model_id: currentSelectedModel,
      has_attachment: currentAttachedFiles.length > 0,
      attachment_type: currentAttachedFiles[0]?.type ?? null,
      network: paymentNetwork,
    });

    mpTrack("Launch AI");
    mpTrack("AI Prompt Sent and Prompt Text", {
      "Prompt Text": currentInputValue.trim().slice(0, 500),
    });

    chat.addUserMessage(currentInputValue.trim(), {
      type: attached?.type ?? "text",
      ...(attached?.type === "image" ? { imageUrl: attached.url } : {}),
      ...(attached?.type === "audio" ? { audioUrl: attached.url } : {}),
      ...(attached?.type === "video" ? { videoUrl: attached.url } : {}),
    });
    setInputValue("");
    clearFiles();
    setStreaming(true);
    setInferenceError(null);
    chat.clearActivityState();

    const assistantId = chat.createAssistantPlaceholder(modelOutputType(currentSelectedModelInfo));

    try {
      if (!wallet || !account) throw new Error("Connect wallet to use inference");
      if (!userAddress || userAddressResolving) throw new Error("Selected network account is still resolving");

      // Make sure the SDK has the freshly-minted Compose Key JWT cached
      // in-memory before any billable call fires.
      const activeKeyToken = await resolveActiveKeyToken();
      if (sessionActive && budgetRemaining > 0 && !activeKeyToken) {
        throw new Error("Compose session key unavailable. Re-open your session and try again.");
      }
      if (activeKeyToken) {
        sdk.keys.use(activeKeyToken);
      }

      const history = [...currentMessages.slice(currentConversationStartIndex), userMessage];
      const inputItems: ResponseMessage[] = history.map(toMessage);
      if (currentSystemPrompt.trim()) inputItems.unshift({ role: "system", content: currentSystemPrompt.trim() });
      const input = inputItems as unknown as NonNullable<Parameters<typeof sdk.inference.responses.stream>[0]["input"]>;

      const callOptions: StreamCallOptions = {
        ...(activeKeyToken ? { key: activeKeyToken } : {}),
        userAddress,
        network: paymentNetwork,
      };
      await streamer.runResponses({
        params: {
          model: currentSelectedModelInfo.modelId,
          input,
          stream: true,
          ...currentParamValues,
        },
        assistantId,
        options: callOptions,
      });
    } catch (err) {
      const errorMsg = "This request could not be completed.";
      console.error("[playground] inference failed:", err);
      setInferenceError(errorMsg);
      chat.setActivityPhase("error", errorMsg);
      chat.failAssistant(assistantId, errorMsg);
    } finally {
      setStreaming(false);
    }
  }, [wallet, account, budgetRemaining, clearFiles, sessionActive, keyToken, resolveActiveKeyToken, paymentNetwork, toast, posthog, chat, streamer, userAddress, userAddressResolving, selectedModelDetails]);
  const handleClearChat = useCallback(() => {
    streamer.cancelResponses();
    clearMessages();
    setInferenceError(null);
    clearFiles();
    setConversationStartIndex(0);
    if (uploadedCids.length > 0) cleanupFiles();
  }, [uploadedCids, cleanupFiles, clearFiles, clearMessages, streamer]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="cm-playground">
      {/* ── Top-Level Toolbar: Page info only ─────────────────── */}
      <div className="cm-playground__toolbar">
        <h1 className="cm-page-header__title cm-playground__toolbar-title">
          <span className="text-fuchsia-500 mr-2">//</span>
          PLAYGROUND
        </h1>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PlaygroundTab)}>
          <Switcher
            value={activeTab}
            options={playgroundTabs}
            label="Playground section"
            onChange={setActiveTab}
          />
        </Tabs>

        <div className="cm-playground__toolbar-right flex items-center gap-2">
          {activeTab === "model" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobilePaneOpen(true)}
              className="cm-shell-button cm-shell-button--ghost cm-shell-button--icon lg:hidden"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ── Chat + ModelCard — equi-heighted sibling grid ─────── */}
      {activeTab === "model" && (
        <div className={`cm-split${paneCollapsed ? " cm-split--collapsed" : ""}`}>
          {/* Chat cell — contains its own filter toolbar + caps + canvas */}
          <div className="cm-split__main cm-playground__chat-cell">
            {/* ── Chat-internal toolbar: badge, filters, count ── */}
            <div className="cm-playground__chat-toolbar">
              <ModelSelector
                value={selectedModel}
                onChange={setSelectedModel}
                open={commandBarOpen}
                onOpenChange={setCommandBarOpen}
                type={selectedType === "all" ? undefined : selectedType}
                family={selectedFamily === "all" ? undefined : selectedFamily}
              />

              <CapabilityChips
                selectedType={selectedType}
                onTypeChange={setSelectedType}
                typeCategories={typeCategories}
                selectedFamily={selectedFamily}
                onFamilyChange={setSelectedFamily}
                familyCategories={familyCategories}
              />

              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void forceRefreshModels()}
                  disabled={modelsRefetching}
                  className="cm-shell-button cm-shell-button--ghost cm-shell-button--icon"
                  aria-label="Refresh model catalog"
                >
                  <RefreshCw className={`h-4 w-4 ${modelsRefetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {/* ── Chat-internal input row ── */}
            {selectedModelInfo && (() => {
              const inputs = getModelValueList(selectedModelInfo.input);
              const uniqueInputs = [...new Set(inputs)];
              return uniqueInputs.length > 0 ? (
                <div className="cm-playground__caps-row">
                  <span className="cm-playground__caps-label">Input</span>
                  {uniqueInputs.map((input) => {
                    const formatted = input.charAt(0).toUpperCase() + input.slice(1);
                    return (
                      <span key={input} className="cm-playground__cap-tag flex items-center gap-1">
                        {getInputIcon(input)}
                        {formatted}
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
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSend={handleSendMessage}
              sending={streaming}
              activityState={activityState}
              error={inferenceError}
              sessionActive={sessionActive}
              attachedFiles={attachedFiles}
              imageRequired={Boolean(selectedModelDetails && modelRequiresImageAttachment(selectedModelDetails))}
              submitDisabled={!selectedModelDetails}
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
              placeholder={
                !sessionActive
                  ? "Start session"
                  : attachedFiles.length > 0
                    ? "Describe the uploaded file..."
                    : "Send a request..."
              }
              emptyStateIcon={<Bot className="mx-auto mb-4 h-12 w-12 text-cyan-300/50" />}
              emptyStateText={
                selectedModelInfo
                  ? `Start with ${selectedModelInfo.name || selectedModelInfo.modelId}`
                  : "Select a model to begin"
              }
              emptyStateSubtext={
                sessionActive
                  ? `Budget remaining: ${formatBudget(budgetRemaining)}`
                  : "Start a session to begin"
              }
            />
          </div>

          {/* ModelCard — independent equi-heighted sibling cell */}
          {!paneCollapsed && (
            <div className="cm-split__side cm-playground__pane-cell">
              <button
                onClick={() => setPaneCollapsed(true)}
                className="cm-playground__pane-toggle"
                aria-label="Collapse settings pane"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <ModelCard
                selectedModel={selectedModel}
                modelInfo={selectedModelInfo || null}
                systemPrompt={systemPrompt}
                onSystemPromptChange={setSystemPrompt}
                modelParams={modelParams}
                paramValues={paramValues}
                onParamValuesChange={setParamValues}
              />
            </div>
          )}
        </div>
      )}

      {/* Expand button when ModelCard collapsed */}
      {activeTab === "model" && paneCollapsed && (
        <button
          onClick={() => setPaneCollapsed(false)}
          className="cm-playground__pane-expand"
          aria-label="Expand settings pane"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      {/* ── Connectors Tab ──────────────────────────────────────────── */}
      {activeTab === "connectors" && (
        <div className="flex-1 min-h-0">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading connector tester...
              </div>
            }
          >
            <LazyConnectorTester
              initialSource={initialConnectorSource}
              initialConnector={initialConnector}
            />
          </Suspense>
        </div>
      )}

      {/* ── Command Bar (⌘K) ─────────────────────────────────────── */}

      {/* ── Session Dialog ────────────────────────────────────────── */}
      <SessionBudgetDialog
        open={showSessionDialog}
        onOpenChange={setShowSessionDialog}
        showTrigger={false}
      />

      {/* ── Mobile ModelCard Sheet ───────────────────────────────── */}
      <Sheet open={mobilePaneOpen} onOpenChange={setMobilePaneOpen}>
        <SheetContent side="right" className="cm-shell-panel cm-sheet-panel cm-sheet-panel--inspect p-0">
          <SheetHeader className="border-b border-primary/15 p-4">
            <SheetTitle className="font-display text-cyan-300 flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5" />
              Model Settings
            </SheetTitle>
          </SheetHeader>
          <div className="cm-sheet-body cm-sheet-body--inspect">
            <ModelCard
              selectedModel={selectedModel}
              modelInfo={selectedModelInfo || null}
              systemPrompt={systemPrompt}
              onSystemPromptChange={setSystemPrompt}
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
