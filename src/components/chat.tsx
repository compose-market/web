/**
 * Unified Chat Component (Surface 1 + Surface 2 Pulse Integration)
 *
 * Consolidates:
 * - MultimodalCanvas (chat container with input, attachments, recording, 3D empty stage, Pulse action rail)
 * - MessageItem (rich streamed blocks: CoT, Plan/Clarify gates, Connector gates, media/deliveries, x402 receipts)
 * - MarkdownRenderer (lazy-loaded rich content with Mermaid, LaTeX, code)
 *
 * Used by: agent.tsx, workflow.tsx, playground.tsx
 */
import React, { useState, memo, useCallback, useEffect, useRef, useMemo } from "react";
import { StreamMedia } from "@/components/media";
import { Pulse } from "@/components/pulse";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
    ShellButton,
    ShellInput,
    ShellModal,
    ShellNotice,
} from "@compose-market/theme/shell";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Activity,
    Bot,
    Brain,
    Check,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    Coins,
    Copy,
    Download,
    ExternalLink,
    FileText,
    GitBranch,
    HelpCircle,
    Image as ImageIcon,
    ImagePlus,
    KeyRound,
    Layers,
    Loader2,
    Maximize2,
    Mic,
    MicOff,
    Music,
    Paperclip,
    Play,
    Plug,
    RefreshCw,
    Send,
    Square,
    Trash2,
    User,
    Video,
    X,
    BookOpen,
} from "lucide-react";
import type { ActivityState, Receipt } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";
import { sdk } from "@/lib/sdk";
import { formatWeiUsd, shortTx } from "@/lib/receipts";
import { getExplorerTxUrl } from "@/lib/chains";
import { useToast } from "@/hooks/use-toast";
import { summarizeTurnReceipts } from "@/hooks/use-receipts";
import { MarkdownRenderer, normalizeMediaUrl, safeHref } from "@/lib/performance/markdown";
import {
    SlashCommandPopover,
    SelectedSlashCommandBadges,
    clearSlashCommandToken,
    isSelectableSlashCommandName,
    nextSelectedSlashCommands,
    slashCommandMatches,
    withoutSelectedSlashCommand,
} from "@/components/slash-commands";
import type {
    Artifact,
    AttachedFile,
    ChatActivityState,
    ConnectorRequest,
    Message,
    MessageBlock,
    Plan,
} from "@/hooks/use-chat";
import { DocumentCard } from "@/components/document";
import { PoweredByChainGpt, usedWeb3Chatbot } from "@/components/chaingpt";

// Re-export for convenience
export type { Message, AttachedFile };

// =============================================================================
// Local Stream Primitives (owned cleanly by web/, zero theme bloat)
// =============================================================================

function FoldNode({
    title,
    icon,
    metadata,
    tone,
    defaultOpen = false,
    className,
    children,
}: {
    title: React.ReactNode;
    icon?: React.ReactNode;
    metadata?: React.ReactNode;
    tone?: "default" | "error" | "reasoning";
    defaultOpen?: boolean;
    className?: string;
    children?: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={cn("cm-stream-fold", className)} data-tone={tone ?? "default"} data-open={open ? "true" : "false"}>
            <div className="cm-stream-fold__head">
                <button
                    type="button"
                    className="cm-stream-fold__toggle"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                >
                    <span className="cm-stream-fold__chev" aria-hidden="true">
                        {open ? <ChevronDown className="cm-stream-fold__icon" /> : <ChevronRight className="cm-stream-fold__icon" />}
                    </span>
                    {icon ? <span className="cm-stream-fold__lead" aria-hidden="true">{icon}</span> : null}
                    <span className="cm-stream-fold__title">{title}</span>
                </button>
                {metadata ? <div className="cm-stream-fold__meta">{metadata}</div> : null}
            </div>
            {open && children ? <div className="cm-stream-fold__body">{children}</div> : null}
        </div>
    );
}

function NoticeBox({
    tone = "info",
    title,
    children,
}: {
    tone?: "info" | "warning" | "error";
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="cm-stream-notice" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
            <div className="cm-stream-notice__title">
                <CircleAlert className="cm-stream-notice__icon" aria-hidden="true" />
                <span>{title}</span>
            </div>
            <div className="cm-stream-notice__body">{children}</div>
        </div>
    );
}

function ReasoningBlock({
    text: content,
    startedAt,
    finishedAt,
}: {
    text: string;
    startedAt?: number;
    finishedAt?: number;
}) {
    const live = startedAt !== undefined && finishedAt === undefined;
    const duration = startedAt !== undefined && finishedAt !== undefined
        ? `${Math.max(0.1, (finishedAt - startedAt) / 1000).toFixed(1)}s`
        : live
            ? "Thinking..."
            : undefined;

    return (
        <FoldNode
            title="Reasoning"
            icon={<Brain className="cm-stream-fold__icon" />}
            tone="reasoning"
            defaultOpen={false}
            className="cm-chat-thinking"
            metadata={duration ? <span className="cm-stream-fold__badge">{duration}</span> : undefined}
        >
            <pre className="cm-chat-thinking__pre">{content}</pre>
        </FoldNode>
    );
}
const LazyMarkdownRenderer = lazy(() =>
    import("@/lib/performance/markdown").then((module) => ({ default: module.MarkdownRenderer }))
);

function EmbeddingBlock({ content }: { content: string }) {
    const [copied, setCopied] = useState(false);

    let formattedContent = content;
    let dimensions = 0;
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            if (Array.isArray(parsed[0])) {
                dimensions = parsed[0].length;
                formattedContent = parsed.map((emb: number[], idx: number) =>
                    `[${idx}]:\n  ` + emb.map((v, i) => `[${i}]: ${v.toFixed(8)}`).join("\n  ")
                ).join("\n\n");
            } else {
                dimensions = parsed.length;
                formattedContent = parsed.map((v, i) => `[${i}]: ${v.toFixed(8)}`).join("\n");
            }
        }
    } catch {
        // Keep original content if not valid JSON
    }

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <FoldNode
            title={<>Embedding vector {dimensions > 0 && <span>({dimensions} dimensions)</span>}</>}
            defaultOpen={false}
            metadata={
                <button
                    onClick={() => void handleCopy()}
                    className="cm-chat__icon-action rounded-full px-2 py-1 text-xs transition-colors"
                    title="Copy raw embedding"
                    type="button"
                >
                    {copied ? "Copied" : "Copy raw"}
                </button>
            }
        >
            <pre className="text-xs font-mono text-emerald-300/80 overflow-x-auto whitespace-pre leading-relaxed">
                {formattedContent}
            </pre>
        </FoldNode>
    );
}

function shortId(value?: string): string {
    if (!value) return "";
    return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function formatBytes(value?: number): string | null {
    if (!value || !Number.isFinite(value)) return null;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function extractMessageText(message: Message): string {
    const parts: string[] = [];
    const blockTexts = (message.blocks ?? [])
        .filter((b): b is Extract<MessageBlock, { type: "text" }> => b.type === "text" && b.text.trim().length > 0)
        .map((b) => b.text.trim());

    if (blockTexts.length > 0) {
        for (const textBlock of blockTexts) {
            if (!parts.includes(textBlock)) parts.push(textBlock);
        }
    } else if (message.content.trim()) {
        parts.push(message.content.trim());
    }
    if (message.artifacts?.length) {
        for (const item of message.artifacts) {
            if (item.artifactType === "delivery" || item.artifactType === "snippet") {
                const raw = item.raw ?? {};
                const body = (typeof raw.content === "string" && raw.content.trim())
                    || (typeof raw.markdown === "string" && raw.markdown.trim())
                    || (typeof raw.source === "string" && raw.source.trim())
                    || (typeof raw.text === "string" && raw.text.trim())
                    || "";
                if (body && !parts.includes(body)) parts.push(body);
            }
        }
    }
    return parts.join("\n\n");
}

const ACTIONABLE_PLAN_STATES = new Set(["awaiting_approval", "clarify", "proposed", "pending"]);
const LIVE_OR_TERMINAL_PLAN_STATES = new Set([
    "executing",
    "monitoring",
    "refining",
    "completed",
    "failed",
    "blocked",
    "cancelled",
    "expired",
]);

function planLifecycleState(plan: Plan): string {
    return LIVE_OR_TERMINAL_PLAN_STATES.has(plan.state)
        ? plan.state
        : (plan.decision || plan.state);
}

function planTaskCounts(plan: Plan): {
    total: number;
    done: number;
    doing: number;
    failed: number;
    activeTask: NonNullable<Plan["tasks"]>[number] | undefined;
} {
    const tasks = plan.tasks ?? [];
    let done = 0;
    let doing = 0;
    let failed = 0;
    let activeTask: NonNullable<Plan["tasks"]>[number] | undefined;
    for (const task of tasks) {
        if (task.status === "done") done += 1;
        else if (task.status === "doing") {
            doing += 1;
            if (!activeTask) activeTask = task;
        } else if (task.status === "failed" || task.status === "blocked") {
            failed += 1;
        }
    }
    return { total: tasks.length, done, doing, failed, activeTask };
}

function selectPreviewTasks(tasks: NonNullable<Plan["tasks"]>, limit = 6): NonNullable<Plan["tasks"]> {
    if (tasks.length <= limit) return tasks;
    const priority = tasks.filter((t) => t.status === "doing" || t.status === "failed" || t.status === "blocked");
    const chosen = new Set(priority.slice(0, limit).map((t) => t.id));
    for (const task of tasks) {
        if (chosen.size >= limit) break;
        chosen.add(task.id);
    }
    return tasks.filter((t) => chosen.has(t.id));
}

function formatMissingInputLabel(entry: string | NonNullable<Plan["missingInputs"]>[number]): string {
    if (typeof entry === "string") return entry;
    const target = entry.taskTitle || entry.taskId;
    const model = entry.modelName || entry.modelId;
    const needs = entry.acceptedInputs?.length ? entry.acceptedInputs.join(" / ") : "input";
    const head = [target, model ? `(${model})` : ""].filter(Boolean).join(" ");
    return entry.reason ? `${head}: ${needs} — ${entry.reason}` : `${head}: requires ${needs}`;
}

// =============================================================================
// Inline Plan & Clarify Gate
// =============================================================================

function planSummary(plan: Plan): string {
    if (plan.state === "clarify") {
        return plan.decision === "clarify"
            ? `Clarification sent · v${plan.version}`
            : `Clarification needed · v${plan.version}`;
    }
    const state = planLifecycleState(plan);
    const { total, done } = planTaskCounts(plan);
    if (state === "approved" || state === "executing" || state === "monitoring") {
        return total > 0 ? `Executing plan · ${done}/${total} done` : `Executing plan · v${plan.version}`;
    }
    if (state === "refining") return `Revising plan · v${plan.version}`;
    if (state === "rejected") return `Plan rejected · v${plan.version}`;
    if (state === "changes_requested") return `Changes requested · v${plan.version}`;
    if (state === "completed") {
        return total > 0 ? `Plan completed · ${done}/${total} done` : `Plan completed · v${plan.version}`;
    }
    if (state === "failed" || state === "blocked") {
        return total > 0 ? `Plan failed · ${done}/${total} done` : `Plan failed · v${plan.version}`;
    }
    if (state === "cancelled") return `Plan cancelled · v${plan.version}`;
    if (state === "expired") return `Plan expired · v${plan.version}`;
    return `Plan proposed · v${plan.version}`;
}

function InlinePlanGate({
    messageId,
    plan,
    onPlanDecision,
    onInspectFlow,
}: {
    messageId: string;
    plan: Plan;
    onPlanDecision?: MessageItemProps["onPlanDecision"];
    onInspectFlow?: (nodeId?: string) => void;
}) {
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [feedback, setFeedback] = useState("");
    const [answer, setAnswer] = useState("");
    useEffect(() => {
        setFeedbackOpen(false);
        setFeedback("");
        setAnswer("");
    }, [plan.proposalId, plan.version, plan.state]);
    const isClarify = plan.state === "clarify";
    const actionableState = ACTIONABLE_PLAN_STATES.has(plan.state);
    const decided = Boolean(plan.decision) || !actionableState;
    const canAct = Boolean(onPlanDecision) && !plan.pending && !decided;
    const state = planLifecycleState(plan);
    const isExecuting = state === "approved" || state === "executing" || state === "monitoring" || state === "refining";
    const isFailed = state === "failed" || state === "blocked";
    const isCompleted = state === "completed";
    const { total, done, activeTask } = planTaskCounts(plan);
    const previewTasks = plan.tasks && plan.tasks.length > 0 ? selectPreviewTasks(plan.tasks, 6) : [];
    const clarifyObj = plan.clarify && typeof plan.clarify !== "string" ? plan.clarify : undefined;
    const clarifyContext = typeof plan.clarify === "string" ? plan.clarify : clarifyObj?.context;
    const clarifyItems = clarifyObj?.items ?? [];
    const plainQuestions = clarifyItems.length > 0 ? [] : (plan.questions ?? clarifyObj?.questions ?? []);
    const missingInputs = plan.missingInputs ?? clarifyObj?.missingInputs ?? [];

    return (
        <div
            className="cm-chat-plan"
            data-state={isExecuting ? "executing" : state}
            data-clarify={isClarify ? "true" : "false"}
        >
            <div className="cm-chat-plan__head">
                <div className="cm-chat-plan__titles">
                    <span className="cm-chat-plan__icon" aria-hidden="true">
                        {isClarify ? (
                            <HelpCircle className="cm-stream-fold__icon" />
                        ) : isExecuting ? (
                            <Loader2 className="cm-stream-fold__icon cm-pulse__spin" />
                        ) : isFailed ? (
                            <CircleAlert className="cm-stream-fold__icon" />
                        ) : isCompleted ? (
                            <Check className="cm-stream-fold__icon" />
                        ) : (
                            <GitBranch className="cm-stream-fold__icon" />
                        )}
                    </span>
                    <div className="min-w-0">
                        <div className="cm-chat-plan__title">{planSummary(plan)}</div>
                        <div className="cm-chat-plan__meta">
                            <span>v{plan.version}</span>
                            {total > 0 ? (
                                <span>{isExecuting || isCompleted || isFailed ? `${done}/${total} steps` : `${total} steps`}</span>
                            ) : null}
                            {plan.proposalId ? <span>{shortId(plan.proposalId)}</span> : null}
                        </div>
                    </div>
                </div>

                {onInspectFlow ? (
                    <button
                        type="button"
                        className="cm-chat-plan__inspect"
                        onClick={() => onInspectFlow()}
                    >
                        <span>Inspect Flow</span>
                        <ChevronRight className="cm-stream-fold__icon" />
                    </button>
                ) : null}
            </div>

            {isExecuting ? (
                <progress
                    className="cm-chat-plan__progress"
                    {...(total > 0 && done > 0 ? { value: done, max: total } : {})}
                    aria-label={total > 0 ? `Plan progress: ${done} of ${total} steps completed` : "Executing plan"}
                />
            ) : null}

            {plan.error ? (
                <NoticeBox tone="error" title="Decision error">{plan.error}</NoticeBox>
            ) : null}

            {/* Clarify Gate: display structured questions, options & missing inputs with inline answer composer */}
            {isClarify ? (
                <div className="cm-chat-plan__clarify">
                    {clarifyContext ? (
                        <p className="cm-chat-plan__subtitle">{clarifyContext}</p>
                    ) : null}
                    {clarifyItems.length > 0 ? (
                        <ul className="cm-chat-plan__questions">
                            {clarifyItems.map((item) => (
                                <li key={item.id}>
                                    <div>
                                        {item.stepTitle ? <strong>{item.stepTitle}: </strong> : null}
                                        <span>{item.question}</span>
                                        {item.defaultHint ? (
                                            <span className="text-muted-foreground"> (Default: {item.defaultHint})</span>
                                        ) : null}
                                    </div>
                                    {canAct && item.options?.length ? (
                                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                                            {item.options.map((option) => (
                                                <button
                                                    key={option}
                                                    type="button"
                                                    className="cm-plan-btn cm-plan-btn--changes"
                                                    onClick={() => setAnswer((prev) => (prev.trim() ? `${prev.trim()}\n${option}` : option))}
                                                >
                                                    {option}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    ) : plainQuestions.length > 0 ? (
                        <ul className="cm-chat-plan__questions">
                            {plainQuestions.map((question, idx) => (
                                <li key={idx}>{question}</li>
                            ))}
                        </ul>
                    ) : null}
                    {missingInputs.length > 0 ? (
                        <div className="cm-chat-plan__missing">
                            Missing inputs: {missingInputs.map(formatMissingInputLabel).join("; ")}
                        </div>
                    ) : null}
                    {canAct ? (
                        <div className="cm-chat-plan__clarify-form">
                            <textarea
                                value={answer}
                                onChange={(e) => setAnswer(e.target.value)}
                                placeholder="Provide the missing details so the agent can proceed..."
                                className="cm-plan-feedback-input"
                                rows={2}
                            />
                            <div className="cm-chat-plan__actions">
                                <button
                                    type="button"
                                    className="cm-plan-btn cm-plan-btn--approve"
                                    disabled={plan.pending || !answer.trim()}
                                    onClick={() => {
                                        onPlanDecision?.(messageId, plan, "clarify", answer.trim());
                                        setAnswer("");
                                    }}
                                >
                                    Send Answer
                                </button>
                                {clarifyObj?.canSkipWithDefaults ? (
                                    <button
                                        type="button"
                                        className="cm-plan-btn cm-plan-btn--changes"
                                        disabled={plan.pending}
                                        onClick={() => {
                                            onPlanDecision?.(messageId, plan, "clarify", "Proceed using the suggested defaults.");
                                            setAnswer("");
                                        }}
                                    >
                                        Use Defaults
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className="cm-plan-btn cm-plan-btn--reject"
                                    disabled={plan.pending}
                                    onClick={() => onPlanDecision?.(messageId, plan, "cancelled")}
                                >
                                    Cancel Plan
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : (
                <>
                    {previewTasks.length > 0 && (
                        <ol className="cm-chat-plan__task-preview">
                            {previewTasks.map((task) => (
                                <li key={task.id} data-status={task.status}>
                                    <span className="cm-chat-plan__task-row">
                                        <span className="cm-chat-plan__task-icon" aria-hidden="true">
                                            {task.status === "doing" ? (
                                                <Loader2 className="cm-stream-fold__icon cm-pulse__spin" />
                                            ) : task.status === "done" ? (
                                                <Check className="cm-stream-fold__icon" />
                                            ) : task.status === "failed" || task.status === "blocked" ? (
                                                <CircleAlert className="cm-stream-fold__icon" />
                                            ) : (
                                                <span className="cm-chat-plan__task-dot" />
                                            )}
                                        </span>
                                        <span className="cm-chat-plan__task-title">{task.title}</span>
                                        {task.ownerName ? (
                                            <span className="cm-chat-plan__task-owner">{task.ownerName}</span>
                                        ) : null}
                                    </span>
                                </li>
                            ))}
                            {plan.tasks && plan.tasks.length > previewTasks.length && (
                                <li className="cm-chat-plan__more">+{plan.tasks.length - previewTasks.length} more steps in Flow</li>
                            )}
                        </ol>
                    )}

                    {feedbackOpen && canAct && (
                        <textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="Tell the agent what to revise..."
                            className="cm-plan-feedback-input"
                            rows={3}
                        />
                    )}

                    {canAct ? (
                        <div className="cm-chat-plan__actions">
                            <button
                                type="button"
                                className="cm-plan-btn cm-plan-btn--approve"
                                disabled={plan.pending}
                                onClick={() => onPlanDecision?.(messageId, plan, "approved")}
                            >
                                Approve
                            </button>
                            <button
                                type="button"
                                className="cm-plan-btn cm-plan-btn--changes"
                                disabled={plan.pending || (feedbackOpen && !feedback.trim())}
                                onClick={() => {
                                    if (!feedbackOpen) {
                                        setFeedbackOpen(true);
                                        return;
                                    }
                                    const trimmed = feedback.trim();
                                    if (!trimmed) return;
                                    onPlanDecision?.(messageId, plan, "changes_requested", trimmed);
                                    setFeedback("");
                                    setFeedbackOpen(false);
                                }}
                            >
                                {feedbackOpen ? "Send Feedback" : "Request Changes"}
                            </button>
                            <button
                                type="button"
                                className="cm-plan-btn cm-plan-btn--reject"
                                disabled={plan.pending}
                                onClick={() => onPlanDecision?.(messageId, plan, "rejected", feedback.trim() || undefined)}
                            >
                                Reject
                            </button>
                        </div>
                    ) : plan.pending ? (
                        <div
                            className="cm-chat-plan__settled"
                            data-state="executing"
                            role="status"
                            aria-live="polite"
                        >
                            <Loader2 className="cm-stream-fold__icon cm-pulse__spin" aria-hidden="true" />
                            <span>Submitting decision…</span>
                        </div>
                    ) : decided ? (
                        <div
                            className="cm-chat-plan__settled"
                            data-state={isExecuting ? "executing" : isFailed ? "failed" : state}
                            role="status"
                            aria-live="polite"
                        >
                            {isExecuting ? (
                                <>
                                    <Loader2 className="cm-stream-fold__icon cm-pulse__spin" aria-hidden="true" />
                                    <span>
                                        {activeTask
                                            ? `Running: ${activeTask.title}`
                                            : total > 0
                                                ? `Executing · ${done}/${total} steps done`
                                                : "Executing plan…"}
                                    </span>
                                </>
                            ) : isFailed ? (
                                <>
                                    <CircleAlert className="cm-stream-fold__icon" aria-hidden="true" />
                                    <span>
                                        {state === "blocked" && !plan.failureReason
                                            ? "Waiting for connection"
                                            : (plan.failureReason || String(state).replace(/_/g, " "))}
                                    </span>
                                </>
                            ) : isCompleted ? (
                                <>
                                    <Check className="cm-stream-fold__icon" aria-hidden="true" />
                                    <span>{total > 0 ? `Completed · ${done}/${total} steps` : "Completed"}</span>
                                </>
                            ) : (
                                <>
                                    <Check className="cm-stream-fold__icon" aria-hidden="true" />
                                    <span>{String(state).replace(/_/g, " ")}</span>
                                </>
                            )}
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}

// Inline Connector Gate — explicit Connect / Discard decision for a
// credential-gated connector request. Chat text is never a decision;
// only these buttons act on the request. Fully self-contained: fetches
// the connector's credential requirements, takes the key paste, stores it
// via the backpack, and submits the run-owner decision.

const CONNECTORS_CATALOG_URL = (import.meta.env.VITE_CONNECTORS_URL || "https://connectors.compose.market").replace(/\/+$/, "");

// =============================================================================
// Inline Connector Gate (supports "account" | "mcp" | "connector")
// =============================================================================

export function InlineConnectorGate({
    request,
    onDecided,
}: {
    request: ConnectorRequest;
    onDecided?: (request: ConnectorRequest, decision: "connected" | "discarded") => void;
}) {
    const { toast } = useToast();
    const [localState, setLocalState] = useState<ConnectorRequest["state"] | null>(null);
    const [pending, setPending] = useState(false);
    const [waitingForPopup, setWaitingForPopup] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [credentials, setCredentials] = useState<Array<{ varName: string; description?: string; obtainUrl?: string }> | null>(null);
    const [vars, setVars] = useState<Record<string, string>>({});
    const [dialogError, setDialogError] = useState<string | null>(null);
    const authPollRef = useRef<{ timer: ReturnType<typeof setInterval> | null; controller: AbortController | null; busy: boolean }>({
        timer: null,
        controller: null,
        busy: false,
    });

    const stopAuthPolling = useCallback(() => {
        if (authPollRef.current.timer) {
            clearInterval(authPollRef.current.timer);
            authPollRef.current.timer = null;
        }
        if (authPollRef.current.controller) {
            authPollRef.current.controller.abort();
            authPollRef.current.controller = null;
        }
        authPollRef.current.busy = false;
        setWaitingForPopup(false);
    }, []);

    useEffect(() => {
        return () => {
            stopAuthPolling();
        };
    }, [stopAuthPolling]);

    const state = localState ?? request.state;
    const decided = state === "connected" || state === "granted" || state === "discarded" || state === "denied";
    const isServerRequest = Boolean(request.agentWallet && request.runId && !request.requestId.startsWith("tool-auth:"));
    const actionable = Boolean(request.slug);
    const isAccount = request.kind === "account"
        || request.origin === "account"
        || request.authMode === "oauth"
        || Boolean(request.bindingId?.toLowerCase().startsWith("account:"));
    const accountToolkit = request.toolkit || request.slug;
    const displayName = request.name || request.slug;

    const submitDecision = useCallback(async (decision: "connected" | "discarded") => {
        stopAuthPolling();
        setPending(true);
        try {
            if (isServerRequest && request.agentWallet && request.runId) {
                await sdk.agent.decideConnector({
                    agentWallet: request.agentWallet,
                    runId: request.runId,
                    requestId: request.requestId,
                    decision,
                    ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                });
            }
            setLocalState(decision);
            onDecided?.(request, decision);
            toast({
                title: decision === "connected" ? `${displayName} connected` : "Connector discarded",
            });
        } catch (error) {
            toast({
                title: "Connector decision failed",
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
        } finally {
            setPending(false);
        }
    }, [displayName, isServerRequest, onDecided, request, stopAuthPolling, toast]);

    const handleApproveAccount = useCallback(async () => {
        stopAuthPolling();
        setPending(true);
        setDialogError(null);
        try {
            const list = await sdk.connectors.accounts.list(
                request.userAddress ? { userAddress: request.userAddress, toolkit: accountToolkit } : { toolkit: accountToolkit },
            );
            const existing = (list.connections || []).find(
                (conn) => conn.slug.toLowerCase() === accountToolkit.toLowerCase() && conn.connected,
            );
            if (existing) {
                await sdk.connectors.accounts.grant({
                    ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                    toolkit: accountToolkit,
                });
                await submitDecision("connected");
                return;
            }

            const connectRes = await sdk.connectors.accounts.connect({
                ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                toolkit: accountToolkit,
            });
            if (connectRes.status === "ACTIVE") {
                await sdk.connectors.accounts.grant({
                    ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                    toolkit: accountToolkit,
                });
                await submitDecision("connected");
                return;
            }
            const redirectUrl = safeHref(connectRes.redirectUrl) ?? safeHref(request.authUrl);
            if (!redirectUrl) {
                throw new Error("No valid authentication redirect URL returned from server.");
            }
            const popup = window.open(redirectUrl, `Connect ${displayName}`, "noopener,noreferrer,popup=yes,width=560,height=700,scrollbars=yes");
            if (!popup) {
                throw new Error("Allow browser popups to connect this account.");
            }

            const controller = new AbortController();
            authPollRef.current.controller = controller;
            setWaitingForPopup(true);
            toast({
                title: "Authentication started",
                description: `Complete sign-in for ${displayName} in the popup window.`,
            });

            let attempts = 0;
            authPollRef.current.timer = setInterval(() => {
                if (controller.signal.aborted || authPollRef.current.busy) return;
                authPollRef.current.busy = true;
                attempts += 1;
                void (async () => {
                    try {
                        const statusRes = await sdk.connectors.accounts.status(
                            {
                                ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                                toolkit: accountToolkit,
                                connectedAccountId: connectRes.connectedAccountId,
                            },
                            { signal: controller.signal },
                        );
                        if (statusRes.connected || statusRes.status === "ACTIVE") {
                            stopAuthPolling();
                            if (!popup.closed) popup.close();
                            await sdk.connectors.accounts.grant({
                                ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                                toolkit: accountToolkit,
                            });
                            await submitDecision("connected");
                            return;
                        }
                        if (popup.closed) {
                            stopAuthPolling();
                            setPending(false);
                            toast({
                                title: "Connection window closed",
                                description: `Sign-in for ${displayName} was closed before completion.`,
                                variant: "destructive",
                            });
                            return;
                        }
                        if (attempts >= 120) {
                            stopAuthPolling();
                            if (!popup.closed) popup.close();
                            setPending(false);
                            toast({
                                title: "Authentication timed out",
                                description: "Sign-in was not completed in time. Click Connect to try again.",
                                variant: "destructive",
                            });
                        }
                    } catch (pollErr) {
                        if (!controller.signal.aborted && attempts >= 120) {
                            stopAuthPolling();
                            setPending(false);
                            toast({
                                title: "Account authorization failed",
                                description: pollErr instanceof Error ? pollErr.message : String(pollErr),
                                variant: "destructive",
                            });
                        }
                    } finally {
                        authPollRef.current.busy = false;
                    }
                })();
            }, 1500);
        } catch (error) {
            stopAuthPolling();
            setPending(false);
            toast({
                title: "Account authorization failed",
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
        }
    }, [accountToolkit, displayName, request.authUrl, request.userAddress, stopAuthPolling, submitDecision, toast]);

    const openConnectDialog = useCallback(async () => {
        if (isAccount) {
            await handleApproveAccount();
            return;
        }
        setDialogError(null);
        // Mirror man0: check if this connector is already connected in Backpack and auto-grant
        if (request.userAddress) {
            try {
                const status = await sdk.connectors.status({ userAddress: request.userAddress });
                const matched = status?.connectors?.find(
                    (entry) => entry.slug.toLowerCase() === request.slug.toLowerCase(),
                );
                if (matched?.connected && (matched.missingVars?.length ?? 0) === 0) {
                    if (!matched.allowed) {
                        await sdk.connectors.gated.grant({
                            userAddress: request.userAddress,
                            slug: matched.slug,
                        }).catch(() => undefined);
                    }
                    await submitDecision("connected");
                    return;
                }
            } catch {
                // Fall through to credential dialog
            }
        }
        setDialogOpen(true);
        if (request.missingVars && request.missingVars.length > 0) {
            const preset = request.missingVars
                .filter((entry) => typeof entry.varName === "string" && entry.varName.trim().length > 0)
                .map((entry) => ({
                    varName: entry.varName.trim(),
                    ...(entry.description ? { description: entry.description } : {}),
                    ...(entry.obtainUrl ? { obtainUrl: entry.obtainUrl } : {}),
                }));
            if (preset.length > 0) {
                setCredentials(preset);
                setVars(Object.fromEntries(preset.map((credential) => [credential.varName, ""])));
                return;
            }
        }
        setCredentials(null);
        try {
            const card = await sdk.connectors.mcps.get(request.slug, { timeoutMs: 8000 });
            const parsed = (card.credentials || [])
                .filter((entry): entry is { varName: string; description?: string; obtainUrl?: string } =>
                    typeof entry?.varName === "string" && entry.varName.trim().length > 0)
                .map((entry) => ({
                    varName: entry.varName.trim(),
                    ...(entry.description ? { description: entry.description } : {}),
                    ...(entry.obtainUrl ? { obtainUrl: entry.obtainUrl } : {}),
                }));
            setCredentials(parsed);
            setVars(Object.fromEntries(parsed.map((credential) => [credential.varName, ""])));
        } catch (error) {
            setDialogError(error instanceof Error ? error.message : "Could not load connector requirements.");
        }
    }, [handleApproveAccount, isAccount, request.missingVars, request.slug, request.userAddress, submitDecision]);

    useEffect(() => {
        const onTrigger = (event: Event) => {
            const targetId = (event as CustomEvent<string>).detail;
            if (targetId === request.requestId && !decided) {
                void openConnectDialog();
            }
        };
        window.addEventListener("cm:open-connector-gate", onTrigger);
        return () => window.removeEventListener("cm:open-connector-gate", onTrigger);
    }, [decided, openConnectDialog, request.requestId]);

    const submitConnect = useCallback(async () => {
        if (!credentials) return;
        setPending(true);
        setDialogError(null);
        try {
            const payload: Record<string, string> = {};
            for (const credential of credentials) {
                const value = (vars[credential.varName] || "").trim();
                if (!value) throw new Error(`${credential.varName} is required.`);
                payload[credential.varName] = value;
            }
            if (credentials.length > 0) {
                await sdk.connectors.gated.connect({
                    ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                    slug: request.slug,
                    vars: payload,
                });
                await sdk.connectors.gated.grant({
                    ...(request.userAddress ? { userAddress: request.userAddress } : {}),
                    slug: request.slug,
                }).catch(() => undefined);
            }
            setDialogOpen(false);
            await submitDecision("connected");
        } catch (error) {
            setDialogError(error instanceof Error ? error.message : "Could not connect connector.");
        } finally {
            setPending(false);
        }
    }, [credentials, request.slug, request.userAddress, submitDecision, vars]);

    const normalizedState = state === "requested" || state === "escalated"
        ? "pending"
        : state === "granted"
            ? "connected"
            : state === "denied"
                ? "discarded"
                : state;

    return (
        <>
            <div className="cm-chat-plan" data-state={normalizedState} data-connector-request-id={request.requestId}>
                <div className="cm-chat-plan__head">
                    <div className="cm-chat-plan__titles">
                        <span className="cm-chat-plan__icon" aria-hidden="true">
                            <Plug className="cm-stream-fold__icon" />
                        </span>
                        <div className="min-w-0">
                            <div className="cm-chat-plan__title">
                                {displayName}
                            </div>
                            <div className="cm-chat-plan__meta">
                                <span>{isAccount ? "OAuth account" : "Credentials"}</span>
                                {request.actions?.length ? <span>{request.actions.length} actions</span> : null}
                            </div>
                        </div>
                    </div>
                </div>

                {!decided && (
                    <p className="cm-chat-plan__subtitle">
                        {waitingForPopup
                            ? `Waiting for sign-in in popup for ${displayName}...`
                            : request.reason || `Connect ${displayName} to continue.`}
                    </p>
                )}

                {!decided && request.missingVars && request.missingVars.length > 0 && (
                    <div className="cm-chat-plan__vars">
                        {request.missingVars.map((v) => (
                            <span key={v.varName} className="cm-chat-plan__var-chip">{v.varName}</span>
                        ))}
                    </div>
                )}

                {!decided && actionable ? (
                    <div className="cm-chat-plan__actions">
                        <button
                            type="button"
                            className="cm-plan-btn cm-plan-btn--approve"
                            disabled={pending && !waitingForPopup}
                            onClick={() => void openConnectDialog()}
                        >
                            {waitingForPopup ? "Waiting for login..." : `Connect ${displayName}`}
                        </button>
                        {isServerRequest && (
                            <button
                                type="button"
                                className="cm-plan-btn cm-plan-btn--reject"
                                disabled={pending && !waitingForPopup}
                                onClick={() => void submitDecision("discarded")}
                            >
                                Discard
                            </button>
                        )}
                    </div>
                ) : decided ? (
                    <div className="cm-chat-plan__settled">
                        <Check className="cm-stream-fold__icon" />
                        <span>{normalizedState}</span>
                    </div>
                ) : null}
            </div>

            <ShellModal
                open={dialogOpen}
                onClose={() => { if (!pending) setDialogOpen(false); }}
                title={`Connect ${request.name || request.slug}`}
                subtitle="Credentials are encrypted at rest and injected blind at execution time. They are never shown again."
                className="cm-connector-modal"
            >
                <div className="space-y-3">
                    {credentials === null && !dialogError && (
                        <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Loading credential requirements...
                        </div>
                    )}
                    {credentials?.length === 0 && (
                        <p className="text-sm text-muted-foreground">This connector declares no credential variables.</p>
                    )}
                    {credentials?.map((credential) => (
                        <div key={credential.varName} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <label className="text-xs font-mono text-foreground">{credential.varName}</label>
                                {(() => {
                                    const obtainHref = safeHref(credential.obtainUrl);
                                    return obtainHref ? (
                                        <a
                                            href={obtainHref}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-fuchsia-400 hover:underline inline-flex items-center gap-1"
                                        >
                                            Get key <ExternalLink className="w-3 h-3" />
                                        </a>
                                    ) : null;
                                })()}
                            </div>
                            {credential.description && (
                                <p className="text-xs text-muted-foreground">{credential.description}</p>
                            )}
                            <ShellInput
                                type="password"
                                autoComplete="off"
                                value={vars[credential.varName] || ""}
                                onChange={(e) => setVars((current) => ({ ...current, [credential.varName]: e.target.value }))}
                                placeholder={credential.varName}
                                className="font-mono"
                            />
                        </div>
                    ))}
                    {dialogError && (
                        <ShellNotice tone="error">{dialogError}</ShellNotice>
                    )}
                </div>

                <div className="cm-session-modal__footer">
                    <ShellButton tone="ghost" size="sm" onClick={() => setDialogOpen(false)} disabled={pending}>
                        Cancel
                    </ShellButton>
                    <ShellButton
                        tone="primary"
                        size="sm"
                        onClick={() => void submitConnect()}
                        disabled={pending || credentials === null || credentials.some((credential) => !(vars[credential.varName] || "").trim())}
                    >
                        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                        <span>Connect</span>
                    </ShellButton>
                </div>
            </ShellModal>
        </>
    );
}

// Inline Activity Chip — compact summary that points to the side panel

function InlineActivityChip({
    activity,
    onFocusMissionControl,
}: {
    activity?: import("@compose-market/sdk").ActivityState;
    onFocusMissionControl?: () => void;
}) {
    if (!activity) return null;
    const nodes = Object.values(activity.nodes);
    const visible = nodes.filter((n) => {
        if (n.kind === "trace" || n.kind === "plan" || n.kind === "connector") return false;
        if (n.kind === "message" && !n.parentId) return false;
        return true;
    });
    if (visible.length === 0) return null;

    const running = visible.filter((n) => n.status === "running").length;
    const completed = visible.filter((n) => n.status === "completed").length;
    const failed = visible.filter((n) => n.status === "failed").length;
    const tools = visible.filter((n) => n.kind === "tool").length;
    const agents = visible.filter((n) => n.kind === "agent").length;

    const status = running > 0 ? "running" : failed > 0 ? "failed" : completed > 0 ? "completed" : "pending";
    const parts: string[] = [];
    if (tools > 0) parts.push(`${tools} tool${tools > 1 ? "s" : ""}`);
    if (agents > 0) parts.push(`${agents} agent${agents > 1 ? "s" : ""}`);
    if (running > 0) parts.push(`${running} running`);
    else if (completed > 0) parts.push(`${completed} done`);
    const summary = parts.join(" \u00B7 ") || `${visible.length} activities`;

    return (
        <SharedActivityChip
            status={status}
            summary={summary}
            metadata={`${visible.length} updates`}
            onClick={onFocusMissionControl}
        />
    );
}

function StreamMeta({ values }: { values: Array<string | undefined> }) {
    const items = values.filter((value): value is string => Boolean(value));
    if (items.length === 0) return null;
    return (
        <>
            {items.map((item) => <span key={item}>{item}</span>)}
        </>
    );
}

function text(value: unknown): string | undefined {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
}

function ArtifactBlock({
    artifacts,
    onStopRealtime,
}: {
    artifacts: Artifact[];
    onStopRealtime?: () => void;
}) {
    const [expanded, setExpanded] = useState<Artifact | null>(null);
    const rows = artifacts;
    if (rows.length === 0) return null;
    const mediaTotal = mediaCounts(rows);
    return (
        <div className="cm-chat-artifacts mb-2 space-y-4">
            {rows.map((item, index) => {
                const size = formatBytes(item.bytes);
                const status = artifactStatus(item);
                const mediaKind = artifactMediaKind(item.artifactType);
                const partial = item.partial === true || item.hydrating === true || item.status === "running";
                const progress = progressLabel(item.progress);
                const title = mediaKind
                    ? mediaTitle(item, rows, mediaTotal)
                    : `${artifactTitle(item.artifactType)} ${index + 1}`;
                const actionLabel = title || artifactTitle(item.artifactType);

                // Plan delivery: the plan's FINAL DELIVERY artifact frame —
                // the complete content rides the artifact (visible inline
                // like a picture); .md + PDF download icons in the frame.
                if (item.artifactType === "delivery") {
                    return (
                        <DeliveryCard
                            key={item.id}
                            artifact={item}
                        />
                    );
                }

                // Snippet: smart-contract source/report artifact frame —
                // complete content rides the artifact (visible inline);
                // .sol + .md download icons in the frame.
                if (item.artifactType === "snippet") {
                    return (
                        <SnippetCard
                            key={item.id}
                            artifact={item}
                        />
                    );
                }

                if (mediaKind) {
                    const live = mediaKind === "audio" && item.partial === true && Boolean(liveAudioBase64(item));
                    return (
                        <div key={item.id} className="cm-chat-media-asset space-y-1.5">
                            {item.url ? (
                                <div className={cn(
                                    "relative max-w-full",
                                    mediaKind === "audio" ? "w-full min-w-0" : mediaKind === "video" ? "w-full max-w-2xl" : "w-fit",
                                )}>
                                    {mediaKind === "image" ? (
                                        <button
                                            type="button"
                                            className="block max-w-full cursor-zoom-in rounded-md text-left"
                                            onClick={() => setExpanded(item)}
                                            aria-label={`Open ${actionLabel}`}
                                        >
                                            <SharedStreamMedia
                                                kind={mediaKind}
                                                url={item.url}
                                                partial={partial}
                                            />
                                        </button>
                                    ) : (
                                        <SharedStreamMedia
                                            kind={mediaKind}
                                            url={item.url}
                                            partial={partial}
                                        />
                                    )}
                                    {partial && (
                                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-black/15 text-xs font-medium text-white shadow">
                                            {progress || "Generating"}
                                        </div>
                                    )}
                                </div>
                            ) : live ? (
                                <LiveAudio item={item} onStopRealtime={onStopRealtime} />
                            ) : (
                                <PendingMedia
                                    type={mediaKind}
                                    status={progress ? `${status} ${progress}` : status}
                                />
                            )}
                            <ArtifactMeta
                                title={title}
                                values={[
                                    mediaStatus(status),
                                    progress,
                                    item.mimeType,
                                    size || undefined,
                                    item.responseId ? `response ${shortId(item.responseId)}` : undefined,
                                ]}
                                url={item.url}
                                onOpen={() => setExpanded(item)}
                            />
                            {item.error && (
                                <SharedStreamNotice tone="error" title="Artifact error">
                                    {item.error}
                                </SharedStreamNotice>
                            )}
                        </div>
                    );
                }

                if (item.artifactType === "embedding") {
                    const label = title ?? `${artifactTitle(item.artifactType)} ${index + 1}`;
                    return (
                        <EmbeddingArtifact
                            key={item.id}
                            item={item}
                            title={label}
                            values={[
                                embeddingShape(item),
                                item.responseId ? `response ${shortId(item.responseId)}` : undefined,
                            ]}
                        />
                    );
                }

                return (
                    <div key={item.id} className="cm-chat-artifact-meta space-y-1.5">
                        <ArtifactMeta
                            title={title}
                            values={[
                                status,
                                progress,
                                item.mimeType,
                                size || undefined,
                                item.responseId ? `response ${shortId(item.responseId)}` : undefined,
                            ]}
                            url={item.url}
                        />
                        {item.url ? (
                            <a className="text-xs underline-offset-2 hover:underline" href={item.url} target="_blank" rel="noreferrer">
                                Open artifact
                            </a>
                        ) : null}
                        {item.error && (
                            <SharedStreamNotice tone="error" title="Artifact error">
                                {item.error}
                            </SharedStreamNotice>
                        )}
                    </div>
                );
            })}
            <MediaPreview artifact={expanded} onOpenChange={(open) => {
                if (!open) setExpanded(null);
            }} />
        </div>
    );
}

function MediaPreview({
    artifact,
    onOpenChange,
}: {
    artifact: Artifact | null;
    onOpenChange: (open: boolean) => void;
}) {
    const kind = artifact ? artifactMediaKind(artifact.artifactType) : null;
    const url = artifact?.url;
    const title = artifact ? artifactTitle(artifact.artifactType) : "Asset";
    return (
        <Dialog open={Boolean(kind && url)} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl border-cyan-500/30 bg-background/95 p-4">
                <DialogHeader>
                    <DialogTitle className="font-display text-sm text-cyan-100">{title}</DialogTitle>
                </DialogHeader>
                {kind && url ? (
                    <div className={cn("flex max-h-[78vh] min-h-0 items-center justify-center", kind === "audio" && "items-stretch")}>
                        <SharedStreamMedia
                            kind={kind}
                            url={url}
                            className={cn(
                                kind === "image" && "max-h-[72vh] w-auto",
                                kind === "video" && "max-h-[72vh]",
                                kind === "audio" && "w-full",
                            )}
                        />
                    </div>
                ) : null}
                {url ? (
                    <div className="flex justify-end text-xs text-muted-foreground">
                        <a
                            className="cm-chat__icon-action inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
                            href={url}
                            download
                            rel="noreferrer"
                            aria-label="Download"
                            title="Download"
                        >
                            <Download className="h-3 w-3" />
                        </a>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function mediaCounts(artifacts: Artifact[]): Map<Artifact["artifactType"], number> {
    const counts = new Map<Artifact["artifactType"], number>();
    for (const item of artifacts) {
        if (!artifactMediaKind(item.artifactType)) continue;
        counts.set(item.artifactType, (counts.get(item.artifactType) ?? 0) + 1);
    }
    return counts;
}

function mediaTitle(
    item: Artifact,
    artifacts: Artifact[],
    counts: Map<Artifact["artifactType"], number>,
): string | undefined {
    if ((counts.get(item.artifactType) ?? 0) <= 1) return undefined;
    const index = artifacts
        .filter((current) => current.artifactType === item.artifactType)
        .findIndex((current) => current.id === item.id);
    return `${artifactTitle(item.artifactType)} ${index + 1}`;
}

function mediaStatus(status: string): string | undefined {
    return status === "Ready" ? undefined : status;
}

function EmbeddingArtifact({
    item,
    title,
    values,
}: {
    item: Artifact;
    title: string;
    values: Array<string | undefined>;
}) {
    const [copied, setCopied] = useState(false);
    const vector = embeddingVector(item);
    const raw = vector ? JSON.stringify(vector) : JSON.stringify(item.raw ?? {}, null, 2);
    const formatted = vector ? formatEmbedding(vector) : raw;
    const copy = async () => {
        await navigator.clipboard.writeText(raw);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <SharedStreamNode
            title={title}
            defaultOpen={false}
            metadata={
                <>
                    <StreamMeta values={values} />
                    <button
                        onClick={copy}
                        className="cm-chat__icon-action w-fit rounded-full px-2 py-1 text-[11px] transition-colors"
                        title="Copy raw embedding"
                        type="button"
                    >
                        {copied ? "Copied" : "Copy raw"}
                    </button>
                </>
            }
        >
            {vector ? (
                <pre className="text-xs font-mono text-emerald-300/80 overflow-auto max-h-80 whitespace-pre leading-relaxed">
                    {formatted}
                </pre>
            ) : (
                <SharedStreamNotice tone="warning" title="Embedding data unavailable">
                    {item.responseId ? `Response ${shortId(item.responseId)} finished, but the vector payload was not returned to the UI.` : "The embedding vector payload was not returned to the UI."}
                </SharedStreamNotice>
            )}
            {item.error && (
                <SharedStreamNotice tone="error" title="Embedding error">
                    {item.error}
                </SharedStreamNotice>
            )}
        </SharedStreamNode>
    );
}

function embeddingShape(item: Artifact): string | undefined {
    const vector = embeddingVector(item);
    if (!vector) return undefined;
    if (isVector(vector)) return `${vector.length} dimensions`;
    const dimensions = vector[0]?.length;
    return `${vector.length} vectors${dimensions ? ` · ${dimensions} dimensions` : ""}`;
}

function embeddingVector(item: Artifact): number[] | number[][] | null {
    const raw = item.raw ?? {};
    const hydrated = record(raw.hydrated);
    for (const value of [
        item.embedding,
        raw.embedding,
        raw.embeddings,
        hydrated?.embedding,
        hydrated?.embeddings,
    ]) {
        const parsed = parseEmbedding(value);
        if (parsed) return parsed;
    }
    return null;
}

function parseEmbedding(value: unknown): number[] | number[][] | null {
    if (isVector(value)) return value;
    if (Array.isArray(value) && value.every(isVector)) return value;
    return null;
}

function isVector(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function formatEmbedding(value: number[] | number[][]): string {
    if (isVector(value)) {
        return value.map((entry, index) => `[${index}]: ${entry.toFixed(8)}`).join("\n");
    }
    return value.map((vector, index) =>
        `[${index}]:\n  ${vector.map((entry, dimension) => `[${dimension}]: ${entry.toFixed(8)}`).join("\n  ")}`
    ).join("\n\n");
}

function ArtifactMeta({
    title,
    values,
    url,
    onOpen,
}: {
    title?: string;
    values: Array<string | undefined>;
    url?: string;
    onOpen?: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {title && <span className="font-medium text-foreground">{title}</span>}
            <StreamMeta values={values} />
            {url && (
                <>
                    {onOpen ? (
                        <button
                            type="button"
                            className="cm-chat__icon-action inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
                            onClick={onOpen}
                            aria-label="Open"
                            title="Open"
                        >
                            <Maximize2 className="h-3 w-3" />
                        </button>
                    ) : (
                        <a className="underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer">Open</a>
                    )}
                    {onOpen ? (
                        <a
                            className="cm-chat__icon-action inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
                            href={url}
                            download
                            rel="noreferrer"
                            aria-label="Download"
                            title="Download"
                        >
                            <Download className="h-3 w-3" />
                        </a>
                    ) : (
                        <a className="underline-offset-2 hover:underline" href={url} download rel="noreferrer">Download</a>
                    )}
                </>
            )}
        </div>
    );
}

function artifactStatus(item: Artifact): string {
    if (item.error || item.status === "failed") return "Failed";
    if (item.hydrating) return "Preparing";
    const raw = typeof item.raw?.status === "string" ? item.raw.status : item.status;
    if (raw === "queued") return "Queued";
    if (raw === "stopped") return "Stopped";
    if (raw === "processing" || raw === "running" || item.partial) return "Generating";
    if (raw === "completed") return "Ready";
    return item.url ? "Ready" : "Generating";
}

function progressLabel(value?: number): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const pct = value > 0 && value <= 1 ? value * 100 : value;
    return `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

function artifactTitle(kind: Artifact["artifactType"]): string {
    if (kind === "image") return "Image";
    if (kind === "audio") return "Audio";
    if (kind === "video") return "Video";
    if (kind === "embedding") return "Embedding";
    if (kind === "realtime") return "Realtime";
    if (kind === "file") return "File";
    if (kind === "snippet") return "Snippet";
    return "Artifact";
}

function artifactMediaKind(kind: Artifact["artifactType"]): "image" | "audio" | "video" | null {
    return kind === "image" || kind === "audio" || kind === "video" ? kind : null;
}

// ActivityView was removed and refactored into the new MissionControl component

function numeric(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function liveAudioBase64(item: Artifact): string | undefined {
    const raw = item.raw ?? {};
    return text(raw.base64) ?? text(raw.data) ?? text(raw.delta) ?? text(raw.audio);
}

function audioSampleRate(item: Artifact): number {
    const raw = item.raw ?? {};
    return numeric(raw.sampleRate) ?? numeric(raw.sample_rate) ?? numeric(raw.sampleRateHz) ?? 48000;
}

function audioChannels(item: Artifact): number {
    const raw = item.raw ?? {};
    return numeric(raw.channels) ?? 2;
}

function pcm16(bytes: Uint8Array, channels: number, sampleRate: number, context: AudioContext): AudioBuffer | null {
    const width = 2 * channels;
    const frames = Math.floor(bytes.byteLength / width);
    if (frames <= 0) return null;
    const buffer = context.createBuffer(channels, frames, sampleRate);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
            const offset = frame * width + channel * 2;
            buffer.getChannelData(channel)[frame] = view.getInt16(offset, true) / 32768;
        }
    }
    return buffer;
}

function b64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function LiveAudio({
    item,
    onStopRealtime,
}: {
    item: Artifact;
    onStopRealtime?: () => void;
}) {
    const contextRef = useRef<AudioContext | null>(null);
    const nextRef = useRef(0);
    const seenRef = useRef<Set<string>>(new Set());
    const base64 = liveAudioBase64(item);
    const sequence = numeric(item.raw?.sequenceIndex) ?? numeric(item.raw?.sequence_index) ?? item.outputIndex ?? 0;

    useEffect(() => {
        if (!base64 || typeof window === "undefined") return;
        const key = `${sequence}:${base64.length}:${base64.slice(0, 24)}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        if (seenRef.current.size > 256) {
            const [first] = seenRef.current;
            if (first) seenRef.current.delete(first);
        }

        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const context = contextRef.current ?? new Ctor({ latencyHint: "interactive" });
        contextRef.current = context;
        const sampleRate = audioSampleRate(item);
        const channels = audioChannels(item);
        const buffer = pcm16(b64(base64), channels, sampleRate, context);
        if (!buffer) return;

        void context.resume().catch(() => undefined);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const start = Math.max(context.currentTime + 0.01, nextRef.current || context.currentTime + 0.01);
        source.start(start);
        nextRef.current = start + buffer.duration;
    }, [base64, item, sequence]);

    const closePlayback = useCallback(() => {
        const context = contextRef.current;
        contextRef.current = null;
        nextRef.current = 0;
        seenRef.current.clear();
        void context?.close().catch(() => undefined);
    }, []);

    useEffect(() => closePlayback, [closePlayback]);

    const stop = useCallback(() => {
        closePlayback();
        onStopRealtime?.();
    }, [closePlayback, onStopRealtime]);

    return (
        <div className="relative">
            <PendingMedia type="audio" status="Live audio" />
            {onStopRealtime && (
                <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute right-2 top-2 h-7 w-7 rounded-full border border-red-500/30 bg-black/50 text-red-200 hover:bg-red-500/20 hover:text-red-100"
                    onClick={stop}
                    title="Stop realtime stream"
                    aria-label="Stop realtime stream"
                >
                    <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
            )}
        </div>
    );
}

function DirectMedia({ message }: { message: Message }) {
    if (!message.imageUrl && !message.audioUrl && !message.videoUrl) return null;
    return (
        <div className="mb-2 space-y-2">
            {message.imageUrl && (
                <SharedStreamMedia kind="image" url={message.imageUrl} alt="Generated" partial={message.partialImage} />
            )}
            {message.audioUrl && <SharedStreamMedia kind="audio" url={message.audioUrl} />}
            {message.videoUrl && <SharedStreamMedia kind="video" url={message.videoUrl} />}
        </div>
    );
}

function PendingMedia({
    type,
    status,
}: {
    type: "image" | "audio" | "video";
    status?: string;
}) {
    const icon = type === "image"
        ? <ImageIcon />
        : type === "audio"
            ? <Music />
            : <Video />;
    const label = status || (type === "image" ? "Generating image" : type === "audio" ? "Generating audio" : "Generating video");
    const stopped = status === "Stopped";
    return (
        <div className="cm-chat-pending-media" data-kind={type}>
            <div className="cm-chat-pending-media__wash" />
            <div className="cm-chat-pending-media__shine" />
            <div className="cm-chat-pending-media__content">
                <div className="cm-chat-pending-media__icon">
                    {icon}
                    {!stopped && <Loader2 className="cm-chat-pending-media__spinner" />}
                </div>
                <span className="cm-chat-pending-media__label">{label}{stopped ? "" : "..."}</span>
            </div>
        </div>
    );
}

class MessageBoundary extends React.Component<
    { children: React.ReactNode },
    { error: string | null }
> {
    state = { error: null };

    static getDerivedStateFromError(error: unknown) {
        return { error: error instanceof Error ? error.message : String(error) };
    }

    componentDidCatch(error: unknown) {
        console.error("[chat] message render failed:", error);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="cm-chat__error-boundary">
                <SharedStreamNode title="Render error" kind="error" status="failed">
                    <SharedStreamNotice tone="error" title="Render error">
                        {this.state.error}
                    </SharedStreamNotice>
                </SharedStreamNode>
            </div>
        );
    }
}


// =============================================================================
// Chat Message Item
// =============================================================================

export interface MessageItemProps {
    message: Message;
    messages: Message[];
    variant?: "agent" | "workflow" | "playground";
    showActions?: boolean;
    onCopy?: (content: string) => void;
    onRetry?: (content: string) => void;
    onDelete?: (id: string) => void;
    onPlanDecision?: (messageId: string, plan: Plan, decision: NonNullable<Plan["decision"]>, feedback?: string) => void;
    onStopRealtime?: () => void;
    onFocusMissionControl?: () => void;
    assistantAvatar?: React.ReactNode;
}

const messageVariantStyles = {
    agent: {
        user: "bg-fuchsia-500/20 text-fuchsia-100",
        userAvatar: "bg-fuchsia-500/20 text-fuchsia-400",
        assistant: "",
        assistantAvatar: "bg-cyan-500/20 text-cyan-400",
    },
    workflow: {
        user: "bg-cyan-500/20 text-cyan-100",
        userAvatar: "bg-cyan-500/20 text-cyan-400",
        assistant: "font-mono text-sm",
        assistantAvatar: "bg-fuchsia-500/20 text-fuchsia-400",
    },
    playground: {
        user: "cm-chat-message__bubble--user",
        userAvatar: "cm-chat-message__avatar-user",
        assistant: "",
        assistantAvatar: "bg-cyan-500/20 text-cyan-400",
    },
};

export { usedWeb3Chatbot };

function MessageItemInner({
    message,
    messages,
    variant = "agent",
    showActions = true,
    onCopy,
    onRetry,
    onDelete,
    onPlanDecision,
    onStopRealtime,
    onFocusMissionControl,
    assistantAvatar,
}: MessageItemProps) {
    const styles = messageVariantStyles[variant];
    const isUser = message.role === "user";
    const hasDirectMedia = Boolean(message.imageUrl || message.audioUrl || message.videoUrl);
    const hasStreamMedia = Boolean(message.artifacts?.some((item) => artifactMediaKind(item.artifactType)));
    const hasBlocks = !isUser && Boolean(message.blocks?.length);
    // Only treat assistant message as "loading" when generating non-text media.
    // Text "thinking" status is owned exclusively by the activityState bar (see line ~608),
    // so we don't render a second per-bubble spinner for plain text turns.
    const isLoadingMedia = !hasBlocks
        && !message.content
        && message.role === "assistant"
        && !hasDirectMedia
        && !hasStreamMedia
        && (message.type === "image" || message.type === "audio" || message.type === "video");
    const hasText = message.content.trim().length > 0;
    const hasTextBlock = hasBlocks && Boolean(message.blocks?.some((block) => block.type === "text" && block.text.trim().length > 0));
    const showChainGptAttribution = !isUser && (hasText || hasTextBlock) && usedWeb3Chatbot(message.activity);
    const shouldRenderText = message.type === "embedding"
        || isLoadingMedia
        || (isUser ? hasText || !hasDirectMedia : hasText && !hasBlocks);

    const getAssistantIcon = () => {
        if (assistantAvatar) return assistantAvatar;
        switch (message.type) {
            case "image": return <ImageIcon className="h-4 w-4" />;
            case "audio": return <Music className="h-4 w-4" />;
            case "video": return <Video className="h-4 w-4" />;
            default: return <Bot className="h-4 w-4" />;
        }
    };

    const renderBlock = (block: MessageBlock) => {
        if (block.type === "text") {
            if (!block.text) return null;
            return (
                <div key={block.id}>
                    <Suspense fallback={<p className="whitespace-pre-wrap text-sm">{block.text}</p>}>
                        <LazyMarkdownRenderer content={block.text} />
                    </Suspense>
                </div>
            );
        }
        if (block.type === "reasoning") {
            if (!block.text) return null;
            return (
                <SharedStreamNode
                    key={block.id}
                    title="Thinking"
                    defaultOpen={false}
                    className="cm-chat-thinking"
                >
                    <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {block.text}
                    </pre>
                </SharedStreamNode>
            );
        }
        if (block.type === "plan") {
            if (!message.proposal || message.proposal.proposalId !== block.planId) return null;
            return (
                <InlinePlanGate
                    key={block.id}
                    messageId={message.id}
                    plan={message.proposal}
                    onPlanDecision={onPlanDecision}
                />
            );
        }
        if (block.type === "activity") {
            return <InlineActivityChip key={block.id} activity={message.activity} onFocusMissionControl={onFocusMissionControl} />;
        }
        if (block.type === "asset") {
            const artifact = message.artifacts?.find((item) => item.id === block.artifactId);
            return artifact ? <ArtifactBlock key={block.id} artifacts={[artifact]} onStopRealtime={onStopRealtime} /> : null;
        }
        return (
            <SharedStreamNotice
                key={block.id}
                tone={block.tone === "error" ? "error" : undefined}
                title={block.tone === "error" ? "Error" : "Notice"}
            >
                {block.text}
            </SharedStreamNotice>
        );
    };

    return (
        <div className={cn("cm-chat-message", isUser && "cm-chat-message--user")}>
            {!isUser && (
                <Avatar className="cm-chat-message__avatar">
                    <AvatarFallback className={cn("cm-chat-message__avatar-assistant", styles.assistantAvatar)}>{getAssistantIcon()}</AvatarFallback>
                </Avatar>
            )}

            <div className={cn("cm-chat-message__bubble group", isUser ? styles.user : styles.assistant, isUser && "cm-chat-message__bubble--user")}>
                {showActions && (
                    <div className="cm-chat-message__actions">
                        {onCopy && (
                            <button
                                onClick={() => onCopy(message.content)}
                                className="cm-chat__icon-action rounded-full p-1 transition-colors"
                                title="Copy message"
                            >
                                <Copy className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {isUser && onRetry && (
                            <button
                                onClick={() => onRetry(message.content)}
                                className="cm-chat__icon-action rounded-full p-1 transition-colors"
                                title="Retry this message"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {onDelete && (
                            <button
                                onClick={() => onDelete(message.id)}
                                className="cm-chat__icon-action rounded-full p-1 transition-colors hover:text-red-400"
                                title="Delete message"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}

                {!hasBlocks && message.proposal && (
                    <InlinePlanGate
                        messageId={message.id}
                        plan={message.proposal}
                        onPlanDecision={onPlanDecision}
                    />
                )}

                {hasBlocks && message.blocks?.map(renderBlock)}

                {message.connectorRequests?.map((request) => (
                    <InlineConnectorGate key={request.requestId} request={request} />
                ))}

                {!hasBlocks && shouldRenderText && message.type === "embedding" ? (
                    <EmbeddingBlock content={message.content || "..."} />
                ) : isLoadingMedia ? (
                    <PendingMedia
                        type={message.type as "image" | "audio" | "video"}
                        status={message.content || undefined}
                    />
                ) : !shouldRenderText ? null : isUser ? (
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                ) : (
                    <Suspense fallback={<p className="whitespace-pre-wrap text-sm">{message.content}</p>}>
                        <LazyMarkdownRenderer content={message.content} />
                    </Suspense>
                )}

                {hasDirectMedia && <DirectMedia message={message} />}

                {!hasBlocks && !!message.artifacts?.length && <ArtifactBlock artifacts={message.artifacts} onStopRealtime={onStopRealtime} />}

                {showChainGptAttribution && (
                    <div className="mt-2 pt-1.5 border-t border-border/30 flex items-center justify-end">
                        <PoweredByChainGpt />
                    </div>
                )}
            </div>

            {isUser && (
                <Avatar className="cm-chat-message__avatar">
                    <AvatarFallback className={cn("cm-chat-message__avatar-user", styles.userAvatar)}><User className="w-4 h-4" /></AvatarFallback>
                </Avatar>
            )}
        </div>
    );
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
    return (
        <MessageBoundary>
            <MessageItemInner {...props} />
        </MessageBoundary>
    );
});

// =============================================================================
// Multimodal Canvas
// =============================================================================

export interface MultimodalCanvasProps {
    messages: Message[];
    inputValue: string;
    onInputChange: (value: string) => void;
    onSend: (selectedSlashCommands?: string[]) => boolean | void | Promise<boolean | void>;
    sending: boolean;
    continuous?: boolean;
    variant?: "agent" | "workflow" | "playground";
    title?: string;
    icon?: React.ReactNode;
    emptyStateText?: string;
    emptyStateSubtext?: string;
    emptyStateIcon?: React.ReactNode;
    showHeader?: boolean;
    placeholder?: string;
    status?: "idle" | "paying" | "waiting" | "streaming";
    activityState?: ChatActivityState;
    error?: string | null;
    sessionActive?: boolean;
    onStartSession?: () => void;
    attachedFiles?: AttachedFile[];
    imageRequired?: boolean;
    submitDisabled?: boolean;
    onFileSelect?: () => void;
    onRemoveFile?: (file: File) => void;
    fileInputRef?: React.RefObject<HTMLInputElement | null>;
    onFileInputChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isRecording?: boolean;
    recordingSupported?: boolean;
    onStartRecording?: () => void;
    onStopRecording?: () => void;
    realtimeActive?: boolean;
    showMessageActions?: boolean;
    onCopyMessage?: (content: string) => void;
    onRetryMessage?: (content: string) => void;
    onDeleteMessage?: (id: string) => void;
    onPlanDecision?: (messageId: string, plan: Plan, decision: NonNullable<Plan["decision"]>, feedback?: string) => void;
    onClearChat?: () => void;
    onKnowledgeUpload?: () => void;
    onFocusMissionControl?: () => void;
    scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
    messagesEndRef?: React.RefObject<HTMLDivElement | null>;
    height?: string;
}

const canvasVariantConfig = {
    agent: {
        border: "border-cyan-500/30",
        headerBg: "bg-cyan-500/5",
        headerText: "text-cyan-400",
        headerIcon: <Bot className="w-4 h-4 text-cyan-400" />,
        sendButton: "bg-cyan-500 hover:bg-cyan-600 text-black",
        accentColor: "cyan",
    },
    workflow: {
        border: "border-fuchsia-500/30",
        headerBg: "bg-fuchsia-500/5",
        headerText: "text-fuchsia-400",
        headerIcon: <Layers className="w-4 h-4 text-fuchsia-400" />,
        sendButton: "bg-fuchsia-500 hover:bg-fuchsia-600 text-white",
        accentColor: "fuchsia",
    },
    playground: {
        border: "border-cyan-500/20",
        headerBg: "bg-cyan-500/5",
        headerText: "text-cyan-400",
        headerIcon: <Bot className="w-4 h-4 text-cyan-400" />,
        sendButton: "bg-cyan-500 hover:bg-cyan-600 text-black",
        accentColor: "cyan",
    },
};

export function MultimodalCanvas({
    messages,
    inputValue,
    onInputChange,
    onSend,
    sending,
    continuous = false,
    variant = "agent",
    title,
    icon,
    emptyStateText = "Start a conversation",
    emptyStateSubtext,
    emptyStateIcon,
    showHeader = true,
    placeholder,
    status = "idle",
    activityState,
    error,
    attachedFiles = [],
    imageRequired = false,
    submitDisabled = false,
    onFileSelect,
    onRemoveFile,
    fileInputRef,
    onFileInputChange,
    isRecording = false,
    recordingSupported = true,
    onStartRecording,
    onStopRecording,
    showMessageActions = true,
    onCopyMessage,
    onRetryMessage,
    onDeleteMessage,
    onPlanDecision,
    onClearChat,
    onKnowledgeUpload,
    onFocusMissionControl,
    scrollContainerRef,
    messagesEndRef,
    height = "",
}: MultimodalCanvasProps) {
    const config = canvasVariantConfig[variant];
    const activeTools = activityState?.tools.filter((t) => t.status === "running") || [];
    const shouldShowActivity = status !== "idle" || Boolean(activityState && activityState.phase !== "idle");
    const nearBottomRef = useRef(true);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [showJump, setShowJump] = useState(false);
    const [selectedSlashCommands, setSelectedSlashCommands] = useState<string[]>([]);
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const slashMatches = useMemo(
        () => variant === "workflow" ? [] : slashCommandMatches(inputValue),
        [inputValue, variant],
    );

    useEffect(() => {
        setSlashSelectedIndex(0);
    }, [inputValue]);

    const hasReadyImage = attachedFiles.some((file) => file.type === "image" && !file.uploading && Boolean(file.url));
    const imageRequirementMissing = imageRequired && !hasReadyImage;
    const imageRequirementId = React.useId();
    const canSend = (!sending || continuous)
        && (inputValue.trim() || attachedFiles.length > 0)
        && !submitDisabled
        && !imageRequirementMissing;
    const isUploading = attachedFiles.some(f => f.uploading);

    const focusTextarea = useCallback(() => {
        requestAnimationFrame(() => textareaRef.current?.focus());
    }, []);

    const handleSend = useCallback(async () => {
        if (!canSend || isUploading) return;
        const result = await onSend(selectedSlashCommands.length > 0 ? selectedSlashCommands : undefined);
        if (result !== false) {
            setSelectedSlashCommands([]);
        }
    }, [canSend, isUploading, onSend, selectedSlashCommands]);

    const selectSlashCommand = useCallback((cmd: { name: string }) => {
        if (isSelectableSlashCommandName(cmd.name)) {
            setSelectedSlashCommands((prev) => nextSelectedSlashCommands(prev, cmd.name));
            onInputChange(clearSlashCommandToken(inputValue));
            focusTextarea();
            return;
        }

        const nextInput = `/${cmd.name} `;
        onInputChange(nextInput);
        focusTextarea();
    }, [focusTextarea, inputValue, onInputChange]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (slashMatches.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                setSlashSelectedIndex((prev) => (prev + 1) % slashMatches.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                setSlashSelectedIndex((prev) => (prev - 1 + slashMatches.length) % slashMatches.length);
                return;
            }
            if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                selectSlashCommand(slashMatches[slashSelectedIndex] ?? slashMatches[0]);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onInputChange(inputValue.replace(/^\//, ""));
                return;
            }
        }

        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    }, [handleSend, inputValue, onInputChange, selectSlashCommand, slashMatches, slashSelectedIndex]);

    const isNearBottom = useCallback(() => {
        const el = scrollContainerRef?.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    }, [scrollContainerRef]);

    const scrollToBottom = useCallback(() => {
        messagesEndRef?.current?.scrollIntoView({ behavior: "smooth" });
        nearBottomRef.current = true;
        setShowJump(false);
    }, [messagesEndRef]);

    useEffect(() => {
        const el = scrollContainerRef?.current;
        if (!el) return;
        const update = () => {
            const near = isNearBottom();
            nearBottomRef.current = near;
            if (near) setShowJump(false);
        };
        update();
        el.addEventListener("scroll", update, { passive: true });
        return () => el.removeEventListener("scroll", update);
    }, [isNearBottom, scrollContainerRef]);

    useEffect(() => {
        if (nearBottomRef.current) {
            setShowJump(false);
            return;
        }
        if (messages.length > 0) {
            setShowJump(true);
        }
    }, [messages]);

    return (
        <div className={cn(
            "cm-chat",
            config.border,
            variant === "workflow" && "shadow-[0_0_30px_-5px_hsl(292_85%_55%/0.1)]",
            !showHeader && "cm-chat--bare",
            height
        )}>
            {showHeader && (
                <div className={cn("cm-chat__header", config.headerBg)}>
                    <div className="flex items-center gap-2">
                        {icon || config.headerIcon}
                        <span className={cn("text-sm font-mono", config.headerText)}>{title || "Chat"}</span>
                    </div>
                </div>
            )}

            <div ref={scrollContainerRef} className="cm-chat__body">
                {messages.length === 0 ? (
                    <div className="cm-chat__empty text-sm">
                        {emptyStateIcon || (variant === "workflow" ? (
                            <Play className={cn("w-12 h-12 mx-auto mb-4 opacity-50", config.headerText)} />
                        ) : (
                            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        ))}
                        <p>{emptyStateText}</p>
                        {emptyStateSubtext && <p className="text-xs mt-1 text-muted-foreground/70">{emptyStateSubtext}</p>}
                    </div>
                ) : (
                    <div className="cm-chat__messages">
                        {messages.map((msg) => (
                            <React.Fragment key={msg.id}>
                                <MessageItem
                                    message={msg}
                                    messages={messages}
                                    variant={variant}
                                    showActions={showMessageActions}
                                    onCopy={onCopyMessage}
                                    onRetry={onRetryMessage}
                                    onDelete={onDeleteMessage}
                                    onPlanDecision={onPlanDecision}
                                    onStopRealtime={onStopRecording}
                                    onFocusMissionControl={onFocusMissionControl}
                                />
                            </React.Fragment>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
                {showJump ? (
                    <button type="button" className="cm-chat__jump" onClick={scrollToBottom}>
                        <ChevronDown className="h-3.5 w-3.5" />
                        New messages
                    </button>
                ) : null}
            </div>

            {shouldShowActivity && (
                <div className="cm-chat__activity">
                    <Loader2 className={cn("w-3 h-3", (status === "paying" || status === "waiting" || status === "streaming" || activityState?.phase === "thinking" || activityState?.phase === "tool" || activityState?.phase === "streaming") && "animate-spin", config.headerText)} />
                    <span className="text-muted-foreground">
                        {status === "paying" && <><span className="text-yellow-400">Paying...</span> Processing x402 payment</>}
                        {status === "waiting" && <><span className="text-orange-400">Waiting...</span> Awaiting response</>}
                        {status === "streaming" && activityState?.label ? <><span className={config.headerText}>Live...</span> {activityState.label}</> : null}
                        {status === "streaming" && !activityState?.label && <><span className={config.headerText}>Streaming...</span> Receiving response</>}
                        {status === "idle" && activityState?.phase === "streaming" && <><span className={config.headerText}>Live...</span> {activityState.label || "Receiving response"}</>}
                        {status === "idle" && activityState?.phase === "thinking" && <><span className={config.headerText}>Thinking...</span> {activityState.label || "Planning next step"}</>}
                        {status === "idle" && activityState?.phase === "tool" && <><span className={config.headerText}>Tool...</span> {activityState.label || "Using tools"}</>}
                        {status === "idle" && activityState?.phase === "error" && <><span className="text-red-400">Error...</span> {activityState.label || "Execution failed"}</>}
                    </span>
                    {activeTools.length > 0 && (
                        <div className="ml-auto flex flex-wrap items-center gap-1">
                            {activeTools.map((tool) => (
                                <span
                                    key={tool.id}
                                    className={cn(
                                        "cm-chat__tool-chip",
                                        tool.status === "running" && "cm-chat__tool-chip--running",
                                        tool.status === "completed" && "cm-chat__tool-chip--completed",
                                        tool.status === "error" && "cm-chat__tool-chip--error",
                                    )}
                                    title={tool.summary || tool.displayName || tool.toolName}
                                >
                                    {tool.displayName || tool.toolName}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="cm-chat__composer">
                {error && <div className="text-xs text-red-400 mb-2 p-2 bg-red-500/10 rounded">{error}</div>}

                {imageRequirementMissing && onFileSelect && (
                    <div
                        id={imageRequirementId}
                        role="alert"
                        aria-live="polite"
                        className="mb-3 flex flex-col gap-3 rounded-md border-2 border-amber-400/70 bg-amber-400/15 p-3 shadow-[0_0_24px_hsl(45_100%_55%/0.12)] sm:flex-row sm:items-center"
                    >
                        <CircleAlert className="h-6 w-6 shrink-0 text-amber-300" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-amber-100">Image required</p>
                            <p className="mt-0.5 text-sm leading-snug text-foreground/90">
                                This model needs an image as input before it can run. Upload an image to continue.
                            </p>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            onClick={onFileSelect}
                            disabled={(sending && !continuous) || isRecording}
                            className="w-full shrink-0 bg-amber-300 font-bold text-black hover:bg-amber-200 sm:w-auto"
                            aria-label="Upload required image"
                        >
                            <ImagePlus className="h-4 w-4" />
                            Upload image
                        </Button>
                    </div>
                )}

                {attachedFiles.length > 0 && (
                    <div className="cm-chat__attachments">
                        {attachedFiles.map((file, index) => (
                            <div key={file.file.name + index} className="relative group">
                                <div className="cm-chat__attachment">
                                    {file.type === "image" ? (
                                        <img src={file.preview} alt="Preview" className="h-full w-full object-cover" />
                                    ) : file.type === "video" ? (
                                        file.preview ? <video src={file.preview} className="h-full w-full object-cover" muted /> : <Video className="h-6 w-6 text-pink-500" />
                                    ) : file.type === "pdf" ? (
                                        <FileText className="h-6 w-6 text-muted-foreground" />
                                    ) : file.type === "file" ? (
                                        <Paperclip className="h-6 w-6 text-muted-foreground" />
                                    ) : (
                                        <Music className="h-6 w-6 text-muted-foreground" />
                                    )}
                                    {file.uploading && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                                        </div>
                                    )}
                                </div>
                                {onRemoveFile && (
                                    <button
                                        onClick={() => onRemoveFile(file.file)}
                                        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-primary/20 bg-background/90 text-muted-foreground hover:text-foreground"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <SelectedSlashCommandBadges
                    selected={selectedSlashCommands}
                    onRemove={(name) => setSelectedSlashCommands((prev) => withoutSelectedSlashCommand(prev, name))}
                />

                <div className="cm-chat__composer-row">
                    {onClearChat && (
                        <Button variant="ghost" size="icon" onClick={onClearChat} disabled={sending && !continuous} className="cm-chat__icon-action shrink-0" title="Clear chat">
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    )}

                    {onFileSelect && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onFileSelect}
                            disabled={(sending && !continuous) || isRecording}
                            className="cm-chat__icon-action shrink-0 cursor-pointer"
                            title={imageRequired ? "Upload required image" : "Attach file"}
                            aria-label={imageRequired ? "Upload required image" : "Attach file"}
                        >
                            <Paperclip className="w-4 h-4" />
                        </Button>
                    )}

                    {onStartRecording && onStopRecording && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={isRecording ? onStopRecording : onStartRecording}
                            disabled={(sending && !continuous) || !recordingSupported}
                            className={cn("cm-chat__icon-action shrink-0 cursor-pointer transition-colors", isRecording && "text-red-500 hover:text-red-400 animate-pulse")}
                            title={isRecording ? "Stop microphone" : "Start microphone"}
                        >
                            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        </Button>
                    )}

                    {onKnowledgeUpload && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={onKnowledgeUpload} disabled={sending} className="cm-chat__icon-action shrink-0 cursor-pointer">
                                        <BookOpen className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Upload Knowledge</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}

                    <div className="relative flex-1">
                        {variant !== "workflow" && (
                            <SlashCommandPopover
                                input={inputValue}
                                selectedIndex={slashSelectedIndex}
                                onSelect={selectSlashCommand}
                                onHighlight={setSlashSelectedIndex}
                            />
                        )}
                        <Textarea
                            ref={textareaRef}
                            placeholder={placeholder || (variant === "workflow" ? "Enter workflow parameters or instruction..." : "Type your message or use / for commands...")}
                            value={inputValue}
                            onChange={(e) => onInputChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={1}
                            className={cn("resize-none w-full", variant === "workflow" && "font-mono text-sm")}
                            disabled={sending && !continuous}
                            aria-invalid={imageRequirementMissing || undefined}
                            aria-describedby={imageRequirementMissing ? imageRequirementId : undefined}
                        />
                    </div>

                    <Button
                        onClick={() => void handleSend()}
                        disabled={!canSend || isUploading}
                        className={cn("cm-chat__send", config.sendButton)}
                        aria-describedby={imageRequirementMissing ? imageRequirementId : undefined}
                        title={imageRequirementMissing ? "Upload an image to continue" : undefined}
                    >
                        {sending && !continuous ? <Loader2 className="w-4 h-4 animate-spin" /> : variant === "workflow" ? <Play className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    </Button>
                </div>

                {fileInputRef && onFileInputChange && (
                    <input type="file" ref={fileInputRef} onChange={onFileInputChange} accept={imageRequired ? "image/*" : "image/*,audio/*,video/*,application/pdf,.pdf,.txt,.md,.json,.csv,.html,.xml,text/*,application/json,.sol"} className="hidden" />
                )}
            </div>
        </div>
    );
}
