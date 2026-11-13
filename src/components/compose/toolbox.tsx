/**
 * Floating Toolbox Component
 *
 * Canvas-docked draggable step picker for workflow composition.
 */

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Plug, ChevronRight } from "lucide-react";
import { ConnectorPicker } from "./pickers/connectors";
import { AgentsPicker } from "./pickers/agents";
import type { ConnectorTool } from "@/lib/services";
import type { Agent } from "@/lib/agents";

interface FloatingToolboxProps {
  onAddStep: (connectorId: string, tool: ConnectorTool) => void;
  onAddAgentStep: (agent: Agent) => void;
}

export function FloatingToolbox({
  onAddStep,
  onAddAgentStep,
}: FloatingToolboxProps) {
  const [position, setPosition] = useState({ xPct: 1.5, yPct: 2.5 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const toolboxRef = useRef<HTMLDivElement>(null);

  const startDrag = (clientX: number, clientY: number) => {
    const box = toolboxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    setIsDragging(true);
    setDragOffset({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-drag-handle]")) return;
    startDrag(e.clientX, e.clientY);
    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!(e.target as HTMLElement).closest("[data-drag-handle]")) return;
    const touch = e.touches[0];
    if (!touch) return;
    startDrag(touch.clientX, touch.clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const moveTo = (clientX: number, clientY: number) => {
      const box = toolboxRef.current;
      const parent = box?.parentElement;
      if (!box || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      if (parentRect.width <= 0 || parentRect.height <= 0) return;

      const margin = 8;
      const maxX = Math.max(margin, parentRect.width - boxRect.width - margin);
      const maxY = Math.max(margin, parentRect.height - boxRect.height - margin);
      const clampedX = Math.max(margin, Math.min(maxX, clientX - parentRect.left - dragOffset.x));
      const clampedY = Math.max(margin, Math.min(maxY, clientY - parentRect.top - dragOffset.y));

      setPosition({
        xPct: Number(((clampedX / parentRect.width) * 100).toFixed(2)),
        yPct: Number(((clampedY / parentRect.height) * 100).toFixed(2)),
      });
    };

    const handleMouseMove = (e: MouseEvent) => moveTo(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (touch) moveTo(touch.clientX, touch.clientY);
    };
    const stopDrag = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDrag);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", stopDrag);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDrag);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", stopDrag);
    };
  }, [isDragging, dragOffset]);

  return (
    <div
      ref={toolboxRef}
      className="absolute z-20 w-[min(calc(100%-1.5rem),18rem)] bg-card/95 backdrop-blur-xl border border-cyan-500/30 rounded-lg shadow-2xl overflow-hidden"
      style={{
        insetInlineStart: `${position.xPct}%`,
        insetBlockStart: `${position.yPct}%`,
        cursor: isDragging ? "grabbing" : "auto",
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      <div
        data-drag-handle
        className="flex items-center justify-between px-3 py-2 bg-sidebar-accent border-b border-sidebar-border cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: "none" }}
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5" aria-hidden="true">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
          </div>
          <span className="text-xs font-mono font-bold text-cyan-400">ADD STEP</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={isMinimized ? "Expand step picker" : "Minimize step picker"}
          onClick={() => setIsMinimized((prev) => !prev)}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isMinimized ? "rotate-90" : "-rotate-90"}`} />
        </Button>
      </div>

      {!isMinimized && (
        <div className="flex flex-col p-3">
          <Tabs defaultValue="connectors" className="w-full">
            <TabsList className="w-full h-8 rounded-sm bg-sidebar-accent border border-sidebar-border">
              <TabsTrigger
                value="connectors"
                className="flex-1 text-xs h-6 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 rounded-sm"
              >
                <Plug className="w-3 h-3 mr-1" />
                PLUGINS
              </TabsTrigger>
              <TabsTrigger
                value="agents"
                className="flex-1 text-xs h-6 data-[state=active]:bg-fuchsia-500/20 data-[state=active]:text-fuchsia-400 rounded-sm"
              >
                <Bot className="w-3 h-3 mr-1" />
                AGENTS
              </TabsTrigger>
            </TabsList>
            <TabsContent value="connectors" className="mt-2 max-h-[min(15rem,38dvh)] overflow-y-auto overscroll-contain pr-1">
              <ConnectorPicker onSelect={onAddStep} />
            </TabsContent>
            <TabsContent value="agents" className="mt-2 max-h-[min(15rem,38dvh)] overflow-y-auto overscroll-contain pr-1">
              <AgentsPicker onSelect={onAddAgentStep} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
