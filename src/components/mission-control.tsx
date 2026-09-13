/**
 * Mission Control Side Panel
 *
 * Renders the full fractal activity tree + plan review in the side panel.
 * Uses rich server-side display data (target.name, target.details, target.summary)
 * to show human-readable information — never leaks internal JSON/protocol details.
 *
 * Hierarchy:
 *   Main Agent (depth 0)
 *   └── Tool / Memory (depth 1)
 *       ├── Tool actions (depth 2)
 *       └── Sub-Agent (depth 1, fractal — same structure recursively)
 *           └── ...up to depth 3
 */
import React, { useState, useEffect, useRef, Suspense, lazy, useMemo } from "react";
import {
    MissionControlPanel,
    MissionPocket,
    AgentNode,
    StreamNode,
    PlanGate,
    PlanTask,
    PlanActions,
    PlanVersionCarousel,
} from "@compose-market/theme";
import type { ActivityState, ActivityNode } from "@compose-market/sdk";
import type { Artifact, ConnectorRequest, Plan, Message, MessageBlock } from "@/hooks/use-chat";
import { taskFoldRows, TASK_ROW_STATUS, type TaskFoldRow } from "@/lib/folds";
import { InlineConnectorGate } from "@/components/chat";

import { MarkdownRenderer } from "@/lib/performance/markdown";

export interface MissionControlSidePanelProps {
    activity?: ActivityState;
    plan?: Plan;
    messages: Message[];
    phase?: "idle" | "thinking" | "tool" | "streaming" | "error";
    phaseLabel?: string;
    agentLabel?: string;
    onPlanDecision?: (
        messageId: string,
        plan: Plan,
        decision: "approved" | "rejected" | "changes_requested",
        feedback?: string,
    ) => void;
    className?: string;
}

function shortId(value?: string): string {
    if (!value) return "";
    return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function text(value: unknown): string | undefined {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
}

function truncate(value: string, max = 80): string {
    return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}

function isVisibleNode(node: ActivityNode): boolean {
    if (node.kind === "trace" || node.kind === "plan" || node.kind === "connector") return false;
    if (node.kind === "message" && !node.parentId) return false;
    return true;
}

function statusLabel(status: ActivityNode["status"]): string | undefined {
    if (status === "pending") return "Pending";
    if (status === "running") return "Running";
    if (status === "completed") return "Completed";
    if (status === "failed") return "Failed";
    if (status === "cancelled") return "Stopped";
    return undefined;
}

// =============================================================================
// Rich Title — the protocol carries the human-readable name on target
// =============================================================================

function nodeTitle(node: ActivityNode): string {
    const target = node.target;

    if (node.kind === "tool") {
        const kind = target?.kind;
        const name = target?.name ?? node.name;
        if (kind === "model") return name ?? "Model call";
        if (kind === "connector") return name ?? "Connector call";
        if (kind === "agent") return name ?? "Agent search";
        if (kind === "search") return name ?? "Search";
        if (kind === "conclave") return target?.target ?? "Conclave";
        return name ?? "Tool call";
    }

    if (node.kind === "agent") {
        return target?.name ?? node.name ?? "Agent";
    }

    if (node.kind === "thinking") return "Thinking";
    if (node.kind === "conclave") return "Conclave";
    if (node.kind === "route") return "Route";
    if (node.kind === "message") return "Message";
    if (node.kind === "error") return "Action failed";
    if (node.kind === "run") {
        if (node.status === "completed") return "Run completed";
        if (node.status === "cancelled") return "Run stopped";
        return "Run";
    }
    return target?.name ?? node.name ?? "Activity";
}

// =============================================================================
// Summary — what the node is actually doing (human-readable)
// =============================================================================

function nodeSummary(node: ActivityNode): string | undefined {
    const payload = node.payload ?? {};
    const target = node.target;

    if (node.kind === "message") {
        return node.text ? truncate(node.text, 120) : undefined;
    }

    // Child reasoning accumulates into the node text — the reasoning sub-fold.
    if (node.kind === "thinking") {
        return node.text ? truncate(node.text, 120) : undefined;
    }

    if (node.kind === "conclave") {
        const action = text(payload.action) ?? text(target?.details?.action);
        const key = text(payload.key) ?? target?.target;
        if (action && key) return `${action} ${key}`;
        return target?.summary;
    }

    const summary = node.text
        || target?.summary
        || text(payload.message)
        || text(payload.summary)
        || text(payload.error)
        || text(payload.reason);

    if (summary) return truncate(summary, 120);

    if (node.kind === "tool" && node.status === "running" && payload.input) {
        const inputStr = typeof payload.input === "string"
            ? payload.input
            : JSON.stringify(payload.input).slice(0, 120);
        return truncate(inputStr, 120);
    }

    if (node.kind === "tool" && node.status === "completed" && payload.output) {
        const outputStr = typeof payload.output === "string"
            ? payload.output
            : text(payload.message) ?? undefined;
        if (outputStr) return truncate(outputStr, 120);
    }

    return undefined;
}

// =============================================================================
// Summary Preview — shown in collapsed <summary> row (one-liner)
// =============================================================================

function nodeSummaryPreview(node: ActivityNode): string | undefined {
    const target = node.target;

    if (node.kind === "conclave") {
        const action = text(target?.details?.action) ?? text(node.payload?.action);
        const key = target?.target ?? text(node.payload?.key);
        if (action && key) return `${action} ${key}`;
        return target?.summary;
    }

    if (node.kind === "message" && node.text) {
        return truncate(node.text, 80);
    }

    if (node.kind === "thinking" && node.text) {
        return truncate(node.text, 80);
    }

    if (target?.summary) {
        return truncate(target.summary, 80);
    }

    const payload = node.payload ?? {};
    if (node.kind === "tool" && payload.input) {
        const input = payload.input;
        const inputStr = typeof input === "string"
            ? input
            : text((input as Record<string, unknown>)?.query) ?? text((input as Record<string, unknown>)?.prompt) ?? JSON.stringify(input).slice(0, 80);
        return truncate(inputStr, 80);
    }

    return undefined;
}

// =============================================================================
// Metadata
// =============================================================================

function nodeMeta(node: ActivityNode): string | undefined {
    const status = statusLabel(node.status);
    const updates = node.events > 1 ? `${node.events} events` : undefined;
    return [status, updates].filter(Boolean).join(" \u00B7 ") || undefined;
}

// =============================================================================
// Task folds — every plan task is assigned to an agent (another or the
// planner itself); each task renders its own fold with its agent's live
// activity and reasoning inside. Derivation lives in lib/task-folds.
// =============================================================================

function TaskFold({ row, activity }: { row: TaskFoldRow; activity: ActivityState }) {
    const { task, agentNodes } = row;
    const ownerName = task.ownerName ?? task.title;
    const status = TASK_ROW_STATUS[task.status] ?? "pending";
    const isRunning = status === "running";
    const isFailed = status === "failed";
    const firstActivity = agentNodes[0];
    const preview = agentNodes.length > 0
        ? `${agentNodes.length} agent run${agentNodes.length > 1 ? "s" : ""}${task.startedAt ? "" : ""}`
        : "not started";

    return (
        <StreamNode
            title={`task ${task.id} - ${ownerName}`}
            kind="agent"
            status={status}
            depth={0}
            targetKind="agent"
            summary={task.title}
            summaryPreview={preview}
            metadata={firstActivity ? statusLabel(firstActivity.status) : undefined}
            defaultOpen={isRunning || isFailed}
        >
            {agentNodes.length > 0 ? (
                agentNodes.map((node) => (
                    <SwarmNode
                        key={node.id}
                        node={node}
                        activity={activity}
                        depth={1}
                        visited={new Set<string>()}
                    />
                ))
            ) : (
                <div className="cm-stream-node__summary text-xs text-muted-foreground pl-2">
                    Assigned to {ownerName} — waiting for its turn in the plan.
                </div>
            )}
        </StreamNode>
    );
}

// =============================================================================
// Grouping — collapse same-kind root nodes into a single collapsible parent
// =============================================================================

interface GroupedNode {
    kind: string;
    title: string;
    status: string;
    nodes: ActivityNode[];
}

function groupRoots(roots: ActivityNode[]): Array<ActivityNode | GroupedNode> {
    const buckets = new Map<string, ActivityNode[]>();
    const orderedKinds: string[] = [];

    for (const root of roots) {
        const key = root.kind;
        if (!buckets.has(key)) {
            buckets.set(key, []);
            orderedKinds.push(key);
        }
        buckets.get(key)!.push(root);
    }

    const result: Array<ActivityNode | GroupedNode> = [];
    for (const kind of orderedKinds) {
        const nodes = buckets.get(kind)!;
        if (nodes.length <= 1) {
            result.push(nodes[0]);
        } else {
            const hasRunning = nodes.some((n) => n.status === "running");
            const hasFailed = nodes.some((n) => n.status === "failed");
            result.push({
                kind,
                title: `${kindLabel(kind)} \u2014 ${nodes.length} actions`,
                status: hasRunning ? "running" : hasFailed ? "failed" : "completed",
                nodes,
            });
        }
    }
    return result;
}

function kindLabel(kind: string): string {
    const labels: Record<string, string> = {
        conclave: "Conclave",
        tool: "Tool calls",
        thinking: "Thinking",
        route: "Routes",
        run: "Runs",
        agent: "Agents",
        message: "Messages",
        error: "Errors",
    };
    return labels[kind] ?? kind;
}

// =============================================================================
// SwarmNode — recursive fractal renderer
// =============================================================================

interface SwarmNodeProps {
    node: ActivityNode;
    activity: ActivityState;
    depth: number;
    visited: Set<string>;
    /** Node ids claimed by per-task folds — skipped in the general timeline. */
    hiddenIds?: Set<string>;
}

function SwarmNode({ node, activity, depth, visited, hiddenIds }: SwarmNodeProps) {
    if (!isVisibleNode(node) || visited.has(node.id) || hiddenIds?.has(node.id)) return null;
    visited.add(node.id);

    const children = node.children
        .map((id) => activity.nodes[id])
        .filter((child): child is ActivityNode => Boolean(child));

    const isAgent = node.kind === "agent" || node.kind === "thinking" || node.kind === "run";
    const isFailed = node.status === "failed";
    const isRunning = node.status === "running";
    const targetKind = node.target?.kind;
    const d = Math.min(depth, 3);
    const title = nodeTitle(node);
    const summary = nodeSummary(node);
    const preview = nodeSummaryPreview(node);
    const meta = nodeMeta(node);
    const details = node.target?.details;
    const modelName = text(details?.model) || text(details?.provider);

    const childElements = children.length > 0 ? (
        <>
            {children.map((child) => (
                <SwarmNode
                    key={child.id}
                    node={child}
                    activity={activity}
                    depth={depth + 1}
                    visited={visited}
                    hiddenIds={hiddenIds}
                />
            ))}
        </>
    ) : null;

    if (isAgent) {
        return (
            <AgentNode
                title={title}
                status={node.status}
                depth={d}
                targetKind={targetKind}
                modelName={modelName}
                summary={summary}
                summaryPreview={preview}
                metadata={meta}
                defaultOpen={d === 0 || isRunning || isFailed}
            >
                {childElements}
            </AgentNode>
        );
    }

    return (
        <StreamNode
            title={title}
            kind={node.kind}
            status={node.status}
            depth={d}
            targetKind={targetKind}
            summary={summary}
            summaryPreview={preview}
            metadata={meta}
            defaultOpen={isFailed || (isRunning && d <= 1)}
        >
            {childElements}
        </StreamNode>
    );
}

// =============================================================================
// GroupedSwarmNode — renders a grouped parent with children inside
// =============================================================================

function GroupedSwarmNode({ group, activity }: { group: GroupedNode; activity: ActivityState }) {
    const visited = new Set<string>();
    const hasRunning = group.status === "running";
    const hasFailed = group.status === "failed";

    return (
        <StreamNode
            title={group.title}
            kind={group.kind}
            status={group.status}
            depth={0}
            defaultOpen={hasRunning || hasFailed}
        >
            {group.nodes.map((node) => (
                <SwarmNode
                    key={node.id}
                    node={node}
                    activity={activity}
                    depth={1}
                    visited={visited}
                />
            ))}
        </StreamNode>
    );
}

// =============================================================================
// Plan parsing
// =============================================================================

function parseTasksFromMarkdown(md?: string): Array<{ title: string; status: "pending" | "completed" }> {
    if (!md) return [];
    const tasks: Array<{ title: string; status: "pending" | "completed" }> = [];
    for (const line of md.split("\n")) {
        const match = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/);
        if (match) {
            tasks.push({
                title: match[2].trim(),
                status: match[1].toLowerCase() === "x" ? "completed" : "pending",
            });
        }
    }
    return tasks;
}

function planTasks(plan: Plan): Array<{ title: string; description?: string; status: "pending" | "running" | "completed" | "failed" }> {
    if (plan.tasks?.length) {
        return plan.tasks.map((task) => {
            // Fork + retry badges: dependency pairing and machine repair
            // attempts, exactly as the plan recorded them.
            const badges: string[] = [];
            if (task.dependsOn?.length) badges.push(`Needs ${task.dependsOn.join(", ")}`);
            if (task.parallel?.length) badges.push(`Parallel: ${task.parallel.join(", ")}`);
            if (task.retryCount && task.retryCount > 0) badges.push(`Retried ${task.retryCount}×`);
            const badgeText = badges.length ? badges.join(" · ") : undefined;
            const description = [
                ...(task.error ? [task.error] : []),
                ...(badgeText ? [badgeText] : []),
                ...(task.ownerName ? [`Assigned: ${task.ownerName}`] : task.owner && !task.error && !badgeText ? [task.owner] : []),
            ].join(" — ") || undefined;
            return {
                title: task.title,
                ...(description ? { description } : {}),
                status: task.status === "done"
                    ? "completed"
                    : task.status === "doing"
                        ? "running"
                        : task.status === "failed" || task.status === "blocked"
                            ? "failed"
                            : "pending",
            };
        });
    }
    return parseTasksFromMarkdown(plan.markdown);
}

/** Delivery artifacts attached to the conversation (plan final delivery). */
function messageDeliveries(messages: Message[]): Artifact[] {
    const rows: Artifact[] = [];
    for (const message of messages) {
        for (const artifact of message.artifacts ?? []) {
            if (artifact.artifactType === "delivery") {
                rows.push(artifact);
            }
        }
    }
    return rows;
}

// =============================================================================
// Main Component
// =============================================================================

export function MissionControlSidePanel({
    activity,
    plan: initialPlan,
    messages,
    phase = "idle",
    phaseLabel,
    agentLabel,
    onPlanDecision,
    className,
}: MissionControlSidePanelProps) {
    const allProposals = useMemo(() => {
        return messages
            .map((m) => m.proposal)
            .filter((p): p is Plan => Boolean(p))
            .filter((p, idx, self) => self.findIndex((x) => x.proposalId === p.proposalId && x.version === p.version) === idx)
            .sort((a, b) => a.version - b.version);
    }, [messages]);

    const currentPlanIndex = allProposals.findIndex(
        (p) => p.version === (initialPlan?.version ?? 0),
    );

    const [activePlanIdx, setActivePlanIdx] = useState<number>(
        currentPlanIndex !== -1 ? currentPlanIndex : Math.max(0, allProposals.length - 1),
    );

    const prevProposalsLength = useRef(allProposals.length);
    useEffect(() => {
        if (allProposals.length > prevProposalsLength.current) {
            setActivePlanIdx(allProposals.length - 1);
        }
        prevProposalsLength.current = allProposals.length;
    }, [allProposals.length]);

    useEffect(() => {
        if (currentPlanIndex !== -1) {
            setActivePlanIdx(currentPlanIndex);
        }
    }, [currentPlanIndex]);

    const activePlan = allProposals[activePlanIdx] ?? initialPlan;
    const activePlanMessage = messages.find(
        (m) => m.proposal?.proposalId === activePlan?.proposalId && m.proposal?.version === activePlan?.version,
    );
    const activeMessageId = activePlanMessage?.id ?? "";

    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");

    const { rows: taskRows, claimedIds } = useMemo(
        () => taskFoldRows(activePlan, activity),
        [activePlan, activity],
    );

    const connectorRequests = useMemo(() => {
        return messages
            .flatMap((m) => m.connectorRequests ?? [])
            .filter((request, idx, self) => self.findIndex((x) => x.requestId === request.requestId) === idx);
    }, [messages]);

    if (!activity && !activePlan && connectorRequests.length === 0) return null;

    const visited = new Set<string>();
    const roots = activity
        ? activity.roots.map((id) => activity.nodes[id]).filter((n): n is ActivityNode => Boolean(n))
        : [];
    const rootIds = new Set(roots.map((n) => n.id));
    const orphanRoots = activity
        ? Object.values(activity.nodes).filter((n) => {
            if (rootIds.has(n.id) || !isVisibleNode(n)) return false;
            const parent = n.parentId ? activity.nodes[n.parentId] : undefined;
            return !parent || !isVisibleNode(parent);
        })
        : [];
    const allRoots = [...roots, ...orphanRoots];
    const groupedRoots = groupRoots(allRoots);

    const activeNodesCount = activity ? Object.values(activity.nodes).filter((n) => n.status === "running").length : 0;
    const completedNodesCount = activity ? Object.values(activity.nodes).filter((n) => n.status === "completed").length : 0;
    const totalNodes = activity ? Object.keys(activity.nodes).filter((id) => {
        const n = activity.nodes[id];
        return n && isVisibleNode(n);
    }).length : 0;

    const panelStatus = activeNodesCount > 0 ? "running" : completedNodesCount > 0 ? "completed" : phase === "error" ? "failed" : "running";
    const panelSummary = activeNodesCount > 0
        ? `${activeNodesCount} active task${activeNodesCount > 1 ? "s" : ""} executing`
        : completedNodesCount > 0
            ? `${completedNodesCount} task${completedNodesCount > 1 ? "s" : ""} completed`
            : phaseLabel || "Standing by";
    const panelMetadata = (
        <>
            {totalNodes > 0 && <span>{totalNodes} nodes</span>}
            {roots[0]?.runId && <span>run {shortId(roots[0].runId)}</span>}
        </>
    );

    const renderPlanSection = () => {
        if (!activePlan) return null;

        const decided = activePlan.decision || activePlan.state === "approved" || activePlan.state === "rejected" || activePlan.state === "changes_requested";
        const canAct = Boolean(onPlanDecision) && !activePlan.pending && !decided;
        const tasks = planTasks(activePlan);
        const deliveries = messageDeliveries(messages).filter((artifact) => (
            !artifact.taskId || !activePlan.tasks?.some((task) => task.id === artifact.taskId && task.status !== "done")
        ));
        const versionMetadata = (
            <>
                <span>v{activePlan.version}</span>
                {activePlan.proposalId && <span>{shortId(activePlan.proposalId)}</span>}
                {activePlan.runId && <span>{shortId(activePlan.runId)}</span>}
            </>
        );

        return (
            <PlanGate
                title={decided ? "Plan Decided" : "Plan Review"}
                state={activePlan.decision || activePlan.state}
                subtitle={activePlan.failureReason ?? activePlan.error ? (activePlan.failureReason ?? activePlan.error) : decided ? undefined : "Review the proposed work plan and choose an out-of-band decision."}
                metadata={versionMetadata}
                actions={
                    canAct ? (
                        <PlanActions
                            onApprove={() => onPlanDecision?.(activeMessageId, activePlan, "approved")}
                            onReject={() => onPlanDecision?.(activeMessageId, activePlan, "rejected", feedbackText.trim() || undefined)}
                            onRequestChanges={() => {
                                if (!feedbackOpen) {
                                    setFeedbackOpen(true);
                                    return;
                                }
                                onPlanDecision?.(activeMessageId, activePlan, "changes_requested", feedbackText.trim() || undefined);
                            }}
                            disabled={activePlan.pending}
                            hasFeedbackInput={feedbackOpen}
                        />
                    ) : decided ? (
                        <PlanActions state={activePlan.decision || activePlan.state} />
                    ) : undefined
                }
            >
                {allProposals.length > 1 && (
                    <PlanVersionCarousel
                        currentVersion={activePlan.version}
                        totalVersions={allProposals.length}
                        onPrev={() => setActivePlanIdx((prev) => Math.max(0, prev - 1))}
                        onNext={() => setActivePlanIdx((prev) => Math.min(allProposals.length - 1, prev + 1))}
                    />
                )}
                {feedbackOpen && canAct && (
                    <textarea
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder="Provide specific guidelines or requests for this plan..."
                        className="cm-plan-feedback-input"
                        rows={3}
                    />
                )}
                {tasks.length > 0 ? (
                    <div className="cm-plan-task-list">
                        {tasks.map((task, idx) => (
                            <PlanTask
                                key={idx}
                                index={idx}
                                title={task.title}
                                description={task.description}
                                status={task.status}
                            />
                        ))}
                    </div>
                ) : (
                    <MarkdownRenderer content={activePlan.markdown || "No checklist provided."} />
                )}
                {deliveries.length > 0 && (
                    <div className="cm-plan-deliveries space-y-1.5 pt-2">
                        <p className="text-xs font-medium text-muted-foreground">Deliveries</p>
                        {deliveries.map((artifact) => {
                            const content = artifact.content ?? artifact.summary ?? "";
                            const download = () => {
                                const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
                                const href = URL.createObjectURL(blob);
                                const anchor = document.createElement("a");
                                anchor.href = href;
                                anchor.download = `deliverable-${artifact.taskId ?? "final"}.md`;
                                document.body.appendChild(anchor);
                                anchor.click();
                                anchor.remove();
                                URL.revokeObjectURL(href);
                            };
                            return (
                                <div key={artifact.deliverableId ?? artifact.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">{artifact.title ?? "Plan delivery"}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {artifact.taskTitle ?? "final delivery"}
                                            {artifact.bytes ? ` · ${Math.max(1, Math.round(artifact.bytes / 1024))} KB` : ""}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={download}
                                        className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                                    >
                                        .md
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </PlanGate>
        );
    };

    const renderConnectorSection = () => {
        if (connectorRequests.length === 0) return null;
        return connectorRequests.map((request: ConnectorRequest) => (
            <InlineConnectorGate key={request.requestId} request={request} />
        ));
    };

    const renderTaskSection = () => {
        if (taskRows.length === 0) return null;
        const runningTasks = taskRows.filter((row) => row.task.status === "doing").length;
        const doneTasks = taskRows.filter((row) => row.task.status === "done").length;

        return (
            <MissionPocket
                title="Task Assignments"
                summary={runningTasks > 0
                    ? `${runningTasks} of ${taskRows.length} tasks executing`
                    : doneTasks === taskRows.length
                        ? `All ${taskRows.length} tasks completed`
                        : `${taskRows.length} assigned tasks`}
                status={runningTasks > 0 ? "running" : doneTasks === taskRows.length ? "completed" : "pending"}
                metadata={<span>{doneTasks}/{taskRows.length} done</span>}
            >
                {taskRows.map((row) => (
                    <TaskFold key={row.task.id} row={row} activity={activity!} />
                ))}
            </MissionPocket>
        );
    };

    const renderActivitySection = () => {
        if (!activity || groupedRoots.length === 0) return null;

        return (
            <MissionPocket
                title="Agent Swarm Timeline"
                summary={activeNodesCount > 0 ? `${activeNodesCount} sub-tasks executing` : "Execution standby"}
                status={activeNodesCount > 0 ? "running" : "completed"}
                metadata={
                    <>
                        <span>{completedNodesCount} done</span>
                    </>
                }
            >
                {groupedRoots.map((item) => {
                    if ("nodes" in item) {
                        return <GroupedSwarmNode key={item.kind} group={item} activity={activity} />;
                    }
                    return (
                        <SwarmNode
                            key={item.id}
                            node={item}
                            activity={activity}
                            depth={0}
                            visited={visited}
                            hiddenIds={claimedIds}
                        />
                    );
                })}
            </MissionPocket>
        );
    };

    return (
        <MissionControlPanel
            title="Mission Control"
            status={panelStatus}
            summary={panelSummary}
            metadata={panelMetadata}
            className={className}
        >
            {renderPlanSection()}
            {renderConnectorSection()}
            {renderTaskSection()}
            {renderActivitySection()}
        </MissionControlPanel>
    );
}
