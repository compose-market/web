/**
 * Agent Harness Capability Visual Language
 *
 * Maps the real runtime harness modules (`runtime/src/manowar/harness/tools/`)
 * to semantic Lucide glyphs, tones, and plain-English `<Hint>` tooltips —
 * matching `ModelCard`'s modality badge grammar (`web/src/lib/modalities.tsx`).
 */
import type { LucideIcon } from "lucide-react";
import Blocks from "lucide-react/icons/blocks";
import BookOpen from "lucide-react/icons/book-open";
import Brain from "lucide-react/icons/brain";
import Globe from "lucide-react/icons/globe";
import Network from "lucide-react/icons/network";
import Plug from "lucide-react/icons/plug";
import Sparkles from "lucide-react/icons/sparkles";
import { Hint } from "@compose-market/theme/shell";
import { cn } from "@/lib/utils";

export type CapabilityId =
  | "memory"
  | "search"
  | "web3"
  | "models"
  | "connectors"
  | "swarm"
  | "knowledge";

export type CapabilityTone = "cyan" | "fuchsia" | "emerald" | "amber";

export interface Capability {
  id: CapabilityId;
  label: string;
  summary: string;
  tone: CapabilityTone;
  badge?: string;
}

export interface CapabilityInput {
  role?: string | null;
  connectorCount?: number;
  knowledgeCount?: number;
}

const ICONS: Record<CapabilityId, LucideIcon> = {
  memory: Brain,
  search: Globe,
  web3: Blocks,
  models: Sparkles,
  connectors: Plug,
  swarm: Network,
  knowledge: BookOpen,
};

/**
 * Derives the exact runtime harness capabilities available to an agent
 * from structured card metadata (`role`, pinned `connectors`, attached `knowledge`).
 */
export function getAgentCapabilities(input: CapabilityInput): Capability[] {
  const isCoordinator = input.role === "coordinator";
  const connectors = Math.max(0, input.connectorCount ?? 0);
  const knowledge = Math.max(0, input.knowledgeCount ?? 0);

  const items: Capability[] = [
    {
      id: "memory",
      label: "Memory",
      summary: "Remembers context and facts across conversations.",
      tone: "cyan",
    },
    {
      id: "search",
      label: "Web Search",
      summary: "Searches live web pages, news, and docs.",
      tone: "cyan",
    },
    {
      id: "web3",
      label: "Web3 Intel",
      summary: "Queries live token, contract, and on-chain data.",
      tone: "amber",
    },
    {
      id: "models",
      label: "Use Models",
      summary: "Calls 650+ text, image, audio, and video models on demand.",
      tone: "fuchsia",
    },
    {
      id: "connectors",
      label: "Connectors",
      summary: connectors > 0
        ? `Runs ${connectors} pinned ${connectors === 1 ? "tool" : "tools"} plus on-demand apps and MCP servers.`
        : "Discovers and runs external apps, APIs, and MCP tools on demand.",
      tone: "fuchsia",
      badge: connectors > 0 ? String(connectors) : undefined,
    },
  ];

  if (isCoordinator) {
    items.push({
      id: "swarm",
      label: "Swarm Agents",
      summary: "Plans multi-step work and delegates tasks to specialist agents.",
      tone: "fuchsia",
    });
  }

  if (knowledge > 0) {
    items.push({
      id: "knowledge",
      label: "Knowledge",
      summary: `Searches ${knowledge} attached reference ${knowledge === 1 ? "document" : "documents"}.`,
      tone: "emerald",
      badge: String(knowledge),
    });
  }

  return items;
}

export function capabilityIcon(id: CapabilityId, className = "cm-cap-glyph__icon") {
  const Icon = ICONS[id];
  return <Icon className={className} aria-hidden="true" />;
}

export interface CapabilityStripProps {
  capabilities: Capability[];
  size?: "sm" | "md";
  showLabels?: boolean;
  className?: string;
}

export function CapabilityStrip({
  capabilities,
  size = "md",
  showLabels = false,
  className,
}: CapabilityStripProps) {
  return (
    <div
      className={cn("cm-cap-strip", size === "sm" && "cm-cap-strip--sm", showLabels && "cm-cap-strip--labeled", className)}
      role="list"
      aria-label="Agent capabilities"
    >
      {capabilities.map((cap) => {
        const tooltip = `${cap.label} — ${cap.summary}`;
        return (
          <Hint key={cap.id} label={tooltip}>
            <span
              role="listitem"
              tabIndex={0}
              className="cm-cap-glyph"
              data-tone={cap.tone}
              data-capability={cap.id}
              aria-label={tooltip}
            >
              {capabilityIcon(cap.id)}
              {showLabels ? <span className="cm-cap-glyph__label">{cap.label}</span> : null}
              {cap.badge ? <span className="cm-cap-glyph__count">{cap.badge}</span> : null}
            </span>
          </Hint>
        );
      })}
    </div>
  );
}
