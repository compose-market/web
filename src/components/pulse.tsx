/**
 * Pulse — Above-Composer Real-Time Action Rail (Surface 2)
 *
 * Docked seamlessly above the chat input bar. Appears with spring physics
 * strictly when an active stream, recent actions, or inspectable flow exists
 * (zero wasted height when idle).
 */

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Bot,
  Check,
  Cpu,
  GitBranch,
  Loader2,
  Plug,
  Radio,
  Square,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ChatActionKind, ChatActivityState, ChatToolActivity, ConnectorRequest, Plan } from "@/hooks/use-chat";
import type { Receipt } from "@compose-market/sdk";
import { formatWeiUsd } from "@/lib/receipts";
import { summarizeTurnReceipts } from "@/hooks/use-receipts";
import { cn } from "@/lib/utils";

const ACTIVE_PLAN_STATES = new Set(["approved", "executing", "monitoring", "refining"]);

export interface PulseProps {
  status: "idle" | "paying" | "waiting" | "streaming";
  sending: boolean;
  activityState?: ChatActivityState;
  activePlan?: Plan;
  pendingConnector?: ConnectorRequest;
  stepCount?: number;
  receipt?: Receipt;
  receipts?: Receipt[];
  onStop?: () => void;
  onConnect?: (request: ConnectorRequest) => void;
  onInspect?: (nodeId?: string) => void;
  className?: string;
}

function actionIcon(kind?: ChatActionKind) {
  if (kind === "agent") return <Bot className="cm-pulse__pill-icon" />;
  if (kind === "connector") return <Plug className="cm-pulse__pill-icon" />;
  if (kind === "conclave") return <Radio className="cm-pulse__pill-icon" />;
  if (kind === "model") return <Cpu className="cm-pulse__pill-icon" />;
  return <Wrench className="cm-pulse__pill-icon" />;
}

function planProgress(plan?: Plan): {
  running: boolean;
  total: number;
  done: number;
  label?: string;
} {
  if (!plan || !ACTIVE_PLAN_STATES.has(plan.state)) {
    return { running: false, total: 0, done: 0 };
  }
  const tasks = plan.tasks ?? [];
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  const active = tasks.find((task) => task.status === "doing");
  if (plan.state === "refining") {
    return { running: true, total, done, label: "Revising plan" };
  }
  if (active && total > 0) {
    return { running: true, total, done, label: `Executing ${done}/${total} · ${active.title}` };
  }
  if (total > 0) {
    return { running: true, total, done, label: `Executing ${done}/${total} steps` };
  }
  return { running: true, total, done, label: "Executing plan" };
}

function phaseText(
  status: PulseProps["status"],
  activityState?: ChatActivityState,
  planLabel?: string,
): string {
  if (status === "paying") return "Starting session";
  if (planLabel && (!activityState?.label || activityState.phase === "idle" || activityState.phase === "thinking")) {
    return planLabel;
  }
  if (activityState?.label) return activityState.label;
  if (planLabel) return planLabel;
  if (activityState?.phase === "streaming" || status === "streaming") return "Responding";
  if (activityState?.phase === "thinking") return "Reasoning";
  if (activityState?.phase === "tool") return "Using tool";
  if (activityState?.phase === "error") return "Error";
  return "Done";
}

function formatDuration(startedAt: number, endedAt?: number): string {
  const ms = Math.max(0, (endedAt ?? Date.now()) - startedAt);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Pulse({
  status,
  sending,
  activityState,
  activePlan,
  pendingConnector,
  stepCount = 0,
  receipt,
  receipts,
  onStop,
  onConnect,
  onInspect,
  className,
}: PulseProps) {
  const tools: ChatToolActivity[] = activityState?.tools ?? [];
  const turnSummary = React.useMemo(
    () => summarizeTurnReceipts(receipts, receipt),
    [receipt, receipts],
  );
  const progress = React.useMemo(() => planProgress(activePlan), [activePlan]);
  const isActive = progress.running
    || status === "paying"
    || activityState?.phase === "thinking"
    || activityState?.phase === "tool"
    || activityState?.phase === "streaming"
    || tools.some((t) => t.status === "running");

  const isError = activityState?.phase === "error";
  const hasSteps = stepCount > 0 || tools.length > 0 || Boolean(activePlan) || Boolean(pendingConnector);
  const visible = isActive || isError || hasSteps || Boolean(turnSummary);
  const canStop = (isActive || sending) && Boolean(onStop);

  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const totalBadgeCount = Math.max(stepCount, tools.length, progress.total);

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key="cm-pulse"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className={cn("cm-pulse", className)}
          data-state={isError ? "error" : isActive ? "live" : "settled"}
          role="status"
          aria-live="polite"
        >
          <div className="cm-pulse__lead">
            <span className="cm-pulse__beacon" aria-hidden="true">
              {isError ? (
                <XCircle className="cm-pulse__lead-icon" />
              ) : isActive ? (
                <Loader2 className="cm-pulse__lead-icon cm-pulse__spin" />
              ) : (
                <Activity className="cm-pulse__lead-icon" />
              )}
            </span>
            <span className="cm-pulse__label" title={phaseText(status, activityState, progress.label)}>
              {phaseText(status, activityState, progress.label)}
            </span>
            {progress.running ? (
              <progress
                className="cm-pulse__progress"
                {...(progress.total > 0 && progress.done > 0 ? { value: progress.done, max: progress.total } : {})}
                aria-label={
                  progress.total > 0
                    ? `Plan progress: ${progress.done} of ${progress.total} steps completed`
                    : "Executing plan"
                }
              />
            ) : null}
          </div>

          {tools.length > 0 && (
            <div className="cm-pulse__pills cm-snap-x" role="list" aria-label="Live execution steps">
              {tools.slice(-10).map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  role="listitem"
                  className="cm-pulse__pill cm-snap-item"
                  data-status={tool.status}
                  data-kind={tool.kind ?? "tool"}
                  onClick={() => onInspect?.(tool.nodeId)}
                  title={tool.summary || tool.displayName || tool.toolName}
                >
                  {tool.status === "running" ? (
                    <Loader2 className="cm-pulse__pill-icon cm-pulse__spin" />
                  ) : tool.status === "error" ? (
                    <XCircle className="cm-pulse__pill-icon" />
                  ) : (
                    actionIcon(tool.kind)
                  )}
                  <span className="cm-pulse__pill-name">{tool.displayName || tool.toolName}</span>
                  <span className="cm-pulse__pill-time">
                    {formatDuration(tool.startedAt, tool.endedAt ?? (tool.status === "running" ? now : tool.startedAt))}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="cm-pulse__actions">
            {pendingConnector && onConnect && (
              <button
                type="button"
                className="cm-pulse__connect-btn"
                onClick={() => onConnect(pendingConnector)}
                title={`Connect ${pendingConnector.name || pendingConnector.slug}`}
              >
                <Plug className="cm-pulse__pill-icon" aria-hidden="true" />
                <span>Connect {pendingConnector.name || pendingConnector.slug}</span>
              </button>
            )}

            {turnSummary && !isActive && (
              <button
                type="button"
                className="cm-pulse__receipt"
                data-status={turnSummary.status}
                onClick={() => onInspect?.("receipt")}
                title="View settled x402 transactions"
              >
                {turnSummary.status === "settled" ? (
                  <Check className="cm-pulse__pill-icon" />
                ) : turnSummary.status === "failed" ? (
                  <XCircle className="cm-pulse__pill-icon" />
                ) : (
                  <Loader2 className="cm-pulse__pill-icon cm-pulse__spin" />
                )}
                <span>{formatWeiUsd(turnSummary.totalAmountWei)}</span>
                {turnSummary.status !== "settled" ? (
                  <span>{turnSummary.status === "failed" ? "Failed" : "Settling"}</span>
                ) : null}
              </button>
            )}

            {onInspect && (hasSteps || turnSummary) && (
              <button
                type="button"
                className="cm-pulse__flow-btn"
                onClick={() => onInspect?.()}
              >
                <GitBranch className="cm-pulse__pill-icon" />
                <span>Activity{totalBadgeCount > 0 ? ` (${totalBadgeCount})` : ""}</span>
              </button>
            )}

            {canStop && (
              <button
                type="button"
                className="cm-pulse__stop-btn"
                onClick={onStop}
                aria-label="Stop generation"
                title="Stop generation"
              >
                <Square className="cm-pulse__stop-icon" />
                <span>Stop</span>
              </button>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
