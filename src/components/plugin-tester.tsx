/**
 * Plugin Tester Component
 * 
 * Unified testing interface for GOAT, MCP, and Eliza plugins.
 * Extracts all plugin testing functionality from the playground page.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useActiveWallet } from "thirdweb/react";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { thirdwebClient, inferencePriceWei } from "@/lib/thirdweb";
import { createNormalizedFetch } from "@/lib/payment";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useRegistryServers } from "@/hooks/use-registry";
import {
    Loader2,
    RefreshCw,
    Trash2,
    Plug,
    Play,
    Terminal,
    AlertCircle,
    ExternalLink,
    ChevronsUpDown,
    Check,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface GoatTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    example?: Record<string, unknown>;
}

interface PluginInfo {
    id: string;
    name: string;
    description: string;
    toolCount: number;
    requiresApiKey?: boolean;
    apiKeyConfigured?: boolean;
}

interface PluginResult {
    success: boolean;
    pluginId: string;
    tool: string;
    result?: unknown;
    error?: string;
    txHash?: string;
    explorer?: string;
    executedBy?: string;
    source?: "goat" | "mcp" | "eliza";
    executionTime?: number;
}

interface ElizaPlugin {
    id: string;
    package: string;
    source?: string;
    description?: string;
    version?: string;
    supports?: {
        v0: boolean;
        v1: boolean;
    };
}

interface ElizaActionParameter {
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    description: string;
    required: boolean;
    default?: unknown;
    enum?: string[];
    example?: unknown;
}

interface ElizaAction {
    name: string;
    description: string;
    similes: string[];
    parameters: ElizaActionParameter[];
    examples: Array<{ input: string; output?: string }>;
}

interface ElizaPluginsResponse {
    count: number;
    plugins: ElizaPlugin[];
}

interface ElizaActionsResponse {
    pluginId: string;
    package: string;
    description?: string;
    actionCount: number;
    actions: ElizaAction[];
}

interface GoatStatus {
    initialized: boolean;
    walletAddress: string | null;
    chain: string | null;
    totalTools: number;
    plugins: PluginInfo[];
}

interface McpTool {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}

interface McpToolsResponse {
    server: string;
    toolCount: number;
    tools: McpTool[];
}

type PluginSource = "goat" | "mcp" | "eliza";

const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");
const CONNECTOR_URL = (import.meta.env.VITE_CONNECTOR_URL || "https://services.compose.market/connector").replace(/\/+$/, "");

// =============================================================================
// Helpers
// =============================================================================

function generateDefaultArgs(schema: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const props = (schema as { properties?: Record<string, { type?: string; default?: unknown; description?: string }> }).properties;
    if (!props) return result;

    for (const [key, prop] of Object.entries(props)) {
        if (prop.default !== undefined) {
            result[key] = prop.default;
        } else if (prop.type === "string") {
            if (key.toLowerCase().includes("address")) {
                result[key] = "0x...";
            } else if (key.toLowerCase().includes("amount")) {
                result[key] = "0";
            } else {
                result[key] = "";
            }
        } else if (prop.type === "number" || prop.type === "integer") {
            result[key] = 0;
        } else if (prop.type === "boolean") {
            result[key] = false;
        } else if (prop.type === "array") {
            result[key] = [];
        } else if (prop.type === "object") {
            result[key] = {};
        }
    }
    return result;
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

// =============================================================================
// Props
// =============================================================================

export interface PluginTesterProps {
    sessionActive: boolean;
    budgetRemaining: number;
    formatBudget: (n: number) => string;
    recordUsage: () => void;
    /** Initial source from URL params */
    initialSource?: PluginSource;
    /** Initial plugin/server from URL params */
    initialPlugin?: string;
}

// =============================================================================
// Component
// =============================================================================

export function PluginTester({
    sessionActive,
    budgetRemaining,
    formatBudget,
    recordUsage,
    initialSource = "goat",
    initialPlugin = "",
}: PluginTesterProps) {
    const wallet = useActiveWallet();
    const resultsEndRef = useRef<HTMLDivElement>(null);

    // Common state
    const [pluginSource, setPluginSource] = useState<PluginSource>(initialSource);
    const [pluginsLoading, setPluginsLoading] = useState(false);
    const [selectedTool, setSelectedTool] = useState<string>("");
    const [toolArgs, setToolArgs] = useState<string>("{}");
    const [toolSchema, setToolSchema] = useState<Record<string, unknown> | null>(null);
    const [pluginResults, setPluginResults] = useState<PluginResult[]>([]);
    const [executingPlugin, setExecutingPlugin] = useState(false);
    const [pluginError, setPluginError] = useState<string | null>(null);

    // GOAT state
    const [goatStatus, setGoatStatus] = useState<GoatStatus | null>(null);
    const [pluginTools, setPluginTools] = useState<GoatTool[]>([]);
    const [selectedPlugin, setSelectedPlugin] = useState<string>(
        initialSource !== "mcp" ? initialPlugin : ""
    );

    // MCP state - fetched from centralized registry
    const mcpRegistryOptions = useMemo(() => ({ origin: 'mcp' as const, available: true }), []);
    const { data: mcpRegistryData, isLoading: mcpLoading, forceRefresh: forceRefreshMcpRegistry } = useRegistryServers(mcpRegistryOptions);
    const mcpServers = mcpRegistryData?.servers ?? [];
    const [mcpServerSearch, setMcpServerSearch] = useState("");
    const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
    const [selectedMcpServer, setSelectedMcpServer] = useState<string>(
        initialSource === "mcp" && initialPlugin ? `mcp:${initialPlugin}` : ""
    );

    // Eliza state
    const [elizaPlugins, setElizaPlugins] = useState<ElizaPlugin[]>([]);
    const [elizaActions, setElizaActions] = useState<ElizaAction[]>([]);
    const [selectedElizaPlugin, setSelectedElizaPlugin] = useState<string>(
        initialSource === "eliza" ? initialPlugin : ""
    );
    const [selectedElizaAction, setSelectedElizaAction] = useState<string>("");

    // Filtered MCP servers
    const MAX_MCP_DROPDOWN_ITEMS = 50;
    const filteredMcpServers = useMemo(() => {
        if (!mcpServerSearch.trim()) {
            return mcpServers.slice(0, MAX_MCP_DROPDOWN_ITEMS);
        }
        const query = mcpServerSearch.toLowerCase().trim();
        return mcpServers
            .filter(s =>
                s.name?.toLowerCase().includes(query) ||
                s.slug?.toLowerCase().includes(query) ||
                s.description?.toLowerCase().includes(query)
            )
            .slice(0, MAX_MCP_DROPDOWN_ITEMS);
    }, [mcpServers, mcpServerSearch]);

    // ==========================================================================
    // GOAT Handlers
    // ==========================================================================

    const fetchPluginStatus = async () => {
        setPluginsLoading(true);
        try {
            const response = await fetch(`${CONNECTOR_URL}/plugins/status`);
            if (!response.ok) throw new Error(`Failed to fetch status: ${response.status}`);
            const data = await response.json();
            setGoatStatus(data);
            if (!selectedPlugin && data.plugins?.length > 0) {
                setSelectedPlugin(data.plugins[0].id);
            }
        } catch (err) {
            console.error("Failed to fetch plugin status:", err);
            setPluginError(err instanceof Error ? err.message : "Failed to connect to plugin server");
        } finally {
            setPluginsLoading(false);
        }
    };

    const fetchPluginTools = async (pluginId: string) => {
        try {
            const response = await fetch(`${CONNECTOR_URL}/plugins/${encodeURIComponent(pluginId)}/tools`);
            if (!response.ok) throw new Error(`Failed to fetch tools: ${response.status}`);
            const data = await response.json();
            setPluginTools(data.tools || []);
            if (data.tools?.length > 0) {
                setSelectedTool(data.tools[0].name);
                setToolSchema(data.tools[0].parameters);
                const defaultArgs = data.tools[0].example || generateDefaultArgs(data.tools[0].parameters);
                setToolArgs(JSON.stringify(defaultArgs, null, 2));
            }
        } catch (err) {
            console.error("Failed to fetch plugin tools:", err);
            setPluginTools([]);
        }
    };

    const currentTool = pluginTools.find(t => t.name === selectedTool);

    const handleToolSelect = useCallback((toolName: string) => {
        setSelectedTool(toolName);
        const tool = pluginTools.find(t => t.name === toolName);
        if (tool) {
            setToolSchema(tool.parameters);
            const defaultArgs = tool.example || generateDefaultArgs(tool.parameters);
            setToolArgs(JSON.stringify(defaultArgs, null, 2));
        }
    }, [pluginTools]);

    const handlePluginChange = useCallback((pluginId: string) => {
        setSelectedPlugin(pluginId);
        setSelectedTool("");
        setToolSchema(null);
        setToolArgs("{}");
    }, []);

    const handleExecutePlugin = useCallback(async () => {
        if (!selectedPlugin || !selectedTool || executingPlugin) return;
        if (!wallet) {
            setPluginError("Connect wallet to execute plugins");
            return;
        }

        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(toolArgs);
        } catch (e) {
            setPluginError(`Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`);
            return;
        }

        setExecutingPlugin(true);
        setPluginError(null);

        try {
            const normalizedFetch = createNormalizedFetch();
            const fetchWithPayment = wrapFetchWithPayment(
                normalizedFetch,
                thirdwebClient,
                wallet,
                { maxValue: BigInt(inferencePriceWei) }
            );

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (sessionActive && budgetRemaining > 0) {
                headers["x-session-active"] = "true";
                headers["x-session-budget-remaining"] = budgetRemaining.toString();
            }

            const response = await fetchWithPayment(`${CONNECTOR_URL}/plugins/${encodeURIComponent(selectedPlugin)}/execute`, {
                method: "POST",
                headers,
                body: JSON.stringify({ tool: selectedTool, args }),
            });

            const data = await response.json();
            const result: PluginResult = {
                success: data.success ?? response.ok,
                pluginId: selectedPlugin,
                tool: selectedTool,
                result: data.result,
                error: data.error || data.hint,
                txHash: data.txHash,
                explorer: data.explorer,
                executedBy: data.executedBy,
                source: "goat",
            };

            setPluginResults(prev => [...prev, result]);
            if (data.success) recordUsage();
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            setPluginError(errorMsg);
            setPluginResults(prev => [
                ...prev,
                { success: false, pluginId: selectedPlugin, tool: selectedTool, error: errorMsg, source: "goat" },
            ]);
        } finally {
            setExecutingPlugin(false);
        }
    }, [selectedPlugin, selectedTool, toolArgs, executingPlugin, wallet, sessionActive, budgetRemaining, recordUsage]);

    // ==========================================================================
    // MCP Handlers
    // ==========================================================================

    const fetchMcpTools = async (slug: string) => {
        setPluginsLoading(true);
        try {
            const response = await fetch(`${CONNECTOR_URL}/mcp/servers/${encodeURIComponent(slug)}/tools`);
            if (!response.ok) throw new Error(`Failed to fetch MCP tools: ${response.status}`);
            const data: McpToolsResponse = await response.json();
            setMcpTools(data.tools || []);
            if (data.tools?.length > 0) {
                setSelectedTool(data.tools[0].name);
                setToolSchema(data.tools[0].inputSchema);
                const defaultArgs = generateDefaultArgs(data.tools[0].inputSchema);
                setToolArgs(JSON.stringify(defaultArgs, null, 2));
            }
        } catch (err) {
            console.error("Failed to fetch MCP tools:", err);
            setMcpTools([]);
            setPluginError(err instanceof Error ? err.message : "Failed to fetch tools");
        } finally {
            setPluginsLoading(false);
        }
    };

    const handleMcpServerChange = useCallback((registryId: string) => {
        setSelectedMcpServer(registryId);
        setSelectedTool("");
        setToolSchema(null);
        setToolArgs("{}");
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

    const handleExecuteMcpTool = useCallback(async () => {
        if (!selectedMcpServer || !selectedTool || executingPlugin) return;
        if (!wallet) {
            setPluginError("Connect wallet to execute MCP tools");
            return;
        }

        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(toolArgs);
        } catch (e) {
            setPluginError(`Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`);
            return;
        }

        setExecutingPlugin(true);
        setPluginError(null);

        try {
            const normalizedFetch = createNormalizedFetch();
            const fetchWithPayment = wrapFetchWithPayment(
                normalizedFetch,
                thirdwebClient,
                wallet,
                { maxValue: BigInt(inferencePriceWei) }
            );

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (sessionActive && budgetRemaining > 0) {
                headers["x-session-active"] = "true";
                headers["x-session-budget-remaining"] = budgetRemaining.toString();
            }

            const response = await fetchWithPayment(`${API_BASE}/api/mcp/servers/${encodeURIComponent(selectedMcpServer)}/call`, {
                method: "POST",
                headers,
                body: JSON.stringify({ tool: selectedTool, args }),
            });

            const data = await response.json();
            const result: PluginResult = {
                success: data.success ?? response.ok,
                pluginId: selectedMcpServer,
                tool: selectedTool,
                result: data.content,
                error: data.error || data.message,
                source: "mcp",
            };

            setPluginResults(prev => [...prev, result]);
            if (data.success) recordUsage();
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            setPluginError(errorMsg);
            setPluginResults(prev => [
                ...prev,
                { success: false, pluginId: selectedMcpServer, tool: selectedTool, error: errorMsg, source: "mcp" },
            ]);
        } finally {
            setExecutingPlugin(false);
        }
    }, [selectedMcpServer, selectedTool, toolArgs, executingPlugin, wallet, sessionActive, budgetRemaining, recordUsage]);

    // ==========================================================================
    // Eliza Handlers
    // ==========================================================================

    const fetchElizaPlugins = async () => {
        setPluginsLoading(true);
        try {
            const response = await fetch(`${CONNECTOR_URL}/eliza/plugins`);
            if (!response.ok) throw new Error(`Failed to fetch Eliza plugins: ${response.status}`);
            const data: ElizaPluginsResponse = await response.json();
            setElizaPlugins(data.plugins || []);
        } catch (err) {
            console.error("Failed to fetch Eliza plugins:", err);
            setPluginError(err instanceof Error ? err.message : "Failed to fetch Eliza plugins");
        } finally {
            setPluginsLoading(false);
        }
    };

    const fetchElizaActions = async (pluginId: string) => {
        setPluginsLoading(true);
        setElizaActions([]);
        try {
            const response = await fetch(`${CONNECTOR_URL}/eliza/plugins/${encodeURIComponent(pluginId)}/actions`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to fetch actions: ${response.status}`);
            }
            const data: ElizaActionsResponse = await response.json();
            setElizaActions(data.actions || []);
            if (data.actions?.length > 0) {
                handleElizaActionChange(data.actions[0].name);
            }
        } catch (err) {
            console.error("Failed to fetch Eliza actions:", err);
            setPluginError(err instanceof Error ? err.message : "Failed to fetch actions");
        } finally {
            setPluginsLoading(false);
        }
    };

    const handleElizaPluginChange = (pluginId: string) => {
        setSelectedElizaPlugin(pluginId);
        setSelectedElizaAction("");
        setElizaActions([]);
        setSelectedTool("");
        setToolSchema(null);
        setToolArgs("{}");
        setPluginError(null);
        if (pluginId) fetchElizaActions(pluginId);
    };

    const handleElizaActionChange = (actionName: string) => {
        setSelectedElizaAction(actionName);
        setSelectedTool(actionName);
        setPluginError(null);

        const action = elizaActions.find(a => a.name === actionName);
        if (action) {
            const defaultArgs: Record<string, unknown> = {};
            for (const param of action.parameters) {
                if (param.example !== undefined) {
                    defaultArgs[param.name] = param.example;
                } else if (param.default !== undefined) {
                    defaultArgs[param.name] = param.default;
                } else if (param.required) {
                    switch (param.type) {
                        case "string": defaultArgs[param.name] = param.enum?.[0] || ""; break;
                        case "number": defaultArgs[param.name] = 0; break;
                        case "boolean": defaultArgs[param.name] = false; break;
                        case "array": defaultArgs[param.name] = []; break;
                        case "object": defaultArgs[param.name] = {}; break;
                    }
                }
            }
            setToolArgs(JSON.stringify(defaultArgs, null, 2));
            setToolSchema({
                properties: action.parameters.reduce((acc, p) => {
                    acc[p.name] = { type: p.type, description: p.description, enum: p.enum, default: p.default };
                    return acc;
                }, {} as Record<string, unknown>),
                required: action.parameters.filter(p => p.required).map(p => p.name),
            });
        }
    };

    const handleElizaExecution = useCallback(async () => {
        if (!selectedElizaPlugin || !selectedElizaAction || executingPlugin) return;
        if (!wallet) {
            setPluginError("Connect wallet to execute Eliza actions");
            return;
        }

        let params: Record<string, unknown> = {};
        try {
            params = JSON.parse(toolArgs);
        } catch (e) {
            setPluginError(`Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`);
            return;
        }

        setExecutingPlugin(true);
        setPluginError(null);

        try {
            const normalizedFetch = createNormalizedFetch();
            const fetchWithPayment = wrapFetchWithPayment(
                normalizedFetch,
                thirdwebClient,
                wallet,
                { maxValue: BigInt(inferencePriceWei) }
            );

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (sessionActive && budgetRemaining > 0) {
                headers["x-session-active"] = "true";
                headers["x-session-budget-remaining"] = budgetRemaining.toString();
            }

            const response = await fetchWithPayment(`${CONNECTOR_URL}/eliza/plugins/${encodeURIComponent(selectedElizaPlugin)}/execute`, {
                method: "POST",
                headers,
                body: JSON.stringify({ action: selectedElizaAction, params }),
            });

            const data = await response.json();
            const result: PluginResult = {
                success: data.success ?? response.ok,
                pluginId: selectedElizaPlugin,
                tool: selectedElizaAction,
                result: data.result || data.text,
                error: data.error,
                source: "eliza",
                executionTime: data.executionTime,
            };

            setPluginResults(prev => [...prev, result]);
            if (data.success) recordUsage();
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            setPluginError(errorMsg);
            setPluginResults(prev => [
                ...prev,
                { success: false, pluginId: selectedElizaPlugin, tool: selectedElizaAction, error: errorMsg, source: "eliza" },
            ]);
        } finally {
            setExecutingPlugin(false);
        }
    }, [selectedElizaPlugin, selectedElizaAction, toolArgs, executingPlugin, wallet, sessionActive, budgetRemaining, recordUsage]);

    // ==========================================================================
    // Source Change Handler
    // ==========================================================================

    const handleSourceChange = useCallback((source: PluginSource) => {
        setPluginSource(source);
        setSelectedTool("");
        setToolSchema(null);
        setToolArgs("{}");
        setPluginError(null);
        if (source !== "goat") setSelectedPlugin("");
        if (source !== "mcp") setSelectedMcpServer("");
        if (source !== "eliza") {
            setSelectedElizaPlugin("");
            setSelectedElizaAction("");
        }
    }, []);

    const handleClearResults = useCallback(() => {
        setPluginResults([]);
        setPluginError(null);
    }, []);

    // ==========================================================================
    // Effects
    // ==========================================================================

    useEffect(() => {
        if (pluginSource === "goat" && !goatStatus) {
            fetchPluginStatus();
        } else if (pluginSource === "eliza" && elizaPlugins.length === 0) {
            fetchElizaPlugins();
        }
    }, [pluginSource, goatStatus, elizaPlugins.length]);

    useEffect(() => {
        if (selectedMcpServer && pluginSource === "mcp") {
            const slug = selectedMcpServer.replace(/^mcp:/, '');
            if (slug) fetchMcpTools(slug);
        }
    }, [selectedMcpServer, pluginSource]);

    useEffect(() => {
        if (selectedPlugin && pluginSource === "goat") {
            fetchPluginTools(selectedPlugin);
        }
    }, [selectedPlugin, pluginSource]);

    useEffect(() => {
        if (selectedElizaPlugin && pluginSource === "eliza") {
            fetchElizaActions(selectedElizaPlugin);
        }
    }, [selectedElizaPlugin, pluginSource]);

    useEffect(() => {
        resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [pluginResults]);

    // ==========================================================================
    // Render
    // ==========================================================================

    return (
        <div className="flex flex-col h-full">
            {/* Header: Source and Plugin/Server selectors */}
            <div className="shrink-0 p-3 lg:p-4 border-b border-zinc-800">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
                    {/* Source selector */}
                    <Select value={pluginSource} onValueChange={(v) => handleSourceChange(v as PluginSource)}>
                        <SelectTrigger className="w-full sm:w-28 lg:w-32 bg-zinc-900 border-zinc-700 h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700">
                            <SelectItem value="goat">
                                <div className="flex items-center gap-2">
                                    <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-[10px] px-1.5">GOAT</Badge>
                                    <span className="text-[10px] text-zinc-500">DeFi</span>
                                </div>
                            </SelectItem>
                            <SelectItem value="mcp">
                                <div className="flex items-center gap-2">
                                    <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/40 text-[10px] px-1.5">MCP</Badge>
                                    <span className="text-[10px] text-zinc-500">Servers</span>
                                </div>
                            </SelectItem>
                            <SelectItem value="eliza">
                                <div className="flex items-center gap-2">
                                    <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/40 text-[10px] px-1.5">Eliza</Badge>
                                    <span className="text-[10px] text-zinc-500">AI Agents</span>
                                </div>
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    {/* GOAT Plugin selector */}
                    {pluginSource === "goat" && (
                        <>
                            <Select value={selectedPlugin} onValueChange={handlePluginChange} disabled={!goatStatus?.plugins?.length}>
                                <SelectTrigger className="w-full sm:w-40 lg:w-52 bg-zinc-900 border-zinc-700 h-9">
                                    <SelectValue placeholder={pluginsLoading ? "Loading..." : "Select plugin"} />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 max-h-80">
                                    {!goatStatus?.plugins?.length ? (
                                        <div className="p-2 text-zinc-500 text-sm">No plugins available</div>
                                    ) : (
                                        goatStatus.plugins.map((plugin) => (
                                            <SelectItem key={plugin.id} value={plugin.id}>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs">{plugin.name}</span>
                                                    <Badge variant="outline" className="text-[9px] px-1 py-0">{plugin.toolCount}</Badge>
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>

                            <Select value={selectedTool} onValueChange={handleToolSelect} disabled={pluginTools.length === 0}>
                                <SelectTrigger className="w-full sm:flex-1 lg:w-56 xl:w-72 bg-zinc-900 border-zinc-700 h-9">
                                    <SelectValue placeholder={pluginTools.length === 0 ? "Select plugin first" : "Select tool"} />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 max-h-96">
                                    {pluginTools.length === 0 ? (
                                        <div className="p-2 text-zinc-500 text-sm">No tools available</div>
                                    ) : (
                                        pluginTools.map((tool) => (
                                            <SelectItem key={tool.name} value={tool.name}>
                                                <div className="flex flex-col py-0.5">
                                                    <span className="font-mono text-xs">{tool.name}</span>
                                                    <span className="text-[10px] text-zinc-500 truncate max-w-64">{tool.description}</span>
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>

                            {goatStatus && (
                                <div className="flex items-center gap-2 text-xs">
                                    <div className={cn("w-2 h-2 rounded-full", goatStatus.initialized ? "bg-emerald-500" : "bg-red-500")} />
                                    <span className="text-zinc-500">
                                        {goatStatus.initialized ? `${goatStatus.totalTools} tools • ${goatStatus.chain}` : "Offline"}
                                    </span>
                                </div>
                            )}
                        </>
                    )}

                    {/* MCP Server selector */}
                    {pluginSource === "mcp" && (
                        <>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        className="w-full sm:w-40 lg:w-52 bg-zinc-900 border-zinc-700 h-9 justify-between text-left font-normal"
                                    >
                                        <span className="truncate font-mono text-xs">
                                            {mcpLoading
                                                ? "Loading..."
                                                : selectedMcpServer
                                                    ? mcpServers.find(s => s.registryId === selectedMcpServer)?.name || selectedMcpServer.replace(/^mcp:/, '')
                                                    : "Select server..."}
                                        </span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[300px] p-0 bg-zinc-900 border-zinc-700" align="start">
                                    <Command className="bg-zinc-900" shouldFilter={false}>
                                        <CommandInput
                                            placeholder="Search servers..."
                                            className="h-9"
                                            value={mcpServerSearch}
                                            onValueChange={setMcpServerSearch}
                                        />
                                        <CommandList className="max-h-[300px]">
                                            {mcpLoading ? (
                                                <div className="p-4 text-center text-zinc-500">
                                                    <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                                                    Loading servers...
                                                </div>
                                            ) : filteredMcpServers.length === 0 ? (
                                                <CommandEmpty>No servers match "{mcpServerSearch}"</CommandEmpty>
                                            ) : (
                                                <CommandGroup heading={mcpServerSearch ? `${filteredMcpServers.length} matches` : `Showing ${filteredMcpServers.length} of ${mcpServers.length.toLocaleString()}`}>
                                                    {filteredMcpServers.map((server) => (
                                                        <CommandItem
                                                            key={server.registryId}
                                                            value={server.registryId}
                                                            onSelect={() => {
                                                                handleMcpServerChange(server.registryId);
                                                                setMcpServerSearch("");
                                                            }}
                                                            className="cursor-pointer"
                                                        >
                                                            <div className="flex items-center gap-2 w-full">
                                                                <Check
                                                                    className={cn(
                                                                        "h-4 w-4 shrink-0",
                                                                        selectedMcpServer === server.registryId ? "opacity-100" : "opacity-0"
                                                                    )}
                                                                />
                                                                <div className="flex flex-col min-w-0 flex-1">
                                                                    <span className="font-mono text-xs truncate">{server.name || server.slug}</span>
                                                                    <span className="text-[10px] text-zinc-500 truncate">{server.description || "No description"}</span>
                                                                </div>
                                                                {server.transport === 'http' && (
                                                                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-cyan-500/50 text-cyan-400 shrink-0">remote</Badge>
                                                                )}
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            )}
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>

                            <Select value={selectedTool} onValueChange={handleMcpToolSelect} disabled={mcpTools.length === 0}>
                                <SelectTrigger className="w-full sm:flex-1 lg:w-56 xl:w-72 bg-zinc-900 border-zinc-700 h-9">
                                    <SelectValue placeholder={mcpTools.length === 0 ? "Select server first" : "Select tool"} />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 max-h-96">
                                    {mcpTools.length === 0 ? (
                                        <div className="p-2 text-zinc-500 text-sm">No tools available</div>
                                    ) : (
                                        mcpTools.map((tool) => (
                                            <SelectItem key={tool.name} value={tool.name}>
                                                <div className="flex flex-col py-0.5">
                                                    <span className="font-mono text-xs">{tool.name}</span>
                                                    <span className="text-[10px] text-zinc-500 truncate max-w-48 sm:max-w-64">{tool.description || "No description"}</span>
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>

                            <div className="flex items-center gap-2 text-[10px] sm:text-xs shrink-0">
                                <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", mcpServers.length > 0 ? "bg-purple-500" : "bg-zinc-500")} />
                                <span className="text-zinc-500">
                                    {mcpServers.length > 0 ? `${mcpServers.length.toLocaleString()} servers` : "Loading..."}
                                </span>
                            </div>
                        </>
                    )}

                    {/* Eliza Plugin selector */}
                    {pluginSource === "eliza" && (
                        <>
                            <Select value={selectedElizaPlugin} onValueChange={handleElizaPluginChange} disabled={elizaPlugins.length === 0}>
                                <SelectTrigger className="w-full sm:w-40 lg:w-52 bg-zinc-900 border-zinc-700 h-9">
                                    <SelectValue placeholder={pluginsLoading ? "Loading..." : "Select plugin"} />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 max-h-80">
                                    {elizaPlugins.length === 0 ? (
                                        <div className="p-2 text-zinc-500 text-sm">No plugins available</div>
                                    ) : (
                                        elizaPlugins.map((plugin) => (
                                            <SelectItem key={plugin.id} value={plugin.id}>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs truncate max-w-24 sm:max-w-40">{plugin.id}</span>
                                                    {plugin.version && (
                                                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-zinc-500 hidden sm:flex">{plugin.version}</Badge>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>

                            <Select value={selectedElizaAction} onValueChange={handleElizaActionChange} disabled={elizaActions.length === 0}>
                                <SelectTrigger className="w-full sm:flex-1 lg:w-56 xl:w-72 bg-zinc-900 border-zinc-700 h-9">
                                    <SelectValue placeholder={elizaActions.length === 0 ? "Select plugin first" : "Select action"} />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 max-h-96">
                                    {elizaActions.length === 0 ? (
                                        <div className="p-2 text-zinc-500 text-sm">No actions available</div>
                                    ) : (
                                        elizaActions.map((action) => (
                                            <SelectItem key={action.name} value={action.name}>
                                                <div className="flex flex-col py-0.5">
                                                    <span className="font-mono text-xs">{action.name}</span>
                                                    <span className="text-[10px] text-zinc-500 truncate max-w-48 sm:max-w-64">{action.description}</span>
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>

                            <div className="flex items-center gap-2 text-[10px] sm:text-xs shrink-0">
                                <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", elizaPlugins.length > 0 ? "bg-fuchsia-500" : "bg-zinc-500")} />
                                <span className="text-zinc-500">
                                    {elizaPlugins.length > 0 ? `${elizaPlugins.length} plugins` : "Loading..."}
                                </span>
                            </div>
                        </>
                    )}

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={pluginSource === "goat" ? fetchPluginStatus : pluginSource === "eliza" ? fetchElizaPlugins : () => forceRefreshMcpRegistry()}
                        disabled={pluginsLoading || mcpLoading}
                        className="text-zinc-400 hover:text-white shrink-0 h-8 w-8 sm:h-9 sm:w-9"
                        title="Refresh"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", (pluginsLoading || mcpLoading) && "animate-spin")} />
                    </Button>
                </div>
            </div>

            {/* Results Area */}
            <ScrollArea className="flex-1 p-4 min-h-0">
                <div className="space-y-4 max-w-4xl mx-auto">
                    {pluginResults.length === 0 ? (
                        <div className="text-center py-8 text-zinc-500">
                            <Plug className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg">
                                Test {pluginSource === "goat" ? "GOAT DeFi" : pluginSource === "mcp" ? "MCP Server" : "Eliza AI"} Actions
                            </p>
                            <p className="text-sm mt-2">
                                {sessionActive
                                    ? `Budget: ${formatBudget(budgetRemaining)} • Select a ${pluginSource === "goat" ? "plugin" : pluginSource === "mcp" ? "server" : "plugin"} and ${pluginSource === "eliza" ? "action" : "tool"} to execute`
                                    : "Start a session to begin"}
                            </p>

                            {pluginSource === "goat" && goatStatus?.plugins && goatStatus.plugins.length > 0 && (
                                <div className="mt-6 text-left max-w-2xl mx-auto">
                                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">
                                        {goatStatus.plugins.length} Plugins • {goatStatus.totalTools} Tools
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {goatStatus.plugins.map((plugin) => (
                                            <button
                                                key={plugin.id}
                                                onClick={() => handlePluginChange(plugin.id)}
                                                className={cn(
                                                    "bg-zinc-900 rounded-lg p-3 border text-left transition-colors",
                                                    selectedPlugin === plugin.id
                                                        ? "border-green-500/50 bg-green-950/20"
                                                        : "border-zinc-800 hover:border-zinc-700"
                                                )}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-green-400 font-mono text-xs">{plugin.name}</span>
                                                    <Badge variant="outline" className="text-[9px]">{plugin.toolCount}</Badge>
                                                </div>
                                                <p className="text-zinc-500 text-[10px] line-clamp-2">{plugin.description}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {pluginSource === "mcp" && mcpServers.length > 0 && (
                                <div className="mt-6 text-left max-w-md mx-auto">
                                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3 text-center">
                                        {mcpServers.length.toLocaleString()} MCP Servers Available
                                    </p>
                                    <p className="text-zinc-500 text-sm text-center">
                                        Use the <span className="text-purple-400 font-mono">Select server</span> dropdown above to search and select from all available servers.
                                    </p>
                                </div>
                            )}

                            {pluginSource === "eliza" && elizaPlugins.length > 0 && (
                                <div className="mt-6 text-left max-w-2xl mx-auto">
                                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">
                                        {elizaPlugins.length} ElizaOS Plugins Available
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {elizaPlugins.slice(0, 8).map((plugin) => (
                                            <button
                                                key={plugin.id}
                                                onClick={() => handleElizaPluginChange(plugin.id)}
                                                className={cn(
                                                    "bg-zinc-900 rounded-lg p-3 border text-left transition-colors",
                                                    selectedElizaPlugin === plugin.id
                                                        ? "border-fuchsia-500/50 bg-fuchsia-950/20"
                                                        : "border-zinc-800 hover:border-zinc-700"
                                                )}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-fuchsia-400 font-mono text-xs">{plugin.id}</span>
                                                    {plugin.version && (
                                                        <Badge variant="outline" className="text-[9px] text-zinc-500">{plugin.version}</Badge>
                                                    )}
                                                </div>
                                                <p className="text-zinc-500 text-[10px] line-clamp-2">{plugin.description || "No description"}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {pluginsLoading && (
                                <div className="mt-6">
                                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-cyan-400" />
                                    <p className="mt-2 text-sm">
                                        Loading {pluginSource === "goat" ? "plugins" : pluginSource === "mcp" ? "servers" : "plugins"}...
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : (
                        pluginResults.map((result, index) => (
                            <div
                                key={index}
                                className={cn(
                                    "rounded-lg p-4 border",
                                    result.success
                                        ? "bg-emerald-950/30 border-emerald-800"
                                        : "bg-red-950/30 border-red-800"
                                )}
                            >
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <Terminal className="h-4 w-4 text-zinc-400" />
                                    <Badge
                                        className={cn(
                                            "text-[10px] px-1.5",
                                            result.source === "mcp"
                                                ? "bg-purple-500/20 text-purple-400 border-purple-500/40"
                                                : result.source === "eliza"
                                                    ? "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/40"
                                                    : "bg-green-500/20 text-green-400 border-green-500/40"
                                        )}
                                    >
                                        {result.source === "mcp" ? "MCP" : result.source === "eliza" ? "Eliza" : "GOAT"}
                                    </Badge>
                                    <span className="font-mono text-sm text-zinc-300">
                                        {result.pluginId}/{result.tool}
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
                                        <span className="text-[10px] text-zinc-600">
                                            by {result.executedBy.slice(0, 6)}...{result.executedBy.slice(-4)}
                                        </span>
                                    )}
                                </div>
                                <pre className="text-xs text-zinc-400 overflow-auto max-h-48 font-mono bg-zinc-900/50 rounded p-2">
                                    {result.error || JSON.stringify(result.result, null, 2)}
                                </pre>
                            </div>
                        ))
                    )}
                    <div ref={resultsEndRef} />
                </div>
            </ScrollArea>

            {/* Input with schema hints */}
            <div className="shrink-0 border-t border-zinc-800 p-4">
                <div className="max-w-4xl mx-auto space-y-3">
                    {/* Tool/Action description & schema hint */}
                    {(pluginSource === "goat" ? currentTool : pluginSource === "mcp" ? currentMcpTool : elizaActions.find(a => a.name === selectedElizaAction)) && (
                        <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800">
                            <div className="flex items-center gap-2 mb-2">
                                <Terminal className={cn(
                                    "h-4 w-4",
                                    pluginSource === "goat" ? "text-green-400" : pluginSource === "mcp" ? "text-purple-400" : "text-fuchsia-400"
                                )} />
                                <Badge
                                    className={cn(
                                        "text-[10px] px-1.5",
                                        pluginSource === "goat"
                                            ? "bg-green-500/20 text-green-400 border-green-500/40"
                                            : pluginSource === "mcp"
                                                ? "bg-purple-500/20 text-purple-400 border-purple-500/40"
                                                : "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/40"
                                    )}
                                >
                                    {pluginSource === "goat" ? "GOAT" : pluginSource === "mcp" ? "MCP" : "Eliza"}
                                </Badge>
                                <span className={cn(
                                    "font-mono text-sm",
                                    pluginSource === "goat" ? "text-green-400" : pluginSource === "mcp" ? "text-purple-400" : "text-fuchsia-400"
                                )}>
                                    {pluginSource === "goat"
                                        ? currentTool?.name
                                        : pluginSource === "mcp"
                                            ? currentMcpTool?.name
                                            : elizaActions.find(a => a.name === selectedElizaAction)?.name}
                                </span>
                            </div>
                            <p className="text-xs text-zinc-400 mb-2">
                                {pluginSource === "goat"
                                    ? currentTool?.description
                                    : pluginSource === "mcp"
                                        ? (currentMcpTool?.description || "No description available")
                                        : (elizaActions.find(a => a.name === selectedElizaAction)?.description || "No description available")}
                            </p>
                            {toolSchema && (
                                <div className="mt-2 pt-2 border-t border-zinc-800">
                                    <p className="text-[10px] text-zinc-500 uppercase mb-1">Parameters (* = required)</p>
                                    <pre className="text-[10px] text-zinc-500 font-mono whitespace-pre-wrap">
                                        {formatSchemaHint(toolSchema)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleClearResults}
                            className="text-zinc-400 hover:text-white shrink-0"
                            title="Clear results"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        <div className="flex-1 relative">
                            <Textarea
                                value={toolArgs}
                                onChange={(e) => setToolArgs(e.target.value)}
                                placeholder='{"key": "value"}'
                                className="bg-zinc-900 border-zinc-700 font-mono text-sm min-h-20 pr-20"
                            />
                            <div className="absolute right-2 top-2 flex gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        if (pluginSource === "goat" && currentTool) {
                                            const defaultArgs = currentTool.example || generateDefaultArgs(currentTool.parameters);
                                            setToolArgs(JSON.stringify(defaultArgs, null, 2));
                                        } else if (pluginSource === "mcp" && currentMcpTool) {
                                            const defaultArgs = generateDefaultArgs(currentMcpTool.inputSchema);
                                            setToolArgs(JSON.stringify(defaultArgs, null, 2));
                                        }
                                    }}
                                    className="h-6 px-2 text-[10px] text-zinc-500 hover:text-white"
                                    title="Reset to defaults"
                                >
                                    Reset
                                </Button>
                            </div>
                        </div>
                        <Button
                            onClick={
                                pluginSource === "goat"
                                    ? handleExecutePlugin
                                    : pluginSource === "mcp"
                                        ? handleExecuteMcpTool
                                        : handleElizaExecution
                            }
                            disabled={
                                !sessionActive ||
                                executingPlugin ||
                                !selectedTool ||
                                (pluginSource === "goat" ? !selectedPlugin : pluginSource === "mcp" ? !selectedMcpServer : !selectedElizaPlugin)
                            }
                            className={cn(
                                "h-auto px-6",
                                pluginSource === "goat"
                                    ? "bg-green-600 hover:bg-green-700"
                                    : pluginSource === "mcp"
                                        ? "bg-purple-600 hover:bg-purple-700"
                                        : "bg-fuchsia-600 hover:bg-fuchsia-700"
                            )}
                        >
                            {executingPlugin ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Play className="h-4 w-4 mr-2" />
                                    Execute
                                </>
                            )}
                        </Button>
                    </div>
                    {pluginError && (
                        <div className="p-3 rounded-lg bg-red-950/30 border border-red-800">
                            <p className="text-red-400 text-sm flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                {pluginError}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
