/**
 * Trace — Readable Agentic Flow & Delegation Sheet (Surface 3)
 *
 * Replaces the cramped, buggy, truncated mission-control.tsx with a clean,
 * responsive, human-readable flow inspector showing:
 *   - Agent ↔ Sub-Agent delegations (brief, model, notes, reasoning, latency, batches)
 *   - Agent ↔ Connector / Tool calls (readable inputs, outputs, candidate selections)
 *   - Agent ↔ Model steps (CoT reasoning, responses, token usage)
 *   - Swarm Bus (conclave) messages & Six-Layer Memory recalls/writes
 *   - Interactive Plan & Clarify review (full markdown, live task status, version switch)
 *   - Itemized x402 settlement receipt tree (bills breakdown)
 *
 * Zero permanent truncation (every prompt/output expands cleanly in full),
 * zero fake idle/running statuses, accurate node counts with hiddenIds respected.
 */

import * as React from "react";
import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Cpu,
  Database,
  ExternalLink,
  GitBranch,
  Loader2,
  Plug,
  Radio,
  Sparkles,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import type { ActivityNode, ActivityState, Bill, Receipt } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";
import type { Plan, Task } from "@/hooks/use-chat";
import { formatWeiUsd, settlementTone, shortTx, timeAgo } from "@/lib/receipts";
import { getExplorerTxUrl } from "@/lib/chains";
import { summarizeTurnReceipts } from "@/hooks/use-receipts";
import { MarkdownRenderer } from "@/lib/performance/markdown";
import { cn } from "@/lib/utils";

export interface TraceProps {
  open: boolean;
  onClose: () => void;
  activity?: ActivityState;
  plan?: Plan;
  planVersions?: Plan[];
  receipt?: Receipt;
  receipts?: Receipt[];
  usage?: Record<string, unknown>;
  focusedNodeId?: string | null;
  onPlanDecision?: (plan: Plan, decision: NonNullable<Plan["decision"]>, feedback?: string) => void;
  mode?: "sheet" | "inline";
  className?: string;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatMs(ms?: number): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? `• ${item}` : readableValue(item)))
      .filter(Boolean)
      .join("\n");
  }
  const obj = rec(value);
  if (!obj) return String(value);
  const directText = str(obj.prompt)
    ?? str(obj.message)
    ?? str(obj.query)
    ?? str(obj.summary)
    ?? str(obj.content)
    ?? str(obj.text)
    ?? str(obj.goal)
    ?? str(obj.task)
    ?? str(obj.output);
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== "");
  if (directText && keys.length <= 2) return directText;
  return keys
    .map((key) => {
      const v = obj[key];
      const label = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim();
      const formatted = typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : JSON.stringify(v, null, 2);
      return `${label}: ${formatted}`;
    })
    .join("\n");
}

function nodeTitle(node: ActivityNode): string {
  if (node.target?.name) return node.target.name;
  if (node.name) return node.name;
  if (node.kind === "agent") return "Sub-agent";
  if (node.kind === "thinking") return "Thinking";
  if (node.kind === "message") return "Response";
  if (node.kind === "conclave") return "Team";
  if (node.kind === "selection") return "Routing";
  if (node.kind === "run") return "Memory";
  if (node.kind === "connector") return "Connector";
  return "Tool";
}

function laneLabel(node: ActivityNode): string {
  if (node.kind === "agent") return "Sub-agent";
  if (node.kind === "connector" || node.target?.kind === "connector") return "Connector";
  if (node.kind === "tool") return "Tool";
  if (node.kind === "thinking") return "Thinking";
  if (node.kind === "message") return "Response";
  if (node.kind === "conclave") return "Team";
  if (node.kind === "selection") return "Routing";
  if (node.kind === "run") return "Memory";
  return "Step";
}

function laneIcon(node: ActivityNode) {
  if (node.kind === "agent") return <Bot className="cm-trace__icon" />;
  if (node.kind === "connector" || node.target?.kind === "connector") return <Plug className="cm-trace__icon" />;
  if (node.kind === "thinking") return <Brain className="cm-trace__icon" />;
  if (node.kind === "conclave") return <Radio className="cm-trace__icon" />;
  if (node.kind === "selection") return <Sparkles className="cm-trace__icon" />;
  if (node.kind === "run") return <Database className="cm-trace__icon" />;
  if (node.kind === "message") return <Cpu className="cm-trace__icon" />;
  return <Wrench className="cm-trace__icon" />;
}

function isDisplayableNode(node: ActivityNode): boolean {
  if (node.kind === "trace" || node.kind === "plan") return false;
  if (node.kind === "message" && !node.parentId) return false;
  return true;
}

function overallStatus(nodes: ActivityNode[], plan?: Plan): "idle" | "running" | "gated" | "completed" | "failed" | "cancelled" {
  if (plan?.state === "awaiting_approval" || plan?.state === "clarify") return "gated";
  if (nodes.some((n) => n.kind === "connector" && n.status === "pending")) return "gated";
  if (nodes.some((n) => n.status === "running")) return "running";
  if (plan?.state === "executing" || plan?.state === "monitoring" || plan?.state === "refining") return "running";
  if (nodes.some((n) => n.status === "failed") || plan?.state === "failed" || plan?.state === "blocked") return "failed";
  if (nodes.some((n) => n.status === "cancelled") || plan?.state === "cancelled") return "cancelled";
  if (nodes.length > 0 || plan?.state === "completed") return "completed";
  return "idle";
}