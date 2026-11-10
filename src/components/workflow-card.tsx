/**
 * Workflow Card Component
 *
 * Compact card displaying Workflow details with nested agent viewing.
 * Fold Pattern: Main Card → Agent List → Individual AgentCard
 */
import * as React from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Excerpt } from "@compose-market/theme/shell";
import { Card, Skeleton, type Metric, type Section } from "@compose-market/theme/entity";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getIpfsUrl } from "@/lib/pinata";
import type { OnchainWorkflow, OnchainAgent } from "@/hooks/use-onchain";
import type { AgentCard as AgentCardType } from "@/lib/pinata";
import { AgentCard } from "@/components/identikit";
import { RUNTIME_BASE_URL } from "@/lib/sdk";
import { cn } from "@/lib/utils";
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
import { evmChainId, formatUsdcPrice, getChainByNetwork, getContractAddress, isEvmNetwork } from "@/lib/chains";
import { safeHref } from "@/lib/performance/markdown";

function formatLicensePrice(raw: string | undefined): string {
  const trimmed = (raw ?? "0").trim();
  if (/^\d+$/u.test(trimmed)) {
    return formatUsdcPrice(BigInt(trimmed));
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? `$${parsed.toFixed(2)}` : "Free";
}

export interface WorkflowStat {
  icon: React.ReactNode;
  value: string;
  tooltip?: string;
  tone?: "green" | "cyan" | "fuchsia" | "warning";
}

export interface WorkflowCardShellProps {
  bannerSrc?: string | null;
  title: string;
  description?: React.ReactNode;
  titleIcon?: React.ReactNode;
  headerAction?: React.ReactNode;
  badges?: React.ReactNode;
  stats?: WorkflowStat[];
  coordinatorIcon?: React.ReactNode;
  coordinatorLabel?: string;
  coordinatorValue?: string;
  agentsCount?: number;
  agentsIcon?: React.ReactNode;
  onAgentsFold?: () => void;
  agentsFoldChevron?: React.ReactNode;
  agentsBadges?: React.ReactNode;
  leaseSlot?: React.ReactNode;
  endpointSlot?: React.ReactNode;
  footer?: React.ReactNode;
  interactive?: boolean;
  className?: string;
}

export function WorkflowCardShell({
  bannerSrc,
  title,
  description,
  titleIcon,
  headerAction,
  badges,
  stats,
  coordinatorIcon,
  coordinatorLabel,
  coordinatorValue,
  agentsCount,
  agentsIcon,
  onAgentsFold,
  agentsFoldChevron,
  agentsBadges,
  leaseSlot,
  endpointSlot,
  footer,
  interactive,
  className,
}: WorkflowCardShellProps) {
  const metrics: Metric[] = (stats || []).map((stat) => ({
    label: stat.tooltip || "",
    value: stat.value,
    icon: stat.icon,
    tone: stat.tone,
  }));
  const sections: Section[] = [];
  if (badges) {
    sections.push({ children: <div className="cm-workflow-card__badges">{badges}</div> });
  }
  if (coordinatorValue) {
    sections.push({
      label: coordinatorLabel || "Coordinator",
      children: (
        <div className="cm-workflow-card__coordinator">
          {coordinatorIcon ? <span className="cm-workflow-card__coordinator-icon">{coordinatorIcon}</span> : null}
          <span className="cm-workflow-card__coordinator-value" title={coordinatorValue}>
            {coordinatorValue}
          </span>
        </div>
      ),
    });
  }
  if (agentsCount != null && agentsCount > 0) {
    sections.push({
      children: (
        <div className="cm-workflow-card__agents">
          <button type="button" className="cm-workflow-card__agents-header" onClick={onAgentsFold}>
            <span className="cm-workflow-card__agents-label">
              {agentsIcon ? <span className="cm-workflow-card__agents-label-icon">{agentsIcon}</span> : null}
              <span className="cm-workflow-card__agents-label-text">Agents ({agentsCount})</span>
            </span>
            {agentsFoldChevron}
          </button>
          {agentsBadges ? <div className="cm-workflow-card__agents-badges">{agentsBadges}</div> : null}
        </div>
      ),
    });
  }
  if (leaseSlot) sections.push({ children: leaseSlot });
  if (endpointSlot) sections.push({ children: endpointSlot });

  return (
    <Card
      variant="market"
      className={cn("cm-workflow-card", interactive && "cm-workflow-card--interactive", className)}
      media={bannerSrc ? (
        <img src={bannerSrc} alt="" className="cm-workflow-card__banner-image" loading="lazy" decoding="async" />
      ) : titleIcon ? (
        <span className="cm-workflow-card__icon">{titleIcon}</span>
      ) : undefined}
      mediaFallback={titleIcon}
      title={title}
      description={description}
      metrics={metrics}
      sections={sections}
      footer={footer}
      headerAction={headerAction}
      interactive={interactive}
    />
  );
}

export interface WorkflowCardProps {
  workflow: OnchainWorkflow;
  onCopyEndpoint?: () => void;
}

type CardView = "main" | "agents" | "agent-detail";

export function WorkflowCard({ workflow, onCopyEndpoint }: WorkflowCardProps) {
  const [cardView, setCardView] = useState<CardView>("main");
  const [selectedAgentIndex, setSelectedAgentIndex] = useState<number | null>(null);

  const bannerUrl = workflow.image && workflow.image.startsWith("ipfs://")
    ? getIpfsUrl(workflow.image.replace("ipfs://", ""))
    : workflow.image?.startsWith("https://")
      ? workflow.image
      : null;

  const unitsDisplay = workflow.units === 0 ? "∞" : `${workflow.units - workflow.unitsMinted}/${workflow.units}`;
  const agents = workflow.metadata?.agents || [];
  const selectedAgent = selectedAgentIndex !== null ? agents[selectedAgentIndex] : null;

  const workflowNetwork = workflow.network ?? workflow.metadata?.network;
  const chainInfo = workflowNetwork ? getChainByNetwork(workflowNetwork) : undefined;
  const chainAbbr = (chainInfo?.name || workflowNetwork || "NET").split(" ")[0].toUpperCase().slice(0, 4);
  const workflowExplorerUrl = workflowNetwork && chainInfo?.explorer && isEvmNetwork(workflowNetwork)
    ? `${chainInfo.explorer}/token/${getContractAddress("Workflow", evmChainId(workflowNetwork))}?a=${workflow.id}`
    : null;
  const creatorExplorerUrl = workflowNetwork && chainInfo?.explorer && isEvmNetwork(workflowNetwork)
    ? `${chainInfo.explorer}/address/${workflow.creator}`
    : null;

  const apiEndpoint = workflow.walletAddress
    ? `${RUNTIME_BASE_URL}/workflow/${workflow.walletAddress}`
    : null;

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

  const agentCardToOnchainAgent = (agentCard: AgentCardType, index: number): OnchainAgent => ({
    id: index + 1,
    dnaHash: agentCard.dnaHash || "",
    walletAddress: agentCard.walletAddress || "",
    licenses: agentCard.licenses || 0,
    licensesMinted: 0,
    licensesAvailable: agentCard.licenses || 0,
    licensePrice: agentCard.licensePrice || "0",
    licensePriceFormatted: formatLicensePrice(agentCard.licensePrice),
    creatorFee: agentCard.creatorFee ?? 1,
    creator: agentCard.creator || workflow.creator,
    cloneable: agentCard.cloneable || false,
    isClone: false,
    parentAgentId: 0,
    agentCardUri: "",
    metadata: agentCard,
    isWarped: false,
  });

  const getAgentAvatarUrl = (agent: AgentCardType) => {
    const image = agent.image || agent.avatar;
    if (!image || image === "none") return null;
    if (image.startsWith("ipfs://")) return getIpfsUrl(image.replace("ipfs://", ""));
    if (image.startsWith("https://")) return image;
    return null;
  };

  const getAgentInitials = (name: string) =>
    name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const handleAgentClick = (index: number) => {
    setSelectedAgentIndex(index);
    setCardView("agent-detail");
  };

  const handleBack = () => {
    if (cardView === "agent-detail") {
      setCardView("agents");
      setSelectedAgentIndex(null);
    } else if (cardView === "agents") {
      setCardView("main");
    }
  };

  if (cardView === "agent-detail" && selectedAgent) {
    const onchainAgent = agentCardToOnchainAgent(selectedAgent, selectedAgentIndex!);
    return (
      <TooltipProvider>
        <div className="cm-workflow-card">
          <div className="cm-workflow-card__fold-header">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              <span>Back to Agents</span>
            </Button>
          </div>
          <div className="cm-workflow-card__fold-body">
            <AgentCard agent={onchainAgent} />
          </div>
        </div>
      </TooltipProvider>
    );
  }

  if (cardView === "agents") {
    return (
      <TooltipProvider>
        <div className="cm-workflow-card">
          <div className="cm-workflow-card__fold-header">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              <span>Back</span>
            </Button>
            <div className="cm-workflow-card__agents-label">
              <Bot className="cm-workflow-card__agents-label-icon" />
              <span className="cm-workflow-card__agents-label-text">Agents ({agents.length})</span>
            </div>
          </div>
          <div className="cm-workflow-card__fold-body">
            <div className="cm-workflow-card__agent-list">
              {agents.map((agent, idx) => {
                const avatarUrl = getAgentAvatarUrl(agent);
                const initials = getAgentInitials(agent.name || `Agent ${idx + 1}`);
                return (
                  <button key={idx} type="button" onClick={() => handleAgentClick(idx)} className="cm-workflow-card__agent-preview">
                    <Avatar className="cm-workflow-card__agent-avatar">
                      <AvatarImage src={avatarUrl || undefined} alt={agent.name} />
                      <AvatarFallback className="bg-cyan-500/20 text-cyan-400 font-mono text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="cm-workflow-card__agent-preview-copy">
                      <p className="cm-workflow-card__agent-preview-name">{agent.name || `Agent ${idx + 1}`}</p>
                      <p className="cm-workflow-card__agent-preview-model">{agent.model || "Unknown model"}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <WorkflowCardShell
        interactive
        bannerSrc={bannerUrl}
        title={workflow.title || `Workflow #${workflow.id}`}
        titleIcon={<Layers />}
        headerAction={(
          <button
            type="button"
            onClick={() => {
              const safeUrl = safeHref(workflowExplorerUrl);
              if (safeUrl) window.open(safeUrl, "_blank", "noopener,noreferrer");
            }}
            disabled={!workflowExplorerUrl}
            className="text-muted-foreground hover:text-fuchsia-400 transition-colors shrink-0"
            aria-label="View on Explorer"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        )}
        description={(
          <Excerpt title={workflow.title || `Workflow #${workflow.id}`} text={workflow.description || "No description available"} lines={3}>
            {workflow.description || "No description available"}
          </Excerpt>
        )}
        badges={(
          <>
            {workflow.hasActiveRfa && (
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Active RFA
              </Badge>
            )}
            {workflow.leaseEnabled && (
              <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
                <Clock className="w-3 h-3 mr-1" />
                Leasable
              </Badge>
            )}
          </>
        )}
        stats={[
          { value: `$${formatPrice(workflow.totalPrice)}`, icon: <DollarSign />, tone: "fuchsia", tooltip: "Total Workflow Price" },
          { value: unitsDisplay, icon: <Package />, tone: "cyan", tooltip: "Available Units" },
          { value: String(agents.length), icon: <Bot />, tone: "fuchsia", tooltip: "Agents in Workflow" },
          { value: chainAbbr, icon: <Globe />, tone: "cyan", tooltip: chainInfo?.name ?? workflowNetwork ?? "Network" },
        ]}
        coordinatorIcon={<Cpu />}
        coordinatorValue={workflow.hasCoordinator ? workflow.coordinatorModel : undefined}
        agentsCount={agents.length}
        agentsIcon={<Bot />}
        onAgentsFold={() => setCardView("agents")}
        agentsFoldChevron={<ChevronRight className="w-4 h-4 text-muted-foreground" />}
        agentsBadges={(
          <>
            {agents.map((agent, idx) => (
              <Badge key={idx} variant="outline" className="text-xs px-2 py-0.5 border-cyan-500/30 text-cyan-400 cursor-default shrink-0">
                {agent.name || `Agent ${idx + 1}`}
              </Badge>
            ))}
          </>
        )}
        leaseSlot={workflow.leaseEnabled ? (
          <div className="cm-workflow-card__lease">
            <div className="cm-workflow-card__lease-item">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span className="cm-workflow-card__lease-label">Duration:</span>
              <span className="cm-workflow-card__lease-value text-cyan-400">{workflow.leaseDuration} days</span>
            </div>
            <div className="cm-workflow-card__lease-item">
              <Percent className="w-4 h-4 text-green-400" />
              <span className="cm-workflow-card__lease-label">Creator:</span>
              <span className="cm-workflow-card__lease-value text-green-400">{workflow.leasePercent}%</span>
            </div>
          </div>
        ) : undefined}
        endpointSlot={apiEndpoint ? (
          <div className="cm-workflow-card__endpoint-section">
            <div className="cm-workflow-card__endpoint-header">
              <Globe className="cm-workflow-card__endpoint-header-icon" />
              <span className="cm-workflow-card__endpoint-label">A2A Endpoint</span>
            </div>
            <div className="cm-workflow-card__endpoint-row">
              <code className="cm-workflow-card__endpoint-code">{apiEndpoint}</code>
              <Button variant="ghost" size="sm" onClick={handleCopyEndpoint} aria-label="Copy endpoint">
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="cm-workflow-card__creator">
              <span>Creator:</span>
              {creatorExplorerUrl ? (
                <a href={creatorExplorerUrl} target="_blank" rel="noopener noreferrer" className="cm-workflow-card__creator-value">
                  {`${workflow.creator.slice(0, 6)}...${workflow.creator.slice(-4)}`}
                </a>
              ) : (
                <span className="cm-workflow-card__creator-value">
                  {`${workflow.creator.slice(0, 6)}...${workflow.creator.slice(-4)}`}
                </span>
              )}
            </div>
          </div>
        ) : undefined}
      />
    </TooltipProvider>
  );
}

export function WorkflowCardSkeleton() {
  return <Skeleton className="cm-workflow-card-skeleton" rows={5} />;
}
