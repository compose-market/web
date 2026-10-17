import { Copy, Cpu, DollarSign, ExternalLink, Globe, Percent, ScrollText, Wrench, Zap, ArrowRightLeft, Check, CheckCircle2, Eye, Layers, Shield, Star } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AgentCard as ThemeAgentCard,
  AgentCardSkeleton as ThemeAgentCardSkeleton,
  type AgentBadge as AgentBadge,
  type AgentMetric as AgentMetric,
  type AgentTag as AgentTag,
} from "@compose-market/theme/agents";
import { Excerpt, Hint, ShellButton } from "@compose-market/theme/shell";
import { useLocation } from "wouter";
import { usePostHog } from "@posthog/react";
import type { OnchainAgent } from "@/hooks/use-onchain";
import {
  AGENT_REGISTRIES,
  formatInteractions,
  getReadmeExcerpt,
  type Agent,
} from "@/lib/agents";
import { CHAIN_CONFIG, getContractAddress } from "@/lib/performance/chains-data";
import { NETWORK_LOGOS } from "@/contexts/Network";
import { API_BASE_URL } from "@/lib/sdk";

export interface AgentCardProps {
  agent: OnchainAgent;
  onCopyEndpoint?: () => void;
  onOpen?: () => void;
  className?: string;
  variant?: "default" | "market" | "compact";
}

export interface DiscoveryAgent extends Agent {
  price?: string;
  units?: string;
  cloneable?: boolean;
  isClone?: boolean;
  isWarped?: boolean;
  walletAddress?: string;
}

export interface DiscoveryAgentCardProps {
  agent: DiscoveryAgent;
  onSelect: (agent: Agent) => void;
  className?: string;
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
  const avatarUrl = (agent.metadata as { avatarUrl?: string | null } | undefined)?.avatarUrl;
  return typeof avatarUrl === "string" && /^https?:\/\//i.test(avatarUrl) ? avatarUrl : null;
}

function chainLabel(agent: OnchainAgent): string {
  const chainId = chain(agent);
  const chainInfo = conf(chainId);
  if (chainInfo) {
    return chainInfo.name;
  }
  return agent.network ?? agent.metadata?.network ?? "Unknown Chain";
}

function buildBadges(agent: OnchainAgent, market: boolean): AgentBadge[] {
  if (market) {
    return [];
  }
  void agent;
  return [];
}

function NetworkMark({ agent }: { agent: OnchainAgent }) {
  const network = agent.network ?? agent.metadata?.network;
  const logo = network ? NETWORK_LOGOS[network] : undefined;
  if (!logo) {
    return null;
  }
  const label = chainLabel(agent);
  return (
    <Hint label={label}>
      <span className="cm-agent-card__network" aria-label={label}>
        <img
          className="cm-agent-card__network-image"
          src={logo}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </span>
    </Hint>
  );
}

function chain(agent: OnchainAgent): number | undefined {
  const network = agent.network ?? agent.metadata?.network;
  if (!network?.startsWith("eip155:")) return undefined;
  const value = Number.parseInt(network.slice("eip155:".length), 10);
  return Number.isFinite(value) ? value : undefined;
}

function conf(chainId: number | undefined): (typeof CHAIN_CONFIG)[number] | undefined {
  return typeof chainId === "number" && Object.prototype.hasOwnProperty.call(CHAIN_CONFIG, chainId)
    ? CHAIN_CONFIG[chainId]
    : undefined;
}

function short(value: string | undefined, head = 5, tail = 5): string {
  return value && value.length > head + tail + 3
    ? `${value.slice(0, head)}...${value.slice(-tail)}`
    : value || "Unknown";
}

function route(value: string | undefined): string {
  return value ? `/agent/${value.slice(0, 5)}...` : "Unavailable";
}

function token(agent: OnchainAgent, chainId: number | undefined): string | null {
  const chainInfo = conf(chainId);
  if (!chainInfo || agent.id <= 0 || typeof chainId !== "number") {
    return null;
  }
  try {
    return `${chainInfo.explorer}/token/${getContractAddress("AgentFactory", chainId)}?a=${agent.id}`;
  } catch {
    return null;
  }
}

function buildMetrics(agent: OnchainAgent): AgentMetric[] {
  const licenses = agent.licenses === 0 ? "∞" : `${agent.licensesAvailable}/${agent.licenses}`;
  const licensePrice = agent.licensePriceFormatted.replace(/^\s*\$\s*/, "");
  const creatorFee = String(agent.creatorFee ?? agent.metadata?.creatorFee ?? 1).replace(/\s*%\s*$/, "");

  return [
    {
      label: "License Price",
      value: licensePrice,
      icon: <DollarSign size={16} />,
      tone: "green",
    },
    {
      label: "Licenses",
      value: licenses,
      icon: <ScrollText size={16} />,
      tone: "cyan",
    },
    {
      label: "Creator Fee",
      value: creatorFee,
      icon: <Percent size={16} />,
      tone: "green",
    },
  ];
}

function buildTags(agent: OnchainAgent, limit?: number): AgentTag[] {
  const connectors = agent.metadata?.connectors || [];
  if (connectors.length === 0) {
    return [{ label: "No tools", title: "No tools registered" }];
  }

  const visible = typeof limit === "number" ? connectors.slice(0, limit) : connectors;
  const tags = visible.map((connector) => ({
    label: connector.name || connector.registryId,
    title: connector.origin || connector.registryId,
  }));
  const hidden = connectors.length - visible.length;

  return hidden > 0
    ? [...tags, { label: `+${hidden}`, title: `${hidden} more tools` }]
    : tags;
}

export function AgentCard({ agent, onCopyEndpoint, onOpen, className, variant = "default" }: AgentCardProps) {
  const isMarketCard = variant === "market";

  const name = agent.metadata?.name || (agent.walletAddress ? short(agent.walletAddress) : `Agent ${agent.id}`);
  const address = agent.walletAddress ? short(agent.walletAddress) : null;
  const model = agent.metadata?.model || "Unknown";
  const framework = agent.metadata?.framework === "other" ? "Other" : "Manowar";
  const description = agent.metadata?.description || "No description available";
  const chainId = chain(agent);
  const chainInfo = conf(chainId);
  const tokenUrl = token(agent, chainId);
  const avatarUrl = resolveAvatarUrl(agent);
  const apiEndpoint = agent.walletAddress ? `${API_BASE_URL}/agent/${agent.walletAddress}` : null;

  const stop = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation();
  };

  const handleCopyEndpoint = async (): Promise<void> => {
    if (!apiEndpoint) {
      return;
    }
    await navigator.clipboard.writeText(apiEndpoint);
    onCopyEndpoint?.();
  };

  return (
    <ThemeAgentCard
      interactive
      variant={isMarketCard ? "market" : variant}
      className={className}
      role={onOpen ? "link" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Open ${name}` : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        }
      } : undefined}
      avatarAlt={name}
      avatarFallback={initials(name)}
      avatarSrc={avatarUrl}
      title={(
        <span className="cm-agent-card__identity">
          <span className="cm-agent-card__identity-head">
            <span className="cm-agent-card__identity-name">{name}</span>
            <Hint label="Verified">
              <span className="cm-agent-card__verified" aria-label="Verified">
                <Check size={18} />
              </span>
            </Hint>
            <NetworkMark agent={agent} />
          </span>
          {address ? <span className="cm-agent-card__identity-address">{address}</span> : null}
          <span className="cm-agent-card__identity-meta">
            <Hint label={model}>
              <span className="cm-agent-card__model">
                <Cpu size={11} />
                <span className="cm-agent-card__model-name">{model}</span>
              </span>
            </Hint>
            <Hint label={framework}>
              <span className="cm-agent-card__model" data-tone="warning">
                <Zap size={11} />
                <span className="cm-agent-card__model-name">{framework}</span>
              </span>
            </Hint>
          </span>
        </span>
      )}
      description={(
        <Excerpt title={name} text={description} lines={isMarketCard ? 3 : 4}>
          {description}
        </Excerpt>
      )}
      badges={buildBadges(agent, isMarketCard)}
      metrics={buildMetrics(agent)}
      tagsTitle={(
        <Hint label="Tools">
          <span className="cm-agent-card__tools-icon" aria-label={`Tools (${agent.metadata?.connectors?.length || 0})`}>
            <Wrench size={14} />
          </span>
        </Hint>
      )}
      tags={buildTags(agent, isMarketCard ? 4 : 6)}
      headerAction={tokenUrl ? (
        <ShellButton
          tone="ghost"
          size="sm"
          iconOnly
          onClick={(event) => {
            event.stopPropagation();
            window.open(tokenUrl, "_blank");
          }}
          aria-label="View on Explorer"
          title="View on Explorer"
        >
          <ExternalLink size={16} />
        </ShellButton>
      ) : undefined}
      footer={!isMarketCard && apiEndpoint ? (
        <div className="cm-agent-card__footer-stack">
          <div className="cm-agent-card__endpoint">
            <div
              role="button"
              tabIndex={0}
              className="cm-agent-card__endpoint-row"
              onClick={(event) => {
                stop(event);
                void handleCopyEndpoint();
              }}
              onKeyDown={(event) => {
                stop(event);
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void handleCopyEndpoint();
                }
              }}
              title={apiEndpoint}
            >
              <span className="cm-agent-card__endpoint-label">A2A</span>
              <code className="cm-agent-card__endpoint-code">{route(agent.walletAddress)}</code>
              <ShellButton
                tone="ghost"
                size="sm"
                iconOnly
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCopyEndpoint();
                }}
                aria-label="Copy endpoint"
              >
                <Copy size={14} />
              </ShellButton>
            </div>
          </div>
          <div className="cm-agent-card__creator">
            <div className="cm-agent-card__creator-label">Creator</div>
            {chainInfo?.explorer && agent.creator ? (
              <a
                href={`${chainInfo.explorer}/address/${agent.creator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="cm-agent-card__creator-value"
                onClick={(event) => event.stopPropagation()}
              >
                {short(agent.creator)}
              </a>
            ) : (
              <span className="cm-agent-card__creator-value">{short(agent.creator)}</span>
            )}
          </div>
        </div>
      ) : null}
    />
  );
}

function discoveryBadges(
  agent: DiscoveryAgent,
  registry: string,
  warped: boolean | undefined,
): AgentBadge[] {
  const badges: AgentBadge[] = [
    {
      label: registry,
      tone: agent.registry === "manowar" ? "cyan" : "fuchsia",
      icon: agent.registry === "manowar" ? <Globe size={12} /> : undefined,
    },
  ];

  if (agent.registry === "manowar") {
    badges.push({ label: "On-chain", tone: "cyan", icon: <Zap size={12} /> });
  }
  if (warped) {
    badges.push({ label: "Warped", tone: "fuchsia", icon: <ArrowRightLeft size={12} /> });
  }
  if (agent.verified) {
    badges.push({ label: "Verified", tone: "green", icon: <Shield size={12} /> });
  }
  if (agent.featured) {
    badges.push({ label: "Featured", tone: "warning", icon: <Star size={12} /> });
  }
  if (agent.cloneable) {
    badges.push({ label: "Cloneable", tone: "fuchsia" });
  }
  if (agent.isClone) {
    badges.push({ label: "Clone", tone: "warning" });
  }
  badges.push({ label: agent.category, tone: "neutral" });
  if (agent.type === "hosted") {
    badges.push({ label: "Hosted", tone: "cyan" });
  }
  return badges;
}

function discoveryMetrics(agent: DiscoveryAgent): AgentMetric[] {
  if (agent.registry === "manowar" && agent.price) {
    return [
      {
        label: "License Price",
        value: agent.price,
        icon: <Zap size={16} />,
        tone: "green",
      },
      {
        label: "Units",
        value: `${agent.units || "0"} units`,
        icon: <Layers size={16} />,
        tone: "cyan",
      },
    ];
  }

  return [
    {
      label: "Uses",
      value: formatInteractions(agent.totalInteractions),
      icon: <Zap size={16} />,
      tone: "green",
    },
    {
      label: "Rating",
      value: agent.rating.toFixed(1),
      icon: <Star size={16} />,
      tone: "warning",
    },
  ];
}

function useExternalWarpStatus(registry: string | null, address: string | null) {
  return useQuery({
    queryKey: ["is-external-warped", registry, address],
    queryFn: async () => {
      if (!registry || !address) {
        return { isWarped: false, warpedAgentId: 0 };
      }
      const { fetchExternalWarpStatus } = await import("@/hooks/use-warp");
      return fetchExternalWarpStatus(registry, address);
    },
    enabled: Boolean(registry && address),
    staleTime: 60 * 1000,
  });
}

export function DiscoveryAgentCard({ agent, onSelect, className }: DiscoveryAgentCardProps) {
  const [, setLocation] = useLocation();
  const posthog = usePostHog();
  const isManowar = agent.registry === "manowar";
  const registryInfo = AGENT_REGISTRIES[agent.registry];
  const externalRegistry = !isManowar ? agent.registry : null;
  const externalAddress = !isManowar ? agent.address : null;
  const { data: externalWarpData } = useExternalWarpStatus(externalRegistry, externalAddress);
  const warped = isManowar ? agent.isWarped : externalWarpData?.isWarped;
  const excerpt = agent.description || (agent.readme ? getReadmeExcerpt(agent.readme, 100) : "");
  const registry = registryInfo?.name || agent.registry;

  const handleWarp = () => {
    posthog?.capture("agent_warp_initiated", {
      agent_id: agent.id,
      agent_name: agent.name,
      agent_registry: agent.registry,
    });
    sessionStorage.setItem("warpAgent", JSON.stringify(agent));
    setLocation("/create-agent?warp=true");
  };

  const handleViewEndpoint = () => {
    if (agent.walletAddress) {
      setLocation(`/agent/${agent.walletAddress}`);
    }
  };

  return (
    <ThemeAgentCard
      interactive
      className={className}
      avatarAlt={agent.name}
      avatarFallback={initials(agent.name)}
      avatarSrc={agent.avatarUrl}
      title={(
        <span className="cm-agent-card__identity">
          <span className="cm-agent-card__identity-head">
            <span className="cm-agent-card__identity-name">{agent.name}</span>
          </span>
          <span className="cm-agent-card__identity-address">{registry}</span>
        </span>
      )}
      description={(
        <Excerpt title={agent.name} text={excerpt} lines={3}>
          {excerpt}
        </Excerpt>
      )}
      badges={discoveryBadges(agent, registry, warped)}
      metrics={discoveryMetrics(agent)}
      tagsTitle="Tags"
      tags={(agent.tags || []).slice(0, 6).map((tag) => ({ label: tag }))}
      headerAction={agent.externalUrl ? (
        <ShellButton
          tone="ghost"
          size="sm"
          iconOnly
          onClick={() => window.open(agent.externalUrl, "_blank")}
          aria-label="Open external profile"
          title="Open external profile"
        >
          <ExternalLink size={16} />
        </ShellButton>
      ) : undefined}
      footer={(
        <div className="cm-agent-card__action-stack">
          <ShellButton tone={isManowar ? "secondary" : "primary"} size="sm" onClick={() => onSelect(agent)}>
            <Check size={14} />
            Select
          </ShellButton>
          {!isManowar && !externalWarpData?.isWarped ? (
            <ShellButton tone="secondary" size="sm" onClick={handleWarp}>
              <ArrowRightLeft size={14} />
              Warp
            </ShellButton>
          ) : null}
          {!isManowar && externalWarpData?.isWarped ? (
            <ShellButton tone="secondary" size="sm" disabled>
              <CheckCircle2 size={14} />
              Warped
            </ShellButton>
          ) : null}
          {isManowar ? (
            <ShellButton tone="secondary" size="sm" onClick={handleViewEndpoint}>
              <Eye size={14} />
              View
            </ShellButton>
          ) : null}
        </div>
      )}
    />
  );
}

export function AgentCardSkeleton() {
  return <ThemeAgentCardSkeleton />;
}
