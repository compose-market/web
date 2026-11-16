/**
 * Playground — Unified Multi-Model Inference Studio
 *
 * Balanced 2-zone responsive layout with:
 * - Quiet central chat hero + prominent model description & controls in ModelCard
 * - CapabilityChips, ModelSelector (⌘K), MultimodalCanvas (Surface 1 + Pulse Surface 2)
 * - On-demand Activity & Receipt Sheet (Surface 3)
 * - Zero nested Tabs, zero 0px chat collapse, real SSE error surfacing & Stop control
 */
import { Suspense, lazy, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { sdk } from "@/lib/sdk";
import { toMessage, type ResponseMessage } from "@/hooks/use-chat";
import { useChain } from "@/contexts/Network";
import { Button } from "@/components/ui/button";
import {
  Bot,
  RefreshCw,
  Plug,
  PanelRightClose,
  PanelRightOpen,
  FileText,
  Image as ImageIcon,
  Mic,
  Video,
} from "lucide-react";
import { MultimodalCanvas } from "@/components/chat";
import { Trace } from "@/components/trace";
import { ModelCard, type ModelParamsSchema } from "@/components/models/card";
import type { ConnectorCardTab } from "@/components/connectors/card";
import type { ConnectorPocket } from "@/components/connectors/tester";
import { ModelSelector } from "@/components/models/selector";
import { CapabilityChips } from "@/components/models/capabilities";
import { useChat } from "@/hooks/use-chat";
import { useTurnReceipts } from "@/hooks/use-receipts";
import { useModelDetails, useModelParams, useModels } from "@/hooks/use-model";
import { Pockets, Switcher, type Option } from "@/components/control";
import { useToast } from "@/hooks/use-toast";
import { seedModelCards, useStream, type StreamCallOptions } from "@/hooks/use-stream";
import { useRegistryMeta } from "@/hooks/use-registry";
import { useSelectedUserAddress } from "@/hooks/use-address";
import {
  buildFamilyCategories,
  buildTypeCategories,
  getFamilyLogoUrl,
  getModelTypeValues,
  getModelValueList,
  modelRequiresImageAttachment,
  type CatalogModel,
} from "@/lib/models";

const PANE_COLLAPSED_KEY = "playground_pane_collapsed";
const DEFAULT_MODEL = "gemini-3.8-flash";

type PlaygroundTab = "model" | "connectors";

const LazyConnectorTester = lazy(() =>
  import("@/components/connectors/tester").then((module) => ({ default: module.ConnectorTester })),
);

function getDefaultParamValues(schema: ModelParamsSchema | null): Record<string, unknown> {
  if (!schema) return {};
  const values: Record<string, unknown> = { ...(schema.defaults || {}) };
  for (const [key, definition] of Object.entries(schema.params)) {
    if (definition.required === true || values[key] !== undefined) continue;
    if (definition.default !== undefined) {
      values[key] = definition.default;
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

export default function PlaygroundPage() {
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const { userAddress, isResolving: userAddressResolving } = useSelectedUserAddress();
  const { sessionActive, budgetRemaining, formatBudget, keyToken, resolveActiveKeyToken } = useSession();
  const { paymentNetwork } = useChain();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<PlaygroundTab>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "connectors" ? "connectors" : "model";
  });

  const initialConnectorSource = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("source");
    if (source === "onchain") return "onchain";
    if (source === "account" || source === "accounts") return "account";
    if (source === "mcp") return "mcp";
    return "mcp";
  }, []);

  const initialConnector = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("connector") || "";
  }, []);

  const [selectedType, setSelectedType] = useState("all");
  const [selectedFamily, setSelectedFamily] = useState("all");
  const { data: registryMeta } = useRegistryMeta({ enabled: activeTab === "connectors" });

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

  const playgroundTabs = useMemo<Option<PlaygroundTab>[]>(() => [
    { value: "model", label: "Models", icon: Bot, count: models.length > 0 ? String(models.length) : undefined },
    { value: "connectors", label: "Connectors", icon: Plug, count: registryMeta?.totalServers ? String(registryMeta.totalServers) : undefined },
  ], [models.length, registryMeta?.totalServers]);

  const typeCategories = useMemo(() => {
    if (selectedFamily === "all") return buildTypeCategories(models);
    return buildTypeCategories(models.filter((m) => (m.family || m.provider) === selectedFamily));
  }, [models, selectedFamily]);

  const familyCategories = useMemo(() => {
    if (selectedType === "all") return buildFamilyCategories(models);
    return buildFamilyCategories(models.filter((m) => getModelTypeValues(m).includes(selectedType)));
  }, [models, selectedType]);

  useEffect(() => {
    if (selectedType !== "all" && typeCategories.length > 0) {
      if (!typeCategories.some((c) => c.id === selectedType)) setSelectedType("all");
    }
  }, [typeCategories, selectedType]);

  useEffect(() => {
    if (selectedFamily !== "all" && familyCategories.length > 0) {
      if (!familyCategories.some((c) => c.id === selectedFamily)) setSelectedFamily("all");
    }
  }, [familyCategories, selectedFamily]);

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const requested = new URLSearchParams(window.location.search).get("model");
    return requested && requested.trim().length > 0 ? requested.trim() : DEFAULT_MODEL;
  });
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [connectorCommandBarOpen, setConnectorCommandBarOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [inspectedMessageId, setInspectedMessageId] = useState<string | null>(null);

  const [pocket, setPocket] = useState<"chat" | "spec" | "tune">("chat");
  const [modelTab, setModelTab] = useState<"details" | "custom" | "benchmarks">("details");
  const [connectorPocket, setConnectorPocket] = useState<ConnectorPocket>("runner");
  const [connectorTab, setConnectorTab] = useState<ConnectorCardTab>("overview");

  const [paneCollapsed, setPaneCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(PANE_COLLAPSED_KEY) === "true";
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem(PANE_COLLAPSED_KEY, String(paneCollapsed));
  }, [paneCollapsed]);

  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});

  const conversationId = useRef(`playground-${Date.now()}`).current;
  const chat = useChat({
    conversationId,
    onError: (err) => setInferenceError(err),
  });
  const {
    messages,
    setMessages,
    scrollContainerRef,
    messagesEndRef,
    activityState,
    latestActivity,
    latestReceipt,
    latestReceipts,
    latestUsage,
    reconcileAssistantReceipts,
    clearMessages,
    attachedFiles,
    fileInputRef,
    handleFileSelect,
    handleRemoveFile,
    uploadedCids,
    cleanupFiles,
    clearFiles,
    isRecording,
    recordingSupported,
    startRecording,
    stopRecording,
  } = chat;

  const streamer = useStream(chat, {
    onError: (err) => setInferenceError(err.message),
    onDone: () => setStreaming(false),
  });
  useEffect(() => () => streamer.cancelResponses(), [streamer]);

  useTurnReceipts({
    messages,
    userAddress,
    network: paymentNetwork,
    mode: "playground",
    isStreaming: streaming,
    onReconcile: reconcileAssistantReceipts,
  });

  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (activeTab === "connectors") {
          setConnectorCommandBarOpen((prev) => !prev);
        } else {
          setCommandBarOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab]);

  useEffect(() => {
    if (filteredModels.length === 0 || filteredModels.some((m) => m.modelId === selectedModel)) return;
    const frontierKeys = new Set(frontiers.map((model) => `${model.provider.toLowerCase()}:${model.modelId.toLowerCase()}`));
    const frontierModel = filteredModels.find((model) =>
      frontierKeys.has(`${model.provider.toLowerCase()}:${model.modelId.toLowerCase()}`),
    );
    setSelectedModel((frontierModel ?? filteredModels[0]).modelId);
  }, [filteredModels, frontiers, selectedModel]);

  useEffect(() => {
    if (!selectedModel) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("model") === selectedModel) return;
    url.searchParams.set("model", selectedModel);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selectedModel]);

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

  const selectedModelIndex = useMemo(
    () => models.find((m) => m.modelId === selectedModel) || null,
    [models, selectedModel],
  );
  const { data: selectedModelDetails } = useModelDetails(selectedModel);
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

  useEffect(() => {
    if (selectedModelDetails && selectedModelInfo) {
      seedModelCards([selectedModelInfo], { overwrite: true });
    }
  }, [selectedModelDetails, selectedModelInfo]);

  const { data: rawModelParams } = useModelParams<ModelParamsSchema>(selectedModel);
  const modelParams = useMemo(() => (
    rawModelParams && Object.keys(rawModelParams.params).length > 0 ? rawModelParams : null
  ), [rawModelParams]);

  useEffect(() => {
    setParamValues(getDefaultParamValues(modelParams));
  }, [modelParams, selectedModel]);

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

    if (currentAttachedFiles.some((f) => f.uploading)) return;
    if ((!currentInputValue.trim() && currentAttachedFiles.length === 0) || currentStreaming || !currentSelectedModel || !currentSelectedModelInfo) return;
    const effectiveModelForGate = selectedModelDetails ?? currentSelectedModelInfo;
    if (
      modelRequiresImageAttachment(effectiveModelForGate)
      && !currentAttachedFiles.some((file) => file.type === "image" && Boolean(file.url))
    ) return false;

    if (!sessionActive || budgetRemaining <= 0) {
      toast({
        title: "Session Required",
        description: "Please create a session to continue. Sessions enable faster responses.",
        variant: "destructive",
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
        ...(paymentNetwork ? { network: paymentNetwork } : {}),
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
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const errorMsg = err instanceof Error && err.message.trim()
          ? err.message
          : "This request could not be completed.";
        console.error("[playground] inference failed:", err);
        setInferenceError(errorMsg);
        chat.setActivityPhase("error", errorMsg);
        chat.failAssistant(assistantId, errorMsg);
      }
    } finally {
      setStreaming(false);
    }
  }, [wallet, account, budgetRemaining, clearFiles, sessionActive, keyToken, resolveActiveKeyToken, paymentNetwork, toast, chat, streamer, userAddress, userAddressResolving, selectedModelDetails]);

  const handleStop = useCallback(() => {
    streamer.cancelResponses();
    chat.clearActivityState();
    setStreaming(false);
  }, [chat, streamer]);

  const handleClearChat = useCallback(() => {
    streamer.cancelResponses();
    clearMessages();
    setInferenceError(null);
    clearFiles();
    setConversationStartIndex(0);
    if (uploadedCids.length > 0) cleanupFiles();
  }, [uploadedCids, cleanupFiles, clearFiles, clearMessages, streamer]);

  const inputModalities = useMemo(
    () => (selectedModelInfo ? [...new Set(getModelValueList(selectedModelInfo.input))] : ["text"]),
    [selectedModelInfo],
  );
  const familyLogo = selectedModelInfo?.family ? getFamilyLogoUrl(selectedModelInfo.family) : null;

  const canvasStatus = streaming
    ? activityState.phase === "streaming" || activityState.phase === "thinking" || activityState.phase === "tool"
      ? "streaming"
      : "waiting"
    : "idle";

  const openTrace = useCallback((nodeId?: string, messageId?: string) => {
    setFocusedNodeId(nodeId ?? null);
    setInspectedMessageId(messageId ?? null);
    setTraceOpen(true);
  }, []);

  const handleCloseTrace = useCallback(() => {
    setTraceOpen(false);
    setInspectedMessageId(null);
  }, []);

  const handleFileSelectClick = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  const handleCopyMessage = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
    toast({ title: "Copied!", description: "Response copied to clipboard" });
  }, [toast]);

  const handleRetryMessage = useCallback((content: string) => {
    setInputValue(content);
  }, []);

  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, [setMessages]);

  const inspectedMessage = useMemo(
    () => (inspectedMessageId ? messages.find((m) => m.id === inspectedMessageId) ?? null : null),
    [inspectedMessageId, messages],
  );

  return (
    <div className="cm-playground">
      {/* ── Top-Level Toolbar ── */}
      <div className="cm-playground__toolbar">
        <h1 className="cm-page-header__title cm-playground__toolbar-title" data-route-heading>
          <span className="text-fuchsia-500 mr-2">//</span>
          PLAYGROUND
        </h1>

        <div className="flex items-center gap-2 min-w-0">
          <Switcher
            value={activeTab}
            options={playgroundTabs}
            label="Playground section"
            onChange={setActiveTab}
          />

          {activeTab === "model" ? (
            <Pockets
              value={pocket}
              label="Playground view"
              className="cm-pocket-bar--split"
              onChange={(next) => {
                setPocket(next);
                if (next === "spec") setModelTab("details");
                if (next === "tune") setModelTab("custom");
              }}
              options={[
                { value: "chat", label: "Chat" },
                { value: "spec", label: "Details" },
                { value: "tune", label: "Custom" },
              ]}
            />
          ) : (
            <Pockets
              value={connectorPocket}
              label="Connector view"
              className="cm-pocket-bar--split"
              onChange={(next) => {
                setConnectorPocket(next);
                if (next === "overview") setConnectorTab("overview");
                if (next === "params") setConnectorTab("params");
              }}
              options={[
                { value: "runner", label: "Run" },
                { value: "overview", label: "Info" },
                { value: "params", label: "Params" },
              ]}
            />
          )}

          <Button
            variant="ghost"
            size="sm"
            className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm cm-split__collapse-btn"
            onClick={() => setPaneCollapsed((prev) => !prev)}
            aria-label={paneCollapsed ? "Show inspector" : "Hide inspector"}
            title={paneCollapsed ? "Show inspector" : "Hide inspector"}
          >
            {paneCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Models Workspace: Balanced 2-Zone Split ── */}
      {activeTab === "model" && (
        <div
          className={`cm-split${paneCollapsed ? " cm-split--collapsed" : ""}`}
          data-pocket={pocket === "chat" ? "main" : "side"}
          data-collapsed={paneCollapsed ? "true" : undefined}
        >
          <div className="cm-split__main cm-playground__chat-cell">
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

            {selectedModelInfo && inputModalities.length > 0 ? (
              <div className="cm-playground__caps-row">
                <span className="cm-playground__caps-label">Input</span>
                {inputModalities.map((input) => {
                  const formatted = input.charAt(0).toUpperCase() + input.slice(1);
                  return (
                    <span key={input} className="cm-playground__cap-tag flex items-center gap-1">
                      {getInputIcon(input)}
                      {formatted}
                    </span>
                  );
                })}
              </div>
            ) : null}

            <MultimodalCanvas
              variant="playground"
              showHeader={false}
              messages={messages}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSend={handleSendMessage}
              sending={streaming}
              status={canvasStatus}
              activityState={activityState}
              stepCount={activityState.tools.length}
              latestReceipt={latestReceipt}
              latestReceipts={latestReceipts}
              error={inferenceError}
              sessionActive={sessionActive}
              attachedFiles={attachedFiles}
              imageRequired={Boolean(selectedModelInfo && modelRequiresImageAttachment(selectedModelDetails ?? selectedModelInfo))}
              submitDisabled={!selectedModelInfo}
              onFileSelect={handleFileSelectClick}
              onRemoveFile={handleRemoveFile}
              fileInputRef={fileInputRef}
              onFileInputChange={handleFileSelect}
              isRecording={isRecording}
              recordingSupported={recordingSupported}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onStop={handleStop}
              onInspectFlow={openTrace}
              onCopyMessage={handleCopyMessage}
              onRetryMessage={handleRetryMessage}
              onDeleteMessage={handleDeleteMessage}
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
              emptyStage={(
                <div className="cm-chat-hero">
                  <div className="cm-chat-hero__emblem">
                    {familyLogo ? (
                      <img src={familyLogo} alt={selectedModelInfo?.family || ""} className="cm-family-icon" />
                    ) : (
                      <Bot className="cm-chat-hero__icon" />
                    )}
                  </div>
                </div>
              )}
              emptyStateText={
                selectedModelInfo
                  ? selectedModelInfo.name || selectedModelInfo.modelId
                  : "Select a model"
              }
              emptyStateSubtext={(() => {
                const desc = selectedModelInfo?.description?.trim() || "";
                const label = (selectedModelInfo?.name || selectedModelInfo?.modelId || "").trim().toLowerCase();
                if (desc && desc.toLowerCase() !== label && desc.toLowerCase() !== (selectedModelInfo?.modelId || "").trim().toLowerCase()) {
                  return desc;
                }
                return sessionActive
                  ? `Balance: ${formatBudget(budgetRemaining)}`
                  : "Start a session to chat";
              })()}
            />
          </div>

          <div className="cm-split__side cm-playground__pane-cell">
            <ModelCard
              selectedModel={selectedModel}
              modelInfo={selectedModelInfo || null}
              systemPrompt={systemPrompt}
              onSystemPromptChange={setSystemPrompt}
              modelParams={modelParams}
              paramValues={paramValues}
              onParamValuesChange={setParamValues}
              tab={modelTab}
              onTabChange={(next) => {
                setModelTab(next);
                if (pocket !== "chat") {
                  setPocket(next === "custom" ? "tune" : "spec");
                }
              }}
            />
          </div>
        </div>
      )}

      {/* ── Connectors Workspace: Balanced 2-Zone Split ── */}
      {activeTab === "connectors" && (
        <Suspense
          fallback={
            <div className="flex flex-1 min-h-0 items-center justify-center text-sm text-muted-foreground font-mono">
              Loading connector workspace...
            </div>
          }
        >
          <LazyConnectorTester
            initialSource={initialConnectorSource}
            initialConnector={initialConnector}
            paneCollapsed={paneCollapsed}
            pocket={connectorPocket}
            onPocketChange={setConnectorPocket}
            inspectorTab={connectorTab}
            onInspectorTabChange={setConnectorTab}
            commandBarOpen={connectorCommandBarOpen}
            onCommandBarOpenChange={setConnectorCommandBarOpen}
          />
        </Suspense>
      )}

      {/* ── Surface 3: On-Demand Inference Flow & Settlement Receipt Sheet ── */}
      <Trace
        open={traceOpen}
        onClose={handleCloseTrace}
        activity={inspectedMessage?.activity ?? latestActivity}
        receipt={inspectedMessage?.receipt ?? latestReceipt}
        receipts={inspectedMessage?.receipts ?? latestReceipts}
        usage={inspectedMessage?.usage ?? latestUsage}
        focusedNodeId={focusedNodeId}
      />

      {/* ── Session Dialog ── */}
      <SessionBudgetDialog
        open={showSessionDialog}
        onOpenChange={setShowSessionDialog}
        showTrigger={false}
      />
    </div>
  );
}
