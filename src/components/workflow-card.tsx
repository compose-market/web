/**
 * Workflow Card Component
 *
 * Compact card displaying Workflow details with nested agent viewing.
 * Shows: identity, coordinator, agents (with fold pattern), stats, lease info, and endpoints.
 * 
 * Fold Pattern: Main Card → Agent List → Individual AgentCard
 * 
 * Styling: uses @compose-market/theme BEM classes (cm-workflow-card*).
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { CHAIN_CONFIG } from "@/lib/performance/chains-data";
import { getContractAddress } from "@/lib/chains";

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
        agentCardUri: "",
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
                <div className="cm-workflow-card">
                    {/* Back Header */}
                    <div className="cm-workflow-card__fold-header">
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
                    {/* Embedded AgentCard */}
                    <div className="cm-workflow-card__fold-body">
                        <AgentCard agent={onchainAgent} />
                    </div>
                </div>
            </TooltipProvider>
        );
    }

    // =========================================================================
    // Agent List View - Show all agents as clickable previews
    // =========================================================================
    if (cardView === "agents") {
        return (
            <TooltipProvider>
                <div className="cm-workflow-card">
                    {/* Back Header */}
                    <div className="cm-workflow-card__fold-header">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleBack}
                            className="h-7 px-2 text-muted-foreground hover:text-fuchsia-400"
                        >
                            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                            <span className="text-xs">Back</span>
                        </Button>
                        <div className="cm-workflow-card__agents-label">
                            <Bot className="cm-workflow-card__agents-label-icon" />
                            <span className="cm-workflow-card__agents-label-text">
                                Agents ({agents.length})
                            </span>
                        </div>
                    </div>

                    {/* Agent List */}
                    <ScrollArea className="cm-workflow-card__fold-body">
                        <div className="p-2 sm:p-3 space-y-2">
                            {agents.map((agent, idx) => {
                                const avatarUrl = getAgentAvatarUrl(agent);
                                const initials = getAgentInitials(agent.name || `Agent ${idx + 1}`);

                                return (
                                    <button
                                        key={idx}
                                        onClick={() => handleAgentClick(idx)}
                                        className="cm-workflow-card__agent-preview"
                                    >
                                        <Avatar className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 border border-cyan-500/30">
                                            <AvatarImage src={avatarUrl || undefined} alt={agent.name} />
                                            <AvatarFallback className="bg-cyan-500/20 text-cyan-400 font-mono text-xs">
                                                {initials}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="cm-workflow-card__agent-preview-copy">
                                            <p className="cm-workflow-card__agent-preview-name">
                                                {agent.name || `Agent ${idx + 1}`}
                                            </p>
                                            <p className="cm-workflow-card__agent-preview-model">
                                                {agent.model || "Unknown model"}
                                            </p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                    </button>
                                );
                            })}
                        </div>
                    </ScrollArea>
                </div>
            </TooltipProvider>
        );
    }

    // =========================================================================
    // Main Card View - Original WorkflowCard with clickable agents section
    // =========================================================================
    return (
        <TooltipProvider>
            <div className="cm-workflow-card cm-workflow-card--interactive">
                {/* Banner */}
                {bannerUrl ? (
                    <div
                        className="cm-workflow-card__banner"
                        style={{ backgroundImage: `url(${bannerUrl})` }}
                    />
                ) : (
                    <div className="cm-workflow-card__banner cm-workflow-card__banner--placeholder" />
                )}

                <div className="cm-workflow-card__body">
                    {/* Header: Title + Actions */}
                    <div className="cm-workflow-card__header">
                        <div className="cm-workflow-card__header-copy">
                            <div className="cm-workflow-card__title-row">
                                <Layers className="cm-workflow-card__icon" />
                                <h3 className="cm-workflow-card__title">
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
                            <p className="cm-workflow-card__description">
                                {workflow.description || "No description available"}
                            </p>
                        </div>
                    </div>

                    {/* Badges */}
                    <div className="cm-workflow-card__badges">
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

                    {/* Stats Row */}
                    <div className="cm-workflow-card__stats">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="cm-workflow-card__stat">
                                    <DollarSign className="cm-workflow-card__stat-icon" style={{ color: "hsl(var(--chart-2))" }} />
                                    <p className="cm-workflow-card__stat-value" style={{ color: "hsl(var(--chart-2))" }}>${formatPrice(workflow.totalPrice)}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Total Workflow Price</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="cm-workflow-card__stat">
                                    <Package className="cm-workflow-card__stat-icon" style={{ color: "hsl(var(--primary))" }} />
                                    <p className="cm-workflow-card__stat-value" style={{ color: "hsl(var(--primary))" }}>{unitsDisplay}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Available Units</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="cm-workflow-card__stat">
                                    <Bot className="cm-workflow-card__stat-icon" style={{ color: "hsl(var(--accent))" }} />
                                    <p className="cm-workflow-card__stat-value" style={{ color: "hsl(var(--accent))" }}>{agents.length}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Agents in Workflow</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="cm-workflow-card__stat">
                                    <Globe className="cm-workflow-card__stat-icon" style={{ color: "hsl(var(--primary))" }} />
                                    <p className="cm-workflow-card__stat-value" style={{ color: "hsl(var(--primary))" }}>{chainAbbr}</p>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>{chainInfo.name}</TooltipContent>
                        </Tooltip>
                    </div>

                    {/* Coordinator Model */}
                    {workflow.hasCoordinator && workflow.coordinatorModel && (
                        <div className="cm-workflow-card__coordinator">
                            <Cpu className="cm-workflow-card__coordinator-icon" />
                            <div className="cm-workflow-card__coordinator-copy">
                                <span className="cm-workflow-card__coordinator-label">Coordinator</span>
                                <span className="cm-workflow-card__coordinator-value" title={workflow.coordinatorModel}>
                                    {workflow.coordinatorModel}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Agents fold section */}
                    {agents.length > 0 && (
                        <div className="cm-workflow-card__agents">
                            <button
                                onClick={() => setCardView("agents")}
                                className="cm-workflow-card__agents-header"
                            >
                                <div className="cm-workflow-card__agents-label">
                                    <Bot className="cm-workflow-card__agents-label-icon" />
                                    <span className="cm-workflow-card__agents-label-text">Agents ({agents.length})</span>
                                </div>
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            </button>
                            <div className="cm-workflow-card__agents-badges">
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

                    {/* Lease Info */}
                    {workflow.leaseEnabled && (
                        <div className="cm-workflow-card__lease">
                            <div className="cm-workflow-card__lease-item">
                                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
                                <span className="cm-workflow-card__lease-label">Duration:</span>
                                <span className="cm-workflow-card__lease-value text-cyan-400">{workflow.leaseDuration} days</span>
                            </div>
                            <div className="cm-workflow-card__lease-item">
                                <Percent className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400" />
                                <span className="cm-workflow-card__lease-label">Creator:</span>
                                <span className="cm-workflow-card__lease-value text-green-400">{workflow.leasePercent}%</span>
                            </div>
                        </div>
                    )}

                    {/* API Endpoint */}
                    {apiEndpoint && (
                        <div className="cm-workflow-card__endpoint-section">
                            <div className="cm-workflow-card__endpoint-header">
                                <Globe className="cm-workflow-card__endpoint-header-icon" />
                                <span className="cm-workflow-card__endpoint-label">A2A Endpoint</span>
                            </div>
                            <div className="cm-workflow-card__endpoint-row">
                                <code className="cm-workflow-card__endpoint-code">{apiEndpoint}</code>
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
                            <div className="cm-workflow-card__creator">
                                <span>Creator:</span>
                                <a
                                    href={`${CHAIN_CONFIG[workflowChainId].explorer}/address/${workflow.creator}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="cm-workflow-card__creator-value"
                                >
                                    {`${workflow.creator.slice(0, 6)}...${workflow.creator.slice(-4)}`}
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
}

export function WorkflowCardSkeleton() {
    return (
        <div className="cm-workflow-card-skeleton">
            <div className="cm-workflow-card-skeleton__banner" />
            <div className="cm-workflow-card-skeleton__body">
                <div className="cm-workflow-card-skeleton__row">
                    <div className="cm-workflow-card-skeleton__block" style={{ width: 20, height: 20 }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="cm-workflow-card-skeleton__block" style={{ width: "60%", height: 20 }} />
                        <div className="cm-workflow-card-skeleton__block" style={{ width: "100%", height: 16 }} />
                    </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    <div className="cm-workflow-card-skeleton__block" style={{ height: 56 }} />
                    <div className="cm-workflow-card-skeleton__block" style={{ height: 56 }} />
                    <div className="cm-workflow-card-skeleton__block" style={{ height: 56 }} />
                    <div className="cm-workflow-card-skeleton__block" style={{ height: 56 }} />
                </div>
                <div className="cm-workflow-card-skeleton__block" style={{ height: 56 }} />
                <div className="cm-workflow-card-skeleton__block" style={{ height: 80 }} />
            </div>
        </div>
    );
}
