/**
 * Task-fold derivation for mission control.
 *
 * Every plan task is assigned to an agent (another agent or the planner
 * itself); the runtime stamps each task row with the assigned agent's
 * name/wallet and each child-agent activity event with its task id. These
 * helpers bind task rows to their live child-agent subtrees.
 */
import type { ActivityNode, ActivityState } from "@compose-market/sdk";
import type { Plan } from "@/hooks/use-chat";

function text(value: unknown): string | undefined {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
}

/** The plan task a child-agent node executes — payload.taskId (wire field) or parsed from the node id. */
export function taskIdOfNode(node: ActivityNode): string | undefined {
    const payloadTaskId = text((node.payload as Record<string, unknown> | undefined)?.taskId);
    if (payloadTaskId) return payloadTaskId;
    if (!node.id.startsWith("agent:sub:")) return undefined;
    const segments = node.id.slice("agent:sub:".length).split(":");
    const last = segments[segments.length - 1];
    if (/^d\d+$/.test(last) && segments.length >= 3) {
        return segments.slice(1, -1).join(":");
    }
    return undefined;
}

export interface TaskFoldRow {
    task: NonNullable<Plan["tasks"]>[number];
    agentNodes: ActivityNode[];
}

/** Collect the agent nodes (and their whole subtrees) claimed by plan tasks. */
function collectSubtreeIds(node: ActivityNode, activity: ActivityState, into: Set<string>): void {
    into.add(node.id);
    for (const childId of node.children) {
        const child = activity.nodes[childId];
        if (child) collectSubtreeIds(child, activity, into);
    }
}

export function taskFoldRows(plan: Plan | undefined, activity: ActivityState | undefined): { rows: TaskFoldRow[]; claimedIds: Set<string> } {
    const rows: TaskFoldRow[] = [];
    const claimedIds = new Set<string>();
    if (!plan?.tasks?.length || !activity) return { rows, claimedIds };

    const byTask = new Map<string, ActivityNode[]>();
    for (const node of Object.values(activity.nodes)) {
        if (node.kind !== "agent") continue;
        const taskId = taskIdOfNode(node);
        if (!taskId) continue;
        const bucket = byTask.get(taskId) ?? [];
        bucket.push(node);
        byTask.set(taskId, bucket);
    }

    for (const task of plan.tasks) {
        const agentNodes = (byTask.get(task.id) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
        rows.push({ task, agentNodes });
        for (const node of agentNodes) {
            collectSubtreeIds(node, activity, claimedIds);
        }
    }
    return { rows, claimedIds };
}

export const TASK_ROW_STATUS: Record<NonNullable<Plan["tasks"]>[number]["status"], string> = {
    todo: "pending",
    doing: "running",
    blocked: "failed",
    done: "completed",
    failed: "failed",
};
