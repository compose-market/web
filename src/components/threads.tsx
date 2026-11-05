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

export interface ThreadsProps {
  threads: readonly ThreadSummary[];
  activeThreadId: string | null;
  disabled?: boolean;
  loading?: boolean;
  onSelectThread: (thread: ThreadSummary) => void;
  onNewThread: () => void;
  className?: string;
}

export function Threads({
  threads,
  activeThreadId,
  disabled = false,
  loading = false,
  onSelectThread,
  onNewThread,
  className,
}: ThreadsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((t) => t.threadId === activeThreadId) ?? null : null),
    [activeThreadId, threads],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (item) =>
        item.title.toLowerCase().includes(q)
        || (item.prompt ?? "").toLowerCase().includes(q),
    );
  }, [query, threads]);

  const activeLabel = activeThread
    ? (activeThread.title.length > 22 ? `${activeThread.title.slice(0, 21)}…` : activeThread.title)
    : "New thread";

  return (
    <div className={cn("cm-threads", className)} role="group" aria-label="Conversation threads">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="cm-threads__trigger"
            aria-label={`Thread: ${activeLabel}`}
            title={activeThread?.title || "New thread"}
          >
            <span className="cm-threads__glyph" aria-hidden="true">
              <MessageSquare className="cm-threads__icon" />
              {activeThread ? (
                <span className="cm-threads__dot" data-status={activeThread.status} />
              ) : null}
            </span>
            <span className="cm-threads__label">{activeLabel}</span>
            <ChevronDown className="cm-threads__chev" aria-hidden="true" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" sideOffset={6} className="cm-threads__menu p-0">
          {threads.length > 6 && (
            <div className="cm-threads__search">
              <Search className="cm-threads__search-icon" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search threads..."
                className="cm-threads__search-input"
              />
            </div>
          )}

          <div className="cm-threads__list" role="listbox" aria-label="Threads">
            <button
              type="button"
              role="option"
              aria-selected={!activeThread}
              className="cm-threads__item"
              data-active={!activeThread ? "true" : undefined}
              onClick={() => {
                setOpen(false);
                onNewThread();
              }}
            >
              <span className="cm-threads__item-main">
                <Plus className="cm-threads__item-icon" aria-hidden="true" />
                <span className="cm-threads__item-title">New thread</span>
              </span>
              <span className="cm-threads__badge">
                {threads.length > 0 ? threads.length : "NEW"}
              </span>
            </button>

            {loading && threads.length === 0 ? (
              <div className="cm-threads__empty">Loading threads…</div>
            ) : filtered.length === 0 && query.trim() ? (
              <div className="cm-threads__empty">No matching threads</div>
            ) : (
              filtered.map((item) => {
                const isSelected = item.threadId === activeThreadId;
                return (
                  <button
                    key={item.threadId}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className="cm-threads__item"
                    data-active={isSelected ? "true" : undefined}
                    title={item.prompt || item.title}
                    onClick={() => {
                      setOpen(false);
                      onSelectThread(item);
                    }}
                  >
                    <span className="cm-threads__item-main">
                      <span className="cm-threads__dot-inline" data-status={item.status} aria-hidden="true" />
                      <span className="cm-threads__item-title">{item.title}</span>
                    </span>
                    <span className="cm-threads__item-meta">
                      <span className="cm-threads__badge" data-status={item.status}>
                        {statusLabel(item.status, item.planState)}
                      </span>
                      {isSelected ? <Check className="cm-threads__check" aria-hidden="true" /> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        disabled={disabled}
        className="cm-threads__new"
        aria-label="Start new thread"
        title="New thread"
        onClick={onNewThread}
      >
        <Plus className="cm-threads__icon" aria-hidden="true" />
      </button>
    </div>
  );
}
