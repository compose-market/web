/**
 * GPU-Composited 3D Perspective Tilt & Specular Light Glint
 *
 * Strictly gated behind `(hover: hover) and (pointer: fine)` and
 * `prefers-reduced-motion: no-preference`. Caches DOMRect on pointerenter
 * so zero layout reads happen during pointermove frames.
 */

import * as React from "react";

export interface TiltOptions {
  maxDeg?: number;
  enabled?: boolean;
}

let cachedTiltAllowed: boolean | null = null;

function isTiltAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (cachedTiltAllowed !== null) return cachedTiltAllowed;
  const fineQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: no-preference)");
  const refresh = () => {
    cachedTiltAllowed = fineQuery.matches && motionQuery.matches;
  };
  refresh();
  fineQuery.addEventListener?.("change", refresh);
  motionQuery.addEventListener?.("change", refresh);
  return cachedTiltAllowed ?? false;
}

export function useTilt<T extends HTMLElement = HTMLElement>(options?: TiltOptions) {
  const maxDeg = options?.maxDeg ?? 6;
  const enabled = options?.enabled ?? true;
  const ref = React.useRef<T | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !isTiltAllowed()) return;

    let rect: DOMRect | null = null;
    let rafId: number | null = null;
    let targetRx = 0;
    let targetRy = 0;
    let glareX = 50;
    let glareY = 50;

    const apply = () => {
      rafId = null;
      el.style.transform = `perspective(900px) rotateX(${targetRx.toFixed(2)}deg) rotateY(${targetRy.toFixed(2)}deg) translate3d(0, -2px, 0)`;
      el.style.setProperty("--cm-glare-x", `${glareX.toFixed(1)}%`);
      el.style.setProperty("--cm-glare-y", `${glareY.toFixed(1)}%`);
      el.dataset.tilt = "active";
    };

    const onEnter = () => {
      rect = el.getBoundingClientRect();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (!rect) rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const nx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      targetRy = (nx - 0.5) * (maxDeg * 2);
      targetRx = (0.5 - ny) * (maxDeg * 2);
      glareX = nx * 100;
      glareY = ny * 100;

      if (rafId === null) {
        rafId = requestAnimationFrame(apply);
      }
    };

    const onLeave = () => {
      rect = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      el.style.transform = "";
      delete el.dataset.tilt;
    };

    el.addEventListener("pointerenter", onEnter, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.style.transform = "";
      delete el.dataset.tilt;
    };
  }, [enabled, maxDeg]);

  return ref;
}

/**
 * Delegated 3D perspective tilt + specular glint for card grids.
 * Attaches a single listener pair on the grid container instead of N per-card
 * effects, preserving identical hover physics with zero per-card mount cost.
 */
export function useGridTilt<T extends HTMLElement = HTMLElement>(options?: TiltOptions) {
  const maxDeg = options?.maxDeg ?? 2.5;
  const enabled = options?.enabled ?? true;
  const ref = React.useRef<T | null>(null);

  React.useEffect(() => {
    const root = ref.current;
    if (!root || !enabled || !isTiltAllowed()) return;

    let activeEl: HTMLElement | null = null;
    let rect: DOMRect | null = null;
    let rafId: number | null = null;
    let targetRx = 0;
    let targetRy = 0;
    let glareX = 50;
    let glareY = 50;

    const resetActive = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (activeEl) {
        activeEl.style.transform = "";
        delete activeEl.dataset.tilt;
        activeEl = null;
      }
      rect = null;
    };

    const apply = () => {
      rafId = null;
      if (!activeEl) return;
      activeEl.style.transform = `perspective(900px) rotateX(${targetRx.toFixed(2)}deg) rotateY(${targetRy.toFixed(2)}deg) translate3d(0, -2px, 0)`;
      activeEl.style.setProperty("--cm-glare-x", `${glareX.toFixed(1)}%`);
      activeEl.style.setProperty("--cm-glare-y", `${glareY.toFixed(1)}%`);
      activeEl.dataset.tilt = "active";
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(".cm-tilt-surface")
        : null;
      if (!target || !root.contains(target)) {
        if (activeEl) resetActive();
        return;
      }
      if (target !== activeEl) {
        if (activeEl) {
          activeEl.style.transform = "";
          delete activeEl.dataset.tilt;
        }
        activeEl = target;
        rect = target.getBoundingClientRect();
      }
      if (!rect || rect.width === 0 || rect.height === 0) return;

      const nx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      targetRy = (nx - 0.5) * (maxDeg * 2);
      targetRx = (0.5 - ny) * (maxDeg * 2);
      glareX = nx * 100;
      glareY = ny * 100;

      if (rafId === null) {
        rafId = requestAnimationFrame(apply);
      }
    };

    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", resetActive, { passive: true });

    return () => {
      resetActive();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", resetActive);
    };
  }, [enabled, maxDeg]);

  return ref;
}
