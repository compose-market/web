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

export async function readCatalogCache<T>(key: string): Promise<T | null> {
  const mem = memory.get(key);
  if (mem !== undefined) return mem as T;
  if (!canUseCacheStorage()) return null;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T | null>;

  const task = (async () => {
    try {
      const cache = await caches.open(CATALOG_CACHE_NAME);
      const hit = await cache.match(cacheUrl(key));
      if (!hit || !hit.ok) return null;
      const parsed = (await hit.json()) as T;
      if (parsed != null) {
        memory.set(key, parsed);
      }
      return parsed;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

export async function writeCatalogCache<T>(key: string, value: T): Promise<void> {
  memory.set(key, value);
  if (!canUseCacheStorage()) return;
  try {
    const cache = await caches.open(CATALOG_CACHE_NAME);
    const response = new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
    await cache.put(cacheUrl(key), response);
  } catch {
    // Non-fatal in private browsing or quota pressure.
  }
}