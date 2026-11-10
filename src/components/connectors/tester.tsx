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
import { ShellNotice } from "@compose-market/theme/shell";
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

interface Onchain {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    connectorId: string;
}

interface ConnectorInfo {
    id: string;
    name: string;
    description: string;
    toolCount: number;
    requiresApiKey?: boolean;
    apiKeyConfigured?: boolean;
    tools: Onchain[];
}

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

interface OnchainStatus {
    initialized: boolean;
    walletAddress: string | null;
    chain: string | null;
    chainId: number | null;
    rpcUrl: string | null;
    error: string | null;
    totalTools: number;
    connectors: ConnectorInfo[];
}

interface OnchainResponse {
    connectors: ConnectorInfo[];
    status: {
        initialized: boolean;
        walletAddress: string | null;
        chain: string;
        chainId: number;
        rpcUrl: string | null;
        error: string | null;
        totalTools: number;
    };
}

interface McpTool {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}

interface McpServerCard {
    slug: string;
    name: string;
    description: string;
    status: "live" | "credential_gated";
    tools: McpTool[];
    credentials: Array<{ varName: string; description?: string | null; obtainUrl?: string | null }>;
}

// =============================================================================
// Types
// =============================================================================

export type ConnectorSource = "mcp" | "account" | "onchain";
export type ConnectorPocket = "runner" | "overview" | "params";

const CONNECTORS_URL = (import.meta.env.VITE_CONNECTORS_URL || "https://connectors.compose.market").replace(/\/+$/, "");

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

function formatSchemaHint(schema: Record<string, unknown>): string {
    const props = (schema as { properties?: Record<string, { type?: string; description?: string }> }).properties;
    const required = (schema as { required?: string[] }).required || [];
    if (!props) return "No parameters required";

    const lines: string[] = [];
    for (const [key, prop] of Object.entries(props)) {
        const isRequired = required.includes(key);
        const desc = prop.description || "";
        lines.push(`• ${key}${isRequired ? " *" : ""} (${prop.type || "any"}): ${desc}`);
    }
    return lines.join("\n");
}

function ToolSchemaDisplay({ schema }: { schema: Record<string, unknown> }) {
    const props = (schema as { properties?: Record<string, { type?: string; description?: string; default?: unknown }> }).properties;
    const required = (schema as { required?: string[] }).required || [];

    if (!props || Object.keys(props).length === 0) {
        return <p className="text-sm text-muted-foreground font-mono">No parameters required</p>;
    }

    return (
        <div className="space-y-3 mt-6">
            <h4 className="text-xs uppercase font-mono text-muted-foreground/80 tracking-wider">Parameters</h4>
            <div className="border border-primary/15 rounded-lg overflow-hidden bg-background/20 divide-y divide-primary/10">
                {Object.entries(props).map(([key, prop]) => {
                    const isRequired = required.includes(key);
                    return (
                        <div key={key} className="p-3 font-mono text-xs flex flex-col sm:flex-row gap-2 sm:gap-4 items-start">
                            <div className="w-full sm:w-1/3 shrink-0">
                                <span className={cn("font-bold", isRequired ? "text-cyan-400" : "text-foreground")}>
                                    {key}
                                </span>
                                {isRequired && <span className="text-cyan-500 ml-1 font-bold">*</span>}
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                    type: <span className="text-fuchsia-400">{prop.type || "any"}</span>
                                </div>
                                {prop.default !== undefined && (
                                    <div className="text-[10px] text-muted-foreground">
                                        default: <span className="text-green-400">{String(prop.default)}</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 text-muted-foreground text-xs leading-relaxed sm:pt-0.5">
                                {prop.description || "No description provided."}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// =============================================================================
// Props
// =============================================================================

export interface ConnectorTesterProps {
    /** Initial source from URL params */
    initialSource?: ConnectorSource;
    /** Initial connector/server from URL params */
    initialConnector?: string;
}

// =============================================================================
// Component
// =============================================================================

// sourceOptions is defined dynamically inside ConnectorTester to support counts

export function ConnectorTester({
    initialSource = "mcp",
    initialConnector = "",
}: ConnectorTesterProps) {
    const wallet = useActiveWallet();
    const { paymentNetwork } = useChain();
    const paymentChainId = isEvmNetwork(paymentNetwork) ? evmChainId(paymentNetwork) : 0;
    const { keyToken, ensureKeyToken } = useSession();
    const resultsEndRef = useRef<HTMLDivElement>(null);

    // Common state
    const [connectorSource, setConnectorSource] = useState<ConnectorSource>(initialSource);
    const [connectorsLoading, setConnectorsLoading] = useState(false);
    const [selectedTool, setSelectedTool] = useState<string>("");
    const [toolArgs, setToolArgs] = useState<string>("{}");
    const [toolSchema, setToolSchema] = useState<Record<string, unknown> | null>(null);
    const [connectorResults, setConnectorResults] = useState<ConnectorResult[]>([]);
    const [executingConnector, setExecutingConnector] = useState(false);
    const [connectorError, setConnectorError] = useState<string | null>(null);

    // Onchain state
    const [onchainStatus, setOnchainStatus] = useState<OnchainStatus | null>(null);
    const [goatConnectorTools, setGoatConnectorTools] = useState<Onchain[]>([]);
    const [selectedGoatConnector, setSelectedGoatConnector] = useState<string>(
        initialSource === "onchain" ? normalizeConnectorSlug(initialConnector, "onchain") : ""
    );

    // Tools state
    const { data: registryMeta, refetch: refetchMeta } = useRegistryMeta();
    const mcpCatalogTotal = registryMeta?.toolsServers ?? 0;
    const [selectedMcpCard, setSelectedMcpCard] = useState<McpServerCard | null>(null);
    const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
    const [selectedMcpServer, setSelectedMcpServer] = useState<string>(
        initialSource === "mcp" && initialConnector ? normalizeConnectorSlug(initialConnector, "mcp") : ""
    );

    const sourceOptions = useMemo<Option<ConnectorSource>[]>(() => [
        { value: "mcp", label: "MCPs", icon: Plug, count: mcpCatalogTotal > 0 ? String(mcpCatalogTotal) : undefined },
        { value: "onchain", label: "Onchain", icon: Play, count: onchainStatus?.totalTools ? String(onchainStatus.totalTools) : undefined },
    ], [mcpCatalogTotal, onchainStatus?.totalTools]);

    // ==========================================================================
    // Onchain Handlers
    // ==========================================================================

    const fetchConnectorStatus = async () => {
        setConnectorsLoading(true);
        try {
            const response = await fetch(`${CONNECTORS_URL}/onchain`);
            if (!response.ok) throw new Error(`Failed to fetch status: ${response.status}`);
            const data = await response.json() as OnchainResponse;
            const status: OnchainStatus = {
                initialized: data.status.initialized,
                walletAddress: data.status.walletAddress,
                chain: data.status.chain,
                chainId: data.status.chainId,
                rpcUrl: data.status.rpcUrl,
                error: data.status.error,
                totalTools: data.status.totalTools,
                connectors: data.connectors,
            };
            setOnchainStatus(status);
            if (!selectedGoatConnector && data.connectors?.length > 0) {
                setSelectedGoatConnector(data.connectors[0].id);
            }
        } catch (err) {
            console.error("Failed to fetch connector status:", err);
            setConnectorError(err instanceof Error ? err.message : "Failed to connect to connector server");
        } finally {
            setConnectorsLoading(false);
        }
    };

    const fetchConnectorTools = async (connectorId: string) => {
        try {
            const slug = normalizeConnectorSlug(connectorId, "onchain");
            const response = await fetch(`${CONNECTORS_URL}/onchain/${encodeURIComponent(slug)}`);
            if (!response.ok) throw new Error(`Failed to fetch tools: ${response.status}`);
            const data = await response.json() as ConnectorInfo;
            const tools = data.tools || [];
            setGoatConnectorTools(tools);
            if (tools.length > 0) {
                setSelectedTool(tools[0].name);
                setToolSchema(tools[0].parameters);
                const defaultArgs = generateDefaultArgs(tools[0].parameters);
                setToolArgs(JSON.stringify(defaultArgs, null, 2));
            }
        } catch (err) {
            console.error("Failed to fetch connector tools:", err);
            setGoatConnectorTools([]);
        }
    };

    const currentTool = goatConnectorTools.find(t => t.name === selectedTool);

    const handleToolSelect = useCallback((toolName: string) => {
        setSelectedTool(toolName);
        const tool = goatConnectorTools.find(t => t.name === toolName);
        if (tool) {
            setToolSchema(tool.parameters);
            const defaultArgs = generateDefaultArgs(tool.parameters);
            setToolArgs(JSON.stringify(defaultArgs, null, 2));
        }
    }, [goatConnectorTools]);

    const handleConnectorChange = useCallback((connectorId: string) => {
        setSelectedGoatConnector(normalizeConnectorSlug(connectorId, "onchain"));
        setSelectedTool("");
        setToolSchema(null);
        setToolArgs("{}");
    }, []);

    const handleExecuteConnector = useCallback(async () => {
        if (!selectedGoatConnector || !selectedTool || executingConnector) return;
        if (!wallet) {
            setConnectorError("Connect wallet to execute connectors");
            return;
        }

        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(toolArgs);
        } catch (e) {
            setConnectorError(`Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`);
            return;
        }

        setExecutingConnector(true);
        setConnectorError(null);

        try {
            let activeKeyToken = keyToken;
            if (!activeKeyToken) {
                activeKeyToken = await ensureKeyToken();
            }
            if (!activeKeyToken) {
                throw new Error("Compose key session is required");
            }

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            const response = await sdk.fetch(
                `/api/onchain/${encodeURIComponent(normalizeConnectorSlug(selectedGoatConnector, "onchain"))}/execute/${encodeURIComponent(selectedTool)}`,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ args }),
                },
            );

            const data = await response.json();
            const result: ConnectorResult = {
                success: data.ok ?? data.success ?? response.ok,
                connectorId: selectedGoatConnector,
                tool: selectedTool,
                result: data.result,
                error: data.ok === false ? (data.message || data.kind) : (data.error || data.hint),
                txHash: data.result?.txHash || data.txHash,
                executedBy: onchainStatus?.walletAddress || undefined,
                source: "onchain",
            };

            setConnectorResults(prev => [...prev, result]);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            setConnectorError(errorMsg);
            setConnectorResults(prev => [
                ...prev,
                { success: false, connectorId: selectedGoatConnector, tool: selectedTool, error: errorMsg, source: "onchain" },
            ]);
        } finally {
            setExecutingConnector(false);
        }
    }, [selectedGoatConnector, selectedTool, toolArgs, executingConnector, wallet, keyToken, ensureKeyToken, onchainStatus, paymentChainId]);

    // ==========================================================================
    // Tools Handlers
    // ==========================================================================

    const fetchMcpTools = async (slug: string) => {
        setConnectorsLoading(true);
        try {
            const response = await fetch(`${CONNECTORS_URL}/mcps/${encodeURIComponent(slug)}`);
            if (!response.ok) throw new Error(`Failed to fetch tools: ${response.status}`);
            const data = await response.json() as McpServerCard;
            setSelectedMcpCard(data);
            setConnectorError(null);
            setMcpTools(data.tools || []);
            if (data.tools?.length > 0) {
                setSelectedTool(data.tools[0].name);
                setToolSchema(data.tools[0].inputSchema);
                const defaultArgs = generateDefaultArgs(data.tools[0].inputSchema);
                setToolArgs(JSON.stringify(defaultArgs, null, 2));
            } else {
                setSelectedTool("");
                setToolSchema(null);
                setToolArgs("{}");
            }
        } catch (err) {
            console.error("Failed to fetch tools:", err);
            setSelectedMcpCard(null);
            setMcpTools([]);
            setConnectorError(err instanceof Error ? err.message : "Failed to fetch tools");
        } finally {
            setConnectorsLoading(false);
        }
    };

    const handleMcpServerChange = useCallback((registryId: string) => {
        setSelectedMcpServer(normalizeConnectorSlug(registryId, "mcp"));
        setSelectedTool("");
        setToolSchema(null);
        setToolArgs("{}");
        setSelectedMcpCard(null);
        setMcpTools([]);
    }, []);

    const handleMcpToolSelect = useCallback((toolName: string) => {
        setSelectedTool(toolName);
        const tool = mcpTools.find(t => t.name === toolName);
        if (tool) {
            setToolSchema(tool.inputSchema);
            const defaultArgs = generateDefaultArgs(tool.inputSchema);
            setToolArgs(JSON.stringify(defaultArgs, null, 2));
        }
    }, [mcpTools]);

    const currentMcpTool = mcpTools.find(t => t.name === selectedTool);
    const selectedMcpCredentials = selectedMcpCard?.credentials ?? [];
    const mcpCredentialsRequired = connectorSource === "mcp" && selectedMcpCard?.status === "credential_gated";

    const handleExecuteMcpTool = useCallback(async () => {
        if (!selectedMcpServer || !selectedTool || executingConnector) return;
        if (!wallet) {
            setConnectorError("Connect wallet to execute tools");
            return;
        }

        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(toolArgs);
        } catch (e) {
            setConnectorError(`Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`);
            return;
        }

        setExecutingConnector(true);
        setConnectorError(null);

        try {
            let activeKeyToken = keyToken;
            if (!activeKeyToken) {
                activeKeyToken = await ensureKeyToken();
            }
            if (!activeKeyToken) {
                throw new Error("Compose key session is required");
            }

            const slug = normalizeConnectorSlug(selectedMcpServer, "mcp");
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            const response = await sdk.fetch(
                `/api/mcps/${encodeURIComponent(slug)}/execute/${encodeURIComponent(selectedTool)}`,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ args }),
                },
            );

            const data = await response.json();
            const result: ConnectorResult = {
                success: data.ok ?? response.ok,
                connectorId: selectedMcpServer,
                tool: selectedTool,
                result: data.result,
                error: data.ok === false ? (data.message || data.kind) : (data.error || data.hint),
                source: "mcp",
            };

            setConnectorResults(prev => [...prev, result]);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            setConnectorError(errorMsg);
            setConnectorResults(prev => [
                ...prev,
                { success: false, connectorId: selectedMcpServer, tool: selectedTool, error: errorMsg, source: "mcp" },
            ]);
        } finally {
            setExecutingConnector(false);
        }
    }, [selectedMcpServer, selectedTool, toolArgs, executingConnector, wallet, keyToken, ensureKeyToken, paymentChainId]);

    // ==========================================================================
    // Source Change Handler
    // ==========================================================================

    const handleSourceChange = useCallback((source: ConnectorSource) => {
        setConnectorSource(source);
        setSelectedTool("");
        setToolSchema(null);
        setToolArgs("{}");
        setConnectorError(null);
        if (source !== "onchain") setSelectedTool("");
        if (source !== "mcp") {
            setSelectedMcpServer("");
            setSelectedMcpCard(null);
            setMcpTools([]);
        }
    }, []);

    const handleClearResults = useCallback(() => {
        setConnectorResults([]);
        setConnectorError(null);
    }, []);

    // ==========================================================================
    // Effects
    // ==========================================================================

    useEffect(() => {
        if (connectorSource === "onchain" && !onchainStatus) {
            fetchConnectorStatus();
        }
    }, [connectorSource, onchainStatus]);

    useEffect(() => {
        if (selectedMcpServer && connectorSource === "mcp") {
            const slug = normalizeConnectorSlug(selectedMcpServer, "mcp");
            if (slug) fetchMcpTools(slug);
        }
    }, [selectedMcpServer, connectorSource]);

    useEffect(() => {
        if (selectedGoatConnector && connectorSource === "onchain") {
            fetchConnectorTools(selectedGoatConnector);
        }
    }, [selectedGoatConnector, connectorSource]);

    useEffect(() => {
        resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [connectorResults]);

    // ==========================================================================
    // Render
    // ==========================================================================

    return (
        <div className="cm-chat cm-connector-tester h-full">
            {/* Header: Source and Connector/Server selectors in BEM control rail layout */}
            <div className="cm-control-rail">
                <div className="cm-control-rail__main">
                    <Tabs value={connectorSource} onValueChange={(v) => handleSourceChange(v as ConnectorSource)}>
                        <Switcher
                            value={connectorSource}
                            onChange={(v) => handleSourceChange(v as ConnectorSource)}
                            label="Connector source"
                            options={sourceOptions}
                        />
                    </Tabs>

                    <ConnectorSelector
                        value={connectorSource === "onchain" ? selectedGoatConnector : selectedMcpServer}
                        onChange={(server) => {
                            if (connectorSource === "onchain") {
                                handleConnectorChange(server.registryId);
                            } else {
                                handleMcpServerChange(server.registryId);
                            }
                        }}
                        placeholder={connectorSource === "onchain" ? "Connector" : "MCP"}
                        origin={connectorSource}
                    />

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <ShellModelBadge
                                placeholder={!selectedTool}
                                label={selectedTool || "Tool"}
                                disabled={(connectorSource === "onchain" ? goatConnectorTools : mcpTools).length === 0}
                            />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="cm-control-menu max-h-96 overflow-y-auto">
                            {(connectorSource === "onchain" ? goatConnectorTools : mcpTools).length === 0 ? (
                                <div className="p-2 text-muted-foreground text-sm font-mono">No tools available</div>
                            ) : (
                                (connectorSource === "onchain" ? goatConnectorTools : mcpTools).map((tool) => (
                                    <DropdownMenuItem
                                        key={tool.name}
                                        onSelect={() => {
                                            if (connectorSource === "onchain") {
                                                handleToolSelect(tool.name);
                                            } else {
                                                handleMcpToolSelect(tool.name);
                                            }
                                        }}
                                        className="cm-control-menu__item"
                                    >
                                        <div className="flex flex-col py-0.5">
                                            <span className="font-mono text-xs">{tool.name}</span>
                                            <span className="text-[10px] text-muted-foreground truncate max-w-48 sm:max-w-64">
                                                {tool.description || "No description"}
                                            </span>
                                        </div>
                                    </DropdownMenuItem>
                                ))
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="cm-control-rail__actions">
                    {connectorSource === "onchain" && onchainStatus && (
                        <div className="flex items-center gap-2 text-xs">
                            <div className={cn("w-2 h-2 rounded-full", onchainStatus.initialized ? "bg-emerald-500" : "bg-red-500")} />
                            <span className="text-muted-foreground">
                                {onchainStatus.initialized ? onchainStatus.chain : "Offline"}
                            </span>
                        </div>
                    )}
                    {connectorSource === "mcp" && (
                        <div className="flex items-center gap-2 text-[10px] sm:text-xs shrink-0">
                            <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", mcpCatalogTotal > 0 ? "bg-fuchsia-400" : "bg-muted-foreground")} />
                            <span className="text-muted-foreground">
                                {mcpCatalogTotal > 0 ? "Online" : "Offline"}
                            </span>
                        </div>
                    )}

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={connectorSource === "onchain" ? fetchConnectorStatus : () => refetchMeta()}
                        disabled={connectorsLoading}
                        className="cm-chat__icon-action shrink-0 h-8 w-8 sm:h-9 sm:w-9"
                        title="Refresh"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", connectorsLoading && "animate-spin")} />
                    </Button>
                </div>
            </div>

            {/* Results Area */}
            <ScrollArea className="cm-chat__body">
                <div className="space-y-4 max-w-4xl mx-auto">
                    {connectorResults.length === 0 ? (
                        (connectorSource === "onchain" ? currentTool : currentMcpTool) ? (
                            <div className="max-w-4xl mx-auto p-4 sm:p-6 cm-shell-panel bg-background/25 border-primary/10">
                                <div className="flex items-center gap-3 border-b border-primary/15 pb-4 mb-4">
                                    <Terminal className={cn(
                                        "h-6 w-6",
                                        connectorSource === "onchain" ? "text-green-400" : "text-fuchsia-300"
                                    )} />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className={cn(
                                                "font-display font-bold text-lg",
                                                connectorSource === "onchain" ? "text-green-400" : "text-fuchsia-300"
                                            )}>
                                                {connectorSource === "onchain" ? currentTool?.name : currentMcpTool?.name}
                                            </h3>
                                            <Badge
                                                className={cn(
                                                    "text-[10px] px-2 py-0.5",
                                                    connectorSource === "onchain"
                                                        ? "bg-green-500/20 text-green-400 border-green-500/40"
                                                        : "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40"
                                                )}
                                            >
                                                {connectorSource === "onchain" ? "Onchain" : "Tools"}
                                            </Badge>
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-1">
                                            Connector: {connectorSource === "onchain" ? selectedGoatConnector : selectedMcpServer}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <h4 className="text-xs uppercase font-mono text-muted-foreground/80 tracking-wider mb-1">Description</h4>
                                        <p className="text-sm text-foreground leading-relaxed">
                                            {connectorSource === "onchain"
                                                ? currentTool?.description
                                                : (currentMcpTool?.description || "No description available.")}
                                        </p>
                                    </div>

                                    {toolSchema && <ToolSchemaDisplay schema={toolSchema} />}
                                </div>
                            </div>
                        ) : (
                            <div className="cm-chat__empty py-12 text-center max-w-xl mx-auto space-y-4">
                                <Plug className="h-16 w-16 mx-auto mb-4 opacity-40 text-cyan-400" />
                                <h3 className="text-xl font-display font-bold text-foreground">Select a Tool to Test</h3>
                                <p className="text-sm text-muted-foreground font-mono max-w-sm mx-auto">
                                    Choose a connector source, selector server, and tool from the top toolbar to inspect parameters and run execution requests.
                                </p>
                            </div>
                        )
                    ) : (
                        connectorResults.map((result, index) => (
                            <div
                                key={index}
                                className={cn(
                                    "cm-shell-panel p-4",
                                    result.success
                                        ? "bg-emerald-950/30 border-emerald-800"
                                        : "bg-red-950/30 border-red-800"
                                )}
                            >
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <Terminal className="h-4 w-4 text-muted-foreground" />
                                    <Badge
                                        className={cn(
                                            "text-[10px] px-1.5",
                                            result.source === "mcp"
                                                ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40"
                                                : "bg-green-500/20 text-green-400 border-green-500/40"
                                        )}
                                    >
                                        {result.source === "mcp" ? "MCPs" : "Onchain"}
                                    </Badge>
                                    <span className="font-mono text-sm text-foreground">
                                        {result.connectorId}/{result.tool}
                                    </span>
                                    <Badge variant={result.success ? "default" : "destructive"} className="text-xs">
                                        {result.success ? "Success" : "Failed"}
                                    </Badge>
                                    {result.explorer && (
                                        <a
                                            href={result.explorer}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
                                        >
                                            View TX <ExternalLink className="h-3 w-3" />
                                        </a>
                                    )}
                                    {result.executedBy && (
                                        <span className="text-[10px] text-muted-foreground">
                                            by {result.executedBy.slice(0, 6)}...{result.executedBy.slice(-4)}
                                        </span>
                                    )}
                                </div>
                                <pre className="text-xs text-muted-foreground overflow-auto max-h-48 font-mono rounded-lg border border-primary/10 bg-background/40 p-2">
                                    {result.error || JSON.stringify(result.result, null, 2)}
                                </pre>
                            </div>
                        ))
                    )}
                    <div ref={resultsEndRef} />
                </div>
            </ScrollArea>

            {/* Input with schema hints */}
            <div className="cm-chat__composer">
                <div className="max-w-4xl mx-auto space-y-3">
                    {mcpCredentialsRequired && (
                        <div className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-3">
                            <p className="text-amber-300 text-sm flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                Credentials needed
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                This server requires credentials before its tools can run.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {selectedMcpCredentials.length > 0 ? (
                                    selectedMcpCredentials.map((credential) => (
                                        <Badge key={credential.varName} variant="outline" className="border-amber-500/50 text-amber-300">
                                            {credential.varName}
                                        </Badge>
                                    ))
                                ) : (
                                    <span className="text-xs text-muted-foreground">No specific env vars are recorded in the catalog.</span>
                                )}
                            </div>
                        </div>
                    )}


                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleClearResults}
                            className="cm-chat__icon-action shrink-0"
                            title="Clear results"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        <div className="flex-1 relative">
                            <Textarea
                                value={toolArgs}
                                onChange={(e) => setToolArgs(e.target.value)}
                                placeholder='{"key": "value"}'
                                className="cm-form-textarea min-h-20 pr-20 font-mono text-sm"
                            />
                            <div className="absolute right-2 top-2 flex gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        if (connectorSource === "onchain" && currentTool) {
                                            const defaultArgs = generateDefaultArgs(currentTool.parameters);
                                            setToolArgs(JSON.stringify(defaultArgs, null, 2));
                                        } else if (connectorSource === "mcp" && currentMcpTool) {
                                            const defaultArgs = generateDefaultArgs(currentMcpTool.inputSchema);
                                            setToolArgs(JSON.stringify(defaultArgs, null, 2));
                                        }
                                    }}
                                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                                    title="Reset to defaults"
                                >
                                    Reset
                                </Button>
                            </div>
                        </div>
                        <Button
                            onClick={connectorSource === "onchain" ? handleExecuteConnector : handleExecuteMcpTool}
                            disabled={
                                executingConnector ||
                                !selectedTool ||
                                (connectorSource === "onchain" ? !selectedGoatConnector : !selectedMcpServer)
                            }
                            className={cn(
                                "h-auto px-6",
                                connectorSource === "onchain"
                                    ? "bg-green-600 hover:bg-green-700"
                                    : "bg-fuchsia-600 hover:bg-fuchsia-700"
                            )}
                        >
                            {executingConnector ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Play className="h-4 w-4 mr-2" />
                                    Execute
                                </>
                            )}
                        </Button>
                    </div>
                    {connectorError && (
                        <div className="p-3 rounded-lg bg-red-950/30 border border-red-800">
                            <p className="text-red-400 text-sm flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                {connectorError}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
