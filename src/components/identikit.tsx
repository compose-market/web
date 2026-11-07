/**
 * Agent Card & Discovery Card Components
 *
 * - `variant="market"`: Breathable 3-tier marketplace tile — prominent squircle
 *   avatar with corner verification seal, title + clean price badge, quiet model/role
 *   line, 2-line description, and borderless hairline footer.
 * - `variant="default"` / `"compact"`: Elevated Agent Identikit for `/agent` and
 *   `/create` live preview — hero identity plate, bio, harness capability glyph
 *   strip with tooltips, conditional pinned tools/docs, flat hairline economics strip,
 *   and actionable copy/explorer provenance footer.
 */
import * as React from "react";
import ArrowRightLeft from "lucide-react/icons/arrow-right-left";
import ArrowUpRight from "lucide-react/icons/arrow-up-right";
import BookOpen from "lucide-react/icons/book-open";
import Check from "lucide-react/icons/check";
import CheckCircle2 from "lucide-react/icons/check-circle-2";
import Copy from "lucide-react/icons/copy";
import Cpu from "lucide-react/icons/cpu";
import DollarSign from "lucide-react/icons/dollar-sign";
import ExternalLink from "lucide-react/icons/external-link";
import Eye from "lucide-react/icons/eye";
import GitFork from "lucide-react/icons/git-fork";
import Globe from "lucide-react/icons/globe";
import Layers from "lucide-react/icons/layers";
import Shield from "lucide-react/icons/shield";
import Star from "lucide-react/icons/star";
import Wrench from "lucide-react/icons/wrench";
import Zap from "lucide-react/icons/zap";
import type { KeyboardEvent, MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton, type Metric, type Tag } from "@compose-market/theme/entity";
import { Excerpt, Hint, ShellButton } from "@compose-market/theme/shell";
import type { OnchainAgent } from "@/hooks/use-onchain";
import {
  AGENT_REGISTRIES,
  formatInteractions,
  getReadmeExcerpt,
  type Agent,
} from "@/lib/agents";
import { CapabilityStrip, getAgentCapabilities } from "@/lib/capabilities";
import { CHAIN_CONFIG, getContractAddress } from "@/lib/performance/networks";
import { NETWORK_LOGOS } from "@/contexts/Network";
import { RUNTIME_BASE_URL } from "@/lib/performance/urls";
import { useAvatarSrc } from "@/lib/performance/avatars";
import { useTilt } from "@/motion/tilt";
import { useViewNavigate } from "@/motion/snap";
import { cn } from "@/lib/utils";

export interface AgentCardProps {
  agent: OnchainAgent;
  onCopyEndpoint?: () => void;
  onOpen?: (triggerEl?: HTMLElement | null, agent?: OnchainAgent) => void;
  className?: string;
  variant?: "default" | "market" | "compact";
  compact?: boolean;
  priority?: boolean;
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
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AG";
}

function monogramTone(seed: string): "cyan" | "fuchsia" | "emerald" {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const tones = ["cyan", "fuchsia", "emerald"] as const;
  return tones[hash % tones.length];
}

function formatMarketPrice(raw: string): { text: string; free: boolean } {
  const cleaned = raw.replace(/^\s*\$\s*/, "").trim();
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return { text: "Free", free: true };
  }
  if (value < 0.01) {
    return { text: `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`, free: false };
  }
  return { text: `$${value.toFixed(2).replace(/\.00$/, "")}`, free: false };
}

export function sizedAvatarUrl(url: string | null, size: "thumb" | "full" = "thumb"): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith("/avatar")) return url;
    parsed.searchParams.delete("w");
    parsed.searchParams.set("size", size);
    return parsed.toString();
  } catch {
    return url;
  }
}

function resolveAvatarUrl(agent: OnchainAgent): string | null {
  const avatarUrl = (agent.metadata as { avatarUrl?: string | null } | undefined)?.avatarUrl;
  return typeof avatarUrl === "string" && /^(https?:\/\/|data:image\/|blob:)/i.test(avatarUrl) ? avatarUrl : null;
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

function chainLabel(agent: OnchainAgent): string {
  const chainId = chain(agent);
  const chainInfo = conf(chainId);
  if (chainInfo) return chainInfo.name;
  return agent.network ?? agent.metadata?.network ?? "Network";
}

function NetworkMark({ agent, tooltip = true }: { agent: OnchainAgent; tooltip?: boolean }) {
  const network = agent.network ?? agent.metadata?.network;
  const logo = network ? NETWORK_LOGOS[network] : undefined;
  if (!logo) return null;
  const label = chainLabel(agent);
  const badge = (
    <span className="cm-agent-card__network" aria-label={label} title={tooltip ? undefined : label}>
      <img
        className="cm-agent-card__network-image"
        src={logo}
        alt=""
        width={18}
        height={18}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
  return tooltip ? <Hint label={label}>{badge}</Hint> : badge;
}

function short(value: string | undefined, head = 5, tail = 5): string {
  return value && value.length > head + tail + 3
    ? `${value.slice(0, head)}...${value.slice(-tail)}`
    : value || "Unknown";
}

function route(value: string | undefined): string {
  return value ? `/agent/${short(value, 8, 6)}` : "Unavailable";
}

function token(agent: OnchainAgent, chainId: number | undefined): string | null {
  const chainInfo = conf(chainId);
  if (!chainInfo || agent.id <= 0 || typeof chainId !== "number") return null;
  try {
    return `${chainInfo.explorer}/token/${getContractAddress("AgentFactory", chainId)}?a=${agent.id}`;
  } catch {
    return null;
  }
}

const MarketAgentCard = React.memo(function MarketAgentCard({
  agent,
  onOpen,
  className,
  compact = false,
  priority = false,
}: AgentCardProps) {
  const [brokenAvatarUrl, setBrokenAvatarUrl] = React.useState<string | null>(null);
  const name = agent.metadata?.name || (agent.walletAddress ? short(agent.walletAddress) : `Agent ${agent.id}`);
  const model = agent.metadata?.model || "Model";
  const isCoordinator = agent.metadata?.role === "coordinator";
  const roleLabel = isCoordinator ? "Coordinator" : "Executor";
  const roleTone = isCoordinator ? "fuchsia" : "cyan";
  const description = agent.metadata?.description?.trim() || "Ready for chat and tasks.";
  const rawAvatarUrl = sizedAvatarUrl(resolveAvatarUrl(agent), "thumb");
  const avatarSrc = useAvatarSrc(rawAvatarUrl);
  const showAvatar = Boolean(avatarSrc) && brokenAvatarUrl !== avatarSrc;
  const isCachedBlob = Boolean(avatarSrc && avatarSrc.startsWith("blob:"));
  const connectors = agent.metadata?.connectors || [];
  const price = formatMarketPrice(agent.licensePriceFormatted);
  const tone = monogramTone(agent.walletAddress || name);
  const isVerified = Boolean(
    (agent as { verified?: boolean }).verified
    ?? (agent.metadata as { verified?: boolean } | undefined)?.verified
    ?? agent.id > 0,
  );
  const visibleTools = connectors.slice(0, 2);
  const extraTools = connectors.length - visibleTools.length;

  return (
    <div className={compact ? "cm-agent-card-host" : "cm-agent-card-host cm-tilt-surface"}>
      <article
        className={cn("cm-agent-card cm-agent-card--market", className)}
        role={onOpen ? (compact ? "button" : "link") : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? (compact ? `Expand ${name}` : `Open ${name}`) : undefined}
        onClick={onOpen ? (event) => onOpen(event.currentTarget as HTMLElement, agent) : undefined}
        onKeyDown={onOpen ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(event.currentTarget as HTMLElement, agent);
          }
        } : undefined}
      >
        {/* Tier 1: Prominent Squircle Avatar + Bold Title + Price Pill + Quiet Model Line */}
        <header className="cm-agent-tile__head">
          <div className="cm-agent-tile__avatar" data-tone={tone}>
            {showAvatar && avatarSrc ? (
              <img
                src={avatarSrc}
                alt={name}
                width={60}
                height={60}
                loading={priority || isCachedBlob ? "eager" : "lazy"}
                fetchPriority={priority ? "high" : "low"}
                decoding="async"
                onError={() => setBrokenAvatarUrl(avatarSrc)}
              />
            ) : (
              <span className="cm-agent-tile__monogram" aria-hidden="true">
                {initials(name)}
              </span>
            )}
            {isVerified ? (
              <span className="cm-agent-card__verified cm-agent-tile__seal" aria-label="Verified" title="Verified">
                <Check />
              </span>
            ) : null}
          </div>

          <div className="cm-agent-tile__heading">
            <div className="cm-agent-tile__top-row">
              <h3 className="cm-agent-tile__name" title={name}>{name}</h3>
              <span className="cm-agent-tile__price" data-free={price.free ? "true" : undefined}>
                {price.text}
              </span>
            </div>
            <div className="cm-agent-tile__sub">
              <span className="cm-agent-tile__model" title={model}>{model}</span>
              <span className="cm-agent-tile__dot" aria-hidden="true">·</span>
              <span className="cm-agent-tile__role" data-tone={roleTone}>{roleLabel}</span>
            </div>
          </div>
        </header>

        {/* Tier 2: Clean Scannable 2-Line Description */}
        <p className="cm-agent-tile__desc" title={description}>
          {description}
        </p>

        {/* Tier 3: Quiet Hairline Footer (Real Tools or Direct Chat + Chain Mark) */}
        <footer className="cm-agent-tile__foot">
          <div className="cm-agent-tile__tools">
            {visibleTools.length > 0 ? (
              <>
                {visibleTools.map((connector) => (
                  <span
                    key={connector.registryId || connector.name}
                    className="cm-agent-tile__tool"
                    title={connector.name || connector.registryId}
                  >
                    {connector.name || connector.registryId}
                  </span>
                ))}
                {extraTools > 0 ? (
                  <span className="cm-agent-tile__tool cm-agent-tile__tool--more">+{extraTools}</span>
                ) : null}
              </>
            ) : (
              <span className="cm-agent-tile__quiet">Direct chat</span>
            )}
          </div>

          <div className="cm-agent-tile__trail">
            <NetworkMark agent={agent} tooltip={false} />
            {onOpen ? (
              <ArrowUpRight className="cm-agent-tile__arrow" aria-hidden="true" />
            ) : null}
          </div>
        </footer>
      </article>
    </div>
  );
});

const IdentikitAgentCard = React.memo(function IdentikitAgentCard({
  agent,
  onCopyEndpoint,
  onOpen,
  className,
  compact = false,
}: AgentCardProps) {
  const [copiedTarget, setCopiedTarget] = React.useState<"handle" | "endpoint" | null>(null);
  const [brokenAvatarUrl, setBrokenAvatarUrl] = React.useState<string | null>(null);
  const copyTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const flashCopied = (target: "handle" | "endpoint") => {
    setCopiedTarget(target);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedTarget(null), 1600);
  };

  const name = agent.metadata?.name || (agent.walletAddress ? short(agent.walletAddress) : `Agent ${agent.id}`);
  const address = agent.walletAddress ? short(agent.walletAddress) : null;
  const model = agent.metadata?.model || "Model";
  const isCoordinator = agent.metadata?.role === "coordinator";
  const roleLabel = isCoordinator ? "Coordinator" : "Executor";
  const roleTone = isCoordinator ? "fuchsia" : "cyan";
  const roleHint = isCoordinator
    ? "Coordinator — Plans multi-step work and delegates to specialist agents."
    : "Executor — Runs direct single-agent tasks, tools, and multi-model calls.";
  const description = agent.metadata?.description?.trim() || "Ready for chat and tasks.";
  const chainId = chain(agent);
  const chainInfo = conf(chainId);
  const tokenUrl = token(agent, chainId);
  const avatarUrl = sizedAvatarUrl(resolveAvatarUrl(agent), "full");
  const showAvatar = Boolean(avatarUrl) && brokenAvatarUrl !== avatarUrl;
  const apiEndpoint = agent.walletAddress ? `${RUNTIME_BASE_URL}/agent/${agent.walletAddress}` : null;
  const connectors = agent.metadata?.connectors || [];
  const knowledgeCount = agent.metadata?.knowledge?.length ?? 0;
  const price = formatMarketPrice(agent.licensePriceFormatted);
  const creatorFee = String(agent.creatorFee ?? agent.metadata?.creatorFee ?? 1).replace(/\s*%\s*$/, "");
  const licenses = agent.licenses === 0 ? "∞" : `${agent.licensesAvailable}/${agent.licenses}`;
  const tone = monogramTone(agent.walletAddress || name);
  const isVerified = Boolean(
    (agent as { verified?: boolean }).verified
    ?? (agent.metadata as { verified?: boolean } | undefined)?.verified
    ?? agent.id > 0,
  );
  const capabilities = React.useMemo(
    () => getAgentCapabilities({
      role: agent.metadata?.role,
      connectorCount: connectors.length,
      knowledgeCount,
    }),
    [agent.metadata?.role, connectors.length, knowledgeCount],
  );

  // ── Agent Identikit (`default` / `compact` — used on /agent side-panel & /create preview) ──
  const stop = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation();
  };

  const handleCopyEndpoint = async (): Promise<void> => {
    if (!apiEndpoint) return;
    await navigator.clipboard.writeText(apiEndpoint);
    flashCopied("endpoint");
    onCopyEndpoint?.();
  };

  const handleCopyWallet = async (): Promise<void> => {
    if (!agent.walletAddress) return;
    await navigator.clipboard.writeText(agent.walletAddress);
    flashCopied("handle");
  };

  const visiblePinned = connectors.slice(0, 4);
  const extraPinned = connectors.length - visiblePinned.length;
  const hasAttachments = visiblePinned.length > 0 || knowledgeCount > 0;

  return (
    <div className="cm-agent-card-host">
      <article
        className={cn("cm-agent-card cm-identikit", compact && "cm-identikit--compact", className)}
        data-role={isCoordinator ? "coordinator" : "executor"}
        data-compact={compact ? "true" : undefined}
        role={onOpen ? (compact ? "button" : "link") : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? (compact ? `Expand ${name}` : `Open ${name}`) : undefined}
        onClick={onOpen ? (event) => onOpen(event.currentTarget as HTMLElement, agent) : undefined}
        onKeyDown={onOpen ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(event.currentTarget as HTMLElement, agent);
          }
        } : undefined}
      >
        {/* Tier 1: Hero Identity Plate */}
        <header className="cm-identikit__head">
          <div className="cm-identikit__portrait" data-tone={isCoordinator ? "fuchsia" : tone}>
            {showAvatar && avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name}
                width={72}
                height={72}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                onError={() => setBrokenAvatarUrl(avatarUrl)}
              />
            ) : (
              <span className="cm-agent-tile__monogram" data-tone={tone} aria-hidden="true">
                {initials(name)}
              </span>
            )}
            {isVerified ? (
              <Hint label="Verified on-chain">
                <span className="cm-agent-card__verified cm-agent-tile__seal" aria-label="Verified">
                  <Check />
                </span>
              </Hint>
            ) : null}
          </div>

          <div className="cm-identikit__identity">
            <div className="cm-identikit__title-row">
              <h2 className="cm-identikit__name" title={name}>{name}</h2>
              <div className="cm-identikit__title-actions">
                <NetworkMark agent={agent} />
                {compact ? (
                  <span className="cm-agent-tile__price" data-free={price.free ? "true" : undefined}>
                    {price.text}
                  </span>
                ) : tokenUrl ? (
                  <Hint label="View on block explorer">
                    <button
                      type="button"
                      className="cm-identikit__icon-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        window.open(tokenUrl, "_blank", "noopener,noreferrer");
                      }}
                      aria-label="View on Explorer"
                    >
                      <ExternalLink />
                    </button>
                  </Hint>
                ) : null}
              </div>
            </div>

            <div className="cm-identikit__meta-row">
              <Hint label={`Base model: ${model}`}>
                <span className="cm-identikit__model">
                  <Cpu aria-hidden="true" />
                  <span>{model}</span>
                </span>
              </Hint>
              <Hint label={roleHint}>
                <span className="cm-identikit__role" data-tone={roleTone}>
                  {roleLabel}
                </span>
              </Hint>
            </div>

            {!compact && address ? (
              <Hint label={copiedTarget === "handle" ? "Copied wallet" : `Copy ${agent.walletAddress}`}>
                <button
                  type="button"
                  className="cm-identikit__handle"
                  onClick={(event) => {
                    stop(event);
                    void handleCopyWallet();
                  }}
                >
                  <span>{address}</span>
                  {copiedTarget === "handle" ? <Check className="cm-identikit__handle-check" /> : <Copy />}
                </button>
              </Hint>
            ) : null}
          </div>
        </header>

        {/* Tier 2: Purpose / Bio */}
        <div className="cm-identikit__bio">
          <Excerpt title={name} text={description} lines={compact ? 2 : 3}>
            {description}
          </Excerpt>
        </div>

        {/* Tier 3: Harness Capabilities Glyph Strip */}
        <section className="cm-identikit__section" aria-label="Capabilities">
          <div className="cm-identikit__section-head">
            <span className="cm-identikit__kicker">Capabilities</span>
            {agent.cloneable ? (
              <Hint label="Cloneable — builders can derive new agents with creator attribution.">
                <span className="cm-identikit__flag">
                  <GitFork aria-hidden="true" />
                  <span>Cloneable</span>
                </span>
              </Hint>
            ) : null}
          </div>
          <CapabilityStrip capabilities={capabilities} size={compact ? "sm" : "md"} />
        </section>

        {/* Tier 4: Pinned Tools & Reference Knowledge (Conditional — zero empty boxes) */}
        {!compact && hasAttachments ? (
          <section className="cm-identikit__section" aria-label="Pinned tools and knowledge">
            <span className="cm-identikit__kicker">Pinned</span>
            <div className="cm-identikit__chips">
              {visiblePinned.map((connector) => (
                <Hint key={connector.registryId || connector.name} label={connector.origin || connector.name || connector.registryId}>
                  <span className="cm-identikit__chip">
                    <Wrench aria-hidden="true" />
                    <span>{connector.name || connector.registryId}</span>
                  </span>
                </Hint>
              ))}
              {extraPinned > 0 ? (
                <span className="cm-identikit__chip cm-identikit__chip--more">+{extraPinned}</span>
              ) : null}
              {knowledgeCount > 0 ? (
                <Hint label={`${knowledgeCount} IPFS-backed reference ${knowledgeCount === 1 ? "document" : "documents"}`}>
                  <span className="cm-identikit__chip cm-identikit__chip--knowledge">
                    <BookOpen aria-hidden="true" />
                    <span>{knowledgeCount} {knowledgeCount === 1 ? "doc" : "docs"}</span>
                  </span>
                </Hint>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Tier 5: Flat Hairline Economics Spec Row */}
        {!compact ? (
          <dl className="cm-identikit__specs" aria-label="Economics">
            <div className="cm-identikit__spec">
              <dt>Price</dt>
              <dd data-tone={price.free ? "emerald" : "cyan"}>{price.text}</dd>
            </div>
            <div className="cm-identikit__spec">
              <dt>Supply</dt>
              <dd>{licenses}</dd>
            </div>
            <div className="cm-identikit__spec">
              <dt>Royalty</dt>
              <dd>{creatorFee}%</dd>
            </div>
          </dl>
        ) : null}

        {/* Tier 6: Actionable Provenance Footer */}
        {!compact && apiEndpoint ? (
          <footer className="cm-identikit__foot">
            <button
              type="button"
              className="cm-identikit__a2a"
              onClick={(event) => {
                stop(event);
                void handleCopyEndpoint();
              }}
              onKeyDown={(event) => {
                stop(event);
              }}
              title={apiEndpoint}
              aria-label="Copy endpoint"
            >
              <span className="cm-identikit__a2a-tag">A2A</span>
              <code className="cm-identikit__a2a-route">{route(agent.walletAddress)}</code>
              {copiedTarget === "endpoint"
                ? <Check className="cm-identikit__a2a-icon cm-identikit__a2a-icon--done" />
                : <Copy className="cm-identikit__a2a-icon" />}
            </button>

            <div className="cm-identikit__creator">
              <span className="cm-identikit__creator-label">By</span>
              {chainInfo?.explorer && agent.creator ? (
                <a
                  href={`${chainInfo.explorer}/address/${agent.creator}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cm-identikit__creator-link"
                  onClick={(event) => event.stopPropagation()}
                >
                  {short(agent.creator, 4, 4)}
                </a>
              ) : (
                <span className="cm-identikit__creator-link">{short(agent.creator, 4, 4)}</span>
              )}
            </div>
          </footer>
        ) : null}
      </article>
    </div>
  );
});

export const AgentCard = React.memo(function AgentCard(props: AgentCardProps) {
  if (props.variant === "market") {
    return <MarketAgentCard {...props} />;
  }
  return <IdentikitAgentCard {...props} />;
});

function buildDiscoveryTags(agent: DiscoveryAgent, limit = 3): Tag[] {
  const rawTags = agent.tags || [];
  if (rawTags.length === 0) {
    return [{ label: agent.category || "General", title: agent.category || "General" }];
  }
  const visible = rawTags.slice(0, limit).map((tag) => ({ label: tag, title: tag }));
  const hidden = rawTags.length - visible.length;
  return hidden > 0
    ? [...visible, { label: `+${hidden}`, title: `${hidden} more tags` }]
    : visible;
}

function discoveryMetrics(agent: DiscoveryAgent): Metric[] {
  if (agent.registry === "manowar" && agent.price) {
    return [
      {
        label: "Price",
        value: formatMarketPrice(agent.price).text,
        icon: <DollarSign />,
        tone: "green",
      },
      {
        label: "Units",
        value: `${agent.units || "0"}`,
        icon: <Layers />,
        tone: "cyan",
      },
      {
        label: "Type",
        value: agent.type === "hosted" ? "Hosted" : "On-chain",
        icon: <Globe />,
        tone: "fuchsia",
      },
    ];
  }

  return [
    {
      label: "Uses",
      value: formatInteractions(agent.totalInteractions),
      icon: <Zap />,
      tone: "green",
    },
    {
      label: "Rating",
      value: agent.rating.toFixed(1),
      icon: <Star />,
      tone: "warning",
    },
    {
      label: "Category",
      value: agent.category || "Agent",
      icon: <Layers />,
      tone: "cyan",
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

export const DiscoveryAgentCard = React.memo(function DiscoveryAgentCard({ agent, onSelect, className }: DiscoveryAgentCardProps) {
  const navigate = useViewNavigate();
  const tiltRef = useTilt<HTMLDivElement>({ maxDeg: 2.5, enabled: true });
  const [brokenAvatarUrl, setBrokenAvatarUrl] = React.useState<string | null>(null);
  const isManowar = agent.registry === "manowar";
  const registryInfo = AGENT_REGISTRIES[agent.registry];
  const externalRegistry = !isManowar ? agent.registry : null;
  const externalAddress = !isManowar ? agent.address : null;
  const { data: externalWarpData } = useExternalWarpStatus(externalRegistry, externalAddress);
  const warped = isManowar ? agent.isWarped : externalWarpData?.isWarped;
  const excerpt = agent.description || (agent.readme ? getReadmeExcerpt(agent.readme, 100) : "Ready for chat and tasks.");
  const registry = registryInfo?.name || agent.registry;
  const statusLabel = warped ? "Warped" : isManowar ? "On-chain" : agent.type === "hosted" ? "Hosted" : "Active";
  const tone = monogramTone(agent.address || agent.name);
  const avatarUrl = sizedAvatarUrl(agent.avatarUrl ?? null, "thumb");
  const showAvatar = Boolean(avatarUrl) && brokenAvatarUrl !== avatarUrl;

  const handleWarp = (event: MouseEvent) => {
    event.stopPropagation();
    sessionStorage.setItem("warpAgent", JSON.stringify(agent));
    navigate("/create?warp=true");
  };

  const handleViewEndpoint = (event: MouseEvent) => {
    event.stopPropagation();
    if (agent.walletAddress) {
      navigate(`/agent/${agent.walletAddress}`);
    }
  };

  return (
    <div ref={tiltRef} className="cm-agent-card-host cm-tilt-surface">
      <Card
        interactive
        variant="market"
        className={cn("cm-agent-card", className)}
        onClick={() => onSelect(agent)}
        media={showAvatar && avatarUrl ? (
          <img
            src={avatarUrl}
            alt={agent.name}
            width={60}
            height={60}
            loading="lazy"
            decoding="async"
            onError={() => setBrokenAvatarUrl(avatarUrl)}
          />
        ) : (
          <span className="cm-agent-tile__monogram" data-tone={tone} aria-hidden="true">
            {initials(agent.name)}
          </span>
        )}
        mediaFallback={initials(agent.name)}
        title={(
          <span className="cm-agent-card__identity">
            <span className="cm-agent-card__identity-head">
              <span className="cm-agent-card__identity-name">{agent.name}</span>
              {agent.verified ? (
                <Hint label="Verified">
                  <span className="cm-agent-card__verified" aria-label="Verified">
                    <Shield />
                  </span>
                </Hint>
              ) : null}
            </span>
            <span className="cm-agent-card__identity-meta">
              <span className="cm-agent-card__model">
                <Globe />
                <span className="cm-agent-card__model-name">{registry}</span>
              </span>
              <span className="cm-agent-card__model" data-tone={warped ? "warning" : undefined}>
                <Zap />
                <span className="cm-agent-card__model-name">{statusLabel}</span>
              </span>
            </span>
          </span>
        )}
        description={(
          <Excerpt title={agent.name} text={excerpt} lines={2}>
            {excerpt}
          </Excerpt>
        )}
        metrics={discoveryMetrics(agent)}
        tagsTitle={(
          <Hint label="Capabilities">
            <span className="cm-agent-card__tools-icon" aria-label="Capabilities">
              <Wrench />
            </span>
          </Hint>
        )}
        tags={buildDiscoveryTags(agent, 2)}
        headerAction={agent.externalUrl ? (
          <ShellButton
            tone="ghost"
            size="sm"
            iconOnly
            onClick={(event) => {
              event.stopPropagation();
              window.open(agent.externalUrl, "_blank", "noopener,noreferrer");
            }}
            aria-label="Open external profile"
            title="Open external profile"
          >
            <ExternalLink className="cm-agent-card__inline-svg" />
          </ShellButton>
        ) : undefined}
        footer={(
          <div className="cm-agent-card__action-stack">
            <ShellButton
              tone={isManowar ? "secondary" : "primary"}
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(agent);
              }}
            >
              <Check className="cm-agent-card__inline-svg" />
              Select
            </ShellButton>
            {!isManowar && !externalWarpData?.isWarped ? (
              <ShellButton tone="secondary" size="sm" onClick={handleWarp}>
                <ArrowRightLeft className="cm-agent-card__inline-svg" />
                Warp
              </ShellButton>
            ) : null}
            {!isManowar && externalWarpData?.isWarped ? (
              <ShellButton tone="secondary" size="sm" disabled>
                <CheckCircle2 className="cm-agent-card__inline-svg" />
                Warped
              </ShellButton>
            ) : null}
            {isManowar ? (
              <ShellButton tone="secondary" size="sm" onClick={handleViewEndpoint}>
                <Eye className="cm-agent-card__inline-svg" />
                View
              </ShellButton>
            ) : null}
          </div>
        )}
      />
    </div>
  );
});

export function AgentCardSkeleton() {
  return <Skeleton className="cm-agent-card cm-agent-card--market" />;
}
