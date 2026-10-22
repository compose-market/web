/**
 * Hard-reload-proof browser `Cache Storage` layer for large platform catalogs
 * (`models`, `connectors`, `agents`).
 *
 * Chrome bypasses HTTP disk cache on `Cmd+Shift+R`, and `localStorage` is
 * synchronous + capped at ~5 MB UTF-16. `Cache Storage` (`caches.open("catalogs")`)
 * survives hard reloads intact with large quota, while an in-memory map avoids
 * redundant `JSON.parse()` calls across components and hooks.
 */

const CATALOG_CACHE_NAME = "catalogs";
const SYNTHETIC_ORIGIN = "https://catalogs.compose.market";

const memory = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function cacheUrl(key: string): string {
  return `${SYNTHETIC_ORIGIN}/${encodeURIComponent(key)}`;
}

function canUseCacheStorage(): boolean {
  return typeof window !== "undefined" && typeof caches !== "undefined";
}

export function getCatalogMemory<T>(key: string): T | null {
  return (memory.get(key) as T | undefined) ?? null;
}

export function setCatalogMemory<T>(key: string, value: T): void {
  memory.set(key, value);
}