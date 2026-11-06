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