/**
 * Isometric 3D Mechanical Projection & Critically Damped Physics Engine
 *
 * Implements the Anatomy / Hairline precision craft rules:
 * - True 3D-to-isometric projection with dynamic yaw/pitch orbit
 * - Painter's-order depth sorting and four-tone surface shading driven by theme tokens
 * - Critically damped spring physics (k=100, c=18) for continuous manipulation
 * - IntersectionObserver offscreen sleep & reactive prefers-reduced-motion support
 */

import * as React from "react";

export type Vec3 = readonly [number, number, number];

export interface Camera {
  yaw: number;
  pitch: number;
  cx: number;
  cy: number;
  scale: number;
}

export interface Point2 {
  x: number;
  y: number;
  z: number;
}

export type ShadeTone = "lit" | "face" | "shade";

export interface Face {
  id: string;
  points: string;
  verts?: Point2[];
  depth: number;
  tone: ShadeTone;
  accent?: "cyan" | "fuchsia" | "emerald" | "amber" | "neutral";
  opacity?: number;
  stroke?: string;
  partId?: string;
}

export const ISO_YAW = Math.PI / 4; // 45deg
export const ISO_PITCH = Math.atan(Math.sin(Math.PI / 4)); // ~35.264deg true isometric

export function project(p: Vec3, cam: Camera): Point2 {
  const [x, y, z] = p;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);

  // Rotate around Y (yaw)
  const rx = x * cy - z * sy;
  const rz = x * sy + z * cy;

  // Rotate around X (pitch) — Y points upward in world space
  const ry = y * cp - rz * sp;
  const depth = y * sp + rz * cp;

  return {
    x: cam.cx + rx * cam.scale,
    y: cam.cy - ry * cam.scale,
    z: depth,
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPointsAttr(pts: Point2[]): string {
  return pts.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ");
}

/**
 * Generates visible faces of an axis-aligned 3D slab centered at (cx, cy, cz)
 * with dimensions (sx, sy, sz). Performs camera-space back-face culling and
 * classifies each visible face into lit (top), face (front), or shade (side).
 */
export function buildBox(
  id: string,
  center: Vec3,
  size: Vec3,
  cam: Camera,
  options?: {
    accent?: Face["accent"];
    opacity?: number;
    stroke?: string;
    partId?: string;
  },
): Face[] {
  const [cx, cy, cz] = center;
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;

  const v: Vec3[] = [
    [cx - hx, cy - hy, cz - hz], // 0: ---
    [cx + hx, cy - hy, cz - hz], // 1: +--
    [cx + hx, cy + hy, cz - hz], // 2: ++-
    [cx - hx, cy + hy, cz - hz], // 3: -+-
    [cx - hx, cy - hy, cz + hz], // 4: --+
    [cx + hx, cy - hy, cz + hz], // 5: +-+
    [cx + hx, cy + hy, cz + hz], // 6: +++
    [cx - hx, cy + hy, cz + hz], // 7: -++
  ];

  const projected = v.map((pt) => project(pt, cam));

  // Each quad's vertices ordered counter-clockwise looking from outside
  const quads: Array<{ key: string; idx: [number, number, number, number]; tone: ShadeTone }> = [
    { key: "top", idx: [3, 2, 6, 7], tone: "lit" },
    { key: "bottom", idx: [0, 4, 5, 1], tone: "shade" },
    { key: "front", idx: [4, 7, 6, 5], tone: "face" },
    { key: "back", idx: [0, 1, 2, 3], tone: "shade" },
    { key: "right", idx: [1, 5, 6, 2], tone: "shade" },
    { key: "left", idx: [0, 3, 7, 4], tone: "face" },
  ];

  const faces: Face[] = [];
  for (const quad of quads) {
    const pts = quad.idx.map((i) => projected[i]);
    // 2D signed area in SVG screen coords (Y down): visible front faces have negative cross product
    const ax = pts[1].x - pts[0].x;
    const ay = pts[1].y - pts[0].y;
    const bx = pts[2].x - pts[0].x;
    const by = pts[2].y - pts[0].y;
    const cross = ax * by - ay * bx;
    if (cross >= -0.001) continue;

    const depth = (pts[0].z + pts[1].z + pts[2].z + pts[3].z) / 4;
    faces.push({
      id: `${id}:${quad.key}`,
      points: toPointsAttr(pts),
      verts: pts,
      depth,
      tone: quad.tone,
      accent: options?.accent,
      opacity: options?.opacity,
      stroke: options?.stroke,
      partId: options?.partId,
    });
  }

  return faces;
}

/**
 * Generates an isometric octagonal cylinder (for nodes & layered discs).
 */
export function buildDisc(
  id: string,
  center: Vec3,
  radius: number,
  height: number,
  cam: Camera,
  options?: {
    segments?: number;
    accent?: Face["accent"];
    opacity?: number;
    partId?: string;
  },
): Face[] {
  const segments = options?.segments ?? 8;
  const [cx, cy, cz] = center;
  const hy = height / 2;
  const topPts: Point2[] = [];
  const botPts: Point2[] = [];

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2 + Math.PI / segments;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    topPts.push(project([x, cy + hy, z], cam));
    botPts.push(project([x, cy - hy, z], cam));
  }

  const faces: Face[] = [];
  // Side segments (only front-facing ones)
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    const quad = [botPts[i], topPts[i], topPts[next], botPts[next]];
    const ax = quad[1].x - quad[0].x;
    const ay = quad[1].y - quad[0].y;
    const bx = quad[2].x - quad[0].x;
    const by = quad[2].y - quad[0].y;
    if (ax * by - ay * bx >= -0.001) continue;

    const depth = (quad[0].z + quad[1].z + quad[2].z + quad[3].z) / 4;
    const tone: ShadeTone = quad[0].x < cam.cx ? "face" : "shade";
    faces.push({
      id: `${id}:side:${i}`,
      points: toPointsAttr(quad),
      verts: quad,
      depth,
      tone,
      accent: options?.accent,
      opacity: options?.opacity,
      partId: options?.partId,
    });
  }

  // Top cap
  const topDepth = topPts.reduce((sum, pt) => sum + pt.z, 0) / topPts.length;
  faces.push({
    id: `${id}:top`,
    points: toPointsAttr(topPts),
    verts: topPts,
    depth: topDepth + 0.005,
    tone: "lit",
    accent: options?.accent,
    opacity: options?.opacity,
    partId: options?.partId,
  });

  return faces;
}

export function sortFaces(faces: Face[]): Face[] {
  return faces.slice().sort((a, b) => a.depth - b.depth);
}

export function faceFill(face: Face, active: boolean): string {
  if (active && face.accent === "cyan") {
    return face.tone === "lit"
      ? "hsl(188 95% 58% / 0.85)"
      : face.tone === "face"
        ? "hsl(188 95% 42% / 0.78)"
        : "hsl(192 92% 28% / 0.85)";
  }
  if (active && face.accent === "fuchsia") {
    return face.tone === "lit"
      ? "hsl(292 85% 68% / 0.85)"
      : face.tone === "face"
        ? "hsl(292 85% 52% / 0.78)"
        : "hsl(295 80% 34% / 0.85)";
  }
  if (active && face.accent === "emerald") {
    return face.tone === "lit"
      ? "hsl(150 78% 54% / 0.85)"
      : face.tone === "face"
        ? "hsl(150 74% 38% / 0.78)"
        : "hsl(152 72% 24% / 0.85)";
  }
  if (active && face.accent === "amber") {
    return face.tone === "lit"
      ? "hsl(42 98% 62% / 0.86)"
      : face.tone === "face"
        ? "hsl(40 94% 46% / 0.8)"
        : "hsl(34 88% 30% / 0.86)";
  }
  if (face.tone === "lit") return "var(--cm-iso-lit, hsl(224 34% 24%))";
  if (face.tone === "face") return "var(--cm-iso-face, hsl(224 36% 15%))";
  return "var(--cm-iso-shade, hsl(222 46% 10%))";
}

export function faceStroke(face: Face, active: boolean): string {
  if (face.stroke) return face.stroke;
  if (active && face.accent === "fuchsia") return "hsl(292 85% 74% / 0.92)";
  if (active && face.accent === "emerald") return "hsl(150 84% 64% / 0.92)";
  if (active && face.accent === "amber") return "hsl(42 100% 68% / 0.92)";
  if (active) return "hsl(188 95% 68% / 0.95)";
  return "var(--cm-iso-stroke, hsl(188 95% 43% / 0.42))";
}

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * Critically damped spring step (defaults: k=100, c=18 per Anatomy craft rules).
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dtSec: number,
  k = 100,
  c = 18,
): SpringState {
  const dt = Math.min(dtSec, 0.05);
  const force = (target - state.value) * k - state.velocity * c;
  const velocity = state.velocity + force * dt;
  const value = state.value + velocity * dt;
  if (Math.abs(target - value) < 0.0005 && Math.abs(velocity) < 0.0005) {
    return { value: target, velocity: 0 };
  }
  return { value, velocity };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export function useVisibility(ref: React.RefObject<Element | null>): boolean {
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setVisible(entry.isIntersecting);
      },
      { threshold: 0.02 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return visible;
}
