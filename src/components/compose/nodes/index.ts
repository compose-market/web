/**
 * Compose Node Components - Shared Types and Styles
 * 
 * n8n-inspired node designs with protruding connectors for ReactFlow.
 */

import { Handle, Position } from "@xyflow/react";
import type { Agent } from "@/lib/agents";
import type { WorkflowStep, ConnectorTool } from "@/lib/services";

// =============================================================================
// Shared Handle Styles
// =============================================================================

/** Base handle styling for n8n-like protruding connectors */
export const handleBaseStyle = "!w-4 !h-4 !rounded-full !border-2 transition-all";

/** Input handle (left side) - cyan glow */
export const inputHandleStyle = `${handleBaseStyle} !-left-2 !bg-cyan-500 !border-cyan-300 !shadow-[0_0_10px_hsl(188_95%_43%/0.6)] hover:!shadow-[0_0_15px_hsl(188_95%_43%/0.8)]`;

/** Output handle (right side) - fuchsia glow */
export const outputHandleStyle = `${handleBaseStyle} !-right-2 !bg-fuchsia-500 !border-fuchsia-300 !shadow-[0_0_10px_hsl(292_85%_55%/0.6)] hover:!shadow-[0_0_15px_hsl(292_85%_55%/0.8)]`;

// =============================================================================
// Node Data Types
// =============================================================================

export interface StepNodeData extends Record<string, unknown> {
    step: WorkflowStep;
    connector?: { name: string; registryId: string };
    tool?: ConnectorTool;
    status?: "pending" | "running" | "success" | "error";
    error?: string;
}

export interface AgentNodeData extends Record<string, unknown> {
    agent: Agent;
    step: WorkflowStep;
    status?: "pending" | "running" | "success" | "error";
    error?: string;
}

export interface TriggerNodeData extends Record<string, unknown> {
    trigger: {
        id: string;
        name: string;
        type: "cron" | "webhook" | "event" | "manual";
        nlDescription?: string;
        cronExpression?: string;
        cronReadable?: string;
        enabled: boolean;
    };
    status?: "pending" | "running" | "success" | "error";
    error?: string;
}

export interface HookNodeData extends Record<string, unknown> {
    hook: {
        id: string;
        name: string;
        type: "pre-execution" | "post-step" | "on-error" | "on-complete" | "on-context-cleanup" | "on-restart";
        action: {
            type: "notify" | "webhook" | "agent" | "memory" | "log";
        };
        enabled: boolean;
    };
    status?: "pending" | "running" | "success" | "error";
    error?: string;
}

// =============================================================================
// Re-exports
// =============================================================================

export { StepNode } from "./step-node";
export { AgentNode } from "./agent-node";
export { TriggerNode } from "./trigger-node";
export { HookNode } from "./hook-node";
