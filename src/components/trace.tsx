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

const ExpandableBlock = memo(function ExpandableBlock({
  label,
  content,
  markdown = false,
  defaultExpanded = false,
}: {
  label: string;
  content: string;
  markdown?: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const clean = content.trim();
  if (!clean) return null;
  const isLong = clean.length > 220 || clean.includes("\n");

  return (
    <div className="cm-trace-field">
      <div className="cm-trace-field__head">
        <span className="cm-trace-field__label">{label}</span>
        {isLong && (
          <button
            type="button"
            className="cm-trace-field__toggle"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Collapse" : "Read full"}
          </button>
        )}
      </div>
      <div className={cn("cm-trace-field__body", !expanded && isLong && "cm-trace-field__body--preview")}>
        {markdown && expanded ? (
          <MarkdownRenderer content={clean} />
        ) : (
          <p className="cm-trace-field__text">{clean}</p>
        )}
      </div>
    </div>
  );
});

const EMPTY_VISITED = new Set<string>();

const TraceNodeCard = memo(function TraceNodeCard({
  node,
  childrenMap,
  focusedNodeId,
  depth = 0,
  visited = EMPTY_VISITED,
}: {
  node: ActivityNode;
  childrenMap: Map<string, ActivityNode[]>;
  focusedNodeId?: string | null;
  depth?: number;
  visited?: Set<string>;
}) {
  const isFocused = focusedNodeId === node.id;
  const [open, setOpen] = useState<boolean>(isFocused || node.status === "running" || node.status === "failed" || depth === 0);

  useEffect(() => {
    if (isFocused) setOpen(true);
  }, [isFocused]);

  const payload = rec(node.payload);
  const inputText = useMemo(
    () => (payload?.input !== undefined ? readableValue(payload.input) : ""),
    [payload?.input],
  );
  const outputText = useMemo(
    () => (payload?.output !== undefined
      ? readableValue(payload.output)
      : payload?.result !== undefined
        ? readableValue(payload.result)
        : ""),
    [payload?.output, payload?.result],
  );

  if (visited.has(node.id)) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(node.id);

  const kids = (childrenMap.get(node.id) ?? []).filter((child) => isDisplayableNode(child) && !nextVisited.has(child.id));
  const notesText = str(payload?.notes) ?? str(payload?.reasoning);
  const errorText = str(payload?.error) ?? (node.status === "failed" ? str(payload?.message) : undefined);
  const summaryText = node.target?.summary ?? str(payload?.message);
  const modelName = str(payload?.model) ?? str(rec(node.target?.details)?.model);
  const wallMs = formatMs(num(payload?.wallMs));
  const toolBatches = num(payload?.toolBatches);
  const candidates = Array.isArray(rec(node.target?.details)?.candidates)
    ? (rec(node.target?.details)?.candidates as unknown[])
    : [];
  const memoryRec = rec(payload?.memory);
  const hasBody = Boolean(
    node.text
    || summaryText
    || inputText
    || outputText
    || notesText
    || errorText
    || candidates.length > 0
    || memoryRec
    || kids.length > 0,
  );

  return (
    <article
      className={cn("cm-trace-node", isFocused && "cm-trace-node--focused")}
      data-kind={node.kind}
      data-status={node.status}
      style={{ "--cm-trace-depth": Math.min(depth, 4) } as React.CSSProperties}
    >
      <button
        type="button"
        className="cm-trace-node__head"
        onClick={() => hasBody && setOpen((o) => !o)}
        aria-expanded={hasBody ? open : undefined}
      >
        <span className="cm-trace-node__chev" aria-hidden="true">
          {hasBody ? (open ? <ChevronDown className="cm-trace__icon-xs" /> : <ChevronRight className="cm-trace__icon-xs" />) : null}
        </span>
        <span className="cm-trace-node__icon">{laneIcon(node)}</span>
        <span className="cm-trace-node__titles">
          <span className="cm-trace-node__title-line">
            <strong className="cm-trace-node__title">{nodeTitle(node)}</strong>
            <span className="cm-trace-node__lane">{laneLabel(node)}</span>
          </span>
          {!open && summaryText && (
            <span className="cm-trace-node__preview">{summaryText}</span>
          )}
        </span>
        <span className="cm-trace-node__meta">
          {modelName && <span className="cm-trace-node__tag">{modelName}</span>}
          {wallMs && <span className="cm-trace-node__tag"><Clock className="cm-trace__icon-xs" />{wallMs}</span>}
          {toolBatches !== undefined && toolBatches > 0 && (
            <span className="cm-trace-node__tag">{toolBatches} batch{toolBatches > 1 ? "es" : ""}</span>
          )}
          <span className="cm-trace-node__status" data-status={node.status}>
            {node.status === "running" && <Loader2 className="cm-trace__icon-xs cm-pulse__spin" />}
            {node.status === "completed" && <CheckCircle2 className="cm-trace__icon-xs" />}
            {node.status === "failed" && <XCircle className="cm-trace__icon-xs" />}
            <span>{node.status}</span>
          </span>
        </span>
      </button>

      {open && hasBody && (
        <div className="cm-trace-node__body">
          {errorText && (
            <div className="cm-trace-node__error" role="alert">
              <XCircle className="cm-trace__icon-xs" />
              <span>{errorText}</span>
            </div>
          )}

          {summaryText && summaryText !== errorText && (
            <ExpandableBlock label="Summary" content={summaryText} />
          )}

          {inputText && (
            <ExpandableBlock label={node.kind === "agent" ? "Delegated Brief" : "Request"} content={inputText} />
          )}

          {notesText && (
            <ExpandableBlock label="Notes & Reasoning" content={notesText} markdown />
          )}

          {node.text && (
            <ExpandableBlock
              label={node.kind === "thinking" ? "Chain of Thought" : "Output"}
              content={node.text}
              markdown={node.kind === "message"}
              defaultExpanded={node.text.length <= 420}
            />
          )}

          {outputText && outputText !== node.text && (
            <ExpandableBlock label="Result" content={outputText} markdown />
          )}

          {candidates.length > 0 && (
            <div className="cm-trace-field">
              <span className="cm-trace-field__label">Evaluated Candidates ({candidates.length})</span>
              <div className="cm-trace-candidates">
                {candidates.map((cand, idx) => {
                  const c = rec(cand);
                  const label = str(c?.name) ?? str(c?.id) ?? str(c?.slug) ?? readableValue(cand);
                  const score = num(c?.score);
                  return (
                    <span key={idx} className="cm-trace-candidate">
                      {label}
                      {score !== undefined ? ` (${score.toFixed(2)})` : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {memoryRec && (
            <div className="cm-trace-field">
              <span className="cm-trace-field__label">Six-Layer Memory</span>
              <p className="cm-trace-field__text">{readableValue(memoryRec)}</p>
            </div>
          )}

          {kids.length > 0 && (
            <div className="cm-trace-node__children">
              {kids.map((child) => (
                <TraceNodeCard
                  key={child.id}
                  node={child}
                  childrenMap={childrenMap}
                  focusedNodeId={focusedNodeId}
                  depth={depth + 1}
                  visited={nextVisited}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

function BillTree({ bills, depth = 0 }: { bills: Bill[]; depth?: number }) {
  return (
    <div className="cm-trace-bills" style={{ "--cm-trace-depth": depth } as React.CSSProperties}>
      {bills.map((bill, idx) => (
        <div key={`${bill.kind}-${bill.name ?? idx}-${idx}`} className="cm-trace-bill">
          <div className="cm-trace-bill__row">
            <span className="cm-trace-bill__kind">{bill.kind}</span>
            <span className="cm-trace-bill__name">{bill.name || bill.model || bill.action || bill.subject || "Execution"}</span>
            <strong className="cm-trace-bill__amount">{formatWeiUsd(bill.amountWei)}</strong>
          </div>
          {bill.children && bill.children.length > 0 && (
            <BillTree bills={bill.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}