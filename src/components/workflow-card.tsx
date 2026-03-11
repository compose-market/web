/**
 * Workflow Card Component
 *
 * Compact card displaying Workflow details with nested agent viewing.
 * Shows: identity, coordinator, agents (with fold pattern), stats, lease info, and endpoints.
 * 
 * Fold Pattern: Main Card → Agent List → Individual AgentCard
 */
import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { getIpfsUrl } from "@/lib/pinata";
import type { OnchainWorkflow, OnchainAgent } from "@/hooks/use-onchain";
import type { AgentCard as AgentCardType } from "@/lib/pinata";
import { AgentCard } from "@/components/agent-card";
import { API_BASE_URL } from "@/lib/api";
import {
    Copy,
    ExternalLink,
    DollarSign,
    Package,
    Zap,
    Globe,
    Layers,
    Bot,
    Clock,
    Percent,
    AlertTriangle,
    Cpu,
    ChevronRight,
    ArrowLeft,
} from "lucide-react";
import { CHAIN_CONFIG, getContractAddress } from "@/lib/chains";

export interface WorkflowCardProps {
    workflow: OnchainWorkflow;
    onCopyEndpoint?: () => void;
}

// View state for fold pattern
type CardView = "main" | "agents" | "agent-detail";

export function WorkflowCard({ workflow, onCopyEndpoint }: WorkflowCardProps) {
    // Fold pattern state
    const [cardView, setCardView] = useState<CardView>("main");
    const [selectedAgentIndex, setSelectedAgentIndex] = useState<number | null>(null);

    // Banner image from IPFS
    const bannerUrl = workflow.image && workflow.image.startsWith("ipfs://")
        ? getIpfsUrl(workflow.image.replace("ipfs://", ""))
        : workflow.image?.startsWith("https://")
            ? workflow.image
            : null;

    const unitsDisplay = workflow.units === 0 ? "∞" : `${workflow.units - workflow.unitsMinted}/${workflow.units}`;

    const agents = workflow.metadata?.agents || [];
    const selectedAgent = selectedAgentIndex !== null ? agents[selectedAgentIndex] : null;

    // Workflow's minting chain
    const workflowChainId = workflow.chainId!;
    const chainInfo = CHAIN_CONFIG[workflowChainId];
    const chainAbbr = chainInfo.name.split(" ")[0].toUpperCase().slice(0, 4);

    // API endpoint URL - direct path without double /api/
    const apiEndpoint = workflow.walletAddress
        ? `${API_BASE_URL}/workflow/${workflow.walletAddress}`
        : null;

    // Format price with max 4 decimal places, trim trailing zeros
    const formatPrice = (price: string | number) => {
        const num = typeof price === "string" ? parseFloat(price) : price;
        if (isNaN(num)) return "0";
        // Use max 4 decimals but trim trailing zeros
        return num.toFixed(4).replace(/\.?0+$/, "") || "0";
    };

    const handleCopyEndpoint = () => {
        if (apiEndpoint) {
            navigator.clipboard.writeText(apiEndpoint);
            onCopyEndpoint?.();
        }
    };

    // Convert AgentCard metadata to OnchainAgent shape for AgentCard component
    const agentCardToOnchainAgent = (agentCard: AgentCardType, index: number): OnchainAgent => ({
        id: index + 1,
        dnaHash: agentCard.dnaHash || "",
        walletAddress: agentCard.walletAddress || "",
        licenses: agentCard.licenses || 0,
        licensesMinted: 0,
        licensesAvailable: agentCard.licenses || 0,
        licensePrice: agentCard.licensePrice || "0",
        licensePriceFormatted: `$${parseFloat(agentCard.licensePrice || "0").toFixed(2)}`,
        creator: agentCard.creator || workflow.creator,
        cloneable: agentCard.cloneable || false,
        isClone: false,
        parentAgentId: 0,
        agentCardUri: "", // Not available in nested context
        metadata: agentCard,
        isWarped: false,
    });

    // Get avatar URL for agent preview
    const getAgentAvatarUrl = (agent: AgentCardType) => {
        const image = agent.image || agent.avatar;
        if (!image || image === "none") return null;
        if (image.startsWith("ipfs://")) return getIpfsUrl(image.replace("ipfs://", ""));
        if (image.startsWith("https://")) return image;
        return null;
    };

    // Agent initials for avatar fallback
    const getAgentInitials = (name: string) =>
        name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

    // Handle agent click in agent list
    const handleAgentClick = (index: number) => {
        setSelectedAgentIndex(index);
        setCardView("agent-detail");
    };

    // Handle back navigation
    const handleBack = () => {
        if (cardView === "agent-detail") {
            setCardView("agents");
            setSelectedAgentIndex(null);
        } else if (cardView === "agents") {
            setCardView("main");
        }
    };

    // =========================================================================
    // Agent Detail View - Show full AgentCard
    // =========================================================================
    if (cardView === "agent-detail" && selectedAgent) {
        const onchainAgent = agentCardToOnchainAgent(selectedAgent, selectedAgentIndex!);
        return (
            <TooltipProvider>
                <Card className="glass-panel border-fuchsia-500/30 h-full flex flex-col overflow-hidden">
                    {/* Back Header */}
                    <div className="p-2 sm:p-3 border-b border-sidebar-border shrink-0">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleBack}
                            className="h-7 px-2 text-muted-foreground hover:text-cyan-400"
                        >
                            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                            <span className="text-xs">Back to Agents</span>
                        </Button>
                    </div>
                    {/* Embedded AgentCard - same component as agent.tsx */}
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        <AgentCard agent={onchainAgent} />
                    </div>
                </Card>
            </TooltipProvider>
        );
    }

    // =========================================================================
    // Agent List View - Show all agents as clickable previews
    // =========================================================================
    if (cardView === "agents") {
        return (
            <TooltipProvider>
                <Card className="glass-panel border-fuchsia-500/30 h-full flex flex-col overflow-hidden">
                    {/* Back Header */}
                    <div className="p-2 sm:p-3 border-b border-sidebar-border shrink-0 flex items-center justify-between">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleBack}
                            className="h-7 px-2 text-muted-foreground hover:text-fuchsia-400"
                        >
                            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                            <span className="text-xs">Back</span>
                        </Button>
                        <div className="flex items-center gap-1.5">
                            <Bot className="w-4 h-4 text-cyan-400" />
                            <span className="text-xs sm:text-sm text-muted-foreground font-medium">
                                Agents ({agents.length})
                            </span>
                        </div>
                    </div>

                    {/* Agent List */}
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-2 sm:p-3 space-y-2">
                            {agents.map((agent, idx) => {
                                const avatarUrl = getAgentAvatarUrl(agent);
                                const initials = getAgentInitials(agent.name || `Agent ${idx + 1}`);

                                return (
                                    <button
                                        key={idx}
                                        onClick={() => handleAgentClick(idx)}
                                        className="w-full p-2 sm:p-3 bg-background/50 border border-sidebar-border rounded-lg hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all flex items-center gap-2 sm:gap-3 text-left group"
                                    >
                                        <Avatar className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 border border-cyan-500/30">
                                            <AvatarImage src={avatarUrl || undefined} alt={agent.name} />
                                            <AvatarFallback className="bg-cyan-500/20 text-cyan-400 font-mono text-xs">
                                                {initials}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-white text-xs sm:text-sm truncate group-hover:text-cyan-400 transition-colors">
                                                {agent.name || `Agent ${idx + 1}`}
                                            </p>
                                            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                                                {agent.model || "Unknown model"}
                                            </p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-cyan-400 shrink-0" />
                                    </button>
                                );
                            })}
                        </div>
                    </ScrollArea>
                </Card>
            </TooltipProvider>
        );
    }

    // =========================================================================
    // Main Card View - Original WorkflowCard with clickable agents section
    // =========================================================================
    return (
        <TooltipProvider>
            <Card className="glass-panel border-fuchsia-500/30 h-full flex flex-col overflow-hidden">
                {/* Banner - responsive height */}
                {bannerUrl && (
                    <div
                        className="h-20 md:h-24 bg-cover bg-center shrink-0"
                        style={{ backgroundImage: `url(${bannerUrl})` }}
                    />
                )}
                {!bannerUrl && (
                    <div className="h-14 md:h-16 bg-gradient-to-br from-fuchsia-500/20 via-cyan-500/10 to-transparent shrink-0" />
                )}

                <CardContent className="p-3 sm:p-4 md:p-5 flex flex-col gap-3 md:gap-4 flex-1 overflow-y-auto">
                    {/* Header: Title + Actions */}
                    <div className="flex items-start gap-2 sm:gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                                <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-fuchsia-400 shrink-0" />
                                <h3 className="font-semibold text-white truncate text-sm md:text-base">
                                    {workflow.title || `Workflow #${workflow.id}`}
                                </h3>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => window.open(`${CHAIN_CONFIG[workflowChainId].explorer}/token/${getContractAddress("Workflow", workflowChainId)}?a=${workflow.id}`, "_blank")}
                                            className="text-muted-foreground hover:text-fuchsia-400 transition-colors shrink-0"
                                        >
                                            <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>View on Explorer</TooltipContent>
                                </Tooltip>
                            </div>
                            <p className="text-muted-foreground text-xs md:text-sm line-clamp-2 mt-1">
                                {workflow.description || "No description available"}
                            </p>
                        </div>
                    </div>

                    {/* Badges */}
                    <div className="flex flex-wrap gap-1 sm:gap-1.5">
                        {workflow.hasActiveRfa && (
                            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px] sm:text-xs">
                                <AlertTriangle className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 sm:mr-1" />
                                Active RFA
                            </Badge>
                        )}
                        {workflow.leaseEnabled && (
                            <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px] sm:text-xs">
                                <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 sm:mr-1" />
                                Leasable
                            </Badge>
                        )}
                    </div>

                    {/* Stats Row - responsive grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 text-center">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-1.5 sm:p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400 mx-auto" />
                                    <p className="font-mono text-xs sm:text-sm text-green-400 mt-0.5 sm:mt-1">${formatPrice(workflow.totalPrice)}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Total Workflow Price</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-1.5 sm:p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 mx-auto" />
                                    <p className="font-mono text-xs sm:text-sm text-cyan-400 mt-0.5 sm:mt-1">{unitsDisplay}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Available Units</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-1.5 sm:p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-fuchsia-400 mx-auto" />
                                    <p className="font-mono text-xs sm:text-sm text-fuchsia-400 mt-0.5 sm:mt-1">{agents.length}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Agents in Workflow</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="p-1.5 sm:p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                    <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 mx-auto" />
                                    <p className="font-mono text-xs sm:text-sm text-cyan-400 mt-0.5 sm:mt-1">{chainAbbr}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>{chainInfo.name}</TooltipContent>
                        </Tooltip>
                    </div>

                    {/* Coordinator Model */}
                    {workflow.hasCoordinator && workflow.coordinatorModel && (
                        <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-background/50 border border-sidebar-border rounded-lg">
                            <Cpu className="w-4 h-4 sm:w-5 sm:h-5 text-fuchsia-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <span className="text-[10px] sm:text-xs text-muted-foreground uppercase block">Coordinator</span>
                                <span className="font-mono text-xs sm:text-sm text-fuchsia-400 truncate block" title={workflow.coordinatorModel}>
                                    {workflow.coordinatorModel}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Agents - Flexible container matching tools pattern */}
                    {agents.length > 0 && (
                        <div className="flex-1 min-h-0 p-2 sm:p-3 bg-background/50 border border-sidebar-border rounded-lg flex flex-col">
                            <button
                                onClick={() => setCardView("agents")}
                                className="flex items-center justify-between mb-1.5 sm:mb-2 shrink-0 hover:opacity-80 transition-opacity"
                            >
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                    <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
                                    <span className="text-[10px] sm:text-xs text-muted-foreground uppercase">Agents ({agents.length})</span>
                                </div>
                                <ChevronRight className="w-4 h-4 text-muted-foreground hover:text-cyan-400 transition-colors" />
                            </button>
                            <div className="flex flex-wrap gap-1 sm:gap-1.5 content-start overflow-y-auto">
                                {agents.map((agent, idx) => (
                                    <Badge
                                        key={idx}
                                        variant="outline"
                                        className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 border-cyan-500/30 text-cyan-400 cursor-default shrink-0"
                                    >
                                        {agent.name || `Agent ${idx + 1}`}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Lease Info - if enabled */}
                    {workflow.leaseEnabled && (
                        <div className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 bg-background/50 border border-sidebar-border rounded-lg text-xs sm:text-sm">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
                                <span className="text-muted-foreground">Duration:</span>
                                <span className="font-mono text-cyan-400">{workflow.leaseDuration} days</span>
                            </div>
                            <div className="flex items-center gap-1.5 sm:gap-2">
                                <Percent className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400" />
                                <span className="text-muted-foreground">Creator:</span>
                                <span className="font-mono text-green-400">{workflow.leasePercent}%</span>
                            </div>
                        </div>
                    )}

                    {/* API Endpoint - Backend proxies to Pinata */}
                    {apiEndpoint && (
                        <div className="pt-2 sm:pt-3 border-t border-sidebar-border mt-auto shrink-0">
                            <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                                <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-fuchsia-400" />
                                <span className="text-[10px] sm:text-xs text-muted-foreground uppercase">A2A Endpoint</span>
                            </div>
                            <div className="flex items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 bg-background border border-sidebar-border rounded-lg font-mono text-[10px] sm:text-xs">
                                <code className="flex-1 truncate text-fuchsia-400">{apiEndpoint}</code>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleCopyEndpoint}
                                            className="h-5 w-5 sm:h-6 sm:w-6 p-0 hover:text-fuchsia-400"
                                        >
                                            <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Copy Endpoint</TooltipContent>
                                </Tooltip>
                            </div>
                            {/* Creator */}
                            <div className="flex items-center gap-1.5 sm:gap-2 mt-2 sm:mt-3 text-[10px] sm:text-xs text-muted-foreground">
                                <span>Creator:</span>
                                <a
                                    href={`${CHAIN_CONFIG[workflowChainId].explorer}/address/${workflow.creator}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-fuchsia-400 hover:underline font-mono"
                                >
                                    {`${workflow.creator.slice(0, 6)}...${workflow.creator.slice(-4)}`}
                                </a>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}

export function WorkflowCardSkeleton() {
    return (
        <Card className="glass-panel border-fuchsia-500/30 h-full">
            <div className="h-16 bg-gradient-to-br from-fuchsia-500/20 via-cyan-500/10 to-transparent" />
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                    <Skeleton className="w-5 h-5 rounded" />
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
