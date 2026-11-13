/**
 * Step Node Component
 * 
 * Renders a workflow step (MCP/connector tool) as an n8n-style node.
 * Features multi-directional handles on all 4 sides for flexible connections.
 */

import { Position, useNodeId, useReactFlow } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Plug, Loader2, CheckCircle2, XCircle, Wrench } from "lucide-react";
import { DirectionalHandle } from "./handle";
import type { StepNodeData } from "./index";

export function StepNode({ data }: { data: StepNodeData }) {
    const nodeId = useNodeId();
    const { getEdges } = useReactFlow();

    // Check which handles are connected
    const edges = getEdges();
    const leftConnected = edges.some((e: any) => e.target === nodeId && e.targetHandle?.includes("Left"));
    const rightConnected = edges.some((e: any) => e.source === nodeId && e.sourceHandle?.includes("Right"));
    const topConnected = edges.some((e: any) => e.target === nodeId && e.targetHandle?.includes("Top"));
    const bottomConnected = edges.some((e: any) => e.source === nodeId && e.sourceHandle?.includes("Bottom"));

    const statusStyles = {
        pending: "border-sidebar-border bg-card/80",
        running: "border-cyan-500 bg-cyan-500/5 shadow-lg shadow-cyan-500/30",
        success: "border-green-500 bg-green-500/5",
        error: "border-red-500 bg-red-500/5",
    };

    const statusIndicator = {
        pending: "bg-sidebar-border",
        running: "bg-cyan-500 animate-pulse",
        success: "bg-green-500",
        error: "bg-red-500",
    };

    return (
        <div className={`relative w-64 rounded-lg border-2 backdrop-blur-md overflow-visible group transition-all duration-200 hover:scale-[1.02] ${statusStyles[data.status || "pending"]}`}>
            {/* Multi-directional handles */}
            <DirectionalHandle type="target" position={Position.Left} id={nodeId || ""} isConnected={leftConnected} />
            <DirectionalHandle type="source" position={Position.Right} id={nodeId || ""} isConnected={rightConnected} />
            <DirectionalHandle type="target" position={Position.Top} id={nodeId || ""} isConnected={topConnected} />
            <DirectionalHandle type="source" position={Position.Bottom} id={nodeId || ""} isConnected={bottomConnected} />

            {/* Status bar */}
            <div className={`h-1 w-full ${statusIndicator[data.status || "pending"]}`} />

            {/* Content */}
            <div className="p-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/30 shrink-0">
                        <Plug className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="overflow-hidden flex-1 min-w-0">
                        <h3 className="font-bold font-display text-sm truncate text-foreground leading-tight">
                            {data.step.name}
                        </h3>
                        <p className="text-xs text-muted-foreground truncate font-mono">
                            {data.step.connectorId}
                        </p>
                    </div>
                    {data.status === "running" && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />}
                    {data.status === "success" && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
                    {data.status === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                </div>

                {data.error && (
                    <div className="text-xs text-red-400 font-mono bg-red-500/10 p-1.5 rounded mt-2 truncate">
                        {data.error}
                    </div>
                )}

                <div className="flex justify-between items-center mt-2 pt-2 border-t border-sidebar-border/50">
                    <Badge variant="outline" className="text-xs h-4 px-1.5 border-cyan-500/30 text-cyan-400 font-mono">
                        {data.step.toolName}
                    </Badge>
                    <Wrench className="w-3 h-3 text-muted-foreground/50" />
                </div>
            </div>
        </div>
    );
}
