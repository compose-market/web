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