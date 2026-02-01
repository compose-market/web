/**
 * Agent Card Component
 *
 * Compact agent details card with readable text and flexible tools section.
 * Shows: identity, model, tools, stats, and endpoints.
 */
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { getIpfsUrl } from "@/lib/pinata";
import type { OnchainAgent } from "@/hooks/use-onchain";
import {
    Copy,
    ExternalLink,
    DollarSign,
    Package,
    Zap,
    Globe,
    CheckCircle,
    Cpu,
    Wrench,
} from "lucide-react";
import { CHAIN_CONFIG } from "@/lib/chains";
import { getContractAddress } from "@/lib/contracts";

export interface AgentCardProps {
    agent: OnchainAgent;
    onCopyEndpoint?: () => void;
}

export function AgentCard({ agent, onCopyEndpoint }: AgentCardProps) {
    const avatarUrl = agent.metadata?.image && agent.metadata.image !== "none"
        ? agent.metadata.image.startsWith("ipfs://")
            ? getIpfsUrl(agent.metadata.image.replace("ipfs://", ""))
            : agent.metadata.image.startsWith("https://")
                ? agent.metadata.image
                : null
        : null;

    const initials = (agent.metadata?.name || `Agent ${agent.id}`)
        .split(" ")
        .map(w => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    const licensesDisplay = agent.licenses === 0 ? "∞" : `${agent.licensesAvailable}/${agent.licenses}`;
    const model = agent.metadata?.model || "Unknown";
    const plugins = agent.metadata?.plugins || [];

    // Use agent's chain from metadata (source of truth)
    const agentChainId = agent.metadata!.chain;
    const chainInfo = CHAIN_CONFIG[agentChainId];
    const chainAbbr = chainInfo.name.split(" ")[0].toUpperCase().slice(0, 4);

    // API endpoint URL - direct path without double /api/
    const apiEndpoint = agent.walletAddress
        ? `https://manowar.compose.market/agent/${agent.walletAddress}`
        : null;

    const handleCopyEndpoint = () => {
        if (apiEndpoint) {
            navigator.clipboard.writeText(apiEndpoint);
            onCopyEndpoint?.();
        }
    };

    return (
        <TooltipProvider>
            <Card className="glass-panel border-cyan-500/30 h-full flex flex-col overflow-hidden">
                <CardContent className="p-5 flex flex-col gap-4 flex-1 overflow-y-auto">
                    {/* Header: Avatar + Name + Actions */}
                    <div className="flex items-start gap-4">
                        <Avatar className="w-14 h-14 shrink-0 border-2 border-cyan-500/30">
                            <AvatarImage src={avatarUrl || undefined} alt={agent.metadata?.name || `Agent #${agent.id}`} />
                            <AvatarFallback className="bg-cyan-500/20 text-cyan-400 font-mono text-base">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-white truncate text-base">
                                    {agent.metadata?.name || `Agent #${agent.id}`}
                                </h3>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => window.open(`${CHAIN_CONFIG[agentChainId].explorer}/token/${getContractAddress("AgentFactory", agentChainId)}?a=${agent.id}`, "_blank")}
                                            className="text-muted-foreground hover:text-cyan-400 transition-colors shrink-0"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>View on Explorer</TooltipContent>
                                </Tooltip>
                            </div>
                            <p className="text-muted-foreground text-sm line-clamp-2 mt-1">
                                {agent.metadata?.description || "No description available"}
                            </p>
                        </div>
                    </div>

                    {/* Badges */}
                    <div className="flex flex-wrap gap-1.5">
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Verified
                        </Badge>
                        {agent.cloneable && (
                            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                                Cloneable
                            </Badge>
                        )}
                        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
                            #{agent.id}
                        </Badge>
                    </div>

                    {/* Stats Row - Compact horizontal layout */}
                    <div className="grid grid-cols-4 gap-2 text-center">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <DollarSign className="w-4 h-4 text-green-400 mx-auto" />
                                    <p className="font-mono text-sm text-green-400 mt-1">{agent.licensePriceFormatted}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>License Price</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <Package className="w-4 h-4 text-cyan-400 mx-auto" />
                                    <p className="font-mono text-sm text-cyan-400 mt-1">{licensesDisplay}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Available Licenses</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <Zap className="w-4 h-4 text-yellow-400 mx-auto" />
                                    <p className="font-mono text-sm text-yellow-400 mt-1">Manowar</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Protocol</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <Globe className="w-4 h-4 text-fuchsia-400 mx-auto" />
                                    <p className="font-mono text-sm text-fuchsia-400 mt-1">{chainAbbr}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>{chainInfo.name}</TooltipContent>
                        </Tooltip>
                    </div>

                    {/* Model */}
                    <div className="flex items-center gap-3 p-3 bg-background/50 border border-sidebar-border rounded-lg">
                        <Cpu className="w-5 h-5 text-cyan-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <span className="text-xs text-muted-foreground uppercase block">Model</span>
                            <span className="font-mono text-sm text-cyan-400 truncate block" title={model}>
                                {model}
                            </span>
                        </div>
                    </div>

                    {/* Tools - Flexible container that expands based on content */}
                    {plugins.length > 0 && (
                        <div className="flex-1 min-h-0 p-3 bg-background/50 border border-sidebar-border rounded-lg flex flex-col">
                            <div className="flex items-center gap-2 mb-2 shrink-0">
                                <Wrench className="w-4 h-4 text-fuchsia-400" />
                                <span className="text-xs text-muted-foreground uppercase">Tools ({plugins.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 content-start overflow-y-auto">
                                {plugins.map((plugin, idx) => (
                                    <Tooltip key={idx}>
                                        <TooltipTrigger asChild>
                                            <Badge
                                                variant="outline"
                                                className="text-xs px-2 py-0.5 border-fuchsia-500/30 text-fuchsia-400 cursor-default shrink-0"
                                            >
                                                {plugin.name || plugin.registryId}
                                            </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p className="font-mono text-xs">{plugin.name || plugin.registryId}</p>
                                            {plugin.origin && <p className="text-xs text-muted-foreground">{plugin.origin}</p>}
                                        </TooltipContent>
                                    </Tooltip>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* API Endpoint - Backend proxies to Pinata */}
                    {apiEndpoint && (
                        <div className="pt-3 border-t border-sidebar-border mt-auto shrink-0">
                            <div className="flex items-center gap-2 mb-2">
                                <Globe className="w-4 h-4 text-cyan-400" />
                                <span className="text-xs text-muted-foreground uppercase">A2A Endpoint</span>
                            </div>
                            <div className="flex items-center gap-2 p-2 bg-background border border-sidebar-border rounded-lg font-mono text-xs">
                                <code className="flex-1 truncate text-cyan-400">{apiEndpoint}</code>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleCopyEndpoint}
                                            className="h-6 w-6 p-0 hover:text-cyan-400"
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Copy Endpoint</TooltipContent>
                                </Tooltip>
                            </div>
                            {/* Creator - inline */}
                            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                                <span>Creator:</span>
                                <a
                                    href={`${CHAIN_CONFIG[agentChainId].explorer}/address/${agent.creator}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-fuchsia-400 hover:underline font-mono"
                                >
                                    {`${agent.creator.slice(0, 6)}...${agent.creator.slice(-4)}`}
                                </a>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}

export function AgentCardSkeleton() {
    return (
        <Card className="glass-panel border-cyan-500/30 h-full">
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-4">
                    <Skeleton className="w-14 h-14 rounded-full" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-full" />
                    </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                </div>
                <Skeleton className="h-14" />
                <Skeleton className="h-20" />
            </CardContent>
        </Card>
    );
}
