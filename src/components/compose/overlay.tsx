/**
 * Fullscreen Canvas Overlay Component
 * 
 * Provides a blurred backdrop overlay for immersive canvas editing.
 * Includes floating toolbox and ESC key handler.
 */

import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { FloatingToolbox } from "./toolbox";
import type { ConnectorTool } from "@/lib/services";
import type { Agent } from "@/lib/agents";
import type { TriggerDefinition } from "@/lib/triggers";

interface FullscreenOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    onAddStep: (connectorId: string, tool: ConnectorTool) => void;
    onAddAgentStep: (agent: Agent) => void;
    onAddTrigger?: (trigger: Partial<TriggerDefinition>) => void;
    onRun: () => void;
    onRequest: () => void;
    onMint: () => void;
    onSettings: () => void;
    isRunning: boolean;
    nodeCount: number;
}

export function FullscreenOverlay({
    isOpen,
    onClose,
    children,
    onAddStep,
    onAddAgentStep,
    onAddTrigger,
    onRun,
    onRequest,
    onMint,
    onSettings,
    isRunning,
    nodeCount,
}: FullscreenOverlayProps) {
    // Handle ESC key to close
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleEsc);
        return () => window.removeEventListener("keydown", handleEsc);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50">
            {/* Blurred backdrop */}
            <div
                className="absolute inset-0 bg-background/85 backdrop-blur-xl transition-opacity duration-300"
                style={{
                    background: "linear-gradient(145deg, hsl(222 47% 3% / 0.92), hsl(270 60% 10% / 0.88))"
                }}
            />

            {/* Content container */}
            <div className="relative w-full h-full p-6 animate-in zoom-in-95 fade-in duration-300">
                {/* Header badge (top right) */}
                <div className="absolute top-4 right-4 z-10">
                    <Badge variant="outline" className="font-mono border-cyan-500/30 text-cyan-400">
                        FULLSCREEN MODE • Press ESC to exit
                    </Badge>
                </div>

                {/* Fullscreen canvas container */}
                <div className="w-full h-full rounded-sm border border-cyan-500/30 overflow-hidden bg-black/60 shadow-2xl neon-border">
                    {children}
                </div>

                {/* Floating Toolbox */}
                <FloatingToolbox
                    onClose={onClose}
                    onAddStep={onAddStep}
                    onAddAgentStep={onAddAgentStep}
                    onAddTrigger={onAddTrigger}
                    onRun={onRun}
                    onRequest={onRequest}
                    onMint={onMint}
                    onSettings={onSettings}
                    isRunning={isRunning}
                    nodeCount={nodeCount}
                />
            </div>
        </div>
    );
}
