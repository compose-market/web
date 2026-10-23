/**
 * React hooks for the Compose agents worker (agents.compose.market).
 *
 * Catalog retention mirrors the Models worker pattern (use-model.ts): a
 * no-store /health poll yields a content version; the version-keyed
 * immutable /index snapshot is kept forever in memory + IndexedDB
 * (durableQueryMeta) with the previous version as placeholderData — agents
 * render instantly and never vanish between fetches.
 */
import { useMemo, useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DirectoryAgent } from "@compose-market/sdk";
import {
  AGENT_REGISTRIES,
  AGENTS_ORIGIN,
  agentKey,
  fetchAgentCardByWallet,
  fetchAgentsCatalogHealth,
  fetchAgentsCatalogIndex,
  fetchAgentsCatalogLatest,
  getEnabledRegistries,
  getRelevancyScore,
  isAgentIndexing,
  normalizeAgentSearchText,
  sameWallet,
  searchAgents,
  selectManowarAgents,
  toOnchainAgent,
  type Agent,
  type AgentRegistryId,
  type AgentSearchResponse,
  type SearchAgentsOptions,
  type SemanticAgentHit,
} from "@/lib/agents";
import { readAgentSnapshot, writeAgentSnapshot } from "@/lib/cache";
import { readBootCatalog, readBootCatalogPromise, warmAvatars } from "@/lib/performance/avatars";
import { durableQueryMeta, DURABLE_CACHE_MAX_AGE, queryClient } from "@/lib/queryClient";
import type { OnchainAgent } from "@/hooks/use-onchain";

// Re-export types for convenience
export type { Agent, AgentSearchResponse, SearchAgentsOptions };

// =============================================================================
// Catalog — health poll -> version -> immutable snapshot
// =============================================================================

const AGENTS_CACHE_PREFIX = ["agents-catalog", AGENTS_ORIGIN] as const;
const AGENTS_VERSION_KEY = ["agents-health", AGENTS_ORIGIN] as const;

function latestCachedAgents(client: ReturnType<typeof useQueryClient>): DirectoryAgent[] {
  const current = client.getQueryCache()
    .findAll({ queryKey: [...AGENTS_CACHE_PREFIX] })
    .filter((query) => Array.isArray(query.state.data))
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)[0]
    ?.state.data;
  if (Array.isArray(current) && current.length > 0) return current as DirectoryAgent[];
  const persisted = readAgentSnapshot(AGENTS_ORIGIN);
  return persisted?.items ?? [];
}

/**
 * Re-resolve health and, on a new version, pull the fresh immutable snapshot
 * into the shared cache. Any mounted useAgentCatalog observer (and any page
 * hydrating from the snapshot) swaps to it immediately. Safe to fire and
 * forget; failures leave the previous snapshot rendering.
 */
export async function refreshAgentCatalog(): Promise<void> {
  try {
    const health = await fetchAgentsCatalogHealth(AGENTS_ORIGIN);
    queryClient.setQueryData([...AGENTS_VERSION_KEY], health);
    if (!health.version) return;
    const agents = await queryClient.fetchQuery({
      queryKey: [...AGENTS_CACHE_PREFIX, health.version],
      queryFn: () => fetchAgentsCatalogIndex(AGENTS_ORIGIN, health.version!),
      staleTime: Infinity,
    });
    if (Array.isArray(agents) && agents.length > 0) {
      writeAgentSnapshot(AGENTS_ORIGIN, health.version, agents, health.lastUpdated);
    }
  } catch {
    // Health or index unreachable: the 5s poll and cron sync recover.
  }
}

export interface UseAgentCatalogOptions {
  enabled?: boolean;
}

export interface UseAgentCatalogReturn {
  agents: DirectoryAgent[];
  isLoading: boolean;
  isRefetching: boolean;
  error: Error | null;
  /** Refresh failed while cached snapshot data renders; null whenever `error` is set. */
  refreshError: Error | null;
  forceRefresh: () => Promise<void>;
  lastUpdated: Date | null;
}

function catalogThumbUrls(agents: DirectoryAgent[]): string[] {
  const urls: string[] = [];
  for (const agent of agents) {
    const raw = (agent as { avatarUrl?: unknown }).avatarUrl;
    if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) continue;
    try {
      const parsed = new URL(raw);
      if (!parsed.pathname.endsWith("/avatar")) continue;
      parsed.searchParams.delete("w");
      parsed.searchParams.set("size", "thumb");
      urls.push(parsed.toString());
    } catch {
      // Ignore malformed URLs.
    }
  }
  return urls;
}

let inflightColdCatalog: Promise<{ version: string; lastUpdated: string | null; agents: DirectoryAgent[] } | null> | null = null;

function loadColdCatalog(): Promise<{ version: string; lastUpdated: string | null; agents: DirectoryAgent[] } | null> {
  if (inflightColdCatalog) return inflightColdCatalog;
  inflightColdCatalog = (async () => {
    const bootPromise = readBootCatalogPromise();
    if (bootPromise) {
      const resolved = await bootPromise;
      if (resolved && Array.isArray(resolved.agents) && resolved.agents.length > 0 && resolved.version) {
        return resolved;
      }
    }
    return fetchAgentsCatalogLatest(AGENTS_ORIGIN);
  })().catch(() => null).finally(() => {
    inflightColdCatalog = null;
  });
  return inflightColdCatalog;
}

export function useAgentCatalog(options: UseAgentCatalogOptions = {}): UseAgentCatalogReturn {
  const { enabled = true } = options;
  const client = useQueryClient();
  const initialSnapshot = useMemo(() => {
    const persisted = readAgentSnapshot(AGENTS_ORIGIN);
    if (persisted) return persisted;
    const boot = readBootCatalog();
    if (boot && boot.agents.length > 0 && boot.version) {
      writeAgentSnapshot(AGENTS_ORIGIN, boot.version, boot.agents, boot.lastUpdated);
      return {
        version: boot.version,
        items: boot.agents,
        lastUpdated: boot.lastUpdated,
        updatedAt: Date.now(),
      };
    }
    return null;
  }, []);
  const [coldSeed, setColdSeed] = useState<{
    version: string;
    items: DirectoryAgent[];
    lastUpdated: string | null;
    updatedAt: number;
  } | null>(null);
  const snapshot = initialSnapshot ?? coldSeed;

  // Cold first load: pull single-RTT edge-cached /index (pre-kicked by index.html)
  // without waiting for PersistQueryClientProvider IndexedDB restore or /health.
  useEffect(() => {
    if (!enabled || snapshot) return;
    let active = true;
    void loadColdCatalog().then((latest) => {
      if (!active || !latest || latest.agents.length === 0) return;
      const now = Date.now();
      writeAgentSnapshot(AGENTS_ORIGIN, latest.version, latest.agents, latest.lastUpdated);
      client.setQueryData([...AGENTS_VERSION_KEY], {
        version: latest.version,
        lastUpdated: latest.lastUpdated,
        agents: latest.agents.length,
      });
      client.setQueryData([...AGENTS_CACHE_PREFIX, latest.version], latest.agents);
      setColdSeed({
        version: latest.version,
        items: latest.agents,
        lastUpdated: latest.lastUpdated,
        updatedAt: now,
      });
    });
    return () => { active = false; };
  }, [client, enabled, snapshot]);

  const healthQuery = useQuery({
    queryKey: [...AGENTS_VERSION_KEY],
    queryFn: () => fetchAgentsCatalogHealth(AGENTS_ORIGIN),
    // Background /health poll: a catalog publish or targeted upsert swaps
    // the snapshot in within one interval, non-blocking, while the old one
    // keeps rendering.
    initialData: snapshot
      ? { version: snapshot.version, lastUpdated: snapshot.lastUpdated, agents: snapshot.items.length }
      : undefined,
    initialDataUpdatedAt: snapshot?.updatedAt,
    staleTime: 30_000,
    gcTime: DURABLE_CACHE_MAX_AGE,
    refetchInterval: 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    enabled: enabled && Boolean(snapshot),
    retry: 2,
  });
  const version = healthQuery.data?.version ?? snapshot?.version ?? null;
  const lastUpdatedIso = healthQuery.data?.lastUpdated ?? snapshot?.lastUpdated ?? null;
  const cachedAgents = latestCachedAgents(client);
  const matchingSnapshot = snapshot && version && snapshot.version === version ? snapshot : null;

  const {
    data: loadedAgents,
    isLoading: isCatalogLoading,
    isFetching,
    error: catalogError,
    dataUpdatedAt,
  } = useQuery<DirectoryAgent[], Error>({
    queryKey: [...AGENTS_CACHE_PREFIX, version],
    queryFn: async () => {
      const fresh = await fetchAgentsCatalogIndex(AGENTS_ORIGIN, version!);
      if (fresh.length > 0) {
        writeAgentSnapshot(AGENTS_ORIGIN, version!, fresh, lastUpdatedIso);
      }
      return fresh;
    },
    initialData: matchingSnapshot?.items,
    initialDataUpdatedAt: matchingSnapshot?.updatedAt,
    staleTime: Infinity,
    gcTime: DURABLE_CACHE_MAX_AGE,
    placeholderData: cachedAgents,
    refetchOnMount: false,
    enabled: enabled && Boolean(version),
    meta: durableQueryMeta,
  });
  const agents = loadedAgents ?? matchingSnapshot?.items ?? cachedAgents;

  useEffect(() => {
    if (!enabled || agents.length === 0) return;
    const urls = catalogThumbUrls(agents);
    if (urls.length > 0) {
      void warmAvatars(urls, 16);
    }
  }, [agents, enabled]);

  const error = agents.length === 0 ? (catalogError ?? healthQuery.error ?? null) : null;
  // A refresh failure while cached agents render is surfaced separately so a
  // stale catalog can never silently masquerade as live.
  const refreshError = agents.length > 0 ? (catalogError ?? healthQuery.error ?? null) : null;
  const isLoading = enabled && agents.length === 0 && (!snapshot || healthQuery.isLoading || isCatalogLoading);

  const forceRefresh = useCallback(() => refreshAgentCatalog(), []);

  const lastUpdated = healthQuery.data?.lastUpdated
    ? new Date(healthQuery.data.lastUpdated)
    : dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return {
    agents,
    isLoading,
    isRefetching: isFetching && !isLoading,
    error: error ?? null,
    refreshError,
    forceRefresh,
    lastUpdated,
  };
}

// =============================================================================
// Semantic search — compact hits resolved back to the canonical snapshot
// =============================================================================

export interface UseSemanticAgentSearchOptions {
  enabled?: boolean;
  limit?: number;
}

export interface UseSemanticAgentSearchReturn {
  hits: SemanticAgentHit[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Semantic ranking hints from agents.compose.market. These are never
 * selected directly; consumers resolve every hit back to the canonical
 * loaded snapshot (mergeSemanticAgentRanks).
 */
export function useSemanticAgentSearch(
  query: string,
  options: UseSemanticAgentSearchOptions = {},
): UseSemanticAgentSearchReturn {
  const normalized = normalizeAgentSearchText(query);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const enabled = (options.enabled ?? true) && normalized.replace(/\s+/gu, "").length >= 3;

  const result = useQuery<SemanticAgentHit[], Error>({
    queryKey: ["agents-semantic-search", normalized, limit],
    queryFn: async ({ signal }) => {
      const target = new URL(`${AGENTS_ORIGIN}/agents/search`);
      target.searchParams.set("q", query.trim());
      target.searchParams.set("limit", String(limit));
      target.searchParams.set("compact", "1");
      const response = await fetch(target, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Semantic agent search failed: ${response.status}`);
      }
      const body = await response.json() as { agents?: unknown };
      if (!Array.isArray(body.agents)) return [];
      return body.agents.flatMap((item): SemanticAgentHit[] => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.walletAddress !== "string" || !row.walletAddress) return [];
        return [{
          walletAddress: row.walletAddress,
          ...(typeof row.name === "string" ? { name: row.name } : {}),
          score: typeof row.score === "number" ? row.score : 0,
        }];
      });
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  return {
    hits: result.data ?? [],
    isLoading: result.isFetching,
    error: result.error ?? null,
  };
}

// =============================================================================
// Single agent — snapshot-hydrated, 404-only "not found", indexing race guard
// =============================================================================

/** Thrown when a just-minted wallet 404s while the catalog publish races. */
export class AgentIndexingError extends Error {
  constructor(walletAddress: string) {
    super(`Agent ${walletAddress} is still being indexed`);
    this.name = "AgentIndexingError";
  }
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function isSolanaAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44) return false;
  const bytes = [0];
  for (let i = 0; i < value.length; i += 1) {
    const digit = BASE58_ALPHABET.indexOf(value[i]!);
    if (digit < 0) return false;
    let carry = digit;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === "1") leadingZeros += 1;
  const decodedLength = leadingZeros + (bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length);
  return decodedLength === 32;
}

function isNearAccountId(value: string): boolean {
  if (/^coord-[0-9a-f]+\.factory\./iu.test(value)) return false;
  if (/^0u[0123456789abcdefghjkmnpqrstvwxyz]{51}[0g]$/u.test(value)) return true;
  if (/^0s[0-9a-fA-F]{40}$/u.test(value)) return true;
  if (value.length < 2 || value.length > 64) return false;
  if (/^[0-9a-f]{64}$/u.test(value)) return true;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)+([a-z\d]+[-_])*[a-z\d]+$/u.test(value);
}

export function resolveAgentIdentifier(identifier: string | null): string | null {
  const value = identifier ? decodeURIComponent(identifier).trim() : "";
  if (!value) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(value) || isSolanaAddress(value) || isNearAccountId(value) ? value : null;
}

export interface UseAgentByIdentifierReturn {
  data: OnchainAgent | null;
  isLoading: boolean;
  error: Error | null;
  /** True while a just-created agent's first catalog publish races the page. */
  isIndexing: boolean;
}

export function useAgentByIdentifier(identifier: string | null): UseAgentByIdentifierReturn {
  const client = useQueryClient();
  const walletAddress = resolveAgentIdentifier(identifier);

  const snapshotAgent = useMemo(() => {
    if (!walletAddress) return null;
    const cached = latestCachedAgents(client);
    const card = cached.find((agent) => sameWallet(agent.walletAddress, walletAddress)) ?? null;
    return card ? toOnchainAgent(card) : null;
  }, [client, walletAddress]);

  const result = useQuery<OnchainAgent | null, Error>({
    queryKey: ["agent-wallet", walletAddress ? agentKey(walletAddress) : null],
    queryFn: async () => {
      if (!walletAddress) return null;
      const card = await fetchAgentCardByWallet(walletAddress);
      if (card === null && isAgentIndexing(walletAddress)) {
        throw new AgentIndexingError(walletAddress);
      }
      return card ? toOnchainAgent(card) : null;
    },
    enabled: Boolean(walletAddress),
    staleTime: 60 * 1000,
    gcTime: DURABLE_CACHE_MAX_AGE,
    retry: (failureCount, error) =>
      error instanceof AgentIndexingError ? failureCount < 3 : failureCount < 2,
    retryDelay: () => 2_000,
    placeholderData: snapshotAgent ?? undefined,
    meta: durableQueryMeta,
  });

  return {
    data: result.data ?? null,
    isLoading: result.isLoading,
    error: result.error ?? null,
    isIndexing: result.error instanceof AgentIndexingError,
  };
}

// =============================================================================
// Creator-owned agents (my assets, RFA submissions) — snapshot + client filter
// =============================================================================

export function useAgentsByCreator(creator: string | undefined) {
  const { agents, isLoading, error, refreshError } = useAgentCatalog({ enabled: Boolean(creator) });

  const data = useMemo(() => {
    if (!creator) return [] as OnchainAgent[];
    const key = agentKey(creator);
    return agents
      .filter((card) => typeof card.creator === "string" && cardKey(card.creator) === key)
      .map(toOnchainAgent);
  }, [agents, creator]);

  return { data, isLoading, error: error ?? refreshError };
}

function cardKey(creator: string): string {
  return creator.startsWith("0x") ? creator.toLowerCase() : creator;
}

// =============================================================================
// Discovery — external registries (network) + manowar (cached snapshot)
// =============================================================================

export function useAgents(options: SearchAgentsOptions = {}) {
  const { search, tags, category, status, limit, offset, sort, direction } = options;

  const enabledRegistries: AgentRegistryId[] = options.registries?.length
    ? options.registries.filter((registry) => AGENT_REGISTRIES[registry]?.enabled)
    : getEnabledRegistries();
  const wantsManowar = enabledRegistries.includes("manowar");
  const externalRegistries = enabledRegistries.filter((registry) => registry !== "manowar");

  const catalog = useAgentCatalog({ enabled: wantsManowar });
  const external = useQuery<AgentSearchResponse>({
    queryKey: [
      "agents-external",
      search,
      tags,
      externalRegistries,
      status,
      limit,
      offset,
      sort,
      direction,
    ],
    queryFn: () => searchAgents({ ...options, registries: externalRegistries }),
    enabled: externalRegistries.length > 0,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });

  const manowar = useMemo(
    () => (wantsManowar
      ? selectManowarAgents(catalog.agents, options)
      : { agents: [] as Agent[], total: 0, tags: [] as string[], categories: [] as string[] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wantsManowar, catalog.agents, search, tags, category, limit, offset],
  );

  const data = useMemo<AgentSearchResponse>(() => {
    const externalAgents = external.data?.agents ?? [];
    const allAgents = [...manowar.agents, ...externalAgents];

    if (sort === "interactions") {
      allAgents.sort((a, b) =>
        direction === "asc"
          ? a.totalInteractions - b.totalInteractions
          : b.totalInteractions - a.totalInteractions
      );
    } else if (sort === "created-at") {
      allAgents.sort((a, b) =>
        direction === "asc"
          ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else if (sort === "relevancy" && search) {
      const q = search.toLowerCase();
      allAgents.sort((a, b) => {
        const scoreA = getRelevancyScore(a, q);
        const scoreB = getRelevancyScore(b, q);
        return direction === "asc" ? scoreA - scoreB : scoreB - scoreA;
      });
    }

    return {
      agents: allAgents,
      total: manowar.total + (external.data?.total ?? 0),
      offset: offset || 0,
      limit: limit || 30,
      tags: Array.from(new Set([...manowar.tags, ...(external.data?.tags ?? [])])).sort(),
      categories: Array.from(new Set([...manowar.categories, ...(external.data?.categories ?? [])])).sort(),
      registries: enabledRegistries,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external.data, manowar, sort, direction, search, enabledRegistries]);

  const isLoading = external.isLoading || (wantsManowar && catalog.isLoading);
  const error = external.error ?? (wantsManowar ? catalog.error : null);

  return { data, isLoading, error };
}
