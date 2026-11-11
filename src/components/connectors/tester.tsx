/**
 * Connector Tester Component
 *
 * Balanced 2-zone Connectors Studio mirroring Playground's Models tab:
 * - Left pane (`.cm-split__main cm-playground__chat-cell`): source switcher,
 *   ConnectorSelector (⌘K), tool dropdown, native scrolling execution stream,
 *   and JSON payload composer.
 * - Right pane (`.cm-split__side cm-playground__pane-cell`): persistent
 *   ConnectorCard (`Overview | Params | Schema`) with schema-driven inputs
 *   bidirectionally synced to the JSON payload.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveWallet } from "thirdweb/react";
import { ShellNotice } from "@compose-market/theme/shell";
import { sdk } from "@/lib/sdk";
import { useSession } from "@/hooks/use-session";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { durableQueryMeta, DURABLE_CACHE_MAX_AGE } from "@/lib/queryClient";
import { openGlobalBackpack } from "@/components/backpack";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { ModelBadgeTrigger } from "@/components/models/badge";
import { Textarea } from "@/components/ui/textarea";
import { HighlightedCode, safeHref } from "@/lib/performance/markdown";
import { cn } from "@/lib/utils";
import { useConnectorCatalogSnapshot, useRegistryMeta } from "@/hooks/use-registry";
import { normalizeConnectorBinding } from "@/lib/connectors";
import { Switcher, type Option } from "@/components/control";
import { ConnectorSelector } from "@/components/connectors/selector";
import {
  ConnectorCard,
  type ConnectorCardTab,
  type ConnectorCredentialSpec,
  type ConnectorToolSummary,
} from "@/components/connectors/card";
import {
  Backpack,
  ExternalLink,
  Link2,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export type ConnectorSource = "mcp" | "account" | "onchain";
export type ConnectorPocket = "runner" | "overview" | "params";

interface ConnectorResult {
  id: string;
  success: boolean;
  connectorId: string;
  tool: string;
  result?: unknown;
  error?: string;
  txHash?: string;
  explorer?: string;
  executedBy?: string;
  source: ConnectorSource;
  durationMs?: number;
}

interface OnchainStatusData {
  initialized: boolean;
  walletAddress: string | null;
  chain: string | null;
  totalTools: number;
  connectors: Array<{
    id: string;
    name: string;
    description: string;
    toolCount: number;
    tools: ConnectorToolSummary[];
  }>;
}

interface McpCardData {
  slug: string;
  name: string;
  description: string;
  status: "live" | "credential_gated";
  tools: ConnectorToolSummary[];
  credentials: ConnectorCredentialSpec[];
}

interface AccountActionsData {
  actions: ConnectorToolSummary[];
  noAuth: boolean;
}

interface AccountConnectionState {
  connected: boolean;
  granted: boolean;
  connectedAccountId?: string;
  noAuth?: boolean;
}

const TOOL_CATALOG_STALE_TIME = 6 * 60 * 60 * 1000;
const CONNECTION_STALE_TIME = 30 * 1000;

// =============================================================================
// Helpers
// =============================================================================

function generateDefaultArgs(schema: Record<string, unknown> | null): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!schema || typeof schema !== "object") return result;
  const props = (schema as { properties?: Record<string, { type?: string | string[]; default?: unknown }> }).properties;
  if (!props) return result;

  for (const [key, prop] of Object.entries(props)) {
    const propType = Array.isArray(prop.type)
      ? prop.type.find((t) => t !== "null") ?? prop.type[0]
      : prop.type;

    if (prop.default !== undefined) {
      result[key] = prop.default;
    } else if (propType === "string") {
      if (key.toLowerCase().includes("address")) {
        result[key] = "0x...";
      } else if (key.toLowerCase().includes("amount")) {
        result[key] = "0";
      } else {
        result[key] = "";
      }
    } else if (propType === "number" || propType === "integer") {
      result[key] = 0;
    } else if (propType === "boolean") {
      result[key] = false;
    } else if (propType === "array") {
      result[key] = [];
    } else if (propType === "object") {
      result[key] = {};
    }
  }
  return result;
}

function normalizeConnectorSlug(value: string, source: ConnectorSource): string {
  if (!value) return "";
  return normalizeConnectorBinding(value, { defaultOrigin: source }).slug;
}

function formatResultPayload(result: ConnectorResult): { code: string; language: string } {
  if (result.error) return { code: result.error, language: "text" };
  if (typeof result.result === "string") return { code: result.result, language: "text" };
  try {
    return { code: JSON.stringify(result.result ?? null, null, 2), language: "json" };
  } catch {
    return { code: String(result.result), language: "text" };
  }
}

// =============================================================================
// Props
// =============================================================================

export interface ConnectorTesterProps {
  initialSource?: ConnectorSource;
  initialConnector?: string;
  paneCollapsed?: boolean;
  pocket?: ConnectorPocket;
  onPocketChange?: (next: ConnectorPocket) => void;
  inspectorTab?: ConnectorCardTab;
  onInspectorTabChange?: (next: ConnectorCardTab) => void;
  commandBarOpen?: boolean;
  onCommandBarOpenChange?: (open: boolean) => void;
}

// =============================================================================
// Component
// =============================================================================

export function ConnectorTester({
  initialSource = "mcp",
  initialConnector = "",
  paneCollapsed = false,
  pocket = "runner",
  onPocketChange,
  inspectorTab = "overview",
  onInspectorTabChange,
  commandBarOpen,
  onCommandBarOpenChange,
}: ConnectorTesterProps) {
  const wallet = useActiveWallet();
  const { userAddress: selectedUserAddress } = useSelectedUserAddress();
  const { keyToken, ensureKeyToken } = useSession();
  const queryClient = useQueryClient();

  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const [connectorSource, setConnectorSource] = useState<ConnectorSource>(initialSource);
  const [selectedMcpServer, setSelectedMcpServer] = useState<string>(
    initialSource === "mcp" && initialConnector ? normalizeConnectorSlug(initialConnector, "mcp") : "",
  );
  const [selectedAccountToolkit, setSelectedAccountToolkit] = useState<string>(
    initialSource === "account" && initialConnector ? normalizeConnectorSlug(initialConnector, "account") : "",
  );
  const [selectedOnchainConnector, setSelectedOnchainConnector] = useState<string>(
    initialSource === "onchain" && initialConnector ? normalizeConnectorSlug(initialConnector, "onchain") : "",
  );

  const [selectedTool, setSelectedTool] = useState<string>("");
  const [toolArgs, setToolArgs] = useState<string>("{}");
  const [connectorResults, setConnectorResults] = useState<ConnectorResult[]>([]);
  const [executingConnector, setExecutingConnector] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);

  const snap = useConnectorCatalogSnapshot(true);
  const { data: registryMeta, refetch: refetchMeta } = useRegistryMeta();

  const activeConnectorSlug = connectorSource === "onchain"
    ? selectedOnchainConnector
    : connectorSource === "account"
      ? selectedAccountToolkit
      : selectedMcpServer;

  // Snapshot metadata for instant name, description, logo
  const snapshotMeta = useMemo(() => {
    if (!activeConnectorSlug || !snap.hasData) return null;
    const binding = normalizeConnectorBinding(activeConnectorSlug, { defaultOrigin: connectorSource });
    return snap.serverByBindingId.get(binding.registryId.toLowerCase())
      ?? snap.serverByBindingId.get(`${connectorSource}:${activeConnectorSlug.toLowerCase()}`)
      ?? null;
  }, [activeConnectorSlug, connectorSource, snap.hasData, snap.serverByBindingId]);

  // ── Cached Queries (Deduplicated, Survive Remount & Reload) ──

  const onchainListQuery = useQuery<OnchainStatusData, Error>({
    queryKey: ["connectors", "onchain", "list"],
    queryFn: async () => {
      const data = await sdk.connectors.onchain.list();
      const rawStatus = (data.status ?? {}) as Record<string, unknown>;
      const connectors = (data.connectors || []).map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || "",
        toolCount: c.toolCount ?? c.tools?.length ?? 0,
        tools: (c.tools || []).map((t) => ({
          name: t.name,
          description: t.description || "",
          inputSchema: (t.parameters ?? t.inputSchema ?? {}) as Record<string, unknown>,
        })),
      }));
      return {
        initialized: typeof rawStatus.initialized === "boolean" ? rawStatus.initialized : connectors.length > 0,
        walletAddress: typeof rawStatus.walletAddress === "string" ? rawStatus.walletAddress : null,
        chain: typeof rawStatus.chain === "string" ? rawStatus.chain : null,
        totalTools: typeof rawStatus.totalTools === "number"
          ? rawStatus.totalTools
          : (data.totalTools ?? connectors.reduce((sum, c) => sum + c.toolCount, 0)),
        connectors,
      };
    },
    enabled: connectorSource === "onchain",
    staleTime: TOOL_CATALOG_STALE_TIME,
    gcTime: DURABLE_CACHE_MAX_AGE,
    meta: durableQueryMeta,
  });

  // Auto-select first onchain connector when switching to onchain with none selected
  useEffect(() => {
    if (connectorSource === "onchain" && !selectedOnchainConnector) {
      const firstId = onchainListQuery.data?.connectors[0]?.id ?? snap.onchainServers[0]?.slug;
      if (firstId) setSelectedOnchainConnector(firstId);
    }
  }, [connectorSource, onchainListQuery.data?.connectors, selectedOnchainConnector, snap.onchainServers]);

  const onchainDetailQuery = useQuery<ConnectorToolSummary[], Error>({
    queryKey: ["connectors", "onchain", "detail", selectedOnchainConnector],
    queryFn: async () => {
      const data = await sdk.connectors.onchain.get(selectedOnchainConnector);
      return (data.tools || []).map((t) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: (t.parameters ?? t.inputSchema ?? {}) as Record<string, unknown>,
      }));
    },
    enabled: connectorSource === "onchain" && Boolean(selectedOnchainConnector),
    staleTime: TOOL_CATALOG_STALE_TIME,
    gcTime: DURABLE_CACHE_MAX_AGE,
    meta: durableQueryMeta,
  });

  const mcpCardQuery = useQuery<McpCardData, Error>({
    queryKey: ["connectors", "mcp", "card", selectedMcpServer],
    queryFn: async () => {
      const data = await sdk.connectors.mcps.get(selectedMcpServer);
      const tools: ConnectorToolSummary[] = (data.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
      }));
      return {
        slug: data.slug,
        name: data.name,
        description: data.description || "",
        status: data.status === "credential_gated" ? "credential_gated" : "live",
        tools,
        credentials: (data.credentials || []).map((c) => ({
          varName: c.varName,
          description: c.description ?? null,
          obtainUrl: c.obtainUrl ?? null,
        })),
      };
    },
    enabled: connectorSource === "mcp" && Boolean(selectedMcpServer),
    staleTime: TOOL_CATALOG_STALE_TIME,
    gcTime: DURABLE_CACHE_MAX_AGE,
    meta: durableQueryMeta,
  });

  const accountActionsQuery = useQuery<AccountActionsData, Error>({
    queryKey: ["connectors", "account", "actions", selectedAccountToolkit],
    queryFn: async () => {
      const actionsData = await sdk.connectors.accounts.toolkits.actions(selectedAccountToolkit, { limit: 100 });
      const rawActions = actionsData.actions || [];
      return {
        noAuth: rawActions.length > 0 && rawActions.every((a) => a.noAuth === true),
        actions: rawActions.map((a) => ({
          name: a.slug,
          description: a.description || a.name,
          inputSchema: (a.inputParameters || {}) as Record<string, unknown>,
        })),
      };
    },
    enabled: connectorSource === "account" && Boolean(selectedAccountToolkit),
    staleTime: TOOL_CATALOG_STALE_TIME,
    gcTime: DURABLE_CACHE_MAX_AGE,
    meta: durableQueryMeta,
  });

  const accountConnectionQuery = useQuery<AccountConnectionState, Error>({
    queryKey: ["connectors", "account", "connection", selectedUserAddress ?? "", selectedAccountToolkit],
    queryFn: async () => {
      if (!selectedUserAddress) return { connected: false, granted: false };
      const connectionsData = await sdk.connectors.accounts.list({
        userAddress: selectedUserAddress,
        toolkit: selectedAccountToolkit,
      }).catch(() => ({ connections: [] }));
      const activeMatch = (connectionsData.connections || []).find(
        (c) => c.slug === selectedAccountToolkit && c.connected,
      );
      if (activeMatch) {
        return {
          connected: true,
          granted: activeMatch.granted ?? true,
          connectedAccountId: activeMatch.connectedAccountId || activeMatch.accountId,
        };
      }
      return { connected: false, granted: false };
    },
    enabled: connectorSource === "account" && Boolean(selectedAccountToolkit),
    staleTime: CONNECTION_STALE_TIME,
  });

  // ── Derived Active Tools & Metadata ──

  const activeTools = useMemo<ConnectorToolSummary[]>(() => {
    if (connectorSource === "onchain") {
      if (onchainDetailQuery.data && onchainDetailQuery.data.length > 0) return onchainDetailQuery.data;
      const fromList = onchainListQuery.data?.connectors.find((c) => c.id === selectedOnchainConnector)?.tools;
      return fromList ?? [];
    }
    if (connectorSource === "account") {
      return accountActionsQuery.data?.actions ?? [];
    }
    return mcpCardQuery.data?.tools ?? [];
  }, [
    accountActionsQuery.data?.actions,
    connectorSource,
    mcpCardQuery.data?.tools,
    onchainDetailQuery.data,
    onchainListQuery.data?.connectors,
    selectedOnchainConnector,
  ]);

  const activeToolMeta = useMemo(
    () => activeTools.find((t) => t.name === selectedTool) ?? null,
    [activeTools, selectedTool],
  );
  const toolSchema = activeToolMeta?.inputSchema ?? null;

  const isLoadingTools = connectorSource === "onchain"
    ? onchainListQuery.isFetching || onchainDetailQuery.isFetching
    : connectorSource === "account"
      ? accountActionsQuery.isFetching
      : mcpCardQuery.isFetching;

  // Keep selectedTool synced when activeTools load for a selected connector
  useEffect(() => {
    if (!activeConnectorSlug) {
      setSelectedTool("");
      setToolArgs("{}");
      return;
    }
    if (activeTools.length === 0) return;
    const stillValid = activeTools.some((t) => t.name === selectedTool);
    if (!stillValid) {
      const first = activeTools[0];
      setSelectedTool(first.name);
      setToolArgs(JSON.stringify(generateDefaultArgs(first.inputSchema), null, 2));
    }
  }, [activeConnectorSlug, activeTools, selectedTool]);

  const handleSelectTool = useCallback((toolName: string) => {
    setSelectedTool(toolName);
    const tool = activeTools.find((t) => t.name === toolName);
    if (tool) {
      setToolArgs(JSON.stringify(generateDefaultArgs(tool.inputSchema), null, 2));
    }
  }, [activeTools]);

  const handleSourceChange = useCallback((source: ConnectorSource) => {
    setConnectorSource(source);
    setSelectedTool("");
    setToolArgs("{}");
    setConnectorError(null);
  }, []);

  const handleConnectorSelect = useCallback((registryId: string) => {
    const slug = normalizeConnectorSlug(registryId, connectorSource);
    setSelectedTool("");
    setToolArgs("{}");
    setConnectorError(null);
    if (connectorSource === "onchain") {
      setSelectedOnchainConnector(slug);
    } else if (connectorSource === "account") {
      setSelectedAccountToolkit(slug);
    } else {
      setSelectedMcpServer(slug);
    }
  }, [connectorSource]);

  const handleRefresh = useCallback(() => {
    if (connectorSource === "onchain") {
      void queryClient.invalidateQueries({ queryKey: ["connectors", "onchain"] });
    } else if (connectorSource === "account" && selectedAccountToolkit) {
      void queryClient.invalidateQueries({ queryKey: ["connectors", "account", "actions", selectedAccountToolkit] });
      void queryClient.invalidateQueries({ queryKey: ["connectors", "account", "connection"] });
    } else if (connectorSource === "mcp" && selectedMcpServer) {
      void queryClient.invalidateQueries({ queryKey: ["connectors", "mcp", "card", selectedMcpServer] });
    }
    void refetchMeta();
  }, [connectorSource, queryClient, refetchMeta, selectedAccountToolkit, selectedMcpServer]);

  const handleBodyScroll = useCallback(() => {
    const el = bodyScrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = bodyScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [connectorResults.length]);

  const mcpCatalogTotal = registryMeta?.toolsServers ?? snap.meta?.toolsServers ?? 0;
  const accountsCatalogTotal = registryMeta?.accountsServers ?? snap.meta?.accountsServers ?? 0;
  const onchainTotal = onchainListQuery.data?.totalTools ?? snap.meta?.onchainServers ?? 0;

  const sourceOptions = useMemo<Option<ConnectorSource>[]>(() => [
    { value: "mcp", label: "MCPs", icon: Plug, count: mcpCatalogTotal > 0 ? String(mcpCatalogTotal) : undefined },
    { value: "account", label: "Accounts", icon: Link2, count: accountsCatalogTotal > 0 ? String(accountsCatalogTotal) : undefined },
    { value: "onchain", label: "Onchain", icon: Play, count: onchainTotal > 0 ? String(onchainTotal) : undefined },
  ], [accountsCatalogTotal, mcpCatalogTotal, onchainTotal]);

  const selectedMcpCredentials = mcpCardQuery.data?.credentials ?? [];
  const mcpCredentialsRequired = connectorSource === "mcp" && mcpCardQuery.data?.status === "credential_gated";
  const accountNoAuth = Boolean(accountActionsQuery.data?.noAuth || snapshotMeta?.noAuth);
  const accountConnected = Boolean(accountConnectionQuery.data?.connected);
  const accountAuthRequired =
    connectorSource === "account"
    && Boolean(selectedAccountToolkit)
    && !accountNoAuth
    && accountConnectionQuery.isFetched
    && !accountConnected;

  const connectorName = (connectorSource === "mcp" ? mcpCardQuery.data?.name : undefined)
    ?? snapshotMeta?.name
    ?? activeConnectorSlug;
  const connectorDescription = (connectorSource === "mcp" ? mcpCardQuery.data?.description : undefined)
    ?? snapshotMeta?.description
    ?? "";
  const connectorLogo = snapshotMeta?.logo;

  const statusInfo = useMemo<{ label: string; tone: "ready" | "warn" | "neutral" }>(() => {
    if (connectorSource === "onchain") {
      if (onchainListQuery.data?.initialized) {
        return { label: onchainListQuery.data.chain || "Live", tone: "ready" };
      }
      return { label: `${onchainTotal} ready`, tone: onchainTotal > 0 ? "ready" : "neutral" };
    }
    if (connectorSource === "account") {
      if (accountConnected) return { label: "Connected", tone: "ready" };
      if (accountNoAuth) return { label: "Public", tone: "ready" };
      if (accountAuthRequired) return { label: "Auth required", tone: "warn" };
      return { label: accountsCatalogTotal > 0 ? `${accountsCatalogTotal} apps` : "Catalog", tone: "neutral" };
    }
    if (mcpCredentialsRequired) return { label: "Credentials required", tone: "warn" };
    if (mcpCardQuery.data) return { label: "Live", tone: "ready" };
    return { label: mcpCatalogTotal > 0 ? `${mcpCatalogTotal} servers` : "Catalog", tone: "neutral" };
  }, [
    accountAuthRequired,
    accountConnected,
    accountNoAuth,
    accountsCatalogTotal,
    connectorSource,
    mcpCardQuery.data,
    mcpCatalogTotal,
    mcpCredentialsRequired,
    onchainListQuery.data?.chain,
    onchainListQuery.data?.initialized,
    onchainTotal,
  ]);

  // ── Unified Execution Handler ──

  const handleExecute = useCallback(async () => {
    if (!activeConnectorSlug || !selectedTool || executingConnector) return;
    if (!wallet && !selectedUserAddress) {
      setConnectorError("Connect wallet to execute connectors");
      return;
    }
    if (connectorSource === "account" && !selectedUserAddress) {
      setConnectorError("Connect wallet to execute account actions");
      return;
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolArgs);
    } catch (err) {
      setConnectorError(`Invalid JSON: ${err instanceof Error ? err.message : "Parse error"}`);
      return;
    }

    setExecutingConnector(true);
    setConnectorError(null);
    const startedAt = performance.now();

    try {
      let activeKeyToken = keyToken;
      if (!activeKeyToken) {
        activeKeyToken = await ensureKeyToken();
      }
      if (!activeKeyToken) {
        throw new Error("Compose key session is required");
      }

      sdk.keys.use(activeKeyToken);

      if (connectorSource === "onchain") {
        const data = await sdk.connectors.onchain.execute(activeConnectorSlug, selectedTool, { args }) as Record<string, unknown>;
        const rawResult = data.result as Record<string, unknown> | undefined;
        const ok = typeof data.ok === "boolean"
          ? data.ok
          : typeof data.success === "boolean"
            ? data.success
            : !data.error;
        const errorField = ok === false
          ? String(data.message || data.kind || data.error || "Execution failed")
          : (typeof data.error === "string" ? data.error : (typeof data.hint === "string" ? data.hint : undefined));
        setConnectorResults((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            success: ok,
            connectorId: activeConnectorSlug,
            tool: selectedTool,
            result: data.result,
            error: errorField,
            txHash: (typeof rawResult?.txHash === "string" ? rawResult.txHash : undefined)
              || (typeof data.txHash === "string" ? data.txHash : undefined),
            executedBy: onchainListQuery.data?.walletAddress || undefined,
            source: "onchain",
            durationMs: Math.round(performance.now() - startedAt),
          },
        ]);
      } else if (connectorSource === "account") {
        const data = await sdk.connectors.accounts.execute({
          userAddress: selectedUserAddress!,
          toolkit: activeConnectorSlug,
          ...(accountConnectionQuery.data?.connectedAccountId
            ? { connectedAccountId: accountConnectionQuery.data.connectedAccountId }
            : {}),
          action: selectedTool,
          params: args,
        });
        const ok = Boolean(data.success);
        setConnectorResults((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            success: ok,
            connectorId: activeConnectorSlug,
            tool: selectedTool,
            result: data.data ?? data.result,
            error: ok ? undefined : (data.error || "Account action failed"),
            executedBy: selectedUserAddress || undefined,
            source: "account",
            durationMs: Math.round(performance.now() - startedAt),
          },
        ]);
      } else {
        const data = await sdk.connectors.mcps.execute(activeConnectorSlug, selectedTool, { args }) as Record<string, unknown>;
        const ok = typeof data.ok === "boolean"
          ? data.ok
          : typeof data.success === "boolean"
            ? data.success
            : !data.error;
        const errorField = ok === false
          ? String(data.message || data.kind || data.error || "Execution failed")
          : (typeof data.error === "string" ? data.error : (typeof data.hint === "string" ? data.hint : undefined));
        setConnectorResults((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            success: ok,
            connectorId: activeConnectorSlug,
            tool: selectedTool,
            result: data.result,
            error: errorField,
            source: "mcp",
            durationMs: Math.round(performance.now() - startedAt),
          },
        ]);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setConnectorError(errorMsg);
      setConnectorResults((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          success: false,
          connectorId: activeConnectorSlug,
          tool: selectedTool,
          error: errorMsg,
          source: connectorSource,
          durationMs: Math.round(performance.now() - startedAt),
        },
      ]);
    } finally {
      setExecutingConnector(false);
    }
  }, [
    accountConnectionQuery.data?.connectedAccountId,
    activeConnectorSlug,
    connectorSource,
    ensureKeyToken,
    executingConnector,
    keyToken,
    onchainListQuery.data?.walletAddress,
    selectedTool,
    selectedUserAddress,
    toolArgs,
    wallet,
  ]);

  const handleResetArgs = useCallback(() => {
    setToolArgs(JSON.stringify(generateDefaultArgs(toolSchema), null, 2));
  }, [toolSchema]);

  const handleClearResults = useCallback(() => {
    setConnectorResults([]);
    setConnectorError(null);
  }, []);

  return (
    <div
      className={cn("cm-split", paneCollapsed && "cm-split--collapsed")}
      data-pocket={pocket === "runner" ? "main" : "side"}
      data-collapsed={paneCollapsed ? "true" : undefined}
    >
      {/* ── Main Zone: Runner Toolbar + Execution Stream + Composer ── */}
      <div className="cm-split__main cm-playground__chat-cell">
        <div className="cm-playground__chat-toolbar cm-connector-toolbar">
          <Switcher
            value={connectorSource}
            onChange={handleSourceChange}
            label="Connector source"
            options={sourceOptions}
          />

          <ConnectorSelector
            value={activeConnectorSlug}
            onChange={(server) => handleConnectorSelect(server.registryId)}
            placeholder={connectorSource === "onchain" ? "Connector" : connectorSource === "account" ? "Account" : "MCP"}
            origin={connectorSource}
            shortcut="⌘K"
            open={commandBarOpen}
            onOpenChange={onCommandBarOpenChange}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ModelBadgeTrigger
                placeholder={!selectedTool}
                label={selectedTool || (connectorSource === "account" ? "Action" : "Tool")}
                disabled={activeTools.length === 0}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="cm-control-menu max-h-96 overflow-y-auto">
              {activeTools.length === 0 ? (
                <div className="p-2 text-muted-foreground text-xs font-mono">
                  {isLoadingTools ? "Loading tools..." : "No tools available"}
                </div>
              ) : (
                activeTools.map((tool) => (
                  <DropdownMenuItem
                    key={tool.name}
                    onSelect={() => handleSelectTool(tool.name)}
                    className="cm-control-menu__item"
                  >
                    <div className="flex flex-col py-0.5">
                      <span className="font-mono text-xs">{tool.name}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-48 sm:max-w-64">
                        {tool.description || "No description"}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isLoadingTools}
              className="cm-shell-button cm-shell-button--ghost cm-shell-button--icon"
              aria-label="Refresh connectors"
              title="Refresh connectors"
            >
              <RefreshCw className={cn("h-4 w-4", isLoadingTools && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Status strip mirroring Models input-modality row */}
        <div className="cm-playground__caps-row">
          <span className="cm-playground__caps-label">Status</span>
          <span className="cm-playground__cap-tag">
            <span className="cm-connector-card__status-dot" data-state={statusInfo.tone} />
            {statusInfo.label}
          </span>
          {activeConnectorSlug ? (
            <span className="cm-playground__cap-tag">
              {activeTools.length} {connectorSource === "account" ? "actions" : "tools"}
            </span>
          ) : null}
          {selectedTool ? (
            <span className="cm-playground__cap-tag">{selectedTool}</span>
          ) : null}
        </div>

        {/* Native scrolling execution stream (no Radix ScrollArea) */}
        <div
          ref={bodyScrollRef}
          onScroll={handleBodyScroll}
          className="cm-connector-runner__body"
        >
          <div className="cm-connector-runner__stack">
            {connectorResults.length === 0 ? (
              <div className="cm-connector-runner__empty">
                <div className="cm-chat-hero">
                  <div className="cm-chat-hero__emblem">
                    {connectorLogo ? (
                      <img src={connectorLogo} alt={connectorName} className="cm-family-icon" />
                    ) : connectorSource === "account" ? (
                      <Link2 className="cm-chat-hero__icon" />
                    ) : connectorSource === "onchain" ? (
                      <Play className="cm-chat-hero__icon" />
                    ) : (
                      <Plug className="cm-chat-hero__icon" />
                    )}
                  </div>
                </div>
                <h3 className="cm-connector-runner__empty-title">
                  {activeToolMeta?.name || connectorName || "Select a connector"}
                </h3>
                <p className="cm-connector-runner__empty-sub">
                  {activeToolMeta?.description
                    || connectorDescription
                    || "Pick a source, connector (⌘K), and tool from the toolbar. Inspect schema or edit parameters in the right panel, then execute."}
                </p>
              </div>
            ) : (
              connectorResults.map((result) => {
                const payload = formatResultPayload(result);
                return (
                  <article
                    key={result.id}
                    className="cm-connector-result"
                    data-status={result.success ? "success" : "error"}
                  >
                    <header className="cm-connector-result__header">
                      <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="cm-connector-card__origin-badge" data-origin={result.source}>
                        {result.source === "mcp" ? "MCP" : result.source === "account" ? "Account" : "Onchain"}
                      </span>
                      <span className="cm-connector-result__target">
                        {result.connectorId}/{result.tool}
                      </span>
                      <span
                        className="cm-connector-result__status"
                        data-status={result.success ? "success" : "error"}
                      >
                        {result.success ? "Success" : "Failed"}
                      </span>
                      {result.durationMs !== undefined ? (
                        <span className="cm-connector-result__meta">{result.durationMs}ms</span>
                      ) : null}
                      {(() => {
                        const explorerHref = safeHref(result.explorer);
                        return explorerHref ? (
                          <a
                            href={explorerHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cm-connector-result__link"
                          >
                            View TX <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null;
                      })()}
                      {result.executedBy ? (
                        <span className="cm-connector-result__meta ml-auto">
                          {result.executedBy.slice(0, 6)}…{result.executedBy.slice(-4)}
                        </span>
                      ) : null}
                    </header>

                    <HighlightedCode
                      code={payload.code}
                      language={payload.language}
                      compact
                    />
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="cm-chat__composer">
          <div className="cm-connector-composer">
            {mcpCredentialsRequired && (
              <ShellNotice tone="warning">
                <div className="cm-connector-notice-row">
                  <div className="text-xs">
                    <strong>Credentials required</strong> — configure{" "}
                    {selectedMcpCredentials.length > 0
                      ? selectedMcpCredentials.map((c) => c.varName).join(", ")
                      : "server credentials"}{" "}
                    in Backpack before running tools.
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm gap-1.5 shrink-0"
                    onClick={() => openGlobalBackpack({ tab: "connectors" })}
                  >
                    <Backpack className="h-3.5 w-3.5" />
                    Open Backpack
                  </Button>
                </div>
              </ShellNotice>
            )}

            {accountAuthRequired && (
              <ShellNotice tone="info">
                <div className="cm-connector-notice-row">
                  <div className="text-xs">
                    <strong>Account connection required</strong> — connect {connectorName} in Backpack before running actions.
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm gap-1.5 shrink-0"
                    onClick={() => openGlobalBackpack({ tab: "accounts" })}
                  >
                    <Backpack className="h-3.5 w-3.5" />
                    Open Backpack
                  </Button>
                </div>
              </ShellNotice>
            )}

            <div className="cm-connector-composer__row">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleClearResults}
                disabled={connectorResults.length === 0 && !connectorError}
                className="cm-shell-button cm-shell-button--ghost cm-shell-button--icon shrink-0"
                aria-label="Clear results"
                title="Clear results"
              >
                <Trash2 className="h-4 w-4" />
              </Button>

              <div className="cm-connector-composer__editor">
                <Textarea
                  rows={4}
                  value={toolArgs}
                  onChange={(e) => setToolArgs(e.target.value)}
                  placeholder='{"key": "value"}'
                  className="cm-form-textarea min-h-[5.5rem] resize-none pr-20 font-mono text-xs"
                />
                <div className="cm-connector-composer__editor-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleResetArgs}
                    disabled={!toolSchema}
                    className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm"
                    title="Reset parameters to defaults"
                  >
                    Reset
                  </Button>
                </div>
              </div>

              <Button
                type="button"
                onClick={() => void handleExecute()}
                disabled={executingConnector || !selectedTool || !activeConnectorSlug}
                className="cm-shell-button cm-shell-button--primary px-5 shrink-0 h-auto"
              >
                {executingConnector ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Execute
                  </>
                )}
              </Button>
            </div>

            {connectorError ? <ShellNotice tone="error">{connectorError}</ShellNotice> : null}
          </div>
        </div>
      </div>

      {/* ── Side Zone: Persistent ConnectorCard Inspector ── */}
      <div className="cm-split__side cm-playground__pane-cell">
        <ConnectorCard
          source={connectorSource}
          connectorId={activeConnectorSlug}
          connectorName={connectorName}
          connectorDescription={connectorDescription}
          connectorLogo={connectorLogo}
          tools={activeTools}
          selectedTool={selectedTool}
          onSelectTool={handleSelectTool}
          toolSchema={toolSchema}
          argsJson={toolArgs}
          onArgsJsonChange={setToolArgs}
          credentials={selectedMcpCredentials}
          credentialsRequired={mcpCredentialsRequired}
          accountAuthRequired={accountAuthRequired}
          statusLabel={statusInfo.label}
          statusTone={statusInfo.tone}
          tab={inspectorTab}
          onTabChange={(next) => {
            onInspectorTabChange?.(next);
            if (pocket !== "runner") {
              onPocketChange?.(next === "params" ? "params" : "overview");
            }
          }}
        />
      </div>
    </div>
  );
}
