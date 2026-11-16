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