/**
 * Compose Node Components - Shared Types and Styles
 * 
 * n8n-inspired node designs with protruding connectors for ReactFlow.
 */

import type { Agent } from "@/lib/agents";
import type { WorkflowStep, ConnectorTool } from "@/lib/services";

export { DirectionalHandle, inputHandleStyle, outputHandleStyle } from "./handle";

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

export { StepNode } from "./step-node";
export { AgentNode } from "./agent-node";
