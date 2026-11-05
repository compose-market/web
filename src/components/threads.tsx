import { useMemo, useState } from "react";
import { Check, ChevronDown, MessageSquare, Plus, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { sdk } from "@/lib/sdk";
import type { ConnectorRequest, Message, Plan } from "@/hooks/use-chat";

const RUNTIME_BASE_URL = (import.meta.env.VITE_RUNTIME_URL || "https://runtime.compose.market").replace(/\/+$/, "");
const ACTIONABLE_PLAN_STATES = new Set(["awaiting_approval", "clarify", "proposed", "pending"]);

export type ThreadStatus = "running" | "input_required" | "connector_required" | "succeeded" | "failed";

export interface ThreadSummary {
  threadId: string;
  title: string;
  prompt?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  status: ThreadStatus;
  rootRunId?: string;
  runId?: string;
  planState?: string;
}

export interface HydratedThread {
  threadId: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number }>;
  plan?: Record<string, unknown>;
  rootRunId?: string;
  runId?: string;
  connectorRequests?: Array<Record<string, unknown>>;
}

function statusLabel(status: ThreadStatus, planState?: string): string {
  if (planState === "cancelled") return "STOPPED";
  switch (status) {
    case "running":
      return "RUNNING";
    case "input_required":
      return "NEEDS INPUT";
    case "connector_required":
      return "NEEDS AUTH";
    case "succeeded":
      return "DONE";
    case "failed":
      return "FAILED";
  }
}

export async function listAgentThreads(
  agentWallet: string,
  userAddress: string,
  options?: { signal?: AbortSignal; limit?: number },
): Promise<ThreadSummary[]> {
  if (!agentWallet || !userAddress) return [];
  const url = new URL(`${RUNTIME_BASE_URL}/agent/${encodeURIComponent(agentWallet)}/threads`);
  url.searchParams.set("userAddress", userAddress);
  if (options?.limit) url.searchParams.set("limit", String(options.limit));
  const response = await sdk.fetch(url.toString(), {
    signal: options?.signal,
    userAddress,
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { threads?: ThreadSummary[] };
  return Array.isArray(body.threads) ? body.threads : [];
}

export async function loadAgentThread(
  agentWallet: string,
  threadId: string,
  userAddress: string,
  options?: { signal?: AbortSignal },
): Promise<HydratedThread | null> {
  if (!agentWallet || !threadId) return null;
  const url = new URL(
    `${RUNTIME_BASE_URL}/agent/${encodeURIComponent(agentWallet)}/threads/${encodeURIComponent(threadId)}`,
  );
  if (userAddress) url.searchParams.set("userAddress", userAddress);
  const response = await sdk.fetch(url.toString(), {
    signal: options?.signal,
    ...(userAddress ? { userAddress } : {}),
  });
  if (!response.ok) return null;
  return (await response.json()) as HydratedThread;
}

export function hydrateThreadMessages(data: HydratedThread): Message[] {
  const base: Message[] = (data.messages ?? []).map((item) => ({
    id: item.id,
    role: item.role,
    content: item.content,
    timestamp: item.timestamp,
  }));

  const rawPlan = data.plan as Record<string, unknown> | undefined;
  const planState = rawPlan && typeof rawPlan.state === "string" ? rawPlan.state : "awaiting_approval";
  const rawProposal = rawPlan?.proposal as Record<string, unknown> | undefined;
  const planTasks = Array.isArray(rawPlan?.tasks)
    ? (rawPlan.tasks as Plan["tasks"])
    : Array.isArray(rawProposal?.tasks)
      ? (rawProposal.tasks as Plan["tasks"])
      : undefined;
  const rawClarify = rawPlan?.clarify as Plan["clarify"] | undefined;
  const rawQuestions = Array.isArray(rawPlan?.questions)
    ? (rawPlan.questions.filter((q): q is string => typeof q === "string"))
    : undefined;
  const rawMissingInputs = Array.isArray(rawPlan?.missingInputs)
    ? (rawPlan.missingInputs as Plan["missingInputs"])
    : undefined;
  const isActionable = ACTIONABLE_PLAN_STATES.has(planState);
  const rawDecision = typeof rawPlan?.decision === "string" ? (rawPlan.decision as Plan["decision"]) : undefined;
  const proposal: Plan | undefined = rawPlan && typeof rawPlan.proposalId === "string"
    ? {
      type: planState === "awaiting_approval"
        ? "approval.requested"
        : planState === "clarify"
          ? "plan.feedback_requested"
          : "approval.decided",
      proposalId: rawPlan.proposalId,
      version: typeof rawPlan.proposalVersion === "number"
        ? rawPlan.proposalVersion
        : typeof rawPlan.version === "number"
          ? rawPlan.version
          : 1,
      state: planState,
      ...(isActionable ? {} : rawDecision ? { decision: rawDecision } : {}),
      runId: typeof rawPlan.runId === "string" ? rawPlan.runId : data.runId,
      rootRunId: typeof rawPlan.rootRunId === "string" ? rawPlan.rootRunId : data.rootRunId,
      approvalId: typeof rawPlan.approvalId === "string" ? rawPlan.approvalId : undefined,
      tasks: planTasks,
      proposal: rawPlan.proposal as Plan["proposal"],
      markdown: typeof rawPlan.markdown === "string" ? rawPlan.markdown : undefined,
      clarify: rawClarify,
      questions: rawQuestions && rawQuestions.length > 0 ? rawQuestions : undefined,
      missingInputs: rawMissingInputs && rawMissingInputs.length > 0 ? rawMissingInputs : undefined,
      feedback: typeof rawPlan.feedback === "string" ? rawPlan.feedback : undefined,
      updatedAt: typeof rawPlan.updatedAt === "number" ? rawPlan.updatedAt : undefined,
      failureReason: typeof rawPlan.lastError === "string" ? rawPlan.lastError : undefined,
    }
    : undefined;

  const connectorRequests: ConnectorRequest[] = (data.connectorRequests ?? [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry.requestId === "string" && typeof entry.slug === "string"))
    .map((entry) => ({
      requestId: String(entry.requestId),
      slug: String(entry.slug),
      name: typeof entry.name === "string" ? entry.name : String(entry.slug),
      bindingId: typeof entry.bindingId === "string" ? entry.bindingId : undefined,
      kind: typeof entry.bindingId === "string" && entry.bindingId.startsWith("account:") ? "account" : "connector",
      runId: typeof entry.runId === "string" ? entry.runId : data.runId,
      rootRunId: typeof entry.rootRunId === "string" ? entry.rootRunId : data.rootRunId,
      userAddress: typeof entry.userAddress === "string" ? entry.userAddress : undefined,
      agentWallet: typeof entry.agentWallet === "string" ? entry.agentWallet : undefined,
      actions: Array.isArray(entry.actions) ? entry.actions.filter((a): a is string => typeof a === "string") : undefined,
      reason: typeof entry.reason === "string" ? entry.reason : undefined,
      state: (entry.state as ConnectorRequest["state"]) ?? "requested",
      ts: typeof entry.requestedAt === "number" ? entry.requestedAt : undefined,
    }));

  if (proposal || connectorRequests.length > 0) {
    const lastAssistantIdx = [...base].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIdx >= 0) {
      const targetIdx = base.length - 1 - lastAssistantIdx;
      base[targetIdx] = {
        ...base[targetIdx],
        ...(proposal ? { proposal } : {}),
        ...(connectorRequests.length > 0 ? { connectorRequests } : {}),
      };
    } else {
      base.push({
        id: `hist-${data.threadId}-gate`,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        ...(proposal ? { proposal } : {}),
        ...(connectorRequests.length > 0 ? { connectorRequests } : {}),
      });
    }
  }

  return base;
}