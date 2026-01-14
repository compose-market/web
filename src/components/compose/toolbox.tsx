/**
 * Floating Toolbox Component
 * 
 * Draggable toolbox for fullscreen compose mode.
 * Contains plugin/agent/trigger pickers and action buttons.
 */

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Play, Bot, Plug, Clock, Settings, Loader2, ChevronRight, Minimize2, Sparkles
} from "lucide-react";
import { ConnectorPicker } from "./pickers/connector-picker";
import { AgentsPicker } from "./pickers/agents-picker";
import { TriggerPicker } from "./pickers/trigger-picker";
import type { ConnectorTool } from "@/lib/services";
import type { Agent } from "@/lib/agents";
import type { TriggerDefinition } from "@/lib/triggers";

interface FloatingToolboxProps {
    onClose: () => void;
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

export function FloatingToolbox({
    onClose,
    onAddStep,
    onAddAgentStep,
    onAddTrigger,
    onRun,
    onRequest,
    onMint,
    onSettings,
    isRunning,
    nodeCount,
}: FloatingToolboxProps) {
    // Initialize position accounting for sidebar on desktop (sidebar is 256px = 16rem when expanded, 64px when collapsed)
    // On mobile, start near top-left with padding
    const getInitialPosition = () => {
        if (typeof window === 'undefined') return { x: 280, y: 80 };
        const isMobile = window.innerWidth < 768;
        return isMobile
            ? { x: 16, y: 70 } // Mobile: padding from edges
            : { x: 280, y: 100 }; // Desktop: past sidebar width + padding
    };

    const [position, setPosition] = useState(getInitialPosition);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const toolboxRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        // Only drag from the header
        if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;

        setIsDragging(true);
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y,
        });
        e.preventDefault();
    };

    // Touch event handlers for mobile drag support
    const handleTouchStart = (e: React.TouchEvent) => {
        if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
        const touch = e.touches[0];
        setIsDragging(true);
        setDragOffset({
            x: touch.clientX - position.x,
            y: touch.clientY - position.y,
        });
    };

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            // Constrain to viewport with padding
            const toolboxWidth = 288; // w-72 = 18rem = 288px
            const toolboxMinHeight = 100;
            const padding = 16;
            const newX = Math.max(padding, Math.min(window.innerWidth - toolboxWidth - padding, e.clientX - dragOffset.x));
            const newY = Math.max(padding, Math.min(window.innerHeight - toolboxMinHeight - padding, e.clientY - dragOffset.y));
            setPosition({ x: newX, y: newY });
        };

        const handleTouchMove = (e: TouchEvent) => {
            // Prevent scrolling while dragging
            e.preventDefault();
            const touch = e.touches[0];
            const toolboxWidth = 288;
            const toolboxMinHeight = 100;
            const padding = 16;
            const newX = Math.max(padding, Math.min(window.innerWidth - toolboxWidth - padding, touch.clientX - dragOffset.x));
            const newY = Math.max(padding, Math.min(window.innerHeight - toolboxMinHeight - padding, touch.clientY - dragOffset.y));
            setPosition({ x: newX, y: newY });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        const handleTouchEnd = () => {
            setIsDragging(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        // Use passive: false to allow preventDefault on touchmove
        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', handleTouchEnd);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [isDragging, dragOffset]);

    return (
        <div
            ref={toolboxRef}
            className="fixed z-50 w-[calc(100vw-32px)] sm:w-72 max-w-72 bg-card/95 backdrop-blur-xl border border-cyan-500/30 rounded-lg shadow-2xl overflow-hidden"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                cursor: isDragging ? 'grabbing' : 'auto',
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
        >
            {/* Draggable Header */}
            <div
                data-drag-handle
                className="flex items-center justify-between px-3 py-2 bg-sidebar-accent border-b border-sidebar-border cursor-grab active:cursor-grabbing select-none"
                style={{ touchAction: 'none' }}
            >
                <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                    </div>
                    <span className="text-xs font-mono font-bold text-cyan-400">TOOLBOX</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1 border-cyan-500/30 text-cyan-400 font-mono">
                        {nodeCount} steps
                    </Badge>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onSettings}
                        className="h-6 w-6 text-muted-foreground hover:text-cyan-400"
                        title="Workflow Settings"
                    >
                        <Settings className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    >
                        {isMinimized ? <ChevronRight className="w-3.5 h-3.5 rotate-90" /> : <ChevronRight className="w-3.5 h-3.5 -rotate-90" />}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="h-6 w-6 text-muted-foreground hover:text-cyan-400"
                        title="Exit fullscreen (ESC)"
                    >
                        <Minimize2 className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </div>

            {/* Collapsible Body */}
            {!isMinimized && (
                <div className="flex flex-col p-3 gap-3">
                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            onClick={onRun}
                            disabled={isRunning || nodeCount === 0}
                            className="bg-green-500 text-white hover:bg-green-600 font-bold font-mono text-xs h-8 flex-1"
                        >
                            {isRunning ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            ) : (
                                <Play className="w-3.5 h-3.5 mr-1.5" />
                            )}
                            {isRunning ? "RUNNING" : "RUN"}
                        </Button>
                        <Button
                            onClick={onRequest}
                            variant="outline"
                            className="border-fuchsia-500/30 hover:border-fuchsia-500 hover:bg-fuchsia-500/10 text-xs h-8"
                        >
                            <Bot className="w-3.5 h-3.5 mr-1.5" />
                            REQUEST
                        </Button>
                    </div>

                    {/* Compact Pickers - no outer scroll, only internal content scrolls */}
                    <div className="border-t border-sidebar-border pt-3">
                        <Tabs defaultValue="connectors" className="w-full">
                            <TabsList className="w-full h-8 rounded-sm bg-sidebar-accent border border-sidebar-border">
                                <TabsTrigger
                                    value="connectors"
                                    className="flex-1 text-[10px] h-6 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 rounded-sm"
                                >
                                    <Plug className="w-3 h-3 mr-1" />
                                    PLUGINS
                                </TabsTrigger>
                                <TabsTrigger
                                    value="agents"
                                    className="flex-1 text-[10px] h-6 data-[state=active]:bg-fuchsia-500/20 data-[state=active]:text-fuchsia-400 rounded-sm"
                                >
                                    <Bot className="w-3 h-3 mr-1" />
                                    AGENTS
                                </TabsTrigger>
                                <TabsTrigger
                                    value="triggers"
                                    className="flex-1 text-[10px] h-6 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 rounded-sm"
                                >
                                    <Clock className="w-3 h-3 mr-1" />
                                    TRIGGERS
                                </TabsTrigger>
                            </TabsList>
                            <TabsContent value="connectors" className="mt-2 h-40 overflow-y-auto">
                                <ConnectorPicker onSelect={onAddStep} />
                            </TabsContent>
                            <TabsContent value="agents" className="mt-2 h-40 overflow-y-auto">
                                <AgentsPicker onSelect={onAddAgentStep} />
                            </TabsContent>
                            <TabsContent value="triggers" className="mt-2 h-40 overflow-y-auto">
                                <TriggerPicker onAdd={(trigger) => {
                                    if (onAddTrigger) {
                                        onAddTrigger(trigger);
                                    } else {
                                        console.log("[compose] Add trigger:", trigger);
                                    }
                                }} />
                            </TabsContent>
                        </Tabs>
                    </div>

                    {/* MINT Button - at the bottom */}
                    <Button
                        onClick={onMint}
                        disabled={nodeCount === 0}
                        className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white hover:from-cyan-400 hover:to-fuchsia-400 font-bold font-mono text-xs h-9 disabled:opacity-50"
                    >
                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                        MINT AS NFT
                    </Button>
                </div>
            )}
        </div>
    );
}
