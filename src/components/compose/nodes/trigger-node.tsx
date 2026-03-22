/**
 * Trigger Node Component
 * 
 * Renders a workflow trigger as an n8n-style node with cron info.
 * Features multi-directional handles on all 4 sides for flexible connections.
 */

import { Handle, Position, useNodeId, useReactFlow } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Clock, Loader2, CheckCircle2, XCircle, Zap, Calendar, Plus } from "lucide-react";
import { type TriggerNodeData } from "./index";

// Custom handle that shows "+" when not connected  
const DirectionalHandle = ({
    type,
    position,
    id,
    isConnected = false,
}: {
    type: "source" | "target";
    position: Position;
    id: string;
    isConnected?: boolean;
}) => {
    // Triggers use amber styling
    const baseHandleStyle = "!w-4 !h-4 !rounded-full !border-2 transition-all";
    const amberInputStyle = `${baseHandleStyle} !bg-amber-500 !border-amber-300 !shadow-[0_0_10px_hsl(38_92%_50%/0.6)]`;
    const amberOutputStyle = `${baseHandleStyle} !bg-amber-500 !border-amber-300 !shadow-[0_0_10px_hsl(38_92%_50%/0.6)]`;
    const handleStyle = type === "source" ? amberOutputStyle : amberInputStyle;

    const positionStyles: Record<Position, string> = {
        [Position.Left]: "!-left-2.5",
        [Position.Right]: "!-right-2.5",
        [Position.Top]: "!-top-2.5",
        [Position.Bottom]: "!-bottom-2.5",
    };

    return (
        <Handle
            type={type}
            position={position}
            id={`${id}-${position}`}
            className={`${handleStyle} ${positionStyles[position]} ${!isConnected ? "!bg-muted flex items-center justify-center" : ""}`}
        >
            {!isConnected && (
                <Plus className="w-2.5 h-2.5 text-muted-foreground pointer-events-none" />
            )}
        </Handle>
    );
};

export function TriggerNode({ data }: { data: TriggerNodeData }) {
    const { trigger, status = "pending", error } = data;
    const nodeId = useNodeId();
    const { getEdges } = useReactFlow();

    // Check which handles are connected
    const edges = getEdges();
    const leftConnected = edges.some((e: any) => e.target === nodeId && e.targetHandle?.includes("Left"));
    const rightConnected = edges.some((e: any) => e.source === nodeId && e.sourceHandle?.includes("Right"));
    const topConnected = edges.some((e: any) => e.target === nodeId && e.targetHandle?.includes("Top"));
    const bottomConnected = edges.some((e: any) => e.source === nodeId && e.sourceHandle?.includes("Bottom"));

    const typeIcon = trigger.type === "cron" ? <Calendar className="w-4 h-4 text-amber-400" /> : <Zap className="w-4 h-4 text-amber-400" />;

    const statusStyles = {
        pending: "border-amber-500/40 bg-amber-500/5",
        running: "border-amber-500 bg-amber-500/10 shadow-[0_0_25px_-5px_hsl(38_92%_50%/0.5)]",
        success: "border-green-500 bg-green-500/5",
        error: "border-red-500 bg-red-500/5",
    };

    const statusIndicator = {
        pending: "bg-amber-500/50",
        running: "bg-amber-500 animate-pulse",
        success: "bg-green-500",
        error: "bg-red-500",
    };

    return (
        <div className={`relative w-64 rounded-lg border-2 backdrop-blur-md overflow-visible group transition-all duration-200 hover:scale-[1.02] ${statusStyles[status]}`}>
            {/* Multi-directional handles */}
            <DirectionalHandle type="target" position={Position.Left} id={nodeId || ""} isConnected={leftConnected} />
            <DirectionalHandle type="source" position={Position.Right} id={nodeId || ""} isConnected={rightConnected} />
            <DirectionalHandle type="target" position={Position.Top} id={nodeId || ""} isConnected={topConnected} />
            <DirectionalHandle type="source" position={Position.Bottom} id={nodeId || ""} isConnected={bottomConnected} />

            {/* Status bar */}
            <div className={`h-1 w-full ${statusIndicator[status]}`} />

            {/* Content */}
            <div className="p-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/30 shrink-0">
                        {typeIcon}
                    </div>
                    <div className="overflow-hidden flex-1 min-w-0">
                        <h3 className="font-bold font-display text-sm truncate text-foreground leading-tight">
                            {trigger.name || "Trigger"}
                        </h3>
                        <p className="text-[10px] text-amber-400/80 truncate font-mono">
                            {trigger.cronReadable || trigger.cronExpression || trigger.type}
                        </p>
                    </div>
                    {status === "running" && <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />}
                    {status === "success" && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
                    {status === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                </div>

                {error && (
                    <div className="text-[10px] text-red-400 font-mono bg-red-500/10 p-1.5 rounded mt-2 truncate">
                        {error}
                    </div>
                )}

                <div className="flex justify-between items-center mt-2 pt-2 border-t border-sidebar-border/50">
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-500/30 text-amber-400 font-mono">
                        {trigger.enabled ? "ACTIVE" : "PAUSED"}
                    </Badge>
                    <Clock className="w-3 h-3 text-amber-400/50" />
                </div>
            </div>
        </div>
    );
}
