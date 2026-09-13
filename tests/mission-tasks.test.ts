/**
 * Mission-control task folds — every plan task is assigned to an agent;
 * the panel groups each task's live child-agent activity (and reasoning)
 * under its own fold, and the general timeline excludes those subtrees.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type { ActivityNode, ActivityState } from "@compose-market/sdk";
import { taskFoldRows, taskIdOfNode, TASK_ROW_STATUS } from "../src/lib/folds.ts";
import type { Plan } from "../src/hooks/use-chat.ts";

const here = import.meta.dirname;

function node(input: Partial<ActivityNode> & { id: string; kind: string }): ActivityNode {
    return {
        status: "completed",
        spanId: input.id,
        children: [],
        path: [],
        events: 1,
        updatedAt: 1,
        ...input,
    } as ActivityNode;
}

function state(nodes: ActivityNode[]): ActivityState {
    const map = new Map(nodes.map((n) => [n.id, n]));
    const roots: string[] = [];
    for (const n of nodes) {
        if (n.parentId && map.has(n.parentId)) {
            const parent = map.get(n.parentId)!;
            parent.children = [...(parent.children ?? []), n.id];
        } else {
            roots.push(n.id);
        }
    }
    return { roots, nodes: Object.fromEntries(map), seen: {}, traces: [], errors: [] } as unknown as ActivityState;
}

test("taskIdOfNode prefers the wire payload taskId and falls back to id parsing", () => {
    assert.equal(taskIdOfNode(node({
        id: "agent:sub:run-1:task-2-business-architecture:d1",
        kind: "agent",
        payload: { taskId: "task-9" },
    })), "task-9");
    assert.equal(taskIdOfNode(node({
        id: "agent:sub:run-1:task-2-business-architecture:d1",
        kind: "agent",
    })), "task-2-business-architecture");
    assert.equal(taskIdOfNode(node({ id: "run:run-1", kind: "run" })), undefined);
    assert.equal(taskIdOfNode(node({ id: "tool:sub:run-1:task-1:d1:search", kind: "tool" })), undefined);
});

test("taskFoldRows binds every task row to its agent nodes and claims their subtrees", () => {
    const plan: Plan = {
        type: "plan.proposed",
        proposalId: "proposal_1",
        version: 1,
        state: "executing",
        tasks: [
            { id: "task-1", title: "Draft", owner: "coordinator", ownerName: "Coordinator", status: "done" },
            { id: "task-2", title: "Review", owner: "specialist", ownerName: "Positioning Specialist", status: "doing" },
        ],
    };
    const activity = state([
        node({ id: "run:run-1", kind: "run", status: "running" }),
        node({ id: "agent:sub:run-1:task-1:d1", kind: "agent", parentId: "run:run-1", status: "completed" }),
        node({ id: "tool:sub:run-1:task-1:d1:search", kind: "tool", parentId: "agent:sub:run-1:task-1:d1" }),
        node({ id: "agent:sub:run-1:task-2:d1", kind: "agent", parentId: "run:run-1", status: "running" }),
        node({ id: "thinking:sub:run-1:task-2:d1", kind: "thinking", parentId: "agent:sub:run-1:task-2:d1", text: "Reviewing" }),
        node({ id: "tool:parent-own-tool", kind: "tool", parentId: "run:run-1" }),
    ]);

    const { rows, claimedIds } = taskFoldRows(plan, activity);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].task.ownerName, "Coordinator");
    assert.deepEqual(rows[0].agentNodes.map((n) => n.id), ["agent:sub:run-1:task-1:d1"]);
    assert.deepEqual(rows[1].agentNodes.map((n) => n.id), ["agent:sub:run-1:task-2:d1"]);
    // The task's whole subtree is claimed: agent + its tools + its thinking.
    assert.ok(claimedIds.has("agent:sub:run-1:task-1:d1"));
    assert.ok(claimedIds.has("tool:sub:run-1:task-1:d1:search"));
    assert.ok(claimedIds.has("thinking:sub:run-1:task-2:d1"));
    // Unrelated parent activity stays in the general timeline.
    assert.ok(!claimedIds.has("tool:parent-own-tool"));
    assert.ok(!claimedIds.has("run:run-1"));
});

test("task row statuses map to fold states", () => {
    assert.equal(TASK_ROW_STATUS.todo, "pending");
    assert.equal(TASK_ROW_STATUS.doing, "running");
    assert.equal(TASK_ROW_STATUS.done, "completed");
    assert.equal(TASK_ROW_STATUS.blocked, "failed");
    assert.equal(TASK_ROW_STATUS.failed, "failed");
});

test("mission control renders one fold per task titled with the assigned agent name", () => {
    const source = readFileSync(resolve(here, "../src/components/mission-control.tsx"), "utf8");
    assert.match(source, /task \$\{task\.id\} - \$\{ownerName\}/);
    assert.match(source, /ownerName = task\.ownerName \?\? task\.title/);
    // Task folds render between the connector gates and the swarm timeline.
    const order = [
        source.indexOf("renderPlanSection()"),
        source.indexOf("renderConnectorSection()"),
        source.indexOf("renderTaskSection()"),
        source.indexOf("renderActivitySection()"),
    ];
    assert.deepEqual(order, [...order].sort());
    // The general timeline excludes task-claimed subtrees.
    assert.match(source, /hiddenIds=\{claimedIds\}/);
});

test("child model reasoning folds into the agent's tree node, never the chat", () => {
    const streamSource = readFileSync(resolve(here, "../src/hooks/use-stream.ts"), "utf8");
    assert.match(streamSource, /function routeChildModelToTree/);
    assert.match(streamSource, /type: "activity\.thinking",[\s\S]{0,200}parentId: `agent:\$\{agentRunKey\}`/);
    assert.match(streamSource, /type: "activity\.message",[\s\S]{0,200}parentId: `agent:\$\{agentRunKey\}`/);
    // Nested sub-plan completion turns (complete-<sub runKey>) fold under the
    // same agent node as the sub-agent's task run.
    assert.match(streamSource, /runId\.startsWith\("complete-"\) \? runId\.slice\("complete-"\.length\) : runId/);
    // The chat-law guards route into the tree instead of silently dropping.
    assert.match(streamSource, /startsWith\("sub:"\)\) \{\s*routeChildModelToTree\(event, chat\);\s*return;/);
});

test("mission control binds to the plan-owning message's activity tree", () => {
    const chatSource = readFileSync(resolve(here, "../src/hooks/use-chat.ts"), "utf8");
    assert.match(chatSource, /find\(\(m\) => m\.role === "assistant" && m\.proposal\)/);
    assert.match(chatSource, /if \(planMessage\?\.activity\) return planMessage\.activity/);
});
