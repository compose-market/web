/**
 * Hard-reload-proof client avatar thumbnail cache (`Cache Storage`) + boot handoff.
 *
 * Chrome bypasses HTTP disk cache on hard reload (`Cmd+Shift+R`), but browser
 * `Cache Storage` (`caches.open("avatars")`) survives intact. All 87 `?size=thumb`
 * WebP thumbnails combined are ~380 KB; hydrating them to in-memory `blob:` URLs
 * makes hard reloads paint real avatars with zero network requests.
 */

import { useSyncExternalStore } from "react";
import type { DirectoryAgent } from "@compose-market/sdk";
import type { FacilitatorChainsResponse } from "@compose-market/sdk/chains";

export const AVATAR_CACHE_NAME = "avatars";

export interface BootCatalogPayload {
  version: string;
  lastUpdated: string | null;
  total: number;
  agents: DirectoryAgent[];
}

interface BootState {
  avatars?: Record<string, string>;
  pending?: Record<string, boolean>;
  catalog?: Promise<BootCatalogPayload | null> | null;
  catalogResolved?: BootCatalogPayload | null;
  chains?: Promise<FacilitatorChainsResponse | null> | null;
  chainsResolved?: FacilitatorChainsResponse | null;
  hydrateReady?: Promise<void> | null;
  onAvatar?: (url: string, blobUrl: string | null) => void;
  onAvatarBatch?: (entries: Array<[string, string | null]>) => void;
}

declare global {
  interface Window {
    __CM_BOOT__?: BootState;
  }
}

const blobUrls = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<string | null>>();
let prunedSignature: string | null = null;

function adoptBootAvatars(): void {
  if (typeof window === "undefined") return;
  const boot = window.__CM_BOOT__;
  if (!boot) return;
  if (boot.avatars) {
    for (const [url, blobUrl] of Object.entries(boot.avatars)) {
      if (url && blobUrl && !blobUrls.has(url)) {
        blobUrls.set(url, blobUrl);
      }
    }
  }
  boot.onAvatar = (url: string, blobUrl: string | null) => {
    if (blobUrl) {
      registerBlobUrl(url, blobUrl);
    } else {
      notifyListeners(url);
    }
  };
  boot.onAvatarBatch = (entries: Array<[string, string | null]>) => {
    const toNotify: string[] = [];
    for (const [url, blobUrl] of entries) {
      if (blobUrl && blobUrls.get(url) !== blobUrl) {
        blobUrls.set(url, blobUrl);
        toNotify.push(url);
      } else if (!blobUrl) {
        toNotify.push(url);
      }
    }
    for (const url of toNotify) {
      notifyListeners(url);
    }
  };
}

function notifyListeners(url: string): void {
  const subs = listeners.get(url);
  if (subs) {
    for (const notify of subs) notify();
  }
}

function registerBlobUrl(url: string, blobUrl: string): void {
  if (blobUrls.get(url) === blobUrl) return;
  blobUrls.set(url, blobUrl);
  notifyListeners(url);
}

adoptBootAvatars();

export function readBootCatalog(): BootCatalogPayload | null {
  if (typeof window === "undefined") return null;
  return window.__CM_BOOT__?.catalogResolved ?? null;
}

export function readBootCatalogPromise(): Promise<BootCatalogPayload | null> | null {
  if (typeof window === "undefined") return null;
  return window.__CM_BOOT__?.catalog ?? null;
}

export function readBootChains(): FacilitatorChainsResponse | null {
  if (typeof window === "undefined") return null;
  return window.__CM_BOOT__?.chainsResolved ?? null;
}

export function readBootChainsPromise(): Promise<FacilitatorChainsResponse | null> | null {
  if (typeof window === "undefined") return null;
  return window.__CM_BOOT__?.chains ?? null;
}

export function resolveAvatarSrc(url: string | null): string | null {
  if (!url) return null;
  adoptBootAvatars();
  const cached = blobUrls.get(url);
  if (cached) return cached;
  if (typeof window !== "undefined" && window.__CM_BOOT__?.pending?.[url]) {
    return null;
  }
  return url;
}

function subscribeAvatar(url: string | null, listener: () => void): () => void {
  if (!url) return () => undefined;
  let set = listeners.get(url);
  if (!set) {
    set = new Set();
    listeners.set(url, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(url);
  };
}

export function useAvatarSrc(url: string | null): string | null {
  return useSyncExternalStore(
    (notify) => subscribeAvatar(url, notify),
    () => resolveAvatarSrc(url),
    () => url,
  );
}

function canUseCacheStorage(): boolean {
  return typeof window !== "undefined"
    && typeof caches !== "undefined"
    && typeof URL !== "undefined"
    && typeof URL.createObjectURL === "function";
}

function isCacheableAvatarUrl(url: string): boolean {
  return /^https?:\/\/.+\/avatar(\?|$)/i.test(url);
}

async function openAvatarCache(): Promise<Cache | null> {
  if (!canUseCacheStorage()) return null;
  try {
    return await caches.open(AVATAR_CACHE_NAME);
  } catch {
    return null;
  }
}

async function fetchAndCacheAvatar(cache: Cache | null, url: string): Promise<string | null> {
  const existing = blobUrls.get(url);
  if (existing) return existing;
  const active = inflight.get(url);
  if (active) return active;

  const task = (async () => {
    try {
      if (cache) {
        const hit = await cache.match(url);
        if (hit && hit.ok) {
          const blob = await hit.blob();
          if (blob.size > 0) {
            const objectUrl = URL.createObjectURL(blob);
            registerBlobUrl(url, objectUrl);
            return objectUrl;
          }
        }
      }

      const response = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType && !contentType.startsWith("image/")) return null;

      if (cache) {
        await cache.put(url, response.clone()).catch(() => undefined);
      }
      const blob = await response.blob();
      if (blob.size === 0) return null;
      const objectUrl = URL.createObjectURL(blob);
      registerBlobUrl(url, objectUrl);
      return objectUrl;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, task);
  return task;
}

async function runBatched(urls: string[], concurrency: number, fn: (url: string) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < urls.length; i += concurrency) {
    await Promise.all(urls.slice(i, i + concurrency).map(fn));
  }
}

/**
 * Hydrate cached thumbnails from `Cache Storage` immediately, then warm any
 * cache misses (priority visible batch first, offscreen remainder in background
 * batches) and prune obsolete versions.
 */
export async function warmAvatars(urls: string[], priorityCount = 16): Promise<void> {
  if (!canUseCacheStorage() || urls.length === 0) return;
  adoptBootAvatars();
  const unique = [...new Set(urls.filter(isCacheableAvatarUrl))];
  if (unique.length === 0) return;

  const cache = await openAvatarCache();
  if (!cache) return;

  // 1. Hydrate all hits already in Cache Storage without touching the network.
  const misses: string[] = [];
  const bootPending = typeof window !== "undefined" ? window.__CM_BOOT__?.pending : undefined;
  await Promise.all(unique.map(async (url) => {
    if (blobUrls.has(url) || bootPending?.[url]) return;
    try {
      const hit = await cache.match(url);
      if (hit && hit.ok) {
        const blob = await hit.blob();
        if (blob.size > 0) {
          registerBlobUrl(url, URL.createObjectURL(blob));
          return;
        }
      }
    } catch {
      // Treat unreadable entry as a miss.
    }
    misses.push(url);
  }));

  if (misses.length > 0) {
    // Preserve input ordering so visible above-the-fold cards fetch first.
    const missSet = new Set(misses);
    const orderedMisses = unique.filter((url) => missSet.has(url));
    const priorityMisses = orderedMisses.slice(0, priorityCount);
    const tailMisses = orderedMisses.slice(priorityCount);

    await runBatched(priorityMisses, 8, (url) => fetchAndCacheAvatar(cache, url));
    if (tailMisses.length > 0) {
      const warmTail = () => {
        void runBatched(tailMisses, 6, (url) => fetchAndCacheAvatar(cache, url));
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(warmTail, { timeout: 400 });
      } else {
        window.setTimeout(warmTail, 32);
      }
    }
  }

  // 2. Prune stale avatar versions once per active URL signature.
  const signature = `${unique.length}:${unique[0] ?? ""}:${unique[unique.length - 1] ?? ""}`;
  if (prunedSignature === signature) return;
  prunedSignature = signature;

  const prune = () => {
    const active = new Set(unique);
    void cache.keys().then((requests) => Promise.all(
      requests
        .filter((req) => !active.has(req.url))
        .map((req) => cache.delete(req)),
    )).catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(prune, { timeout: 2_000 });
  } else {
    window.setTimeout(prune, 500);
  }
}