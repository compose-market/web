/**
 * Agent Node Component
 * 
 * Renders an AI agent as an n8n-style node with avatar and registry info.
 * Features multi-directional handles on all 4 sides for flexible connections.
 */

import { Position, useNodeId, useReactFlow } from "@xyflow/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, CheckCircle2, XCircle, Sparkles, Shield } from "lucide-react";
import { DirectionalHandle } from "./handle";
import type { AgentNodeData } from "./index";

export function AgentNode({ data }: { data: AgentNodeData }) {
    const { agent, status = "pending", error } = data;
    const nodeId = useNodeId();
    const { getEdges } = useReactFlow();

    // Check which handles are connected
    const edges = getEdges();
    const leftConnected = edges.some((e: any) => e.target === nodeId && e.targetHandle?.includes("Left"));
    const rightConnected = edges.some((e: any) => e.source === nodeId && e.sourceHandle?.includes("Right"));
    const topConnected = edges.some((e: any) => e.target === nodeId && e.targetHandle?.includes("Top"));
    const bottomConnected = edges.some((e: any) => e.source === nodeId && e.sourceHandle?.includes("Bottom"));

    const initials = agent.name
        .split(" ")
        .map(w => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    const isManowar = agent.registry === "manowar";

    const statusStyles = {
        pending: isManowar ? "border-cyan-500/40 bg-cyan-500/5" : "border-fuchsia-500/40 bg-fuchsia-500/5",
        running: "border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/35",
        success: "border-green-500 bg-green-500/5",
        error: "border-red-500 bg-red-500/5",
    };

    return (
        <div className={`relative w-64 rounded-lg border-2 backdrop-blur-md overflow-visible group transition-all duration-200 hover:scale-[1.02] ${statusStyles[status]}`}>
            {/* Multi-directional handles */}
            <DirectionalHandle type="target" position={Position.Left} id={nodeId || ""} isConnected={leftConnected} />
            <DirectionalHandle type="source" position={Position.Right} id={nodeId || ""} isConnected={rightConnected} />
            <DirectionalHandle type="target" position={Position.Top} id={nodeId || ""} isConnected={topConnected} />
            <DirectionalHandle type="source" position={Position.Bottom} id={nodeId || ""} isConnected={bottomConnected} />

            {/* Colored header bar */}
            <div className={`h-1.5 w-full ${isManowar ? "bg-gradient-to-r from-cyan-500 to-cyan-400" : "bg-gradient-to-r from-fuchsia-500 to-fuchsia-400"}`} />

            {/* Content */}
            <div className="p-3">
                <div className="flex items-center gap-2.5">
                    <Avatar className={`w-10 h-10 border-2 shrink-0 ${isManowar ? "border-cyan-500/50" : "border-fuchsia-500/50"}`}>
                        <AvatarImage src={agent.avatarUrl || undefined} alt={agent.name} />
                        <AvatarFallback className={`font-mono text-xs ${isManowar ? "bg-cyan-500/20 text-cyan-400" : "bg-fuchsia-500/20 text-fuchsia-400"}`}>
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                    <div className="overflow-hidden flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                            <h3 className="font-bold font-display text-sm truncate text-foreground leading-tight">
                                {agent.name}
                            </h3>
                            {isManowar && <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                            {agent.verified && !isManowar && <Shield className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground truncate font-mono">
                            {agent.protocols?.[0]?.name || "default"}
                        </p>
                    </div>
                    {status === "running" && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />}
                    {status === "success" && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
                    {status === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                </div>

                {error && (
                    <div className="text-xs text-red-400 font-mono bg-red-500/10 p-1.5 rounded mt-2 truncate">
                        {error}
                    </div>
                )}

                <div className="flex justify-between items-center mt-2 pt-2 border-t border-sidebar-border/50">
                    <Badge
                        variant="outline"
                        className={`text-xs h-4 px-1.5 font-mono ${isManowar ? "border-cyan-500/30 text-cyan-400" : "border-fuchsia-500/30 text-fuchsia-400"}`}
                    >
                        {isManowar ? "on-chain" : agent.registry}
                    </Badge>
                    <Bot className={`w-3.5 h-3.5 ${isManowar ? "text-cyan-400/50" : "text-fuchsia-400/50"}`} />
                </div>
            </div>
        </div>
    );
}
