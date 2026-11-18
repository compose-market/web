/**
 * Snap-Scrolling State Sync & Same-Document View Transitions
 *
 * Implements:
 * - Native `scrollsnapchanging` + `scrollsnapchange` with mandatory rAF/scrollend fallback
 * - Initial scroll restoration sync
 * - Progressive `document.startViewTransition()` navigation with unique name cleanup
 *   and programmatic focus routing for assistive technologies.
 */

import * as React from "react";
import { useLocation } from "wouter";

export interface SnapSyncResult {
  activeIndex: number;
  pendingIndex: number | null;
  snapTo: (index: number) => void;
}

function findClosestIndex(container: HTMLElement, items: HTMLElement[], axis: "block" | "inline"): number {
  if (items.length === 0) return 0;
  const containerRect = container.getBoundingClientRect();
  const origin = axis === "block" ? containerRect.top : containerRect.left;
  let closest = 0;
  let minDistance = Infinity;

  items.forEach((item, index) => {
    const rect = item.getBoundingClientRect();
    const pos = axis === "block" ? rect.top : rect.left;
    const dist = Math.abs(pos - origin);
    if (dist < minDistance) {
      minDistance = dist;
      closest = index;
    }
  });

  return closest;
}

export function useSnapSync(
  containerRef: React.RefObject<HTMLElement | null>,
  itemSelector: string,
  axis: "block" | "inline" = "block",
): SnapSyncResult {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [pendingIndex, setPendingIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getItems = () => Array.from(container.querySelectorAll<HTMLElement>(itemSelector));

    const syncInitial = () => {
      const items = getItems();
      if (items.length === 0) return;
      setActiveIndex(findClosestIndex(container, items, axis));
      setPendingIndex(null);
    };

    syncInitial();

    const supportsSnapEvents = "onscrollsnapchange" in HTMLElement.prototype
      && "onscrollsnapchanging" in Element.prototype;

    if (supportsSnapEvents) {
      const onChanging = (event: Event) => {
        const snapEvent = event as Event & {
          snapTargetBlock?: Element | null;
          snapTargetInline?: Element | null;
        };
        const target = axis === "block" ? snapEvent.snapTargetBlock : snapEvent.snapTargetInline;
        if (!target) return;
        const idx = getItems().indexOf(target as HTMLElement);
        if (idx >= 0) setPendingIndex(idx);
      };

      const onChanged = (event: Event) => {
        const snapEvent = event as Event & {
          snapTargetBlock?: Element | null;
          snapTargetInline?: Element | null;
        };
        const target = axis === "block" ? snapEvent.snapTargetBlock : snapEvent.snapTargetInline;
        if (!target) return;
        const idx = getItems().indexOf(target as HTMLElement);
        if (idx >= 0) {
          setActiveIndex(idx);
          setPendingIndex(null);
        }
      };

      container.addEventListener("scrollsnapchanging", onChanging);
      container.addEventListener("scrollsnapchange", onChanged);
      return () => {
        container.removeEventListener("scrollsnapchanging", onChanging);
        container.removeEventListener("scrollsnapchange", onChanged);
      };
    }

    // Fallback for Safari/Firefox: scroll + rAF eager feedback + scrollend/debounce settle
    let rafId: number | null = null;
    let settleTimer: number | null = null;

    const settle = () => {
      const items = getItems();
      if (items.length === 0) return;
      setActiveIndex(findClosestIndex(container, items, axis));
      setPendingIndex(null);
    };

    const onScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const items = getItems();
          if (items.length === 0) return;
          setPendingIndex(findClosestIndex(container, items, axis));
        });
      }
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, 110);
    };

    const onScrollEnd = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settle();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("scrollend", onScrollEnd);

    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("scrollend", onScrollEnd);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [containerRef, itemSelector, axis]);

  const snapTo = React.useCallback(
    (index: number) => {
      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      const target = items[index];
      if (!target) return;

      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      target.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: axis === "block" ? "start" : "nearest",
        inline: axis === "inline" ? "start" : "nearest",
      });
      setActiveIndex(index);
      setPendingIndex(null);
    },
    [containerRef, itemSelector, axis],
  );

  return { activeIndex, pendingIndex, snapTo };
}

export interface ViewNavigateOptions {
  element?: HTMLElement | null;
  transitionName?: string;
  focusSelector?: string;
}

type DocumentWithTransition = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => {
    finished: Promise<void>;
  };
};

function focusRouteTarget(selector?: string) {
  requestAnimationFrame(() => {
    const target = (selector ? document.querySelector<HTMLElement>(selector) : null)
      ?? document.querySelector<HTMLElement>("[data-route-heading]")
      ?? document.querySelector<HTMLElement>("main");
    if (!target) return;
    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
    }
    target.focus({ preventScroll: true });
  });
}

export function useViewNavigate() {
  const [, setLocation] = useLocation();

  return React.useCallback(
    (to: string, options?: ViewNavigateOptions) => {
      const doc = document as DocumentWithTransition;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const triggerEl = options?.element ?? null;
      const transitionName = options?.transitionName;

      if (!doc.startViewTransition || reduced) {
        setLocation(to);
        focusRouteTarget(options?.focusSelector);
        return;
      }

      // Guarantee uniqueness of temporary view-transition-name before capture
      if (triggerEl && transitionName) {
        document.querySelectorAll<HTMLElement>("[data-vt-active]").forEach((node) => {
          node.style.viewTransitionName = "";
          node.removeAttribute("data-vt-active");
        });
        triggerEl.style.viewTransitionName = transitionName;
        triggerEl.setAttribute("data-vt-active", transitionName);
      }

      const transition = doc.startViewTransition(() => {
        setLocation(to);
      });

      transition.finished.finally(() => {
        if (triggerEl) {
          triggerEl.style.viewTransitionName = "";
          triggerEl.removeAttribute("data-vt-active");
        }
        focusRouteTarget(options?.focusSelector);
      });
    },
    [setLocation],
  );
}
