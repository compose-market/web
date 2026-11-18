/**
 * Live 3D Agent Activity Graph (Agent Page Side-Panel Companion)
 *
 * Visualizes real-time human ↔ agent execution state on a HiDPI Canvas2D stage
 * (zero SVG DOM mutations / zero per-frame React reconciliation):
 *   - You        : Prompt & approval checks
 *   - Agent      : Active model thinking / writing
 *   - Sub-agents : Running delegated helpers
 *   - Tools      : Connected apps & running tool calls
 *   - Cost       : Per-turn cost / free indicator
 */

import * as React from "react";
import { Pause, Play } from "lucide-react";
import {
  ISO_PITCH,
  ISO_YAW,
  buildBox,
  buildDisc,
  clamp,
  faceFill,
  faceStroke,
  lerp3,
  project,
  sortFaces,
  stepSpring,
  useReducedMotion,
  useVisibility,
  type Camera,
  type Face,
  type SpringState,
  type Vec3,
} from "./iso";

export type GraphPhase =
  | "idle"
  | "thinking"
  | "planning"
  | "awaiting_gate"
  | "delegating"
  | "tool"
  | "conclave"
  | "settled"
  | "error";

export interface GraphProps {
  agentName?: string;
  modelName?: string;
  connectorCount?: number;
  toolCount?: number;
  activeChildren?: number;
  activeTools?: number;
  phase?: GraphPhase;
  priceLabel?: string;
  paused?: boolean;
  onTogglePause?: () => void;
  className?: string;
}

type NodeId = "human" | "agent" | "subagents" | "tools" | "cost";

interface NodeSpec {
  id: NodeId;
  label: string;
  tag: string;
  accent: Face["accent"];
}

interface Palette {
  lit: string;
  face: string;
  shade: string;
  stroke: string;
  label: string;
  labelActive: string;
  sublabel: string;
  monoFont: string;
}

const NODE_ORDER: readonly NodeId[] = ["human", "agent", "subagents", "tools", "cost"] as const;
const VB_W = 360;
const VB_H = 192;
const LABEL_X = 208;
const LABEL_Y0 = 26;
const LABEL_STEP = 35;

function phaseToNode(phase: GraphPhase): NodeId | null {
  if (phase === "awaiting_gate" || phase === "planning") return "human";
  if (phase === "thinking") return "agent";
  if (phase === "delegating" || phase === "conclave") return "subagents";
  if (phase === "tool") return "tools";
  if (phase === "settled") return "cost";
  return null;
}

function formatPriceTag(raw?: string): string {
  if (!raw) return "Free";
  const cleaned = raw.replace(/^\s*\$\s*/, "").trim();
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return "Free";
  const trimmed = num < 0.01 ? num.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : num.toFixed(2).replace(/\.00$/, "");
  return `$${trimmed}`;
}

function readPalette(el: HTMLElement | null): Palette {
  const cs = el && typeof window !== "undefined" ? getComputedStyle(el) : null;
  const primary = cs?.getPropertyValue("--primary").trim() || "188 95% 43%";
  const foreground = cs?.getPropertyValue("--foreground").trim() || "229 73% 93%";
  const muted = cs?.getPropertyValue("--muted-foreground").trim() || "229 28% 70%";
  const monoVar = cs?.getPropertyValue("--font-mono").trim();
  return {
    lit: cs?.getPropertyValue("--cm-iso-lit").trim() || "hsl(224 34% 24%)",
    face: cs?.getPropertyValue("--cm-iso-face").trim() || "hsl(224 36% 15%)",
    shade: cs?.getPropertyValue("--cm-iso-shade").trim() || "hsl(222 46% 10%)",
    stroke: cs?.getPropertyValue("--cm-iso-stroke").trim() || "hsl(188 95% 43% / 0.42)",
    label: `hsl(${foreground} / 0.92)`,
    labelActive: `hsl(${primary})`,
    sublabel: `hsl(${muted})`,
    monoFont: monoVar ? `${monoVar}, monospace` : '"Fira Code", ui-monospace, monospace',
  };
}

function resolveCanvasColor(raw: string, palette: Palette): string {
  if (!raw.startsWith("var(")) return raw;
  if (raw.includes("--cm-iso-lit")) return palette.lit;
  if (raw.includes("--cm-iso-face")) return palette.face;
  if (raw.includes("--cm-iso-shade")) return palette.shade;
  if (raw.includes("--cm-iso-stroke")) return palette.stroke;
  return raw;
}

function hitTestLabelRow(vx: number, vy: number): NodeId | null {
  if (vx < LABEL_X - 12 || vx > VB_W - 2) return null;
  for (let idx = 0; idx < NODE_ORDER.length; idx += 1) {
    const labelY = LABEL_Y0 + idx * LABEL_STEP;
    if (vy >= labelY - 15 && vy <= labelY + 15) {
      return NODE_ORDER[idx];
    }
  }
  return null;
}

function GraphInner({
  agentName = "Agent",
  modelName,
  connectorCount = 0,
  toolCount = 0,
  activeChildren = 0,
  activeTools = 0,
  phase = "idle",
  priceLabel,
  paused: controlledPaused,
  onTogglePause,
  className,
}: GraphProps) {
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const paletteRef = React.useRef<Palette | null>(null);
  const reducedMotion = useReducedMotion();
  const visible = useVisibility(stageRef);

  const [internalPaused, setInternalPaused] = React.useState(false);
  const isControlledPause = controlledPaused !== undefined && onTogglePause !== undefined;
  const paused = isControlledPause ? controlledPaused : internalPaused;
  const togglePause = isControlledPause ? onTogglePause : () => setInternalPaused((p) => !p);
  const [selected, setSelected] = React.useState<NodeId | null>(null);
  const [hovered, setHovered] = React.useState<NodeId | null>(null);
  const [cursorOverLabel, setCursorOverLabel] = React.useState(false);

  const dragRef = React.useRef({ active: false, moved: false, x: 0, y: 0, yaw: ISO_YAW, pitch: ISO_PITCH });
  const targetOrbitRef = React.useRef({ yaw: ISO_YAW, pitch: ISO_PITCH });
  const springYaw = React.useRef<SpringState>({ value: ISO_YAW, velocity: 0 });
  const springPitch = React.useRef<SpringState>({ value: ISO_PITCH, velocity: 0 });
  const springSpread = React.useRef<SpringState>({ value: 0.24, velocity: 0 });
  const clockRef = React.useRef(0);
  const wakeRef = React.useRef<(() => void) | null>(null);

  const liveNode = phaseToNode(phase);
  const activeNode: NodeId | null = hovered ?? selected ?? liveNode;
  const isLive = phase !== "idle" && phase !== "settled" && phase !== "error";

  const nodes: NodeSpec[] = React.useMemo(() => {
    const toolsTotal = connectorCount + toolCount;
    return [
      {
        id: "human",
        label: "You",
        tag: phase === "awaiting_gate" ? "Needs approval" : "Prompt",
        accent: phase === "awaiting_gate" ? "amber" : "cyan",
      },
      {
        id: "agent",
        label: "Agent",
        tag: modelName || agentName,
        accent: "fuchsia",
      },
      {
        id: "subagents",
        label: "Sub-agents",
        tag: activeChildren > 0 ? `${activeChildren} running` : "Idle",
        accent: "cyan",
      },
      {
        id: "tools",
        label: "Tools",
        tag: activeTools > 0 ? `${activeTools} running` : toolsTotal > 0 ? `${toolsTotal} connected` : "None",
        accent: "fuchsia",
      },
      {
        id: "cost",
        label: "Cost",
        tag: formatPriceTag(priceLabel),
        accent: "emerald",
      },
    ];
  }, [agentName, modelName, connectorCount, toolCount, activeChildren, activeTools, phase, priceLabel]);

  const spreadTarget = activeNode !== null ? 0.62 : isLive ? 0.48 : 0.24;

  // Keep latest render parameters in a ref so the rAF Canvas2D draw never triggers React reconciliation
  const drawStateRef = React.useRef({
    nodes,
    activeNode,
    liveNode,
    isLive,
    phase,
    paused,
    reducedMotion,
    spreadTarget,
    activeChildren,
    connectorCount,
    toolCount,
  });
  drawStateRef.current = {
    nodes,
    activeNode,
    liveNode,
    isLive,
    phase,
    paused,
    reducedMotion,
    spreadTarget,
    activeChildren,
    connectorCount,
    toolCount,
  };

  const sizeRef = React.useRef({ width: 0, height: 0 });

  const paintFrame = React.useCallback((yaw: number, pitch: number, spread: number, pulse: number) => {
    const canvas = canvasRef.current;
    const wrap = canvasWrapRef.current;
    if (!canvas || !wrap) return;
    let width = sizeRef.current.width;
    let height = sizeRef.current.height;
    if (width <= 0 || height <= 0) {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      sizeRef.current = { width, height };
    }
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette = paletteRef.current ?? readPalette(stageRef.current);
    paletteRef.current = palette;

    const st = drawStateRef.current;
    const scale = Math.min(width / VB_W, height / VB_H);
    const offsetX = (width - VB_W * scale) / 2;
    const offsetY = (height - VB_H * scale) / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, VB_W, VB_H);
    ctx.clip();

    const cam: Camera = { yaw, pitch, cx: 96, cy: 98, scale: 25 };
    const lift = spread * 0.3;
    const orbitR = 1.18 + spread * 0.2;

    const humanPos: Vec3 = [0, 1.02 + lift * 0.85, 0];
    const agentPos: Vec3 = [0, 0.24 + lift * 0.18, 0];
    const costPos: Vec3 = [0, -0.9 - lift * 0.75, 0];

    const subCount = Math.max(0, Math.min(5, st.activeChildren));
    const subNodes: Vec3[] = Array.from({ length: subCount }, (_, i) => {
      const angle = (i / subCount) * Math.PI * 2 + 0.4;
      return [Math.cos(angle) * orbitR, -0.18 - lift * 0.14, Math.sin(angle) * orbitR];
    });

    const toolNodeCount = Math.max(0, Math.min(4, st.connectorCount + st.toolCount));
    const toolNodes: Vec3[] = Array.from({ length: toolNodeCount }, (_, i) => {
      const angle = (i / toolNodeCount) * Math.PI * 2 + Math.PI / 3;
      return [Math.cos(angle) * (orbitR * 1.15), -0.52 - lift * 0.36, Math.sin(angle) * (orbitR * 1.15)];
    });

    const faces: Face[] = [];
    faces.push(...buildDisc("cost-0", [0, costPos[1] - 0.16, 0], 1.22, 0.12, cam, { accent: "emerald", partId: "cost" }));
    faces.push(...buildDisc("cost-1", [0, costPos[1] + 0.02, 0], 0.98, 0.12, cam, { accent: "cyan", partId: "cost" }));

    for (let idx = 0; idx < toolNodes.length; idx += 1) {
      faces.push(...buildBox(`tool-${idx}`, toolNodes[idx], [0.34, 0.22, 0.34], cam, { accent: "fuchsia", partId: "tools" }));
    }

    for (let idx = 0; idx < subNodes.length; idx += 1) {
      faces.push(...buildDisc(`sub-${idx}`, subNodes[idx], 0.27, 0.34, cam, { segments: 6, accent: "cyan", partId: "subagents" }));
    }

    faces.push(...buildDisc("agent", agentPos, 0.62, 0.56, cam, { segments: 8, accent: "fuchsia", partId: "agent" }));
    faces.push(
      ...buildBox("human", humanPos, [0.86, 0.2, 0.86], cam, {
        accent: st.phase === "awaiting_gate" ? "amber" : "cyan",
        partId: "human",
      }),
    );

    const sortedFaces = sortFaces(faces);
    const pHuman = project(humanPos, cam);
    const pAgent = project(agentPos, cam);
    const pCost = project(costPos, cam);
    const pSubs = subNodes.map((z) => project(z, cam));
    const pTools = toolNodes.map((c) => project(c, cam));
    const packetPt = project(lerp3(humanPos, costPos, pulse), cam);

    // Central spine line
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = "hsl(188 95% 56% / 0.45)";
    ctx.lineWidth = st.isLive ? 1.5 : 0.9;
    if (!st.isLive) ctx.setLineDash([3, 3]);
    ctx.moveTo(pHuman.x, pHuman.y);
    ctx.lineTo(pCost.x, pCost.y);
    ctx.stroke();
    ctx.restore();

    // Sub-agent links
    ctx.save();
    ctx.strokeStyle = st.activeNode === "subagents" ? "hsl(188 95% 65%)" : "hsl(188 95% 48% / 0.38)";
    ctx.lineWidth = st.activeNode === "subagents" ? 1.25 : 0.8;
    ctx.beginPath();
    for (const pt of pSubs) {
      ctx.moveTo(pAgent.x, pAgent.y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.restore();

    // Tool links
    ctx.save();
    ctx.strokeStyle = st.activeNode === "tools" ? "hsl(292 85% 68%)" : "hsl(292 85% 55% / 0.32)";
    ctx.lineWidth = st.activeNode === "tools" ? 1.2 : 0.75;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    for (const pt of pTools) {
      ctx.moveTo(pAgent.x, pAgent.y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.restore();

    // Painter's-order 3D isometric polygons
    ctx.lineJoin = "round";
    for (const face of sortedFaces) {
      const verts = face.verts;
      if (!verts || verts.length < 3) continue;
      const isPartActive = st.activeNode === face.partId || (st.isLive && face.partId === st.liveNode);
      ctx.globalAlpha = st.activeNode && !isPartActive ? 0.62 : 0.96;
      ctx.fillStyle = resolveCanvasColor(faceFill(face, isPartActive), palette);
      ctx.strokeStyle = resolveCanvasColor(faceStroke(face, isPartActive), palette);
      ctx.lineWidth = isPartActive ? 1.15 : 0.75;

      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i += 1) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Animated pulse packet
    if ((!st.paused || st.isLive) && !st.reducedMotion) {
      ctx.beginPath();
      ctx.fillStyle = st.phase === "awaiting_gate" ? "hsl(42 98% 60%)" : "hsl(188 95% 66%)";
      ctx.arc(packetPt.x, packetPt.y, st.isLive ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Right-hand callout polylines & uppercase labels
    const labelAnchorMap: Record<NodeId, Vec3> = {
      human: humanPos,
      agent: agentPos,
      subagents: subNodes[0] ?? [orbitR, -0.18, 0],
      tools: toolNodes[0] ?? [orbitR, -0.52, 0],
      cost: costPos,
    };

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    for (let idx = 0; idx < st.nodes.length; idx += 1) {
      const node = st.nodes[idx];
      const isActive = st.activeNode === node.id;
      const anchor = project(labelAnchorMap[node.id], cam);
      const labelY = LABEL_Y0 + idx * LABEL_STEP;
      const displayTag = node.tag.length > 18 ? `${node.tag.slice(0, 17)}…` : node.tag;

      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = isActive ? "hsl(188 95% 64%)" : "hsl(188 95% 43% / 0.26)";
      ctx.lineWidth = isActive ? 1.15 : 0.7;
      if (!isActive) ctx.setLineDash([2, 2]);
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(LABEL_X - 12, labelY);
      ctx.lineTo(LABEL_X, labelY);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.fillStyle = isActive ? "hsl(188 95% 64%)" : "hsl(229 28% 70% / 0.48)";
      ctx.arc(anchor.x, anchor.y, isActive ? 2.8 : 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `700 9px ${palette.monoFont}`;
      ctx.fillStyle = isActive ? palette.labelActive : palette.label;
      ctx.fillText(node.label.toUpperCase(), LABEL_X + 5, labelY - 2);

      ctx.font = `500 8px ${palette.monoFont}`;
      ctx.fillStyle = palette.sublabel;
      ctx.fillText(displayTag, LABEL_X + 5, labelY + 10);
    }

    ctx.restore();
  }, []);

  // Re-paint cleanly when canvas container resizes
  React.useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      paletteRef.current = readPalette(stageRef.current);
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        sizeRef.current = { width: box.width, height: box.height };
      }
      paintFrame(
        springYaw.current.value,
        springPitch.current.value,
        springSpread.current.value,
        (clockRef.current * 0.4) % 1,
      );
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paintFrame]);

  // Main animation loop: draws straight to Canvas2D with zero React setState / zero forced layout
  React.useEffect(() => {
    if (reducedMotion) {
      springYaw.current = { value: targetOrbitRef.current.yaw, velocity: 0 };
      springPitch.current = { value: targetOrbitRef.current.pitch, velocity: 0 };
      springSpread.current = { value: spreadTarget, velocity: 0 };
      paintFrame(targetOrbitRef.current.yaw, targetOrbitRef.current.pitch, spreadTarget, isLive ? 0.5 : 0);
      return;
    }
    if (!visible) return;

    let rafId = 0;
    let last = performance.now();
    let lastPaint = 0;

    const tick = (now: number) => {
      rafId = 0;
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      const st = drawStateRef.current;
      // Throttle idle background drift to ~20fps so scroll & chat stay at 60/120fps;
      // run full 60fps whenever the agent is live or the user is dragging/orbiting.
      const idle = !st.isLive && !dragRef.current.active;
      if (idle && now - lastPaint < 50) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      lastPaint = now;

      if (!st.paused || st.isLive) {
        clockRef.current += dt * (st.isLive ? 1.7 : 0.65);
      }

      const drift = !st.paused && !dragRef.current.active ? Math.sin(clockRef.current * 0.5) * 0.09 : 0;
      springYaw.current = stepSpring(springYaw.current, targetOrbitRef.current.yaw + drift, dt);
      springPitch.current = stepSpring(springPitch.current, targetOrbitRef.current.pitch, dt);
      springSpread.current = stepSpring(springSpread.current, st.spreadTarget, dt);

      paintFrame(
        springYaw.current.value,
        springPitch.current.value,
        springSpread.current.value,
        (clockRef.current * 0.4) % 1,
      );

      const settled = st.paused
        && !st.isLive
        && !dragRef.current.active
        && Math.abs(springYaw.current.velocity) < 0.001
        && Math.abs(springPitch.current.velocity) < 0.001
        && Math.abs(springSpread.current.velocity) < 0.001;

      if (!settled) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const wake = () => {
      if (rafId !== 0) return;
      last = performance.now();
      rafId = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (!document.hidden) wake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    wakeRef.current = wake;
    wake();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wakeRef.current = null;
      if (rafId !== 0) cancelAnimationFrame(rafId);
    };
  }, [reducedMotion, visible, paused, isLive, spreadTarget, paintFrame]);

  // Repaint immediately on static state changes (selection, hover, labels, phase) even when paused
  React.useEffect(() => {
    paintFrame(
      springYaw.current.value,
      springPitch.current.value,
      springSpread.current.value,
      reducedMotion ? (isLive ? 0.5 : 0) : (clockRef.current * 0.4) % 1,
    );
  }, [nodes, activeNode, liveNode, isLive, phase, paused, reducedMotion, paintFrame]);

  const toVirtualCoords = (clientX: number, clientY: number): { vx: number; vy: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(rect.width / VB_W, rect.height / VB_H);
    const offsetX = (rect.width - VB_W * scale) / 2;
    const offsetY = (rect.height - VB_H * scale) / 2;
    return {
      vx: (clientX - rect.left - offsetX) / scale,
      vy: (clientY - rect.top - offsetY) / scale,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const pt = toVirtualCoords(event.clientX, event.clientY);
    if (pt) {
      const hit = hitTestLabelRow(pt.vx, pt.vy);
      if (hit) {
        event.stopPropagation();
        setSelected((cur) => (cur === hit ? null : hit));
        wakeRef.current?.();
        return;
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      x: event.clientX,
      y: event.clientY,
      yaw: targetOrbitRef.current.yaw,
      pitch: targetOrbitRef.current.pitch,
    };
    wakeRef.current?.();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.active) {
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
      targetOrbitRef.current = {
        yaw: clamp(dragRef.current.yaw + dx * 0.006, ISO_YAW - 0.6, ISO_YAW + 0.6),
        pitch: clamp(dragRef.current.pitch + dy * 0.004, ISO_PITCH - 0.25, ISO_PITCH + 0.25),
      };
      if (reducedMotion) {
        springYaw.current = { value: targetOrbitRef.current.yaw, velocity: 0 };
        springPitch.current = { value: targetOrbitRef.current.pitch, velocity: 0 };
        paintFrame(targetOrbitRef.current.yaw, targetOrbitRef.current.pitch, spreadTarget, isLive ? 0.5 : 0);
      } else {
        wakeRef.current?.();
      }
      return;
    }

    const pt = toVirtualCoords(event.clientX, event.clientY);
    const hit = pt ? hitTestLabelRow(pt.vx, pt.vy) : null;
    setCursorOverLabel(Boolean(hit));
    setHovered((cur) => (cur === hit ? cur : hit));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  };

  const onPointerLeave = () => {
    setCursorOverLabel(false);
    setHovered(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const idx = activeNode ? NODE_ORDER.indexOf(activeNode) : -1;
      setSelected(NODE_ORDER[(idx + 1) % NODE_ORDER.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const idx = activeNode ? NODE_ORDER.indexOf(activeNode) : 0;
      setSelected(NODE_ORDER[(idx - 1 + NODE_ORDER.length) % NODE_ORDER.length]);
    } else if (event.key === "Escape") {
      setSelected(null);
      setHovered(null);
      targetOrbitRef.current = { yaw: ISO_YAW, pitch: ISO_PITCH };
      wakeRef.current?.();
    }
  };

  return (
    <div
      ref={stageRef}
      className={`cm-graph ${className ?? ""}`.trim()}
      data-phase={phase}
      tabIndex={0}
      role="region"
      aria-label={`Live activity for ${agentName}`}
      onKeyDown={onKeyDown}
    >
      <div ref={canvasWrapRef} className="cm-graph__canvas">
        <canvas
          ref={canvasRef}
          className="cm-graph__svg"
          style={cursorOverLabel ? { cursor: "pointer" } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          aria-hidden="true"
        />

        {!reducedMotion && !isControlledPause && (
          <button
            type="button"
            className="cm-iso-control"
            onClick={togglePause}
            aria-label={paused ? "Play motion" : "Pause motion"}
            title={paused ? "Play motion" : "Pause motion"}
          >
            {paused ? <Play /> : <Pause />}
          </button>
        )}
      </div>

      <div className="cm-graph__footer">
        <div className="cm-graph__pills" role="tablist" aria-label="Activity layers">
          {nodes.map((node) => {
            const active = activeNode === node.id;
            return (
              <button
                key={node.id}
                type="button"
                role="tab"
                aria-selected={active}
                className="cm-graph__pill"
                data-active={active}
                data-accent={node.accent}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered((cur) => (cur === node.id ? null : cur))}
                onClick={() => setSelected((cur) => (cur === node.id ? null : node.id))}
              >
                {node.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const Graph = React.memo(GraphInner);
