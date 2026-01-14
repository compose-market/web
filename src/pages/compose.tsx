import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  ReactFlowProvider,
  Handle,
  Position,
  MarkerType
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Save, Download, Info, Loader2, CheckCircle2, XCircle,
  Plug, Trash2, Settings, ChevronRight, Bot, ExternalLink, Filter, Star, Shield,
  Wrench, Github, Zap, Server, Copy, FlaskConical, Sparkles, Upload, DollarSign, Clock, AlertCircle,
  ArrowRightLeft, Globe, Maximize2, Minimize2, RefreshCw, Check
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useActiveAccount, useActiveWallet, TransactionButton, useSendTransaction } from "thirdweb/react";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { prepareContractCall } from "thirdweb";
import { getManowarContract, usdcToWei, computeExternalAgentHash, getWarpContract, getContractAddress, getAgentFactoryContract, formatUsdcPrice, weiToUsdc, computeManowarDnaHash, deriveManowarWalletAddress } from "@/lib/contracts";
import { readContract } from "thirdweb";
import { uploadManowarBanner, uploadManowarMetadata, getIpfsUri, getIpfsUrl, fileToDataUrl, isPinataConfigured, fetchFromIpfs, type ManowarMetadata, type AgentCard } from "@/lib/pinata";
import { CHAIN_IDS, CHAIN_CONFIG, thirdwebClient, inferencePriceWei, getPaymentTokenContract } from "@/lib/thirdweb";
import { createNormalizedFetch } from "@/lib/payment";
// Models are fetched via useModels hook - no static imports needed
import { coordinatorModels } from "@/hooks/use-coordinator";
import { useSession } from "@/hooks/use-session.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useConnectors,
  useConnectorTools,
  useWorkflowExecution,
  useWorkflowBuilder
} from "@/hooks/use-services";
import { useAgents } from "@/hooks/use-agents";
import { useOnchainAgents } from "@/hooks/use-onchain";
import { usdcToWei as usdcToWeiBigInt } from "@/lib/contracts";
import {
  useRegistryServers,
  useRegistrySearch,
  type RegistryServer,
} from "@/hooks/use-registry";
import type { ConnectorInfo, ConnectorTool, WorkflowStep } from "@/lib/services";
import { executeRegistryTool } from "@/lib/services";
import { WorkflowOutputPanel, type WorkflowExecutionResult } from "@/components/output";
import { type Agent, type AgentRegistryId, AGENT_REGISTRIES, formatInteractions, COMMON_TAGS } from "@/lib/agents";
import { RFAComponent } from "@/components/RFAComponent";
import {
  type TriggerDefinition,
  parseNLToCron,
  TRIGGER_TEMPLATES,
  getUserTimezone,
} from "@/lib/triggers";

// =============================================================================
// Node Types - n8n-inspired design with protruding connectors
// =============================================================================

interface StepNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  connector?: ConnectorInfo;
  tool?: ConnectorTool;
  status?: "pending" | "running" | "success" | "error";
  error?: string;
}

interface AgentNodeData extends Record<string, unknown> {
  agent: Agent;
  status?: "pending" | "running" | "success" | "error";
  error?: string;
}

// Shared handle styles for n8n-like protruding connectors
const handleBaseStyle = "!w-4 !h-4 !rounded-full !border-2 transition-all";
const inputHandleStyle = `${handleBaseStyle} !-left-2 !bg-cyan-500 !border-cyan-300 !shadow-[0_0_10px_hsl(188_95%_43%/0.6)] hover:!shadow-[0_0_15px_hsl(188_95%_43%/0.8)]`;
const outputHandleStyle = `${handleBaseStyle} !-right-2 !bg-fuchsia-500 !border-fuchsia-300 !shadow-[0_0_10px_hsl(292_85%_55%/0.6)] hover:!shadow-[0_0_15px_hsl(292_85%_55%/0.8)]`;

function StepNode({ data }: { data: StepNodeData }) {
  const statusStyles = {
    pending: "border-sidebar-border bg-card/80",
    running: "border-cyan-500 bg-cyan-500/5 shadow-[0_0_25px_-5px_hsl(188_95%_43%/0.4)]",
    success: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  };

  const statusIndicator = {
    pending: "bg-sidebar-border",
    running: "bg-cyan-500 animate-pulse",
    success: "bg-green-500",
    error: "bg-red-500",
  };

  return (
    <div className={`relative w-64 rounded-lg border-2 backdrop-blur-md overflow-visible group transition-all duration-200 hover:scale-[1.02] ${statusStyles[data.status || "pending"]}`}>
      {/* Left handle - Input */}
      <Handle
        type="target"
        position={Position.Left}
        className={inputHandleStyle}
      />

      {/* Status bar */}
      <div className={`h-1 w-full ${statusIndicator[data.status || "pending"]}`} />

      {/* Content */}
      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/30 shrink-0">
            <Plug className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <h3 className="font-bold font-display text-sm truncate text-foreground leading-tight">
              {data.step.name}
            </h3>
            <p className="text-[10px] text-muted-foreground truncate font-mono">
              {data.step.connectorId}
            </p>
          </div>
          {data.status === "running" && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />}
          {data.status === "success" && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
          {data.status === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
        </div>

        {data.error && (
          <div className="text-[10px] text-red-400 font-mono bg-red-500/10 p-1.5 rounded mt-2 truncate">
            {data.error}
          </div>
        )}

        <div className="flex justify-between items-center mt-2 pt-2 border-t border-sidebar-border/50">
          <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-cyan-500/30 text-cyan-400 font-mono">
            {data.step.toolName}
          </Badge>
          <Wrench className="w-3 h-3 text-muted-foreground/50" />
        </div>
      </div>

      {/* Right handle - Output */}
      <Handle
        type="source"
        position={Position.Right}
        className={outputHandleStyle}
      />
    </div>
  );
}

function AgentNode({ data }: { data: AgentNodeData }) {
  const { agent, status = "pending", error } = data;

  const initials = agent.name
    .split(" ")
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isManowar = agent.registry === "manowar";

  const statusStyles = {
    pending: isManowar ? "border-cyan-500/40 bg-cyan-500/5" : "border-fuchsia-500/40 bg-fuchsia-500/5",
    running: "border-cyan-500 bg-cyan-500/10 shadow-[0_0_25px_-5px_hsl(188_95%_43%/0.5)]",
    success: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  };

  return (
    <div className={`relative w-64 rounded-lg border-2 backdrop-blur-md overflow-visible group transition-all duration-200 hover:scale-[1.02] ${statusStyles[status]}`}>
      {/* Left handle - Input */}
      <Handle
        type="target"
        position={Position.Left}
        className={inputHandleStyle}
      />

      {/* Colored header bar */}
      <div className={`h-1.5 w-full ${isManowar ? "bg-gradient-to-r from-cyan-500 to-cyan-400" : "bg-gradient-to-r from-fuchsia-500 to-fuchsia-400"}`} />

      {/* Content */}
      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <Avatar className={`w-10 h-10 border-2 shrink-0 ${isManowar ? "border-cyan-500/50" : "border-fuchsia-500/50"}`}>
            <AvatarImage src={agent.avatarUrl || undefined} alt={agent.name} />
            <AvatarFallback className={`font-mono text-xs ${isManowar ? "bg-cyan-500/20 text-cyan-400" : "bg-fuchsia-500/20 text-fuchsia-400"}`}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="overflow-hidden flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h3 className="font-bold font-display text-sm truncate text-foreground leading-tight">
                {agent.name}
              </h3>
              {isManowar && <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
              {agent.verified && !isManowar && <Shield className="w-3.5 h-3.5 text-green-400 shrink-0" />}
            </div>
            <p className="text-[10px] text-muted-foreground truncate font-mono">
              {agent.protocols?.[0]?.name || "default"}
            </p>
          </div>
          {status === "running" && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />}
          {status === "success" && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
          {status === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
        </div>

        {error && (
          <div className="text-[10px] text-red-400 font-mono bg-red-500/10 p-1.5 rounded mt-2 truncate">
            {error}
          </div>
        )}

        <div className="flex justify-between items-center mt-2 pt-2 border-t border-sidebar-border/50">
          <Badge
            variant="outline"
            className={`text-[9px] h-4 px-1.5 font-mono ${isManowar ? "border-cyan-500/30 text-cyan-400" : "border-fuchsia-500/30 text-fuchsia-400"}`}
          >
            {isManowar ? "on-chain" : agent.registry}
          </Badge>
          <Bot className={`w-3.5 h-3.5 ${isManowar ? "text-cyan-400/50" : "text-fuchsia-400/50"}`} />
        </div>
      </div>

      {/* Right handle - Output */}
      <Handle
        type="source"
        position={Position.Right}
        className={outputHandleStyle}
      />
    </div>
  );
}

// =============================================================================
// Trigger Node - Schedule-based workflow initiation
// =============================================================================

interface TriggerNodeData extends Record<string, unknown> {
  trigger: {
    id: string;
    name: string;
    type: "cron" | "webhook" | "event" | "manual";
    nlDescription: string;
    cronExpression?: string;
    cronReadable?: string;
    enabled: boolean;
  };
  status?: "pending" | "running" | "success" | "error";
}

function TriggerNode({ data }: { data: TriggerNodeData }) {
  const { trigger, status = "pending" } = data;

  const typeIcons: Record<string, React.ReactNode> = {
    cron: <Clock className="w-4 h-4 text-amber-400" />,
    webhook: <Globe className="w-4 h-4 text-amber-400" />,
    event: <Zap className="w-4 h-4 text-amber-400" />,
    manual: <Play className="w-4 h-4 text-amber-400" />,
  };

  const statusStyles = {
    pending: trigger.enabled ? "border-amber-500/40 bg-amber-500/5" : "border-sidebar-border bg-card/50 opacity-60",
    running: "border-amber-500 bg-amber-500/10 shadow-[0_0_25px_-5px_hsl(43_96%_50%/0.5)]",
    success: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  };

  return (
    <div className={`relative w-64 rounded-lg border-2 backdrop-blur-md overflow-visible group transition-all duration-200 hover:scale-[1.02] ${statusStyles[status]}`}>
      {/* Trigger-specific gradient header */}
      <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 to-yellow-400" />

      {/* Content */}
      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/30 shrink-0">
            {typeIcons[trigger.type] || <Clock className="w-4 h-4 text-amber-400" />}
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h3 className="font-bold font-display text-sm truncate text-foreground leading-tight">
                {trigger.name}
              </h3>
              {!trigger.enabled && <Badge variant="outline" className="text-[8px] h-3 px-1 border-muted-foreground/30">OFF</Badge>}
            </div>
            <p className="text-[10px] text-muted-foreground truncate">
              {trigger.cronReadable || trigger.nlDescription}
            </p>
          </div>
          {status === "running" && <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />}
          {status === "success" && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
        </div>

        <div className="flex justify-between items-center mt-2 pt-2 border-t border-sidebar-border/50">
          <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono border-amber-500/30 text-amber-400">
            {trigger.type}
          </Badge>
          {trigger.cronExpression && (
            <code className="text-[8px] text-muted-foreground font-mono">{trigger.cronExpression}</code>
          )}
        </div>
      </div>

      {/* Output handle only - triggers start the flow */}
      <Handle
        type="source"
        position={Position.Right}
        className={outputHandleStyle}
      />
    </div>
  );
}

// =============================================================================
// Hook Node - Lifecycle event handlers
// =============================================================================

interface HookNodeData extends Record<string, unknown> {
  hook: {
    id: string;
    name: string;
    type: "pre-execution" | "post-step" | "on-error" | "on-complete" | "on-context-cleanup" | "on-restart";
    action: {
      type: "notify" | "webhook" | "agent" | "memory" | "log";
    };
    enabled: boolean;
  };
  status?: "pending" | "running" | "success" | "error";
}

function HookNode({ data }: { data: HookNodeData }) {
  const { hook, status = "pending" } = data;

  const typeLabels: Record<string, string> = {
    "pre-execution": "Before Start",
    "post-step": "After Step",
    "on-error": "On Error",
    "on-complete": "On Complete",
    "on-context-cleanup": "Cleanup",
    "on-restart": "On Restart",
  };

  const actionIcons: Record<string, React.ReactNode> = {
    notify: <AlertCircle className="w-4 h-4 text-violet-400" />,
    webhook: <Globe className="w-4 h-4 text-violet-400" />,
    agent: <Bot className="w-4 h-4 text-violet-400" />,
    memory: <Sparkles className="w-4 h-4 text-violet-400" />,
    log: <Server className="w-4 h-4 text-violet-400" />,
  };

  const statusStyles = {
    pending: hook.enabled ? "border-violet-500/40 bg-violet-500/5" : "border-sidebar-border bg-card/50 opacity-60",
    running: "border-violet-500 bg-violet-500/10 shadow-[0_0_25px_-5px_hsl(262_83%_58%/0.5)]",
    success: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  };

  return (
    <div className={`relative w-56 rounded-lg border-2 backdrop-blur-md overflow-visible group transition-all duration-200 hover:scale-[1.02] ${statusStyles[status]}`}>
      {/* Left handle - Input */}
      <Handle
        type="target"
        position={Position.Left}
        className={inputHandleStyle}
      />

      {/* Hook-specific gradient header */}
      <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 to-purple-400" />

      {/* Content */}
      <div className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center border border-violet-500/30 shrink-0">
            {actionIcons[hook.action.type] || <Zap className="w-4 h-4 text-violet-400" />}
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <h3 className="font-bold font-display text-xs truncate text-foreground leading-tight">
              {hook.name}
            </h3>
            <p className="text-[9px] text-muted-foreground truncate">
              {typeLabels[hook.type] || hook.type}
            </p>
          </div>
        </div>

        <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-sidebar-border/50">
          <Badge variant="outline" className="text-[8px] h-3.5 px-1 font-mono border-violet-500/30 text-violet-400">
            {hook.action.type}
          </Badge>
          {!hook.enabled && <Badge variant="outline" className="text-[8px] h-3 px-1 border-muted-foreground/30">OFF</Badge>}
        </div>
      </div>

      {/* Right handle - Output */}
      <Handle
        type="source"
        position={Position.Right}
        className={outputHandleStyle}
      />
    </div>
  );
}

const nodeTypes = {
  stepNode: StepNode,
  agentNode: AgentNode,
  triggerNode: TriggerNode,
  hookNode: HookNode,
};

// =============================================================================
// Connector Picker (Unified search across all sources)
// =============================================================================

function ConnectorPicker({
  onSelect
}: {
  onSelect: (connectorId: string, tool: ConnectorTool) => void
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedServer, setSelectedServer] = useState<RegistryServer | null>(null);
  const [detailServer, setDetailServer] = useState<RegistryServer | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Fetch all servers with search (only plugins, not agents)
  const { data: searchData, isLoading: isSearching } = useRegistrySearch(
    searchQuery,
    30
  );

  // Fetch all servers when no search (only plugins)
  const { data: allData, isLoading: isLoadingAll } = useRegistryServers({
    type: "plugin",
    limit: 50,
  });

  const servers = searchQuery.trim()
    ? searchData?.servers || []
    : allData?.servers || [];
  const isLoading = searchQuery.trim() ? isSearching : isLoadingAll;

  // Add a connector with a specific tool
  const handleToolSelect = (tool: { name: string; description?: string }) => {
    if (!selectedServer) return;

    const connectorTool: ConnectorTool = {
      name: tool.name,
      description: tool.description || "",
      inputSchema: { type: "object", properties: {} },
    };

    onSelect(selectedServer.registryId, connectorTool);
    setSelectedServer(null);
  };

  // Quick add a connector with a default "execute" action
  const handleQuickAdd = () => {
    if (!selectedServer) return;

    // Create a default tool based on the server type
    const defaultTool: ConnectorTool = {
      name: "execute",
      description: `Execute ${selectedServer.name}`,
      inputSchema: { type: "object", properties: {} },
    };

    onSelect(selectedServer.registryId, defaultTool);
    setSelectedServer(null);
  };

  // Open detail dialog
  const handleShowDetails = (server: RegistryServer, e: React.MouseEvent) => {
    e.stopPropagation();
    setDetailServer(server);
    setDetailOpen(true);
  };

  const getOriginBadge = (origin: string) => {
    switch (origin) {
      case "mcp": return <Badge variant="secondary" className="text-[8px] h-4 px-1">MCP</Badge>;
      case "goat": return <Badge variant="outline" className="text-[8px] h-4 px-1 border-green-500/50 text-green-400">GOAT</Badge>;
      case "eliza": return <Badge variant="outline" className="text-[8px] h-4 px-1 border-fuchsia-500/50 text-fuchsia-400">Eliza</Badge>;
      default: return null;
    }
  };

  const hasTools = selectedServer?.tools && selectedServer.tools.length > 0;

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <div>
        <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
          SEARCH TOOLS
        </Label>
        <Input
          placeholder="Search connectors, plugins, MCPs..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSelectedServer(null);
          }}
          className="h-8 text-xs bg-background/50 border-sidebar-border"
        />
      </div>

      {/* Server/Plugin List */}
      <div>
        <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
          SELECT CONNECTOR
        </Label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading...
          </div>
        ) : servers.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            {searchQuery ? "No matches found" : "No tools available"}
          </div>
        ) : (
          <ScrollArea className="h-40">
            <div className="space-y-1 pr-2">
              {servers.map((server) => (
                <div
                  key={server.registryId}
                  role="button"
                  tabIndex={0}
                  draggable="true"
                  onClick={() => setSelectedServer(server)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedServer(server)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/compose-plugin", JSON.stringify(server));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`w-full text-left p-2 rounded-sm border transition-all group cursor-grab active:cursor-grabbing ${selectedServer?.registryId === server.registryId
                    ? "border-cyan-500/50 bg-cyan-500/10"
                    : "border-sidebar-border hover:border-cyan-500/30 hover:bg-background/50"
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <Plug className="w-3 h-3 text-cyan-400" />
                    <span className="font-mono text-xs truncate flex-1">{server.name}</span>
                    {/* Info button */}
                    <button
                      onClick={(e) => handleShowDetails(server, e)}
                      className="p-1 hover:bg-cyan-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="View details"
                    >
                      <Info className="w-3 h-3 text-muted-foreground hover:text-cyan-400" />
                    </button>
                    {getOriginBadge(server.origin)}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5 ml-5">
                    {server.description}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Selected Server Actions */}
      {selectedServer && (
        <div className="space-y-2">
          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-bold"
              onClick={handleQuickAdd}
            >
              <Plug className="w-4 h-4 mr-2" />
              Add
            </Button>
            {selectedServer.executable && (
              <Button
                variant="outline"
                onClick={() => {
                  setDetailServer(selectedServer);
                  setDetailOpen(true);
                }}
                className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              >
                <FlaskConical className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setDetailServer(selectedServer);
                setDetailOpen(true);
              }}
              className="border-cyan-500/30"
            >
              <Info className="w-4 h-4" />
            </Button>
          </div>

          {/* Tools from selected server */}
          {hasTools && (
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
                OR SELECT SPECIFIC TOOL ({selectedServer.tools!.length})
              </Label>
              <ScrollArea className="h-24">
                <div className="space-y-1 pr-2">
                  {selectedServer.tools!.map((tool) => (
                    <Button
                      key={tool.name}
                      variant="ghost"
                      className="w-full justify-start h-auto py-2 text-left hover:bg-cyan-500/10"
                      onClick={() => handleToolSelect(tool)}
                    >
                      <ChevronRight className="w-3 h-3 mr-2 text-cyan-400" />
                      <div className="flex-1 overflow-hidden">
                        <div className="font-mono text-xs truncate">{tool.name}</div>
                        {tool.description && (
                          <div className="text-[10px] text-muted-foreground truncate">{tool.description}</div>
                        )}
                      </div>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      )}

      {/* Detail Dialog */}
      <ConnectorDetailDialog
        server={detailServer}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onAdd={onSelect}
      />
    </div>
  );
}

// =============================================================================
// Connector Detail Dialog
// =============================================================================

function ConnectorDetailDialog({
  server,
  open,
  onOpenChange,
  onAdd,
}: {
  server: RegistryServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (connectorId: string, tool: ConnectorTool) => void;
}) {
  const { toast } = useToast();
  const [selectedTool, setSelectedTool] = useState<string>("");
  const [testArgs, setTestArgs] = useState("{}");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; content?: unknown; error?: string } | null>(null);
  const [dynamicTools, setDynamicTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [loadingTools, setLoadingTools] = useState(false);

  // Fetch tools dynamically for MCP servers that don't have pre-cached tools
  useEffect(() => {
    if (!server || !open) return;

    // Reset state when server changes
    setSelectedTool("");
    setTestResult(null);
    setDynamicTools([]);

    // Only fetch dynamically for MCP servers without pre-cached tools
    if (server.origin === "mcp" && (!server.tools || server.tools.length === 0)) {
      setLoadingTools(true);
      import("@/lib/services").then(({ fetchMcpServerTools }) => {
        fetchMcpServerTools(server.slug)
          .then((tools) => {
            setDynamicTools(tools);
            if (tools.length > 0) {
              setSelectedTool(tools[0].name);
            }
          })
          .catch((err) => {
            toast({
              title: "Failed to load tools",
              description: err.message,
              variant: "destructive",
            });
          })
          .finally(() => setLoadingTools(false));
      });
    }
  }, [server, open, toast]);

  if (!server) return null;

  // Use dynamic tools if available, otherwise use pre-cached tools
  const tools = dynamicTools.length > 0 ? dynamicTools : (server.tools || []);
  const hasTools = tools.length > 0;

  const getOriginStyle = () => {
    switch (server.origin) {
      case "goat": return { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400" };
      case "eliza": return { bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/30", text: "text-fuchsia-400" };
      default: return { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400" };
    }
  };

  const style = getOriginStyle();

  const handleTest = async () => {
    if (!selectedTool && !hasTools) return;

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(testArgs);
    } catch {
      toast({
        title: "Invalid JSON",
        description: "Please enter valid JSON for arguments",
        variant: "destructive",
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const toolName = selectedTool || tools[0]?.name || "execute";
      const result = await executeRegistryTool(
        server.registryId,
        server.origin,
        server.slug,
        toolName,
        args,
        undefined // connectorId removed since internal tools are hidden
      );

      setTestResult({
        success: result.success,
        content: result.result || result.content,
        error: result.error,
      });

      toast({
        title: result.success ? "Test Successful" : "Test Failed",
        description: result.success
          ? "The tool executed successfully"
          : result.error || "Unknown error",
        variant: result.success ? "default" : "destructive",
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, error: errorMsg });
      toast({
        title: "Test Error",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleAdd = () => {
    const toolName = selectedTool || (hasTools ? tools[0].name : "execute");
    const tool: ConnectorTool = {
      name: toolName,
      description: tools.find(t => t.name === toolName)?.description || `Execute ${server.name}`,
      inputSchema: { type: "object", properties: {} },
    };
    onAdd(server.registryId, tool);
    onOpenChange(false);
  };

  const copyResult = () => {
    if (testResult) {
      navigator.clipboard.writeText(JSON.stringify(testResult, null, 2));
      toast({ title: "Copied to clipboard" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-cyan-500/30">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center border ${style.bg} ${style.border}`}>
              {server.origin === "goat" ? (
                <Zap className={`w-5 h-5 ${style.text}`} />
              ) : server.origin === "eliza" ? (
                <Plug className={`w-5 h-5 ${style.text}`} />
              ) : (
                <Server className={`w-5 h-5 ${style.text}`} />
              )}
            </div>
            <div>
              <DialogTitle className="font-display text-lg">{server.name}</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {server.namespace}/{server.slug}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Description */}
          <p className="text-sm text-muted-foreground">{server.description}</p>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge className={`${style.bg} ${style.text}`}>
              {server.origin === "goat" ? "GOAT SDK" :
                server.origin === "eliza" ? "ElizaOS" : "MCP"}
            </Badge>
            {server.category && (
              <Badge variant="outline">{server.category}</Badge>
            )}
            {server.executable && (
              <Badge variant="outline" className="border-green-500/30 text-green-400">
                <FlaskConical className="w-3 h-3 mr-1" />
                Testable
              </Badge>
            )}
            {server.toolCount > 0 && (
              <Badge variant="outline" className="border-sidebar-border">
                <Wrench className="w-3 h-3 mr-1" />
                {server.toolCount} tools
              </Badge>
            )}
          </div>

          {/* Tags */}
          {server.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {server.tags.slice(0, 8).map((tag) => (
                <span key={tag} className="text-[10px] text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Tools List */}
          {hasTools && (
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-2 block">
                AVAILABLE TOOLS ({tools.length})
              </Label>
              <ScrollArea className="h-32">
                <div className="space-y-1 pr-2">
                  {tools.map((tool) => (
                    <button
                      key={tool.name}
                      onClick={() => setSelectedTool(tool.name)}
                      className={`w-full text-left p-2 rounded-sm border transition-all ${selectedTool === tool.name
                        ? "border-cyan-500/50 bg-cyan-500/10"
                        : "border-sidebar-border hover:border-cyan-500/30"
                        }`}
                    >
                      <div className="font-mono text-xs text-cyan-400">{tool.name}</div>
                      {tool.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{tool.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Test Section */}
          {server.executable && (
            <div className="space-y-2 p-3 rounded-sm bg-background/50 border border-sidebar-border">
              <Label className="text-xs font-mono text-muted-foreground">
                TEST ARGUMENTS (JSON)
              </Label>
              <Textarea
                value={testArgs}
                onChange={(e) => setTestArgs(e.target.value)}
                placeholder='{"key": "value"}'
                className="font-mono text-xs h-16 bg-background/50 border-sidebar-border"
              />

              {/* Test Result */}
              {testResult && (
                <div className={`p-2 rounded-sm border ${testResult.success
                  ? "bg-green-500/10 border-green-500/30"
                  : "bg-red-500/10 border-red-500/30"
                  }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold ${testResult.success ? "text-green-400" : "text-red-400"}`}>
                      {testResult.success ? "Success" : "Failed"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={copyResult} className="h-5 px-1">
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                  <pre className="text-[10px] font-mono overflow-auto max-h-20">
                    {JSON.stringify(testResult.content || testResult.error, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <DialogFooter className="gap-2 pt-4 border-t border-sidebar-border">
          {server.repoUrl && (
            <Button variant="outline" asChild>
              <a href={server.repoUrl} target="_blank" rel="noopener noreferrer">
                <Github className="w-4 h-4 mr-2" />
                Repository
              </a>
            </Button>
          )}
          {server.executable && (
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing}
              className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FlaskConical className="w-4 h-4 mr-2" />
              )}
              Test
            </Button>
          )}
          <Button
            onClick={handleAdd}
            className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold"
          >
            <Plug className="w-4 h-4 mr-2" />
            Add to Workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Agents Picker
// =============================================================================

function AgentsPicker({
  onSelect
}: {
  onSelect: (agent: Agent) => void
}) {
  const [selectedTag, setSelectedTag] = useState("all");
  const { data, isLoading: isLoadingExternal, error } = useAgents({
    tags: selectedTag !== "all" ? [selectedTag] : undefined,
    status: "active",
    limit: 20,
    sort: "interactions",
    direction: "desc",
  });

  // Fetch on-chain Manowar agents
  const { data: onchainAgents, isLoading: isLoadingOnchain } = useOnchainAgents();

  // Convert on-chain agents to unified format
  const manowarAgents = useMemo((): Agent[] => {
    if (!onchainAgents) return [];
    return onchainAgents.map((a): Agent => {
      const avatarUri = a.metadata?.image;
      let avatarUrl: string | null = null;
      if (avatarUri && avatarUri !== "none") {
        // Handle both IPFS URIs (ipfs://) and gateway URLs (https://)
        if (avatarUri.startsWith("ipfs://")) {
          avatarUrl = getIpfsUrl(avatarUri.replace("ipfs://", ""));
        } else if (avatarUri.startsWith("https://")) {
          avatarUrl = avatarUri;
        }
      }
      return {
        id: `manowar-${a.id}`,
        onchainAgentId: a.id, // Preserve numeric ID for price lookup
        address: a.creator,
        name: a.metadata?.name || `Agent #${a.id}`,
        description: a.metadata?.description || "",
        registry: "manowar" as AgentRegistryId,
        protocols: a.metadata?.protocols || [{ name: "Manowar", version: "1.0" }],
        avatarUrl,
        totalInteractions: 0,
        recentInteractions: 0,
        rating: 5.0,
        status: "active" as const,
        type: a.metadata?.endpoint ? "hosted" as const : "local" as const,
        featured: false,
        verified: true,
        category: "ai-agent",
        tags: a.metadata?.skills || [],
        owner: a.creator,
        pricePerRequest: a.licensePrice, // Store the license price from onchain data
        createdAt: a.metadata?.createdAt || new Date().toISOString(),
        updatedAt: a.metadata?.createdAt || new Date().toISOString(),
      };
    });
  }, [onchainAgents]);

  // Merge all agents
  const allAgents = useMemo(() => {
    const external = data?.agents || [];
    return [...manowarAgents, ...external];
  }, [data?.agents, manowarAgents]);

  const isLoading = isLoadingExternal || isLoadingOnchain;

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>(COMMON_TAGS);
    if (data?.tags) {
      data.tags.forEach(t => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }, [data?.tags]);

  return (
    <div className="space-y-4">
      {/* Filter by Tag */}
      <div>
        <Label className="text-xs font-mono text-muted-foreground mb-2 block">FILTER BY TAG</Label>
        <Select value={selectedTag} onValueChange={setSelectedTag}>
          <SelectTrigger className="w-full bg-background/50 border-sidebar-border text-sm">
            <Filter className="w-3 h-3 mr-2 text-muted-foreground" />
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tags</SelectItem>
            {availableTags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Agent List */}
      <div>
        <Label className="text-xs font-mono text-muted-foreground mb-2 block">
          SELECT AGENT {manowarAgents.length > 0 && `(${manowarAgents.length} on-chain)`}
        </Label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading agents...
          </div>
        ) : error ? (
          <div className="text-xs text-red-400 font-mono">
            Failed to load agents
          </div>
        ) : allAgents.length === 0 ? (
          <div className="text-sm text-muted-foreground">No agents found</div>
        ) : (
          <ScrollArea className="h-56">
            <div className="space-y-2 pr-2">
              {allAgents.map((agent) => (
                <AgentPickerCard key={agent.id} agent={agent} onSelect={onSelect} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Browse More Link */}
      <div className="pt-2 border-t border-sidebar-border">
        <Link href="/agents">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-fuchsia-400 hover:text-fuchsia-300 p-0 h-auto w-full justify-start"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            Browse all agents →
          </Button>
        </Link>
      </div>
    </div>
  );
}

function AgentPickerCard({
  agent,
  onSelect
}: {
  agent: Agent;
  onSelect: (a: Agent) => void
}) {
  const initials = agent.name
    .split(" ")
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isManowar = agent.registry === "manowar";

  // Resolve avatar URL - handle both IPFS URIs (ipfs://) and gateway URLs (https://)
  // Same pattern as my-assets.tsx and agent.tsx
  let resolvedAvatarUrl: string | null = null;
  if (agent.avatarUrl) {
    if (agent.avatarUrl.startsWith("ipfs://")) {
      resolvedAvatarUrl = getIpfsUrl(agent.avatarUrl.replace("ipfs://", ""));
    } else if (agent.avatarUrl.startsWith("https://")) {
      resolvedAvatarUrl = agent.avatarUrl;
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onClick={() => onSelect(agent)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(agent)}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/compose-agent", JSON.stringify(agent));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`w-full p-2 rounded-sm border bg-background/30 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 transition-all text-left group cursor-grab active:cursor-grabbing ${isManowar ? "border-cyan-500/30" : "border-sidebar-border"}`}
    >
      <div className="flex items-start gap-2">
        <Avatar className={`w-8 h-8 border group-hover:border-fuchsia-500/50 ${isManowar ? "border-cyan-500/50" : "border-sidebar-border"}`}>
          <AvatarImage src={resolvedAvatarUrl || undefined} alt={agent.name} />
          <AvatarFallback className={`font-mono text-[10px] ${isManowar ? "bg-cyan-500/10 text-cyan-400" : "bg-fuchsia-500/10 text-fuchsia-400"}`}>
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs font-medium truncate group-hover:text-fuchsia-400 transition-colors">
              {agent.name}
            </span>
            {isManowar && (
              <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
            )}
            {agent.verified && !isManowar && (
              <Shield className="w-3 h-3 text-green-400 shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {isManowar ? (
              <span className="text-cyan-400">on-chain</span>
            ) : (
              <>
                <span className="flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5 text-yellow-400" />
                  {agent.rating.toFixed(1)}
                </span>
                <span>{formatInteractions(agent.totalInteractions)} uses</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Trigger Picker (Smart NL-first input + structured fallback)
// =============================================================================

function TriggerPicker({
  onAdd
}: {
  onAdd: (trigger: Partial<TriggerDefinition>) => void
}) {
  const [nlInput, setNlInput] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<{
    success: boolean;
    cronExpression?: string;
    cronReadable?: string;
    error?: string;
  } | null>(null);

  // Parse the NL input when user stops typing
  const handleParse = async () => {
    if (!nlInput.trim()) return;

    setIsParsing(true);
    setParseResult(null);

    try {
      const result = await parseNLToCron(nlInput.trim(), getUserTimezone());
      setParseResult(result);
    } catch (error) {
      setParseResult({ success: false, error: String(error) });
    } finally {
      setIsParsing(false);
    }
  };

  const handleAdd = () => {
    if (parseResult?.success && parseResult.cronExpression) {
      onAdd({
        name: nlInput.substring(0, 50),
        type: "cron",
        nlDescription: nlInput,
        cronExpression: parseResult.cronExpression,
        cronReadable: parseResult.cronReadable,
        timezone: getUserTimezone(),
        enabled: true,
      });
      setNlInput("");
      setParseResult(null);
    }
  };

  const handleQuickAdd = (templateKey: string) => {
    const template = TRIGGER_TEMPLATES[templateKey];
    if (template) {
      onAdd({
        name: template.cronReadable,
        type: "cron",
        nlDescription: template.nlDescription,
        cronExpression: template.cronExpression,
        cronReadable: template.cronReadable,
        timezone: getUserTimezone(),
        enabled: true,
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* NL Input - Primary Interface */}
      <div>
        <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
          DESCRIBE YOUR SCHEDULE
        </Label>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. every day at 9am, every Monday..."
            value={nlInput}
            onChange={(e) => {
              setNlInput(e.target.value);
              setParseResult(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleParse()}
            className="h-8 text-xs bg-background/50 border-sidebar-border flex-1"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={handleParse}
            disabled={!nlInput.trim() || isParsing}
            className="h-8 px-3 text-xs"
          >
            {isParsing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Parse"}
          </Button>
        </div>
      </div>

      {/* Parse Result */}
      {parseResult && (
        <div className={`p-2 rounded-sm border text-xs ${parseResult.success
          ? "bg-green-500/10 border-green-500/30"
          : "bg-red-500/10 border-red-500/30"
          }`}>
          {parseResult.success ? (
            <div className="space-y-1">
              <div className="text-green-400 font-mono">{parseResult.cronReadable}</div>
              <code className="text-[10px] text-muted-foreground">{parseResult.cronExpression}</code>
              <Button
                size="sm"
                onClick={handleAdd}
                className="w-full mt-2 bg-amber-500 hover:bg-amber-600 text-black h-7 text-xs font-bold"
              >
                <Clock className="w-3 h-3 mr-1" />
                Add Trigger
              </Button>
            </div>
          ) : (
            <div className="text-red-400">{parseResult.error}</div>
          )}
        </div>
      )}

      {/* Quick Templates */}
      <div>
        <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
          QUICK ADD
        </Label>
        <div className="grid grid-cols-2 gap-1">
          {["every-hour", "daily-9am", "weekdays-9am", "weekly-monday-9am"].map((key) => {
            const template = TRIGGER_TEMPLATES[key];
            return (
              <button
                key={key}
                onClick={() => handleQuickAdd(key)}
                className="p-1.5 text-[10px] font-mono text-left rounded-sm border border-sidebar-border hover:border-amber-500/50 hover:bg-amber-500/5 transition-all"
              >
                {template.cronReadable}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Mint Manowar Dialog
// =============================================================================

interface MintManowarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  workflowDescription: string;
  agentIds: number[];
  agentPrices?: Map<number, bigint>; // Agent ID -> price in USDC wei (6 decimals)
}

function MintManowarDialog({
  open,
  onOpenChange,
  workflowName,
  workflowDescription,
  agentIds,
  agentPrices = new Map()
}: MintManowarDialogProps) {
  const { toast } = useToast();
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const { mutateAsync: sendTransaction } = useSendTransaction();

  const [title, setTitle] = useState(workflowName);
  const [description, setDescription] = useState(workflowDescription);
  const [x402Price, setX402Price] = useState("0.01");
  const [units, setUnits] = useState("");
  const [leaseEnabled, setLeaseEnabled] = useState(false);
  const [leaseDuration, setLeaseDuration] = useState("30");
  const [leasePercent, setLeasePercent] = useState("10");
  const [coordinatorModel, setCoordinatorModel] = useState("");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [isMinting, setIsMinting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Banner generation state
  const [isGeneratingBanner, setIsGeneratingBanner] = useState(false);
  const [generatedBannerUrl, setGeneratedBannerUrl] = useState<string | null>(null);
  const [bannerGenerationCount, setBannerGenerationCount] = useState(0);
  const MAX_BANNER_GENERATIONS = 3;

  // Calculate total agent price
  const totalAgentPrice = useMemo(() => {
    let total = BigInt(0);
    for (const agentId of agentIds) {
      const price = agentPrices.get(agentId) || BigInt(0);
      total += price;
    }
    return total;
  }, [agentIds, agentPrices]);

  const totalAgentPriceFormatted = weiToUsdc(totalAgentPrice);

  useEffect(() => {
    setTitle(workflowName);
    setDescription(workflowDescription);
  }, [workflowName, workflowDescription]);

  const handleBannerSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file type", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large (max 5MB)", variant: "destructive" });
      return;
    }
    setBannerFile(file);
    const dataUrl = await fileToDataUrl(file);
    setBannerPreview(dataUrl);
    // Clear generated banner state when user uploads their own
    setGeneratedBannerUrl(null);
  };

  // Handle AI banner generation
  const API_URL = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

  const handleGenerateBanner = async () => {
    // Check generation limit
    if (bannerGenerationCount >= MAX_BANNER_GENERATIONS) {
      toast({
        title: "Generation limit reached",
        description: `You can generate up to ${MAX_BANNER_GENERATIONS} banners per session. Upload your own image instead.`,
        variant: "destructive",
      });
      return;
    }

    console.log("[generate-banner] Form values:", { title, description });

    if (!title?.trim()) {
      toast({
        title: "Title required",
        description: "You should add Title + Description before generating a banner",
        variant: "destructive",
      });
      return;
    }

    if (!description?.trim()) {
      toast({
        title: "Description required",
        description: "You should add Title + Description before generating a banner",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingBanner(true);
    try {
      const response = await fetch(`${API_URL}/api/generate-banner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }

      const { imageUrl } = await response.json();

      // Convert base64 data URL to File object for IPFS upload
      const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], filename, { type: blob.type });
      };

      const bannerFileName = `${title.replace(/\s+/g, "_")}_banner.png`;
      const generatedFile = await dataUrlToFile(imageUrl, bannerFileName);

      setGeneratedBannerUrl(imageUrl);
      setBannerPreview(imageUrl);
      setBannerFile(generatedFile); // SET the file for IPFS upload on mint!
      setBannerGenerationCount(prev => prev + 1);

      toast({
        title: "Banner generated!",
        description: `Generation ${bannerGenerationCount + 1}/${MAX_BANNER_GENERATIONS}`,
      });
    } catch (error) {
      console.error("[generate-banner] Error:", error);
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingBanner(false);
    }
  };

  const handleAcceptBanner = () => {
    setGeneratedBannerUrl(null);
    toast({
      title: "Banner accepted",
      description: "Your AI-generated banner is ready to use",
    });
  };

  const handleRegenerateBanner = () => {
    handleGenerateBanner();
  };

  // Validate and show price confirmation popup
  const handleMintClick = () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (!wallet) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    if (!isPinataConfigured()) {
      toast({ title: "IPFS not configured", variant: "destructive" });
      return;
    }
    setShowConfirmDialog(true);
  };

  // Execute batched approval + mint transaction
  const handleConfirmMint = async () => {
    setShowConfirmDialog(false);

    try {
      setIsMinting(true);

      // 1. Upload banner if provided
      let bannerImageUri = "";
      if (bannerFile) {
        const bannerCid = await uploadManowarBanner(bannerFile, title);
        bannerImageUri = getIpfsUri(bannerCid);
      }

      // 2. Generate unique manowar DNA hash and wallet address
      // This is the SINGLE SOURCE OF TRUTH for manowar identification
      // Both frontend and backend will fetch this from IPFS metadata
      const mintTimestamp = Math.floor(Date.now() / 1000);
      const dnaHash = computeManowarDnaHash(agentIds, mintTimestamp);
      const walletAddress = deriveManowarWalletAddress(dnaHash, mintTimestamp);

      // 3. Fetch each agent's agentCard from IPFS and embed in manowarCard
      const agentFactoryContract = getAgentFactoryContract();
      const nestedAgentCards: AgentCard[] = [];

      for (const agentId of agentIds) {
        try {
          const agentData = await readContract({
            contract: agentFactoryContract,
            method: "function getAgentData(uint256 agentId) view returns ((bytes32 dnaHash, uint256 licenses, uint256 licensesMinted, uint256 licensePrice, address creator, bool cloneable, bool isClone, uint256 parentAgentId, string agentCardUri))",
            params: [BigInt(agentId)],
          }) as { agentCardUri: string };

          if (agentData.agentCardUri?.startsWith("ipfs://")) {
            const cid = agentData.agentCardUri.replace("ipfs://", "");
            const agentCard = await fetchFromIpfs<AgentCard>(cid);
            nestedAgentCards.push(agentCard);
          }
        } catch (err) {
          console.warn(`Failed to fetch agentCard for agent ${agentId}:`, err);
        }
      }

      // 4. Build and upload manowarCard metadata to IPFS
      const metadata: ManowarMetadata = {
        schemaVersion: "1.0.0",
        title,
        description,
        image: bannerImageUri ? getIpfsUrl(bannerImageUri.replace("ipfs://", "")) : undefined,
        dnaHash,
        walletAddress,
        walletTimestamp: mintTimestamp,
        agents: nestedAgentCards,
        coordinator: coordinatorModel ? { hasCoordinator: true, model: coordinatorModel } : undefined,
        pricing: {
          totalAgentPrice: totalAgentPrice.toString(),
        },
        lease: leaseEnabled ? {
          enabled: true,
          durationDays: parseInt(leaseDuration),
          creatorPercent: parseInt(leasePercent),
        } : undefined,
        creator: account?.address || "",
        createdAt: new Date().toISOString(),
      };

      const metadataCid = await uploadManowarMetadata(metadata);
      const manowarCardUri = getIpfsUri(metadataCid);

      // 5. Prepare USDC approval transaction (if agents have price)
      const manowarContract = getManowarContract();
      const usdcContract = getPaymentTokenContract();
      const manowarAddress = getContractAddress("Manowar");

      // 6. Prepare mint transaction with new params
      const mintTransaction = prepareContractCall({
        contract: manowarContract,
        method: "function mintManowar((string title, string description, string banner, string manowarCardUri, uint256 units, bool leaseEnabled, uint256 leaseDuration, uint8 leasePercent, bool hasCoordinator, string coordinatorModel) params, uint256[] agentIds) returns (uint256 manowarId)",
        params: [
          {
            title,
            description,
            banner: bannerImageUri, // Contract uses 'banner' field name
            manowarCardUri,
            units: units ? BigInt(parseInt(units)) : BigInt(1),
            leaseEnabled,
            leaseDuration: BigInt(parseInt(leaseDuration) || 0),
            leasePercent: parseInt(leasePercent) || 0,
            hasCoordinator: !!coordinatorModel,
            coordinatorModel: coordinatorModel || "",
          },
          agentIds.map(id => BigInt(id)),
        ],
      });

      // 5. If there's a cost, we need approval first
      if (totalAgentPrice > BigInt(0)) {
        const approvalTx = prepareContractCall({
          contract: usdcContract,
          method: "function approve(address spender, uint256 amount) returns (bool)",
          params: [manowarAddress, totalAgentPrice],
        });
        await sendTransaction(approvalTx);
      }

      // 6. Send mint transaction
      const result = await sendTransaction(mintTransaction);

      // 7. Handle success
      toast({
        title: "Manowar Minted!",
        description: (
          <div className="space-y-1">
            <p>{title} deployed to Avalanche Fuji.</p>
            {totalAgentPrice > BigInt(0) && (
              <p className="text-xs text-muted-foreground">
                ${totalAgentPriceFormatted} USDC paid to agent creators
              </p>
            )}
            <a
              href={`${CHAIN_CONFIG[CHAIN_IDS.avalancheFuji].explorer}/tx/${result.transactionHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline text-xs flex items-center gap-1"
            >
              View transaction <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ),
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Mint error:", error);
      toast({
        title: "Minting Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg md:max-w-2xl bg-card border-fuchsia-500/30 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-lg sm:text-xl flex items-center gap-2">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-fuchsia-400" />
              Mint as Manowar
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Deploy this workflow as an ERC-7401 nestable NFT on Avalanche Fuji
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            {/* Left Column */}
            <div className="space-y-4">
              {/* Banner Upload with AI Generation */}
              <div>
                <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground mb-2 block">BANNER IMAGE</Label>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBannerSelect}
                  className="hidden"
                />
                {/* Banner canvas with generate button overlay */}
                <div className="relative w-full">
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    className="w-full h-20 rounded-sm bg-background/50 border border-sidebar-border border-dashed flex items-center justify-center text-muted-foreground hover:border-fuchsia-500 hover:text-fuchsia-400 transition-colors overflow-hidden touch-manipulation"
                  >
                    {isGeneratingBanner ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                        <span className="text-xs font-mono text-fuchsia-400">GENERATING...</span>
                      </div>
                    ) : bannerPreview ? (
                      <img src={bannerPreview} alt="Banner" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        <span className="text-xs font-mono">Upload banner</span>
                      </div>
                    )}
                  </button>

                  {/* Generate button overlay (bottom-right corner) */}
                  {!isGeneratingBanner && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGenerateBanner();
                            }}
                            disabled={bannerGenerationCount >= MAX_BANNER_GENERATIONS}
                            className={`absolute bottom-1 right-1 w-8 h-8 rounded-full flex items-center justify-center transition-all ${bannerGenerationCount >= MAX_BANNER_GENERATIONS
                              ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                              : "bg-fuchsia-500/80 hover:bg-fuchsia-500 text-white shadow-lg hover:shadow-fuchsia-500/30"
                              }`}
                          >
                            <Sparkles className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {bannerGenerationCount >= MAX_BANNER_GENERATIONS
                            ? `Limit reached (${MAX_BANNER_GENERATIONS}/${MAX_BANNER_GENERATIONS})`
                            : `Generate Banner (${bannerGenerationCount}/${MAX_BANNER_GENERATIONS})`}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>

                {/* Accept/Regenerate controls for generated banners */}
                {generatedBannerUrl && !isGeneratingBanner && (
                  <div className="flex gap-2 justify-center mt-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAcceptBanner}
                            className="border-green-500/50 text-green-400 hover:bg-green-500/10 hover:text-green-300 h-7"
                          >
                            <Check className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Accept Banner</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleRegenerateBanner}
                            disabled={bannerGenerationCount >= MAX_BANNER_GENERATIONS}
                            className={`h-7 ${bannerGenerationCount >= MAX_BANNER_GENERATIONS
                              ? "border-muted text-muted-foreground cursor-not-allowed"
                              : "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                              }`}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {bannerGenerationCount >= MAX_BANNER_GENERATIONS
                            ? `Limit reached (${MAX_BANNER_GENERATIONS}/${MAX_BANNER_GENERATIONS})`
                            : `Regenerate (${bannerGenerationCount}/${MAX_BANNER_GENERATIONS})`}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>

              {/* Title */}
              <div className="space-y-1">
                <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground">TITLE</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My Workflow"
                  className="bg-background/50 font-mono border-sidebar-border h-9"
                />
              </div>

              {/* Description */}
              <div className="space-y-1">
                <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground">DESCRIPTION</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this workflow do?"
                  className="bg-background/50 font-mono border-sidebar-border resize-none h-16"
                  rows={2}
                />
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">

              {/* Pricing */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> X402 PRICE (USDC)
                  </Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={x402Price}
                    onChange={(e) => setX402Price(e.target.value)}
                    className="bg-background/50 font-mono border-sidebar-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">SUPPLY CAP</Label>
                  <Input
                    type="number"
                    min="1"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder="1 (default)"
                    className="bg-background/50 font-mono border-sidebar-border"
                  />
                </div>
              </div>

              {/* Coordinator */}
              <div className="space-y-2">
                <Label className="text-xs font-mono text-muted-foreground">COORDINATOR MODEL (optional)</Label>
                <Select value={coordinatorModel || "none"} onValueChange={(v) => setCoordinatorModel(v === "none" ? "" : v)}>
                  <SelectTrigger className="bg-background/50 border-sidebar-border">
                    <SelectValue placeholder="No coordinator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No coordinator</SelectItem>
                    {coordinatorModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                          <span>{model.name}</span>
                          <span className="text-[10px] text-muted-foreground">({model.provider})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Supervisor agent to coordinate workflow steps
                </p>
              </div>

              {/* Lease Toggle */}
              <div className="flex items-center justify-between p-3 rounded-sm border border-sidebar-border bg-background/30">
                <div className="space-y-0.5">
                  <Label className="text-sm font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Enable Leasing
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Allow others to lease this workflow
                  </p>
                </div>
                <Switch checked={leaseEnabled} onCheckedChange={setLeaseEnabled} />
              </div>

              {leaseEnabled && (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 pl-3 sm:pl-4 border-l-2 border-fuchsia-500/30">
                  <div className="space-y-2">
                    <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground">DURATION (days)</Label>
                    <Input
                      type="number"
                      value={leaseDuration}
                      onChange={(e) => setLeaseDuration(e.target.value)}
                      className="bg-background/50 font-mono border-sidebar-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground">YOUR % (max 20)</Label>
                    <Input
                      type="number"
                      max={20}
                      value={leasePercent}
                      onChange={(e) => setLeasePercent(e.target.value)}
                      className="bg-background/50 font-mono border-sidebar-border"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Account status - full width */}
          <div className="py-2">
            {!wallet && (
              <div className="flex items-center gap-2 p-2 rounded-sm bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-xs">
                <AlertCircle className="w-3 h-3" />
                Connect wallet to mint (gas sponsored)
              </div>
            )}
            {wallet && account && (
              <div className="flex items-center gap-2 p-2 rounded-sm bg-green-500/10 border border-green-500/30 text-green-200 text-xs">
                <CheckCircle2 className="w-3 h-3" />
                <span className="font-mono">{account.address.slice(0, 6)}...{account.address.slice(-4)}</span>
                <span className="text-green-300/70">• Gas sponsored</span>
              </div>
            )}
          </div>

          {/* Agent Cost Preview */}
          {agentIds.length > 0 && (
            <div className="p-3 rounded-sm border border-sidebar-border bg-background/30">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {agentIds.length} agent{agentIds.length > 1 ? "s" : ""} • Total cost:
                </span>
                <span className="font-mono text-cyan-400 font-semibold">
                  ${totalAgentPriceFormatted} USDC
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMinting}>
              Cancel
            </Button>
            <Button
              onClick={handleMintClick}
              disabled={!wallet || isMinting}
              className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold"
            >
              {isMinting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Minting...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Mint Manowar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Simple Price Confirmation Popup */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="bg-card border-cyan-500/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-cyan-400" />
              Confirm Minting Cost
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center py-2 border-b border-sidebar-border">
                  <span>Agents included:</span>
                  <span className="font-mono">{agentIds.length}</span>
                </div>
                <div className="flex justify-between items-center text-lg font-semibold">
                  <span>Total Cost:</span>
                  <span className="text-cyan-400 font-mono">${totalAgentPriceFormatted} USDC</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {Number(totalAgentPriceFormatted) > 0
                    ? "This amount will be distributed to agent creators. Gas is sponsored."
                    : "No USDC cost for this manowar. Gas is sponsored."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmMint}
              className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Confirm & Mint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


// =============================================================================
// Run Workflow Dialog - Capture user prompt for LangGraph supervisor
// =============================================================================

interface RunWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  stepCount: number;
  isRunning: boolean;
  onRun: (prompt: string) => void;
}

function RunWorkflowDialog({
  open,
  onOpenChange,
  workflowName,
  stepCount,
  isRunning,
  onRun,
}: RunWorkflowDialogProps) {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = () => {
    if (prompt.trim()) {
      onRun(prompt.trim());
      setPrompt("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-green-500/30 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Play className="w-5 h-5 text-green-400" />
            Run {workflowName || "Workflow"}
          </DialogTitle>
          <DialogDescription>
            Enter a task or prompt for the workflow coordinator to execute.
            The AI supervisor will decompose your request and delegate to the {stepCount} agent{stepCount !== 1 ? "s" : ""} in this workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">TASK / PROMPT</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Research the top 5 AI tokens by market cap and generate a summary report..."
              className="bg-background/50 font-mono border-sidebar-border resize-none text-sm"
              rows={4}
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Be specific about what you want the workflow to accomplish.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRunning}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!prompt.trim() || isRunning}
            className="bg-green-500 hover:bg-green-600 text-white font-bold"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Execute Workflow
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// =============================================================================
// Floating Toolbox for Fullscreen Mode
// =============================================================================

interface FloatingToolboxProps {
  onClose: () => void;
  onAddStep: (connectorId: string, tool: ConnectorTool) => void;
  onAddAgentStep: (agent: Agent) => void;
  onRun: () => void;
  onRequest: () => void;
  onMint: () => void;
  onSettings: () => void;
  isRunning: boolean;
  nodeCount: number;
}

function FloatingToolbox({
  onClose,
  onAddStep,
  onAddAgentStep,
  onRun,
  onRequest,
  onMint,
  onSettings,
  isRunning,
  nodeCount,
}: FloatingToolboxProps) {
  // Initialize position accounting for sidebar on desktop (sidebar is 256px = 16rem when expanded, 64px when collapsed)
  // On mobile, start near top-left with padding
  const getInitialPosition = () => {
    if (typeof window === 'undefined') return { x: 280, y: 80 };
    const isMobile = window.innerWidth < 768;
    return isMobile
      ? { x: 16, y: 70 } // Mobile: padding from edges
      : { x: 280, y: 100 }; // Desktop: past sidebar width + padding
  };

  const [position, setPosition] = useState(getInitialPosition);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const toolboxRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag from the header
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;

    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    e.preventDefault();
  };

  // Touch event handlers for mobile drag support
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
    const touch = e.touches[0];
    setIsDragging(true);
    setDragOffset({
      x: touch.clientX - position.x,
      y: touch.clientY - position.y,
    });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Constrain to viewport with padding
      const toolboxWidth = 288; // w-72 = 18rem = 288px
      const toolboxMinHeight = 100;
      const padding = 16;
      const newX = Math.max(padding, Math.min(window.innerWidth - toolboxWidth - padding, e.clientX - dragOffset.x));
      const newY = Math.max(padding, Math.min(window.innerHeight - toolboxMinHeight - padding, e.clientY - dragOffset.y));
      setPosition({ x: newX, y: newY });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const toolboxWidth = 288;
      const toolboxMinHeight = 100;
      const padding = 16;
      const newX = Math.max(padding, Math.min(window.innerWidth - toolboxWidth - padding, touch.clientX - dragOffset.x));
      const newY = Math.max(padding, Math.min(window.innerHeight - toolboxMinHeight - padding, touch.clientY - dragOffset.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, dragOffset]);

  return (
    <div
      ref={toolboxRef}
      className="fixed z-50 w-[calc(100vw-32px)] sm:w-72 max-w-72 bg-card/95 backdrop-blur-xl border border-cyan-500/30 rounded-lg shadow-2xl overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'auto',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Draggable Header */}
      <div
        data-drag-handle
        className="flex items-center justify-between px-3 py-2 bg-sidebar-accent border-b border-sidebar-border cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
          </div>
          <span className="text-xs font-mono font-bold text-cyan-400">TOOLBOX</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1 border-cyan-500/30 text-cyan-400 font-mono">
            {nodeCount} steps
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettings}
            className="h-6 w-6 text-muted-foreground hover:text-cyan-400"
            title="Workflow Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            {isMinimized ? <ChevronRight className="w-3.5 h-3.5 rotate-90" /> : <ChevronRight className="w-3.5 h-3.5 -rotate-90" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-6 w-6 text-muted-foreground hover:text-cyan-400"
            title="Exit fullscreen (ESC)"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Collapsible Body */}
      {!isMinimized && (
        <div className="flex flex-col p-3 gap-3">
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onRun}
              disabled={isRunning || nodeCount === 0}
              className="bg-green-500 text-white hover:bg-green-600 font-bold font-mono text-xs h-8 flex-1"
            >
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-1.5" />
              )}
              {isRunning ? "RUNNING" : "RUN"}
            </Button>
            <Button
              onClick={onRequest}
              variant="outline"
              className="border-fuchsia-500/30 hover:border-fuchsia-500 hover:bg-fuchsia-500/10 text-xs h-8"
            >
              <Bot className="w-3.5 h-3.5 mr-1.5" />
              REQUEST
            </Button>
          </div>

          {/* Compact Pickers - no outer scroll, only internal content scrolls */}
          <div className="border-t border-sidebar-border pt-3">
            <Tabs defaultValue="connectors" className="w-full">
              <TabsList className="w-full h-8 rounded-sm bg-sidebar-accent border border-sidebar-border">
                <TabsTrigger
                  value="connectors"
                  className="flex-1 text-[10px] h-6 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 rounded-sm"
                >
                  <Plug className="w-3 h-3 mr-1" />
                  PLUGINS
                </TabsTrigger>
                <TabsTrigger
                  value="agents"
                  className="flex-1 text-[10px] h-6 data-[state=active]:bg-fuchsia-500/20 data-[state=active]:text-fuchsia-400 rounded-sm"
                >
                  <Bot className="w-3 h-3 mr-1" />
                  AGENTS
                </TabsTrigger>
                <TabsTrigger
                  value="triggers"
                  className="flex-1 text-[10px] h-6 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 rounded-sm"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  TRIGGERS
                </TabsTrigger>
              </TabsList>
              <TabsContent value="connectors" className="mt-2 h-40 overflow-y-auto">
                <ConnectorPicker onSelect={onAddStep} />
              </TabsContent>
              <TabsContent value="agents" className="mt-2 h-40 overflow-y-auto">
                <AgentsPicker onSelect={onAddAgentStep} />
              </TabsContent>
              <TabsContent value="triggers" className="mt-2 h-40 overflow-y-auto">
                <TriggerPicker onAdd={(trigger) => {
                  // Add trigger node to the workflow
                  console.log("[compose] Add trigger:", trigger);
                  // TODO: onAddTrigger callback
                }} />
              </TabsContent>
            </Tabs>
          </div>

          {/* MINT Button - at the bottom */}
          <Button
            onClick={onMint}
            disabled={nodeCount === 0}
            className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white hover:from-cyan-400 hover:to-fuchsia-400 font-bold font-mono text-xs h-9 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            MINT AS NFT
          </Button>
        </div>
      )}
    </div>
  );
}


// =============================================================================
// Fullscreen Canvas Overlay
// =============================================================================

interface FullscreenOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  onAddStep: (connectorId: string, tool: ConnectorTool) => void;
  onAddAgentStep: (agent: Agent) => void;
  onRun: () => void;
  onRequest: () => void;
  onMint: () => void;
  onSettings: () => void;
  isRunning: boolean;
  nodeCount: number;
}

function FullscreenOverlay({
  isOpen,
  onClose,
  children,
  onAddStep,
  onAddAgentStep,
  onRun,
  onRequest,
  onMint,
  onSettings,
  isRunning,
  nodeCount,
}: FullscreenOverlayProps) {
  // Handle ESC key to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0 bg-background/85 backdrop-blur-xl transition-opacity duration-300"
        style={{
          background: "linear-gradient(145deg, hsl(222 47% 3% / 0.92), hsl(270 60% 10% / 0.88))"
        }}
      />

      {/* Content container */}
      <div className="relative w-full h-full p-6 animate-in zoom-in-95 fade-in duration-300">
        {/* Header badge (top right) */}
        <div className="absolute top-4 right-4 z-10">
          <Badge variant="outline" className="font-mono border-cyan-500/30 text-cyan-400">
            FULLSCREEN MODE • Press ESC to exit
          </Badge>
        </div>

        {/* Fullscreen canvas container */}
        <div className="w-full h-full rounded-sm border border-cyan-500/30 overflow-hidden bg-black/60 shadow-2xl neon-border">
          {children}
        </div>

        {/* Floating Toolbox */}
        <FloatingToolbox
          onClose={onClose}
          onAddStep={onAddStep}
          onAddAgentStep={onAddAgentStep}
          onRun={onRun}
          onRequest={onRequest}
          onMint={onMint}
          onSettings={onSettings}
          isRunning={isRunning}
          nodeCount={nodeCount}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

let nodeId = 0;
const getNodeId = () => `step_${nodeId++}`;


function ComposeFlow() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // Store ReactFlow instance in ref (not state) to avoid re-renders
  const reactFlowInstanceRef = useRef<any>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Workflow state
  const { workflow, addStep, setMetadata } = useWorkflowBuilder();
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [inputJson, setInputJson] = useState("{}");

  // Manowar minting
  const [showMintDialog, setShowMintDialog] = useState(false);

  // Warp dialog state
  const [showWarpDialog, setShowWarpDialog] = useState(false);
  const [pendingWarpAgent, setPendingWarpAgent] = useState<Agent | null>(null);

  // Fullscreen canvas state
  // Start in expanded/fullscreen mode by default for better UX
  const [isFullscreen, setIsFullscreen] = useState(true);

  // Settings sheet state (controlled to work from fullscreen)
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);

  // Run workflow dialog state
  const [showRunDialog, setShowRunDialog] = useState(false);

  // Workflow output panel state
  const [workflowResult, setWorkflowResult] = useState<WorkflowExecutionResult | null>(null);
  const [showOutputPanel, setShowOutputPanel] = useState(false);

  // RFA dialog state
  const [showRFADialog, setShowRFADialog] = useState(false);
  const [pendingManowarId, setPendingManowarId] = useState<number | null>(null);

  // x402 Payment state
  const wallet = useActiveWallet();
  const { sessionActive, budgetRemaining } = useSession();

  // Fetch onchain agents for prices
  const { data: onchainAgents } = useOnchainAgents();

  // Precompute onchain agent prices map for O(1) lookups (Fix 6)
  const onchainPriceById = useMemo(() => {
    const m = new Map<number, bigint>();
    for (const a of onchainAgents ?? []) {
      m.set(a.id, BigInt(Math.floor(parseFloat(a.licensePrice) * 1_000_000)));
    }
    return m;
  }, [onchainAgents]);

  // Memoized onInit callback for ReactFlow (Fix 5)
  const onInit = useCallback((instance: any) => {
    reactFlowInstanceRef.current = instance;
  }, []);

  // Extract agent IDs and prices from workflow nodes
  const { workflowAgentIds, agentPrices } = useMemo(() => {
    const ids: number[] = [];
    const prices = new Map<number, bigint>();

    nodes.forEach((node) => {
      if (node.type === "agentNode") {
        const nodeData = node.data as AgentNodeData & { step: WorkflowStep };
        const agent = nodeData.agent;

        // For manowar native agents, use the preserved onchainAgentId
        // For warped external agents, use warpedAgentId
        let agentId: number | null = null;

        if (agent.registry === "manowar") {
          // Manowar native agent - use the preserved numeric ID
          agentId = agent.onchainAgentId || null;

          // Fallback: parse from prefixed id ("manowar-123")
          if (!agentId && agent.id.startsWith("manowar-")) {
            agentId = parseInt(agent.id.replace("manowar-", "")) || null;
          }
        } else if (agent.warpedAgentId) {
          // External agent that has been warped - use warped ID
          agentId = agent.warpedAgentId;
        }

        if (agentId && agentId > 0) {
          ids.push(agentId);

          // Get price from precomputed map for O(1) lookup
          if (agent.pricePerRequest) {
            const priceWei = BigInt(Math.floor(parseFloat(agent.pricePerRequest) * 1_000_000));
            prices.set(agentId, priceWei);
          } else {
            const cachedPrice = onchainPriceById.get(agentId);
            if (cachedPrice) {
              prices.set(agentId, cachedPrice);
            }
          }
        }
      }
    });

    return { workflowAgentIds: ids, agentPrices: prices };
  }, [nodes, onchainPriceById]);


  // Execution state
  const { execute, isRunning, logs, result, error: execError, reset: resetExecution } = useWorkflowExecution();

  // Build workflow from nodes
  const currentWorkflow = useMemo(() => {
    const steps: WorkflowStep[] = nodes.map((node) => ({
      ...(node.data as StepNodeData).step,
      id: node.id,
    }));

    return {
      id: workflow.id,
      name: workflowName || "Untitled Workflow",
      description: workflowDescription,
      steps,
    };
  }, [nodes, workflow.id, workflowName, workflowDescription]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      animated: true,
      style: { stroke: 'hsl(188 95% 43%)', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(188 95% 43%)' }
    }, eds)),
    [setEdges],
  );

  // Memoized onDrop handler (Fix 4 - avoids recreating on each render)
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const rf = reactFlowInstanceRef.current;
    if (!rf) return;

    const pluginData = e.dataTransfer.getData("application/compose-plugin");
    const agentData = e.dataTransfer.getData("application/compose-agent");
    const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (pluginData) {
      const server = JSON.parse(pluginData);
      const id = getNodeId();
      const step: WorkflowStep = {
        id,
        name: server.name,
        type: "connectorTool",
        connectorId: server.registryId,
        toolName: "execute",
        inputTemplate: {},
        saveAs: `steps.${server.slug || server.name.toLowerCase().replace(/\s+/g, "_")}`,
      };
      const newNode: Node = {
        id,
        type: "stepNode",
        position,
        data: { step, status: "pending" } as StepNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
      toast({ title: "Plugin Added", description: `Added "${server.name}" to canvas` });
    } else if (agentData) {
      const agent = JSON.parse(agentData);
      const id = getNodeId();
      const step: WorkflowStep = {
        id,
        name: agent.name,
        type: "connectorTool",
        connectorId: agent.registry,
        toolName: agent.protocols?.[0]?.name || "default",
        inputTemplate: { agentAddress: agent.address },
        saveAs: `steps.${agent.name.toLowerCase().replace(/\s+/g, "_")}`,
      };
      const newNode: Node = {
        id,
        type: "agentNode",
        position,
        data: { agent, step, status: "pending" } as AgentNodeData & { step: WorkflowStep },
      };
      setNodes((nds) => [...nds, newNode]);
      toast({ title: "Agent Added", description: `Added "${agent.name}" to canvas` });
    }
  }, [setNodes, toast]);

  // Memoized onDragOver handler (Fix 4)
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // Keyboard shortcuts for compose canvas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if ((e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA") return;

      // Delete/Backspace - remove selected nodes
      if (e.key === "Delete" || e.key === "Backspace") {
        const selectedNodes = nodes.filter(n => n.selected);
        if (selectedNodes.length > 0) {
          e.preventDefault();
          setNodes(nds => nds.filter(n => !n.selected));
          setEdges(eds => eds.filter(e =>
            !selectedNodes.some(n => n.id === e.source || n.id === e.target)
          ));
          toast({
            title: "Deleted",
            description: `Removed ${selectedNodes.length} step${selectedNodes.length > 1 ? "s" : ""}`
          });
        }
      }

      // Cmd/Ctrl+K - focus on search (find the input in the connector picker)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector('[placeholder*="Search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodes, setNodes, setEdges, toast]);


  // Add step from connector picker
  const handleAddStep = useCallback((connectorId: string, tool: ConnectorTool) => {
    const id = getNodeId();
    const step: WorkflowStep = {
      id,
      name: tool.name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
      type: "connectorTool",
      connectorId,
      toolName: tool.name,
      inputTemplate: {},
      saveAs: `steps.${tool.name}`,
    };

    // Horizontal flow: position nodes left-to-right
    const newNode: Node = {
      id,
      type: "stepNode",
      position: { x: nodes.length * 320 + 100, y: 150 },
      data: { step, status: "pending" } as StepNodeData,
    };

    setNodes((nds) => [...nds, newNode]);

    toast({
      title: "Step Added",
      description: `Added "${step.name}" to workflow`,
    });
  }, [nodes.length, setNodes, toast]);

  // Check if external agent has been warped
  const checkExternalWarpStatus = useCallback(async (registry: string, address: string): Promise<boolean> => {
    try {
      const externalHash = computeExternalAgentHash(registry, address);
      const warpContract = getWarpContract();
      const warpedId = await readContract({
        contract: warpContract,
        method: "function getWarpedAgentId(bytes32 externalHash) view returns (uint256)",
        params: [externalHash],
      });
      return Number(warpedId) > 0;
    } catch (error) {
      console.error("Failed to check warp status:", error);
      return false;
    }
  }, []);

  // Add step from agent registry (with warp check)
  const handleAddAgentStep = useCallback(async (agent: Agent) => {
    const isManowar = agent.registry === "manowar";

    // External agents need to be warped first
    if (!isManowar) {
      const isWarped = await checkExternalWarpStatus(agent.registry, agent.address);
      if (!isWarped) {
        // Show warp dialog instead of adding
        setPendingWarpAgent(agent);
        setShowWarpDialog(true);
        return;
      }
    }

    // Agent is native (manowar) or already warped - add to workflow
    const id = getNodeId();
    const protocolName = agent.protocols?.[0]?.name || "default";
    const step: WorkflowStep = {
      id,
      name: agent.name,
      type: "connectorTool",
      connectorId: agent.registry,
      toolName: protocolName,
      inputTemplate: { agentAddress: agent.address },
      saveAs: `steps.${agent.name.toLowerCase().replace(/\s+/g, "_")}`,
    };

    // Use new agentNode type for agents
    const newNode: Node = {
      id,
      type: "agentNode",
      position: { x: nodes.length * 320 + 100, y: 150 },
      data: { agent, step, status: "pending" } as AgentNodeData & { step: WorkflowStep },
    };

    setNodes((nds) => [...nds, newNode]);

    const registryName = AGENT_REGISTRIES[agent.registry]?.name || agent.registry;
    toast({
      title: "Agent Added",
      description: `Added "${agent.name}" from ${registryName}`,
    });
  }, [nodes.length, setNodes, toast, checkExternalWarpStatus]);

  // Handle warp navigation
  const handleWarpAgent = useCallback(() => {
    if (pendingWarpAgent) {
      sessionStorage.setItem("warpAgent", JSON.stringify(pendingWarpAgent));
      setLocation("/create-agent?warp=true");
    }
    setShowWarpDialog(false);
    setPendingWarpAgent(null);
  }, [pendingWarpAgent, setLocation]);

  // Check for agent selection from Agents page on mount
  useEffect(() => {
    const stored = sessionStorage.getItem("selectedAgent");
    if (stored) {
      try {
        const agentData = JSON.parse(stored);
        // Create a minimal agent object for the handler
        handleAddAgentStep({
          id: agentData.id || agentData.address,
          address: agentData.address,
          name: agentData.name,
          description: agentData.description || "",
          registry: agentData.registry || "agentverse",
          protocols: agentData.protocols || [],
          avatarUrl: agentData.avatarUrl,
          totalInteractions: 0,
          recentInteractions: 0,
          rating: 0,
          status: "active",
          type: "hosted",
          featured: false,
          verified: false,
          category: agentData.category || "",
          tags: agentData.tags || [],
          owner: "",
          createdAt: "",
          updatedAt: "",
        });
        sessionStorage.removeItem("selectedAgent");
      } catch {
        // Ignore parse errors
      }
    }
  }, [handleAddAgentStep]);

  // Run workflow with x402 payment via Manowar backend
  const handleRun = useCallback(async (userPrompt: string) => {
    if (currentWorkflow.steps.length === 0) {
      toast({
        title: "No Steps",
        description: "Add at least one step to run the workflow",
        variant: "destructive",
      });
      return;
    }

    // Require wallet connection for x402 payment
    if (!wallet) {
      toast({
        title: "Connect Wallet",
        description: "Please connect your wallet to run workflows (x402 payment required)",
        variant: "destructive",
      });
      return;
    }

    // Close the dialog
    setShowRunDialog(false);

    // Build input with user's prompt as the task for LangGraph supervisor
    let additionalInput: Record<string, unknown> = {};
    try {
      additionalInput = JSON.parse(inputJson || "{}");
    } catch {
      // Ignore JSON parse errors for additional input
    }
    const input: Record<string, unknown> = {
      task: userPrompt,
      prompt: userPrompt, // Alias for compatibility
      message: userPrompt, // Alias for compatibility
      ...additionalInput,
    };

    // Reset node statuses
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...(n.data as StepNodeData), status: "pending", error: undefined } as StepNodeData,
    })));

    try {
      // Mark first step as running
      setNodes((nds) => {
        const updated = [...nds];
        if (updated[0]) {
          updated[0] = { ...updated[0], data: { ...(updated[0].data as StepNodeData), status: "running" } as StepNodeData };
        }
        return updated;
      });

      // x402 payment wrapper - wraps fetch to add payment headers
      const normalizedFetch = createNormalizedFetch();
      const fetchWithPayment = wrapFetchWithPayment(
        normalizedFetch,
        thirdwebClient,
        wallet,
        { maxValue: BigInt(10000 + (5000 * currentWorkflow.steps.length)) } // $0.01 + $0.005 per step
      );

      // Build workflow payload for manowar backend
      // Build from nodes which have full data (including agent info)
      const workflowPayload = {
        workflow: {
          id: currentWorkflow.id,
          name: currentWorkflow.name || "Untitled",
          description: currentWorkflow.description || "",
          steps: nodes.map((node) => {
            const nodeData = node.data as StepNodeData | (AgentNodeData & { step: WorkflowStep });
            const step = nodeData.step;
            // Properly type the agent - it's from AgentNodeData which has agent: Agent type
            const agent = "agent" in nodeData ? (nodeData as AgentNodeData).agent : undefined;

            // Determine step type from node type and data
            const isAgent = node.type === "agentNode" && agent;
            const stepType = isAgent ? "agent" : "mcpTool";

            return {
              id: step.id,
              name: step.name || step.connectorId || "Step",
              type: stepType,
              connectorId: step.connectorId,
              toolName: step.toolName,
              // For agents, pass numeric agentId and wallet address
              // Backend schema expects agentId as number, agentAddress as string
              agentId: isAgent && agent?.onchainAgentId ? agent.onchainAgentId : undefined,
              agentAddress: isAgent ? (step.inputTemplate?.agentAddress as string) : undefined,
              inputTemplate: step.inputTemplate || {},
              saveAs: step.saveAs || `step_${step.id}`,
            };
          }),
          // Include edges for execution order/dependencies
          edges: edges.map(e => ({
            source: e.source,
            target: e.target,
            label: e.label,
          })),
        },
        input,
      };

      // Add session headers if session is active
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionActive && budgetRemaining > 0) {
        headers["x-session-active"] = "true";
        headers["x-session-budget-remaining"] = budgetRemaining.toString();
      }

      // Execute workflow via Manowar backend with x402 payment
      const response = await fetchWithPayment("https://manowar.compose.market/manowar/execute", {
        method: "POST",
        headers,
        body: JSON.stringify(workflowPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Workflow execution failed: ${errorText}`);
      }

      const result = await response.json() as {
        success: boolean;
        workflowId: string;
        status: string;
        steps: Array<{ stepId: string; stepName: string; status: string; error?: string }>;
        output: Record<string, unknown>;
        totalCostWei: string;
        error?: string;
      };

      // Update node statuses based on response
      setNodes((nds) => nds.map((n) => {
        const stepResult = result.steps.find((s) => s.stepId === n.id);
        return {
          ...n,
          data: {
            ...(n.data as StepNodeData),
            status: stepResult?.status || "pending",
            error: stepResult?.error,
          } as StepNodeData,
        };
      }));

      // Store result and show output panel (cast steps status to proper union type)
      setWorkflowResult({
        ...result,
        steps: result.steps.map(s => ({
          ...s,
          status: s.status as "pending" | "running" | "success" | "error"
        }))
      });
      setShowOutputPanel(true);

      toast({
        title: result.success ? "Workflow Complete" : "Workflow Failed",
        description: result.success
          ? `Executed ${result.steps.length} steps. Cost: $${(parseInt(result.totalCostWei) / 1_000_000).toFixed(4)}`
          : `Failed: ${result.error || "Unknown error"}`,
        variant: result.success ? "default" : "destructive",
      });
    } catch (err) {
      toast({
        title: "Execution Error",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }, [currentWorkflow, inputJson, nodes, setNodes, toast, wallet, sessionActive, budgetRemaining]);

  return (
    <div className="min-h-[calc(100vh-120px)] lg:h-[calc(100vh-100px)] flex flex-col lg:flex-row gap-3 lg:gap-4 pb-4">
      {/* Sidebar - Picker Tabs */}
      <Card className="w-full lg:w-80 h-auto max-h-[40vh] lg:max-h-none lg:h-full flex flex-col glass-panel border-cyan-500/20 shrink-0 overflow-hidden">
        <CardHeader className="pb-2 border-b border-sidebar-border shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base lg:text-lg font-display font-bold text-cyan-400">ADD STEPS</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 min-h-0">
          <Tabs defaultValue="connectors" className="h-full flex flex-col">
            <TabsList className="w-full rounded-none border-b border-sidebar-border bg-transparent p-0 h-auto shrink-0">
              <TabsTrigger
                value="connectors"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent data-[state=active]:text-cyan-400 py-2.5 font-mono text-xs touch-manipulation"
              >
                <Plug className="w-3 h-3 mr-1.5" />
                PLUGINS
              </TabsTrigger>
              <TabsTrigger
                value="agents"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-fuchsia-500 data-[state=active]:bg-transparent data-[state=active]:text-fuchsia-400 py-2.5 font-mono text-xs touch-manipulation"
              >
                <Bot className="w-3 h-3 mr-1.5" />
                AGENTS
              </TabsTrigger>
            </TabsList>
            <TabsContent value="connectors" className="flex-1 overflow-y-auto p-3 mt-0 min-h-0">
              <ConnectorPicker onSelect={handleAddStep} />
            </TabsContent>
            <TabsContent value="agents" className="flex-1 overflow-y-auto p-3 mt-0 min-h-0">
              <AgentsPicker onSelect={handleAddAgentStep} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Canvas Area with Bottom Action Bar */}
      <div className="flex-1 min-h-[50vh] lg:min-h-0 lg:h-full flex flex-col">
        {/* Main Canvas */}
        <div className="flex-1 relative rounded-t-sm border border-cyan-500/20 overflow-hidden shadow-2xl bg-black/40 min-h-[300px]">
          {/* Toolbar - responsive positioning */}
          <div className="absolute top-2 right-2 lg:top-4 lg:right-4 z-10 flex flex-wrap gap-1.5 lg:gap-2">
            {/* Run Button - opens dialog to capture prompt */}
            <Button
              onClick={() => setShowRunDialog(true)}
              disabled={isRunning || nodes.length === 0}
              className="bg-green-500 text-white hover:bg-green-600 font-bold font-mono shadow-lg text-xs lg:text-sm h-8 lg:h-9 px-2.5 lg:px-4"
            >
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 lg:w-4 lg:h-4 mr-1.5 lg:mr-2 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 lg:w-4 lg:h-4 mr-1.5 lg:mr-2" />
              )}
              <span className="hidden sm:inline">{isRunning ? "RUNNING..." : "RUN"}</span>
              <span className="sm:hidden">{isRunning ? "..." : "RUN"}</span>
            </Button>

            {/* Expand Fullscreen Button */}
            {/* Request Agent Button (RFA) */}
            <Button
              onClick={() => setShowRFADialog(true)}
              variant="outline"
              className="border-fuchsia-500/30 hover:border-fuchsia-500 hover:bg-fuchsia-500/10 text-xs lg:text-sm h-8 lg:h-9 px-2.5 lg:px-4"
              title="Request a missing agent via bounty"
            >
              <Bot className="w-3.5 h-3.5 lg:w-4 lg:h-4 mr-1.5 lg:mr-2" />
              <span className="hidden sm:inline">REQUEST</span>
            </Button>

            <Button
              onClick={() => setIsFullscreen(true)}
              variant="outline"
              className="border-sidebar-border hover:border-cyan-500 hover:bg-cyan-500/10 h-8 lg:h-9 w-8 lg:w-9"
              title="Expand to fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
            </Button>

            {/* Settings Dialog - controlled via state for fullscreen access */}
            <Sheet open={showSettingsSheet} onOpenChange={setShowSettingsSheet}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  className="border-sidebar-border h-8 lg:h-9 w-8 lg:w-9"
                  onClick={() => setShowSettingsSheet(true)}
                >
                  <Settings className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                </Button>
              </SheetTrigger>
              <SheetContent className="bg-card border-sidebar-border z-[60]">
                <SheetHeader>
                  <SheetTitle className="font-display text-cyan-400">Workflow Settings</SheetTitle>
                  <SheetDescription>Configure workflow metadata and input</SheetDescription>
                </SheetHeader>
                <div className="space-y-4 mt-6">
                  <div className="space-y-2">
                    <Label className="font-mono text-xs">WORKFLOW NAME</Label>
                    <Input
                      value={workflowName}
                      onChange={(e) => setWorkflowName(e.target.value)}
                      placeholder="My Workflow"
                      className="bg-background/50 font-mono border-sidebar-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-xs">DESCRIPTION</Label>
                    <Textarea
                      value={workflowDescription}
                      onChange={(e) => setWorkflowDescription(e.target.value)}
                      placeholder="What does this workflow do?"
                      className="bg-background/50 font-mono border-sidebar-border resize-none"
                      rows={3}
                    />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="font-mono text-xs">INPUT (JSON)</Label>
                    <Textarea
                      value={inputJson}
                      onChange={(e) => setInputJson(e.target.value)}
                      placeholder='{"key": "value"}'
                      className="bg-background/50 font-mono border-sidebar-border resize-none text-xs"
                      rows={5}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Access in steps as {"{{input.key}}"}
                    </p>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* Step Count Badge */}
          <div className="absolute top-2 left-2 lg:top-4 lg:left-4 z-10">
            <Badge variant="outline" className="font-mono border-cyan-500/30 text-cyan-400 text-[10px] lg:text-xs">
              {nodes.length} step{nodes.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          <ReactFlowProvider>
            <div className="h-full w-full" ref={reactFlowWrapper}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onInit={onInit}
                nodeTypes={nodeTypes}
                onDrop={onDrop}
                onDragOver={onDragOver}
                fitView
                proOptions={{ hideAttribution: true }}
                className="bg-background"
              >
                <Background color="hsl(188 95% 43%)" gap={20} size={1} className="opacity-10" />
                <Controls className="bg-card border-sidebar-border fill-foreground" />
                <MiniMap
                  className="bg-card border-sidebar-border"
                  maskColor="hsl(222 47% 3% / 0.8)"
                  nodeColor="hsl(188 95% 43%)"
                />
              </ReactFlow>
            </div>
          </ReactFlowProvider>

          {/* Empty State */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4">
              <div className="text-center space-y-2 lg:space-y-3">
                <div className="relative">
                  <Plug className="w-12 h-12 lg:w-16 lg:h-16 mx-auto text-muted-foreground/20" />
                  <div className="absolute -top-1 -right-1 lg:-top-2 lg:-right-2 animate-pulse">
                    <Sparkles className="w-4 h-4 lg:w-6 lg:h-6 text-cyan-500/40" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-foreground/80 font-display text-base lg:text-lg">
                    Start Building
                  </p>
                  <p className="text-muted-foreground font-mono text-[10px] lg:text-xs max-w-[180px] lg:max-w-[200px] mx-auto">
                    Select plugins or agents from the panel above to add workflow steps
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Action Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4 px-3 lg:px-4 py-2.5 lg:py-3 bg-card/60 border border-t-0 border-cyan-500/20 rounded-b-sm backdrop-blur-sm">
          {/* Left: Workflow info */}
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-mono text-muted-foreground min-w-0">
            <span className="text-foreground/80 truncate max-w-[120px] sm:max-w-[150px]">
              {workflowName || "Untitled Workflow"}
            </span>
            {workflowDescription && (
              <>
                <span className="text-muted-foreground/50 hidden sm:inline">•</span>
                <span className="text-[10px] sm:text-xs opacity-60 truncate max-w-[150px] lg:max-w-[200px] hidden sm:block">
                  {workflowDescription}
                </span>
              </>
            )}
          </div>

          {/* Right: Primary action - Mint Button */}
          <Button
            onClick={() => setShowMintDialog(true)}
            disabled={nodes.length === 0}
            className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white hover:from-cyan-400 hover:to-fuchsia-400 font-bold font-mono shadow-lg disabled:opacity-50 w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10 shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
            MINT AS NFT
          </Button>
        </div>
      </div>

      {/* Fullscreen Canvas Overlay */}
      <FullscreenOverlay
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        onAddStep={handleAddStep}
        onAddAgentStep={handleAddAgentStep}
        onRun={() => setShowRunDialog(true)}
        onRequest={() => setShowRFADialog(true)}
        onMint={() => setShowMintDialog(true)}
        onSettings={() => setShowSettingsSheet(true)}
        isRunning={isRunning}
        nodeCount={nodes.length}
      >
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background color="hsl(188 95% 43%)" gap={20} size={1} className="opacity-10" />
            <Controls className="bg-card border-sidebar-border fill-foreground" />
            <MiniMap
              className="bg-card border-sidebar-border"
              maskColor="hsl(222 47% 3% / 0.8)"
              nodeColor="hsl(188 95% 43%)"
            />
          </ReactFlow>
        </ReactFlowProvider>
      </FullscreenOverlay>

      {/* Mint Manowar Dialog */}
      <MintManowarDialog
        open={showMintDialog}
        onOpenChange={setShowMintDialog}
        workflowName={workflowName}
        workflowDescription={workflowDescription}
        agentIds={workflowAgentIds}
        agentPrices={agentPrices}
      />

      {/* Run Workflow Dialog - captures user prompt for LangGraph supervisor */}
      <RunWorkflowDialog
        open={showRunDialog}
        onOpenChange={setShowRunDialog}
        workflowName={workflowName || "Workflow"}
        stepCount={nodes.length}
        isRunning={isRunning}
        onRun={handleRun}
      />

      {/* Workflow Output Panel */}
      <WorkflowOutputPanel
        open={showOutputPanel}
        onOpenChange={setShowOutputPanel}
        result={workflowResult}
        workflowName={workflowName || "Workflow"}
      />

      {/* Warp Required Dialog */}
      <AlertDialog open={showWarpDialog} onOpenChange={setShowWarpDialog}>
        <AlertDialogContent className="bg-background border-sidebar-border max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-fuchsia-400" />
              Warp Required
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This agent needs to be warped into the Manowar ecosystem before it can be used in compose workflows.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingWarpAgent && (
            <div className="space-y-3 py-4 border-y border-sidebar-border">
              <div className="flex items-center gap-3 p-3 rounded-sm bg-sidebar-accent border border-sidebar-border">
                <div className="w-10 h-10 rounded-full bg-fuchsia-500/10 flex items-center justify-center border border-fuchsia-500/30">
                  <Globe className="w-5 h-5 text-fuchsia-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono font-bold text-foreground truncate">{pendingWarpAgent.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {AGENT_REGISTRIES[pendingWarpAgent.registry]?.name || pendingWarpAgent.registry}
                  </p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-2">
                <p>Warping brings external agents on-chain with:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>ERC8004 identity</li>
                  <li>x402 payment integration</li>
                  <li>80% royalties to you (the warper)</li>
                </ul>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="border-sidebar-border">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleWarpAgent}
              className="bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white hover:from-fuchsia-400 hover:to-cyan-400 font-bold"
            >
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Warp This Agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RFA Component Dialog */}
      <RFAComponent
        open={showRFADialog}
        onOpenChange={setShowRFADialog}
        manowarId={pendingManowarId || 0}
        manowarTitle={workflowName || "New Workflow"}
        onSuccess={(rfaId) => {
          toast({
            title: "Agent Request Published",
            description: "Bounty hunters can now submit agents for your request.",
          });
        }}
      />


    </div>
  );
}

export default ComposeFlow;
