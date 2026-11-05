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

function TaskStatusPill({ status }: { status: Task["status"] }) {
  const mapped = status === "done"
    ? "completed"
    : status === "doing"
      ? "running"
      : status === "failed" || status === "blocked"
        ? "failed"
        : "pending";
  return (
    <span className="cm-trace-node__status" data-status={mapped}>
      {mapped === "running" && <Loader2 className="cm-trace__icon-xs cm-pulse__spin" />}
      {mapped === "completed" && <Check className="cm-trace__icon-xs" />}
      {mapped === "failed" && <XCircle className="cm-trace__icon-xs" />}
      <span>{status}</span>
    </span>
  );
}

const TraceInner = memo(function TraceInner({
  open,
  onClose,
  activity,
  plan,
  planVersions = [],
  receipt,
  receipts,
  usage,
  focusedNodeId,
  onPlanDecision,
  mode = "sheet",
  className,
}: TraceProps) {
  const [versionIndex, setVersionIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  const versions = useMemo(() => {
    if (planVersions.length > 0) return planVersions;
    return plan ? [plan] : [];
  }, [plan, planVersions]);

  useEffect(() => {
    if (versions.length > 0) setVersionIndex(versions.length - 1);
  }, [versions.length]);

  const activePlan = versions[versionIndex] ?? plan;

  useEffect(() => {
    setFeedback("");
    setFeedbackOpen(false);
    setClarifyAnswer("");
  }, [activePlan?.proposalId, activePlan?.version, activePlan?.state]);

  useEffect(() => {
    if (!open || mode !== "sheet") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, mode, onClose]);

  const { roots, childrenMap, visibleNodes } = useMemo(() => {
    if (!activity) {
      return { roots: [] as ActivityNode[], childrenMap: new Map<string, ActivityNode[]>(), visibleNodes: [] as ActivityNode[] };
    }
    // Preserve stable creation/insertion order instead of re-sorting live by updatedAt
    const all = Object.values(activity.nodes);
    const byId = new Map(all.map((n) => [n.id, n]));
    const visible = all.filter(isDisplayableNode);
    const map = new Map<string, ActivityNode[]>();
    const top: ActivityNode[] = [];

    for (const node of visible) {
      if (node.parentId && byId.has(node.parentId) && isDisplayableNode(byId.get(node.parentId)!)) {
        const list = map.get(node.parentId) ?? [];
        list.push(node);
        map.set(node.parentId, list);
      } else {
        top.push(node);
      }
    }
    return { roots: top, childrenMap: map, visibleNodes: visible };
  }, [activity]);

  const status = overallStatus(visibleNodes, activePlan);
  const completedCount = visibleNodes.filter((n) => n.status === "completed").length;
  const failedCount = visibleNodes.filter((n) => n.status === "failed").length;
  const turnSummary = useMemo(
    () => summarizeTurnReceipts(receipts, receipt),
    [receipt, receipts],
  );
  const isClarifyPlan = activePlan?.state === "clarify";
  const actionablePlan = Boolean(
    activePlan
    && !activePlan.decision
    && !activePlan.pending
    && (activePlan.state === "awaiting_approval"
      || activePlan.state === "clarify"
      || activePlan.state === "proposed"
      || activePlan.state === "pending"),
  );
  const activeClarifyObj = activePlan?.clarify && typeof activePlan.clarify !== "string"
    ? activePlan.clarify
    : undefined;
  const activeClarifyItems = activeClarifyObj?.items ?? [];
  const activeClarifyQuestions = activeClarifyItems.length > 0
    ? []
    : (activePlan?.questions ?? activeClarifyObj?.questions ?? []);
  const activeMissingInputs = activePlan?.missingInputs ?? activeClarifyObj?.missingInputs ?? [];

  const content = (
    <section
      className={cn("cm-trace", mode === "inline" && "cm-trace--inline", className)}
      data-status={status}
      aria-label="Execution flow trace"
    >
      <header className="cm-trace__header">
        <div className="cm-trace__heading">
          <GitBranch className="cm-trace__icon" />
          <div>
            <h2 className="cm-trace__title">Activity</h2>
            <p className="cm-trace__subtitle">
              {visibleNodes.length > 0
                ? `${completedCount}/${visibleNodes.length} steps done${failedCount > 0 ? ` · ${failedCount} failed` : ""}`
                : activePlan
                  ? `Plan v${activePlan.version} · ${activePlan.state.replace(/_/g, " ")}`
                  : turnSummary
                    ? `Total ${formatWeiUsd(turnSummary.totalAmountWei)} · ${turnSummary.status}`
                    : "Steps, plans, tools & cost"}
            </p>
          </div>
        </div>

        <div className="cm-trace__header-actions">
          <span className="cm-trace-node__status" data-status={status}>
            {status === "running" && <Loader2 className="cm-trace__icon-xs cm-pulse__spin" />}
            <span>{status}</span>
          </span>
          {mode === "sheet" && (
            <button type="button" className="cm-trace__close" onClick={onClose} aria-label="Close activity">
              <X className="cm-trace__icon" />
            </button>
          )}
        </div>
      </header>

      <div className="cm-trace__body">
        {/* Plan & Tasks Section */}
        {activePlan && (
          <div className="cm-trace-section">
            <div className="cm-trace-section__head">
              <span className="cm-trace-section__title">
                <Activity className="cm-trace__icon-xs" />
                Plan · v{activePlan.version}
              </span>
              {versions.length > 1 && (
                <div className="cm-trace-versions">
                  <button
                    type="button"
                    disabled={versionIndex <= 0}
                    onClick={() => setVersionIndex((i) => Math.max(0, i - 1))}
                  >
                    Prev
                  </button>
                  <span>v{activePlan.version} / {versions.length}</span>
                  <button
                    type="button"
                    disabled={versionIndex >= versions.length - 1}
                    onClick={() => setVersionIndex((i) => Math.min(versions.length - 1, i + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>

            {activePlan.failureReason && (
              <div className="cm-trace-node__error" role="alert">
                <XCircle className="cm-trace__icon-xs" />
                <span>{activePlan.failureReason}</span>
              </div>
            )}

            {activePlan.markdown && (
              <div className="cm-trace-plan-md">
                <MarkdownRenderer content={activePlan.markdown} />
              </div>
            )}

            {activePlan.tasks && activePlan.tasks.length > 0 && (
              <div className="cm-trace-tasks">
                {activePlan.tasks.map((task, idx) => (
                  <div key={task.id} className="cm-trace-task" data-status={task.status}>
                    <span className="cm-trace-task__index">{idx + 1}</span>
                    <div className="cm-trace-task__copy">
                      <strong>{task.title}</strong>
                      {task.ownerName ? (
                        <p className="text-xs text-muted-foreground">Owner: {task.ownerName}</p>
                      ) : null}
                      {task.instructions ? (
                        <p>{task.instructions}</p>
                      ) : task.completionCriteria ? (
                        <p>{task.completionCriteria}</p>
                      ) : null}
                      {task.error ? (
                        <p className="text-xs text-red-400">{task.error}</p>
                      ) : null}
                    </div>
                    <TaskStatusPill status={task.status} />
                  </div>
                ))}
              </div>
            )}

            {isClarifyPlan && (
              <div className="cm-chat-plan__clarify">
                {typeof activePlan.clarify === "string" ? (
                  <p className="cm-chat-plan__subtitle">{activePlan.clarify}</p>
                ) : activeClarifyObj?.context ? (
                  <p className="cm-chat-plan__subtitle">{activeClarifyObj.context}</p>
                ) : null}
                {activeClarifyItems.length > 0 ? (
                  <ul className="cm-chat-plan__questions">
                    {activeClarifyItems.map((item) => (
                      <li key={item.id}>
                        <div>
                          {item.stepTitle ? <strong>{item.stepTitle}: </strong> : null}
                          <span>{item.question}</span>
                          {item.defaultHint ? <span className="text-muted-foreground"> (Default: {item.defaultHint})</span> : null}
                        </div>
                        {onPlanDecision && actionablePlan && item.options?.length ? (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {item.options.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                className="cm-plan-btn cm-plan-btn--changes"
                                onClick={() => setClarifyAnswer((prev) => (prev.trim() ? `${prev.trim()}\n${opt}` : opt))}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : activeClarifyQuestions.length > 0 ? (
                  <ul className="cm-chat-plan__questions">
                    {activeClarifyQuestions.map((q, idx) => (
                      <li key={idx}>{q}</li>
                    ))}
                  </ul>
                ) : null}
                {activeMissingInputs.length > 0 ? (
                  <div className="cm-chat-plan__missing">
                    Missing inputs: {activeMissingInputs.map((entry) => (
                      typeof entry === "string"
                        ? entry
                        : `${entry.taskTitle || entry.taskId}${entry.modelName || entry.modelId ? ` (${entry.modelName || entry.modelId})` : ""}: ${entry.acceptedInputs.join(" / ")}${entry.reason ? ` — ${entry.reason}` : ""}`
                    )).join("; ")}
                  </div>
                ) : null}
              </div>
            )}

            {onPlanDecision && actionablePlan && (
              <div className="cm-trace-plan-actions">
                {isClarifyPlan ? (
                  <>
                    <textarea
                      value={clarifyAnswer}
                      onChange={(e) => setClarifyAnswer(e.target.value)}
                      placeholder="Provide the missing details so the agent can proceed..."
                      rows={3}
                      className="cm-plan-feedback-input"
                    />
                    <div className="cm-trace-plan-btns">
                      <button
                        type="button"
                        className="cm-plan-btn cm-plan-btn--approve"
                        disabled={!clarifyAnswer.trim()}
                        onClick={() => {
                          const trimmed = clarifyAnswer.trim();
                          if (!trimmed) return;
                          onPlanDecision(activePlan, "clarify", trimmed);
                          setClarifyAnswer("");
                        }}
                      >
                        Send Answer
                      </button>
                      {activeClarifyObj?.canSkipWithDefaults ? (
                        <button
                          type="button"
                          className="cm-plan-btn cm-plan-btn--changes"
                          onClick={() => {
                            onPlanDecision(activePlan, "clarify", "Proceed using the suggested defaults.");
                            setClarifyAnswer("");
                          }}
                        >
                          Use Defaults
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="cm-plan-btn cm-plan-btn--reject"
                        onClick={() => onPlanDecision(activePlan, "cancelled")}
                      >
                        Cancel Plan
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {feedbackOpen && (
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="Tell the agent what to revise..."
                        rows={3}
                        className="cm-plan-feedback-input"
                      />
                    )}
                    <div className="cm-trace-plan-btns">
                      <button
                        type="button"
                        className="cm-plan-btn cm-plan-btn--approve"
                        onClick={() => onPlanDecision(activePlan, "approved")}
                      >
                        Approve Plan
                      </button>
                      <button
                        type="button"
                        className="cm-plan-btn cm-plan-btn--changes"
                        disabled={feedbackOpen && !feedback.trim()}
                        onClick={() => {
                          if (!feedbackOpen) {
                            setFeedbackOpen(true);
                            return;
                          }
                          const trimmed = feedback.trim();
                          if (!trimmed) return;
                          onPlanDecision(activePlan, "changes_requested", trimmed);
                          setFeedback("");
                          setFeedbackOpen(false);
                        }}
                      >
                        {feedbackOpen ? "Send Feedback" : "Request Changes"}
                      </button>
                      <button
                        type="button"
                        className="cm-plan-btn cm-plan-btn--reject"
                        onClick={() => onPlanDecision(activePlan, "rejected", feedback.trim() || undefined)}
                      >
                        Reject
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live Interaction Tree */}
        {roots.length > 0 ? (
          <div className="cm-trace-section">
            <div className="cm-trace-section__head">
              <span className="cm-trace-section__title">
                <Bot className="cm-trace__icon-xs" />
                Steps ({visibleNodes.length})
              </span>
            </div>
            <div className="cm-trace-list">
              {roots.map((node) => (
                <TraceNodeCard
                  key={node.id}
                  node={node}
                  childrenMap={childrenMap}
                  focusedNodeId={focusedNodeId}
                />
              ))}
            </div>
          </div>
        ) : !activePlan && !turnSummary ? (
          <div className="cm-trace-empty">
            <Activity className="cm-trace-empty__icon" />
            <p>Send a message to see live steps, tools, and cost.</p>
          </div>
        ) : null}

        {/* Usage & Real x402 Settlement Breakdown */}
        {(turnSummary || usage) && (
          <div className="cm-trace-section" id="cm-trace-receipt">
            <div className="cm-trace-section__head">
              <span className="cm-trace-section__title">
                <Coins className="cm-trace__icon-xs" />
                Settlements{turnSummary && turnSummary.totalCount > 1 ? ` (${turnSummary.totalCount})` : ""}
              </span>
              {turnSummary && (
                <div className="flex items-center gap-2">
                  <span className="cm-trace-receipt__status" data-tone={settlementTone(turnSummary.status)}>
                    {turnSummary.status === "settled"
                      ? "settled"
                      : turnSummary.status === "failed"
                        ? "failed"
                        : `${turnSummary.settledCount}/${turnSummary.totalCount} settled`}
                  </span>
                  <strong className="cm-trace-total">{formatWeiUsd(turnSummary.totalAmountWei)}</strong>
                </div>
              )}
            </div>

            {usage && (
              <div className="cm-trace-usage">
                {Object.entries(usage)
                  .filter(([, val]) => typeof val === "number" && Number.isFinite(val))
                  .map(([key, val]) => (
                    <span key={key} className="cm-trace-usage__item">
                      <span>{key.replace(/_/g, " ")}</span>
                      <strong>{Number(val).toLocaleString()}</strong>
                    </span>
                  ))}
              </div>
            )}

            {turnSummary && (
              <div className="cm-trace-receipt">
                <div className="cm-trace-receipt__meta">
                  {turnSummary.primaryNetwork && <span>Network: <b>{turnSummary.primaryNetwork}</b></span>}
                  {BigInt(turnSummary.providerAmountWei) > 0n && (
                    <span>Provider: <b>{formatWeiUsd(turnSummary.providerAmountWei)}</b></span>
                  )}
                  {BigInt(turnSummary.platformFeeWei) > 0n && (
                    <span>Platform fee: <b>{formatWeiUsd(turnSummary.platformFeeWei)}</b></span>
                  )}
                </div>

                <div className="cm-trace-receipt__list">
                  {turnSummary.items.map((item, idx) => {
                    const hash = item.settleTxHash ?? item.txHash;
                    const explorer = hash && item.network ? getExplorerTxUrl(item.network as NetworkId, hash) : null;
                    const rowStatus = item.settlementStatus ?? (hash ? "settled" : "queued");
                    return (
                      <div key={item.id ?? item.paymentIntentId ?? idx} className="cm-trace-receipt__row">
                        <div className="cm-trace-receipt__row-head">
                          <span className="cm-trace-bill__kind">{item.service || "x402"}</span>
                          <span className="cm-trace-bill__name" title={item.subject || item.action}>
                            {item.subject || item.action || "Settlement"}
                          </span>
                          <span className="cm-trace-receipt__status" data-tone={settlementTone(rowStatus)}>
                            {rowStatus}
                          </span>
                          <strong className="cm-trace-bill__amount">{formatWeiUsd(item.finalAmountWei)}</strong>
                        </div>

                        <div className="cm-trace-receipt__row-meta">
                          {item.providerAmountWei ? <span>Provider {formatWeiUsd(item.providerAmountWei)}</span> : null}
                          {item.platformFeeWei ? <span>Fee {formatWeiUsd(item.platformFeeWei)}</span> : null}
                          {item.settledAt && item.settledAt > 0 ? <span>{timeAgo(item.settledAt)}</span> : null}
                          {hash && explorer ? (
                            <a
                              href={explorer}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="cm-trace-receipt__tx"
                              title={hash}
                            >
                              <span>{shortTx(hash)}</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : hash ? (
                            <span className="cm-trace-receipt__tx" title={hash}>{shortTx(hash)}</span>
                          ) : null}
                        </div>

                        {item.bills && item.bills.length > 0 && (
                          <BillTree bills={item.bills} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );

  return content;
});

export const Trace = memo(function Trace(props: TraceProps) {
  if (props.mode === "inline") {
    return <TraceInner {...props} />;
  }

  return (
    <AnimatePresence>
      {props.open ? (
        <motion.div
          key="cm-trace-backdrop"
          className="cm-trace-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onClose();
          }}
        >
          <motion.div
            key="cm-trace-drawer"
            className="cm-trace-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
          >
            <TraceInner {...props} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
});
