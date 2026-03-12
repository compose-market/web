import { Copy, Cpu, DollarSign, ExternalLink, Globe, Package, Wrench, Zap } from "lucide-react";
import { ComposeAgentCard, ComposeAgentCardSkeleton, type ComposeAgentBadge, type ComposeAgentMetric, type ComposeAgentTag } from "@compose-market/theme/agents";
import { ShellButton } from "@compose-market/theme/shell";
import { getIpfsUrl } from "@/lib/pinata";
import type { OnchainAgent } from "@/hooks/use-onchain";
import { CHAIN_CONFIG } from "@/lib/chains";
import { getContractAddress } from "@/lib/contracts";
import { API_BASE_URL } from "@/lib/api";

export interface AgentCardProps {
  agent: OnchainAgent;
  onCopyEndpoint?: () => void;
}

function initials(value: string): string {
  return value
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function resolveAvatarUrl(agent: OnchainAgent): string | null {
  const image = agent.metadata?.image;
  if (!image || image === "none") {
    return null;
  }
  if (image.startsWith("ipfs://")) {
    return getIpfsUrl(image.replace("ipfs://", ""));
  }
  return image.startsWith("https://") ? image : null;
}

function buildBadges(agent: OnchainAgent): ComposeAgentBadge[] {
  const badges: ComposeAgentBadge[] = [
    {
      label: "Verified",
      tone: "green",
    },
    {
      label: `#${agent.id}`,
      tone: "cyan",
    },
  ];

  if (agent.cloneable) {
    badges.splice(1, 0, {
      label: "Cloneable",
      tone: "fuchsia",
    });
  }

  return badges;
}

function buildMetrics(agent: OnchainAgent): ComposeAgentMetric[] {
  const chainInfo = CHAIN_CONFIG[agent.metadata!.chain];
  const chainAbbreviation = chainInfo.name.split(" ")[0].toUpperCase().slice(0, 4);
  const licenses = agent.licenses === 0 ? "∞" : `${agent.licensesAvailable}/${agent.licenses}`;

  return [
    {
      label: "License Price",
      value: agent.licensePriceFormatted,
      icon: <DollarSign size={16} />,
      tone: "green",
    },
    {
      label: "Licenses",
      value: licenses,
      icon: <Package size={16} />,
      tone: "cyan",
    },
    {
      label: "Protocol",
      value: "Manowar",
      icon: <Zap size={16} />,
      tone: "warning",
    },
    {
      label: "Chain",
      value: chainAbbreviation,
      icon: <Globe size={16} />,
      tone: "fuchsia",
    },
  ];
}

function buildTags(agent: OnchainAgent): ComposeAgentTag[] {
  return (agent.metadata?.plugins || []).map((plugin) => ({
    label: plugin.name || plugin.registryId,
    title: plugin.origin || plugin.registryId,
  }));
}

export function AgentCard({ agent, onCopyEndpoint }: AgentCardProps) {
  const name = agent.metadata?.name || `Agent ${agent.id}`;
  const chainId = agent.metadata!.chain;
  const avatarUrl = resolveAvatarUrl(agent);
  const apiEndpoint = agent.walletAddress ? `${API_BASE_URL}/agent/${agent.walletAddress}` : null;

  const handleCopyEndpoint = async (): Promise<void> => {
    if (!apiEndpoint) {
      return;
    }
    await navigator.clipboard.writeText(apiEndpoint);
    onCopyEndpoint?.();
  };

  return (
    <ComposeAgentCard
      interactive
      avatarAlt={name}
      avatarFallback={initials(name)}
      avatarSrc={avatarUrl}
      title={name}
      description={agent.metadata?.description || "No description available"}
      badges={buildBadges(agent)}
      metrics={buildMetrics(agent)}
      focusLabel="Model"
      focusValue={agent.metadata?.model || "Unknown"}
      focusIcon={<Cpu size={18} />}
      tagsTitle={`Tools (${agent.metadata?.plugins?.length || 0})`}
      tags={buildTags(agent)}
      headerAction={(
        <ShellButton
          tone="ghost"
          size="sm"
          iconOnly
          onClick={() => window.open(`${CHAIN_CONFIG[chainId].explorer}/token/${getContractAddress("AgentFactory", chainId)}?a=${agent.id}`, "_blank")}
          aria-label="View on Explorer"
          title="View on Explorer"
        >
          <ExternalLink size={16} />
        </ShellButton>
      )}
      footer={apiEndpoint ? (
        <div className="cm-agent-card__footer-stack">
          <div className="cm-agent-card__endpoint">
            <div className="cm-agent-card__endpoint-label">A2A Endpoint</div>
            <div className="cm-agent-card__endpoint-row">
              <code className="cm-agent-card__endpoint-code">{apiEndpoint}</code>
              <ShellButton tone="ghost" size="sm" iconOnly onClick={() => void handleCopyEndpoint()} aria-label="Copy endpoint">
                <Copy size={14} />
              </ShellButton>
            </div>
          </div>
          <div className="cm-agent-card__creator">
            <div className="cm-agent-card__creator-label">Creator</div>
            <a
              href={`${CHAIN_CONFIG[chainId].explorer}/address/${agent.creator}`}
              target="_blank"
              rel="noopener noreferrer"
              className="cm-agent-card__creator-value"
            >
              {agent.creator.slice(0, 6)}...{agent.creator.slice(-4)}
            </a>
          </div>
        </div>
      ) : null}
    />
  );
}

export function AgentCardSkeleton() {
  return <ComposeAgentCardSkeleton />;
}
