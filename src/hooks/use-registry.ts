/**
 * Connectors registry hooks.
 *
 * Backed by the versioned `https://connectors.compose.market/index?version=`
 * snapshot (persisted in IndexedDB via `durableQueryMeta` like `models` & `agents`)
 * for 0 ms catalog browsing, filtering, and keystroke search, merged seamlessly
 * with Voyage `rerank-2.5` semantic hits from `GET /?q=...&compact=1`, and
 * `sdk.connectors.*` fallbacks for single-connector details and unindexed envs.
 */
import type {
    AccountAuthMode,
    AccountToolkit,
    AccountToolkitAction,
    ConnectorSearchHit,
    McpServerCard,
    McpServerSummary,
    OnchainConnector,
} from "@compose-market/sdk";
import { type QueryClient, useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { CONNECTORS_BASE_URL, sdk } from "@/lib/sdk";
import { getCatalogMemory, readCatalogCache, writeCatalogCache } from "@/lib/performance/catalogs";
import { durableQueryMeta, DURABLE_CACHE_MAX_AGE, persistDurableQueries } from "@/lib/queryClient";
import {
    connectorsOrigin,
    fetchConnectorCatalogHealth,
    fetchConnectorCatalogIndex,
    isSupersededConnectorCatalogQueryKey,
    mergeSemanticConnectorRanks,
    normalizeConnectorBinding,
    normalizeConnectorSearchText,
    rankCatalogConnectors,
    type CanonicalConnectorOrigin,
    type ConnectorCatalogHealth,
    type ConnectorCatalogIndexPayload,
    type ConnectorCatalogMcpSummary,
    type ConnectorCatalogOnchainSummary,
    type SemanticConnectorHit,
} from "@/lib/connectors";

/**
 * Build the connectors broker base URL.
 */
function getBrokerBaseUrl(): string {
    const url = import.meta.env.VITE_CONNECTORS_URL;
    if (url) {
        return url.replace(/\/$/, "");
    }
    return "https://connectors.compose.market";
}

const BROKER_BASE = getBrokerBaseUrl();

/** Server origin types (user-facing). */
export type ServerOrigin = CanonicalConnectorOrigin;

/** Record type: agent (autonomous AI agents) or connector (tools/connectors). */
export type RecordType = "agent" | "connector";

/** Unified server record. */
export interface RegistryServer {
    registryId: string;
    origin: ServerOrigin;
    type: RecordType;
    sources?: ServerOrigin[];
    canonicalKey?: string;
    name: string;
    namespace: string;
    slug: string;
    description: string;
    attributes: string[];
    repoUrl?: string;
    uiUrl?: string;
    logo?: string;
    category?: string;
    tags: string[];
    toolCount: number;
    tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }>;
    available: boolean;
    executable?: boolean;
    missingEnv?: string[];
    alternateIds?: string[];
    transport?: "stdio" | "http" | "docker";
    image?: string;
    remoteUrl?: string;
    status?: ServedCatalogStatus;
    credentialGated?: boolean;
    authMode?: AccountAuthMode;
    noAuth?: boolean;
}

export interface RegistryListResponse {
    total: number;
    offset: number;
    limit: number;
    servers: RegistryServer[];
}

export interface RegistrySearchResponse {
    query: string;
    total: number;
    servers: RegistryServer[];
}

export interface RegistryMeta {
    totalServers: number;
    toolsServers: number;
    accountsServers: number;
    onchainServers: number;
    loadedAt: string | null;
}

export interface ListServersOptions {
    type?: RecordType;
    origin?: ServerOrigin | string;
    category?: string;
    available?: boolean;
    limit?: number;
    offset?: number;
    enabled?: boolean;
}

export interface SearchServersOptions {
    origin?: ServerOrigin | string;
    category?: string;
    enabled?: boolean;
}

type ServedCatalogStatus = "live" | "credential_gated";

interface BrokerServerSummary {
    slug: string;
    origin: CanonicalConnectorOrigin;
    name: string;
    namespace: string;
    description: string;
    tags: string[];
    category: string | null;
    status: ServedCatalogStatus;
    statefulness: "stateless" | "stateful" | "unknown";
    cardVersion: string;
    inspectedAt: string | null;
}

interface BrokerServerCard extends BrokerServerSummary {
    repoUrl: string | null;
    image: string | null;
    compiledAt: string | null;
    tools: Array<{ name: string; description?: string | null; inputSchema: Record<string, unknown> }>;
    credentials: Array<{ varName: string; description?: string | null; obtainUrl?: string | null }>;
}

interface BrokerOnchainConnector {
    id: string;
    name: string;
    description: string;
    toolCount: number;
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown>; connectorId: string }>;
    requiresApiKey?: boolean;
    apiKeyConfigured?: boolean;
}

interface BrokerOnchainResponse {
    connectors: BrokerOnchainConnector[];
    status: {
        initialized: boolean;
        walletAddress: string | null;
        chain: string;
        chainId: number;
        rpcUrl: string | null;
        error: string | null;
        totalTools: number;
    };
}

interface BrokerToolsListResponse {
    total: number;
    offset: number;
    limit: number;
    servers: BrokerServerSummary[];
}

const DEFAULT_REGISTRY_PAGE_SIZE = 50;
const MAX_TOOLS_PAGE_SIZE = 200;
const MAX_SEARCH_RESULTS = 50;

const CONNECTORS_ORIGIN = connectorsOrigin(CONNECTORS_BASE_URL);
const CATALOG_CACHE_PREFIX = ["connectors-catalog", CONNECTORS_ORIGIN] as const;
const CATALOG_VERSION_KEY = ["connectors-health", CONNECTORS_ORIGIN] as const;
const CONNECTOR_CATALOG_STORAGE_KEY = `connectors:catalog:${CONNECTORS_ORIGIN}`;

// Warm connectors catalog from Cache Storage on module load (survives Cmd+Shift+R).
void readCatalogCache<ConnectorCatalogIndexPayload>(CONNECTOR_CATALOG_STORAGE_KEY);

function summaryToRegistryServer(s: McpServerSummary | ConnectorCatalogMcpSummary): RegistryServer {
    const raw = s as McpServerSummary & { repoUrl?: string | null; image?: string | null };
    const binding = normalizeConnectorBinding({ registryId: s.slug, origin: s.origin || "mcp" });
    const origin: ServerOrigin = binding.origin;
    const status: ServedCatalogStatus = s.status === "credential_gated" ? "credential_gated" : "live";
    return {
        registryId: binding.registryId,
        origin,
        type: "connector",
        sources: [origin],
        canonicalKey: s.slug,
        name: s.name,
        namespace: s.namespace || origin,
        slug: s.slug,
        description: s.description || "",
        attributes: [],
        repoUrl: raw.repoUrl ?? undefined,
        image: raw.image ?? undefined,
        category: s.category ?? undefined,
        tags: s.tags || [],
        toolCount: s.toolCount ?? 0,
        available: (s as McpServerSummary).available ?? true,
        executable: true,
        status,
        credentialGated: status === "credential_gated",
    };
}

function cardToRegistryServer(s: McpServerCard): RegistryServer {
    const raw = s as McpServerCard & { repoUrl?: string | null; image?: string | null };
    const binding = normalizeConnectorBinding({ registryId: s.slug, origin: s.origin || "mcp" });
    const origin: ServerOrigin = binding.origin;
    const tools = s.tools || [];
    const credentials = s.credentials || [];
    const status: ServedCatalogStatus = s.status === "credential_gated" ? "credential_gated" : "live";
    return {
        registryId: binding.registryId,
        origin,
        type: "connector",
        sources: [origin],
        canonicalKey: s.slug,
        name: s.name,
        namespace: s.namespace || origin,
        slug: s.slug,
        description: s.description || "",
        attributes: [],
        repoUrl: raw.repoUrl ?? s.repositoryUrl ?? undefined,
        category: s.category ?? undefined,
        tags: s.tags || [],
        toolCount: s.toolCount ?? tools.length,
        tools: tools.map((t) => ({
            name: t.name,
            description: t.description ?? undefined,
            inputSchema: t.inputSchema,
        })),
        available: s.available ?? true,
        executable: true,
        image: raw.image ?? undefined,
        missingEnv: s.missingEnv ?? credentials.map((c) => c.varName),
        status,
        credentialGated: status === "credential_gated",
    };
}

function connectorToRegistryServer(p: OnchainConnector | ConnectorCatalogOnchainSummary): RegistryServer {
    const binding = normalizeConnectorBinding({ registryId: p.id, origin: "onchain" });
    const fullTools = "tools" in p && Array.isArray(p.tools) ? p.tools : undefined;
    return {
        registryId: binding.registryId,
        origin: binding.origin,
        type: "connector",
        sources: [binding.origin],
        canonicalKey: p.id,
        name: p.name,
        namespace: "onchain",
        slug: p.id,
        description: p.description || "",
        attributes: [],
        category: p.category || "defi",
        tags: "tags" in p && Array.isArray(p.tags) && p.tags.length > 0 ? p.tags : ["onchain", "defi"],
        toolCount: p.toolCount ?? fullTools?.length ?? 0,
        ...(fullTools
            ? {
                tools: fullTools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.parameters ?? t.inputSchema,
                })),
            }
            : {}),
        available: true,
        executable: true,
        status: "live",
    };
}

function toolkitToRegistryServer(tk: AccountToolkit, actions?: AccountToolkitAction[]): RegistryServer {
    const binding = normalizeConnectorBinding({ registryId: tk.slug, origin: "account" });
    const isNoAuth = Boolean(tk.noAuth || tk.authMode === "no_auth");
    const status: ServedCatalogStatus = isNoAuth ? "live" : "credential_gated";
    return {
        registryId: binding.registryId,
        origin: binding.origin,
        type: "connector",
        sources: [binding.origin],
        canonicalKey: tk.slug,
        name: tk.name || tk.slug,
        namespace: "account",
        slug: tk.slug,
        description: tk.description || "",
        attributes: [],
        uiUrl: tk.appUrl ?? undefined,
        logo: tk.logo,
        category: tk.categories?.[0],
        tags: tk.categories?.length ? tk.categories : ["account"],
        toolCount: tk.toolsCount ?? actions?.length ?? 0,
        tools: actions?.map((action) => ({
            name: action.slug,
            description: action.description || action.name,
            inputSchema: action.inputParameters,
        })),
        available: true,
        executable: true,
        status,
        credentialGated: !isNoAuth,
        authMode: tk.authMode,
        noAuth: isNoAuth,
    };
}

function searchHitToRegistryServer(hit: ConnectorSearchHit): RegistryServer {
    const binding = normalizeConnectorBinding({
        registryId: hit.bindingId || hit.registryId || hit.slug,
        origin: hit.origin,
    });
    const isNoAuth = Boolean(hit.noAuth || hit.authMode === "no_auth");
    const status: ServedCatalogStatus = hit.status === "credential_gated" ? "credential_gated" : "live";
    return {
        registryId: binding.registryId,
        origin: binding.origin,
        type: "connector",
        sources: [binding.origin],
        canonicalKey: binding.slug,
        name: hit.name || binding.slug,
        namespace: binding.origin,
        slug: binding.slug,
        description: hit.description || "",
        attributes: [],
        logo: hit.logo ?? undefined,
        category: hit.category || undefined,
        tags: hit.tags?.length ? hit.tags : [binding.origin],
        toolCount: hit.toolCount ?? 0,
        available: true,
        executable: hit.playable !== false,
        status,
        credentialGated: Boolean(hit.requiresCredentials),
        authMode: hit.authMode,
        noAuth: hit.origin === "account" ? isNoAuth : undefined,
    };
}

async function fetchServers(options: ListServersOptions = {}): Promise<RegistryListResponse> {
    const { enabled: _enabled, ...listOptions } = options;
    const origins = options.origin ? String(options.origin).split(",") : ["mcp", "account", "onchain"];
    const requestedLimit = listOptions.limit;
    const offset = listOptions.offset ?? 0;
    const toolsLimit = Math.min(Math.max(1, requestedLimit ?? DEFAULT_REGISTRY_PAGE_SIZE), MAX_TOOLS_PAGE_SIZE);

    const tasks: Array<Promise<{ total: number; servers: RegistryServer[] }>> = [];

    if (origins.includes("mcp")) {
        tasks.push(
            (async () => {
                const data = await sdk.connectors.mcps.list({
                    limit: toolsLimit,
                    offset,
                    category: listOptions.category,
                });
                return {
                    total: data.total,
                    servers: (data.servers || []).map(summaryToRegistryServer),
                };
            })(),
        );
    }

    if (origins.includes("account")) {
        tasks.push(
            (async () => {
                try {
                    const data = await sdk.connectors.accounts.catalog({
                        limit: toolsLimit,
                        offset,
                        category: listOptions.category,
                    });
                    const toolkits = data.toolkits || [];
                    return {
                        total: data.total ?? toolkits.length,
                        servers: toolkits.map((tk) => toolkitToRegistryServer(tk)),
                    };
                } catch {
                    return { total: 0, servers: [] };
                }
            })(),
        );
    }

    if (origins.includes("onchain")) {
        tasks.push(
            (async () => {
                try {
                    const data = await sdk.connectors.onchain.list();
                    return {
                        total: (data.connectors || []).length,
                        servers: (data.connectors || []).map(connectorToRegistryServer),
                    };
                } catch {
                    return { total: 0, servers: [] };
                }
            })(),
        );
    }

    const results = await Promise.all(tasks);
    const catalogTotal = results.reduce((acc, r) => acc + r.total, 0);

    let merged: RegistryServer[] = [];
    for (const r of results) {
        merged = merged.concat(r.servers);
    }

    merged = merged.filter((s) => origins.includes(s.origin));

    if (listOptions.category) {
        merged = merged.filter((s) => s.category === listOptions.category);
    }
    if (listOptions.available !== undefined) {
        merged = merged.filter((s) => s.available === listOptions.available);
    }

    return {
        total: listOptions.available !== undefined ? merged.length : Math.max(catalogTotal, merged.length),
        offset,
        limit: merged.length,
        servers: merged,
    };
}

/**
 * Search the unified catalog across MCPs, Accounts, and Onchain connectors
 * using Cloudflare Vectorize + D1 lexical hybrid + Voyage rerank-2.5 on `GET /?q=`.
 */
async function searchServers(query: string, limit = DEFAULT_REGISTRY_PAGE_SIZE, options: SearchServersOptions = {}): Promise<RegistrySearchResponse> {
    const normalizedQuery = query.toLowerCase().trim();
    if (normalizedQuery.length < 2) {
        return { query: normalizedQuery, total: 0, servers: [] };
    }
    const { enabled: _enabled, ...searchOptions } = options;
    const origins = (searchOptions.origin
        ? String(searchOptions.origin).split(",").map((v) => v.trim()).filter(Boolean)
        : ["mcp", "account", "onchain"]) as CanonicalConnectorOrigin[];
    const boundedLimit = Math.min(Math.max(1, limit), MAX_SEARCH_RESULTS);

    const data = await sdk.connectors.all({
        q: query,
        limit: boundedLimit,
        origin: origins,
        category: searchOptions.category,
    });

    let servers = (data.results || [])
        .map(searchHitToRegistryServer)
        .filter((s) => origins.includes(s.origin));

    if (searchOptions.category) {
        servers = servers.filter((server) => server.category === searchOptions.category);
    }
    servers = servers.slice(0, boundedLimit);

    return {
        query: data.query || normalizedQuery,
        total: data.total ?? servers.length,
        servers,
    };
}

async function fetchServer(
    registryId: string,
    defaultOrigin: CanonicalConnectorOrigin = "mcp",
    cachedAccount?: AccountToolkit,
): Promise<RegistryServer> {
    const binding = normalizeConnectorBinding(registryId, { defaultOrigin });
    if (binding.origin === "onchain") {
        const connector = await sdk.connectors.onchain.get(binding.slug);
        return connectorToRegistryServer(connector);
    }
    if (binding.origin === "account") {
        const [toolkitsRes, actionsRes] = await Promise.all([
            cachedAccount
                ? Promise.resolve({ toolkits: [cachedAccount] })
                : sdk.connectors.accounts.toolkits.list({ q: binding.slug, limit: 20 }).catch(() => ({ toolkits: [] })),
            sdk.connectors.accounts.toolkits.actions(binding.slug, { limit: 100 }),
        ]);
        const matched = (toolkitsRes.toolkits || []).find(
            (tk) => tk.slug.toLowerCase() === binding.slug.toLowerCase(),
        ) ?? {
            slug: binding.slug,
            name: actionsRes.actions?.[0]?.toolkitName || binding.slug,
        };
        return toolkitToRegistryServer(matched, actionsRes.actions || []);
    }
    const card = await sdk.connectors.mcps.get(binding.slug);
    return cardToRegistryServer(card);
}

async function fetchRegistryMeta(): Promise<RegistryMeta> {
    const [toolsMeta, accounts, onchain] = await Promise.all([
        sdk.connectors.mcps.meta(),
        sdk.connectors.accounts.catalog({ limit: 1 }).catch(() => null),
        sdk.connectors.onchain.list().catch(() => null),
    ]);
    const origins = (toolsMeta.origins ?? {}) as Record<string, number>;
    const total = typeof toolsMeta.total === "number" ? toolsMeta.total : 0;
    const accountsCount = accounts?.total ?? accounts?.toolkits?.length ?? 0;
    const onchainCount = onchain?.connectors?.length ?? 0;
    return {
        totalServers: total + accountsCount + onchainCount,
        toolsServers: origins["mcp"] ?? total,
        accountsServers: accountsCount,
        onchainServers: onchainCount,
        loadedAt: new Date().toISOString(),
    };
}

async function fetchCategories(): Promise<string[]> {
    const data = await sdk.connectors.mcps.categories();
    const raw = (data.categories ?? []) as Array<string | { category?: string; name?: string; id?: string }>;
    return raw
        .map((c) => (typeof c === "string" ? c : (c.category || c.name || c.id || "")))
        .filter(Boolean);
}

async function fetchTags(): Promise<string[]> {
    const data = await sdk.connectors.mcps.tags();
    const raw = (data.tags ?? []) as Array<string | { tag?: string }>;
    return raw
        .map((t) => (typeof t === "string" ? t : (t.tag || "")))
        .filter(Boolean);
}

// =============================================================================
// Constants & Snapshot Cache Helpers
// =============================================================================

const REGISTRY_STALE_TIME = 6 * 60 * 60 * 1000;
const REGISTRY_GC_TIME = 12 * 60 * 60 * 1000;
const REGISTRY_SEARCH_GC_TIME = 10 * 60 * 1000;
const METADATA_STALE_TIME = 5 * 60 * 1000;
const REGISTRY_CACHE_KEY = ["registry", "servers"] as const;
const SEMANTIC_DEBOUNCE_MS = 150;

function pruneSupersededConnectorCatalogQueries(
    queryClient: QueryClient,
    origin: string,
    activeVersion: string,
): number {
    const staleQueries = queryClient.getQueryCache().findAll({
        predicate: (query) => isSupersededConnectorCatalogQueryKey(query.queryKey, origin, activeVersion),
    });
    if (staleQueries.length === 0) return 0;

    queryClient.removeQueries({
        predicate: (query) => isSupersededConnectorCatalogQueryKey(query.queryKey, origin, activeVersion),
    });
    return staleQueries.length;
}

function latestCachedConnectorCatalog(
    queryClient: QueryClient,
    version?: string | null,
): ConnectorCatalogIndexPayload | undefined {
    if (version) {
        const exact = queryClient.getQueryData<ConnectorCatalogIndexPayload>([...CATALOG_CACHE_PREFIX, version]);
        if (exact && Array.isArray(exact.mcps) && Array.isArray(exact.accounts)) return exact;
    }
    const current = queryClient.getQueryCache()
        .findAll({ queryKey: CATALOG_CACHE_PREFIX })
        .filter((query) => {
            const d = query.state.data as ConnectorCatalogIndexPayload | undefined;
            return Boolean(d && Array.isArray(d.mcps) && Array.isArray(d.accounts));
        })
        .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)[0]
        ?.state.data;
    if (current) return current as ConnectorCatalogIndexPayload;
    const mem = getCatalogMemory<ConnectorCatalogIndexPayload>(CONNECTOR_CATALOG_STORAGE_KEY);
    if (mem && Array.isArray(mem.mcps) && Array.isArray(mem.accounts)) return mem;
    return undefined;
}

interface DerivedConnectorCatalog {
    mcpServers: RegistryServer[];
    accountServers: RegistryServer[];
    onchainServers: RegistryServer[];
    allServers: RegistryServer[];
    accountBySlug: Map<string, AccountToolkit>;
    serverByBindingId: Map<string, RegistryServer>;
    meta: RegistryMeta | undefined;
    categories: string[] | undefined;
    tags: string[] | undefined;
}

const EMPTY_DERIVED_CATALOG: DerivedConnectorCatalog = {
    mcpServers: [],
    accountServers: [],
    onchainServers: [],
    allServers: [],
    accountBySlug: new Map<string, AccountToolkit>(),
    serverByBindingId: new Map<string, RegistryServer>(),
    meta: undefined,
    categories: undefined,
    tags: undefined,
};

const derivedCatalogCache = new WeakMap<ConnectorCatalogIndexPayload, DerivedConnectorCatalog>();

function deriveConnectorCatalog(payload: ConnectorCatalogIndexPayload | undefined): DerivedConnectorCatalog {
    if (!payload) return EMPTY_DERIVED_CATALOG;
    const cached = derivedCatalogCache.get(payload);
    if (cached) return cached;

    const mcpServers = payload.mcps.map(summaryToRegistryServer);
    const accountServers = payload.accounts.map((tk) => toolkitToRegistryServer(tk));
    const onchainServers = payload.onchain.connectors.map(connectorToRegistryServer);
    const allServers = [...accountServers, ...mcpServers, ...onchainServers];

    const accountBySlug = new Map<string, AccountToolkit>();
    for (const tk of payload.accounts) {
        accountBySlug.set(tk.slug.toLowerCase(), tk);
    }

    const serverByBindingId = new Map<string, RegistryServer>();
    for (const server of allServers) {
        serverByBindingId.set(server.registryId.toLowerCase(), server);
        serverByBindingId.set(`${server.origin}:${server.slug.toLowerCase()}`, server);
    }

    const meta: RegistryMeta = {
        totalServers: payload.counts.total,
        toolsServers: payload.counts.mcp,
        accountsServers: payload.counts.account,
        onchainServers: payload.counts.onchain,
        loadedAt: payload.lastUpdated,
    };

    const derived: DerivedConnectorCatalog = {
        mcpServers,
        accountServers,
        onchainServers,
        allServers,
        accountBySlug,
        serverByBindingId,
        meta,
        categories: payload.categories,
        tags: payload.tags,
    };
    derivedCatalogCache.set(payload, derived);
    return derived;
}

export interface HydratedConnectorSnapshot {
    version: string | null;
    hasData: boolean;
    isLoading: boolean;
    isFetching: boolean;
    error: Error | null;
    mcpServers: RegistryServer[];
    accountServers: RegistryServer[];
    onchainServers: RegistryServer[];
    allServers: RegistryServer[];
    accountBySlug: Map<string, AccountToolkit>;
    serverByBindingId: Map<string, RegistryServer>;
    meta: RegistryMeta | undefined;
    categories: string[] | undefined;
    tags: string[] | undefined;
    forceRefresh: () => Promise<void>;
}

export function useConnectorCatalogSnapshot(enabled = true): HydratedConnectorSnapshot {
    const queryClient = useQueryClient();
    const isRestoring = useIsRestoring();
    const persisted = useMemo(
        () => getCatalogMemory<ConnectorCatalogIndexPayload>(CONNECTOR_CATALOG_STORAGE_KEY),
        [],
    );

    useEffect(() => {
        if (persisted) return;
        let active = true;
        void readCatalogCache<ConnectorCatalogIndexPayload>(CONNECTOR_CATALOG_STORAGE_KEY).then((cached) => {
            if (!active || !cached?.version || !Array.isArray(cached.mcps) || !Array.isArray(cached.accounts)) return;
            queryClient.setQueryData(CATALOG_VERSION_KEY, (existing: ConnectorCatalogHealth | undefined) => existing ?? {
                version: cached.version,
                lastUpdated: cached.lastUpdated,
                counts: cached.counts,
            });
            queryClient.setQueryData([...CATALOG_CACHE_PREFIX, cached.version], (existing: ConnectorCatalogIndexPayload | undefined) => (
                existing ?? cached
            ));
        });
        return () => { active = false; };
    }, [persisted, queryClient]);

    const healthQuery = useQuery<ConnectorCatalogHealth, Error>({
        queryKey: CATALOG_VERSION_KEY,
        queryFn: () => fetchConnectorCatalogHealth(CONNECTORS_ORIGIN),
        initialData: persisted
            ? { version: persisted.version, lastUpdated: persisted.lastUpdated, counts: persisted.counts }
            : undefined,
        initialDataUpdatedAt: 0,
        staleTime: 30_000,
        gcTime: DURABLE_CACHE_MAX_AGE,
        refetchInterval: 60_000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        enabled,
        retry: 1,
    });

    const version = healthQuery.data?.version ?? null;
    const cachedPayload = latestCachedConnectorCatalog(queryClient, version);
    const matchingPersisted = persisted && version && persisted.version === version ? persisted : undefined;

    const catalogQuery = useQuery<ConnectorCatalogIndexPayload, Error>({
        queryKey: [...CATALOG_CACHE_PREFIX, version],
        queryFn: async ({ signal }) => {
            const cacheHit = await readCatalogCache<ConnectorCatalogIndexPayload>(CONNECTOR_CATALOG_STORAGE_KEY);
            if (cacheHit && cacheHit.version === version && Array.isArray(cacheHit.mcps)) {
                return cacheHit;
            }
            const fresh = await fetchConnectorCatalogIndex(CONNECTORS_ORIGIN, version!, fetch, { signal });
            if (fresh && Array.isArray(fresh.mcps)) {
                void writeCatalogCache(CONNECTOR_CATALOG_STORAGE_KEY, fresh);
            }
            return fresh;
        },
        initialData: matchingPersisted,
        staleTime: Infinity,
        gcTime: DURABLE_CACHE_MAX_AGE,
        placeholderData: cachedPayload,
        refetchOnMount: false,
        enabled: enabled && Boolean(version),
        retry: 1,
        meta: durableQueryMeta,
    });

    const payload = catalogQuery.data ?? cachedPayload;

    const previousVersionRef = useRef<string | null>(null);
    useEffect(() => {
        if (isRestoring || !version || !catalogQuery.data) return;

        const removedCount = pruneSupersededConnectorCatalogQueries(queryClient, CONNECTORS_ORIGIN, version);
        const versionChanged = previousVersionRef.current !== null && previousVersionRef.current !== version;
        previousVersionRef.current = version;

        if (removedCount > 0 || versionChanged) {
            queryClient.removeQueries({ queryKey: ["connectors-semantic-search"] });
            void persistDurableQueries(queryClient);
        }
    }, [catalogQuery.data, isRestoring, queryClient, version]);

    const derived = useMemo(() => deriveConnectorCatalog(payload), [payload]);

    const forceRefresh = useCallback(async () => {
        queryClient.removeQueries({ queryKey: ["connectors-semantic-search"] });
        await queryClient.invalidateQueries({ queryKey: REGISTRY_CACHE_KEY });

        const health = await fetchConnectorCatalogHealth(CONNECTORS_ORIGIN);
        queryClient.setQueryData(CATALOG_VERSION_KEY, health);

        const catalogKey = [...CATALOG_CACHE_PREFIX, health.version] as const;
        const fresh = await queryClient.fetchQuery({
            queryKey: catalogKey,
            queryFn: ({ signal }) => fetchConnectorCatalogIndex(CONNECTORS_ORIGIN, health.version, fetch, {
                cache: "no-store",
                signal,
            }),
            staleTime: 0,
            gcTime: DURABLE_CACHE_MAX_AGE,
            meta: durableQueryMeta,
        });
        if (fresh && Array.isArray(fresh.mcps)) {
            void writeCatalogCache(CONNECTOR_CATALOG_STORAGE_KEY, fresh);
        }
        queryClient.setQueryData(catalogKey, fresh);
        pruneSupersededConnectorCatalogQueries(queryClient, CONNECTORS_ORIGIN, health.version);
        previousVersionRef.current = health.version;
        await persistDurableQueries(queryClient);
    }, [queryClient]);

    const hasData = Boolean(payload);
    const error = hasData ? null : (catalogQuery.error ?? healthQuery.error ?? null);
    const isLoading = enabled && !hasData && (healthQuery.isLoading || catalogQuery.isLoading);

    return {
        version: payload?.version ?? version,
        hasData,
        isLoading,
        isFetching: healthQuery.isFetching || catalogQuery.isFetching,
        error,
        ...derived,
        forceRefresh,
    };
}
const SEARCH_DEBOUNCE_MS = 250;

// =============================================================================
// Hooks
// =============================================================================

function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timeout = window.setTimeout(() => setDebounced(value), delayMs);
        return () => window.clearTimeout(timeout);
    }, [delayMs, value]);

    return debounced;
}

export function useRegistryServers(options: ListServersOptions = {}) {
    const queryClient = useQueryClient();
    const { enabled = true, ...listOptions } = options;
    const snap = useConnectorCatalogSnapshot(enabled);

    const serializedOptions = JSON.stringify(listOptions);
    const queryKey = useMemo(
        () => [...REGISTRY_CACHE_KEY, serializedOptions],
        [serializedOptions],
    );

    const fallbackEnabled = enabled && !snap.hasData && Boolean(snap.error);
    const fallbackQuery = useQuery({
        queryKey,
        queryFn: () => fetchServers(listOptions),
        enabled: fallbackEnabled,
        staleTime: REGISTRY_STALE_TIME,
        gcTime: REGISTRY_GC_TIME,
    });

    const snapshotListData = useMemo<RegistryListResponse | undefined>(() => {
        if (!snap.hasData) return undefined;

        const origins = listOptions.origin
            ? String(listOptions.origin).split(",").map((s) => s.trim()).filter(Boolean)
            : ["mcp", "account", "onchain"];
        const offset = listOptions.offset ?? 0;
        const pageLimit = Math.min(
            Math.max(1, listOptions.limit ?? DEFAULT_REGISTRY_PAGE_SIZE),
            MAX_TOOLS_PAGE_SIZE,
        );

        const filterList = (items: RegistryServer[]) =>
            items.filter((s) => {
                if (listOptions.category && s.category !== listOptions.category) return false;
                if (listOptions.available !== undefined && s.available !== listOptions.available) return false;
                return true;
            });

        const combined: RegistryServer[] = [];
        if (origins.includes("mcp")) {
            combined.push(...filterList(snap.mcpServers));
        }
        if (origins.includes("account")) {
            combined.push(...filterList(snap.accountServers));
        }
        if (origins.includes("onchain")) {
            combined.push(...filterList(snap.onchainServers));
        }
        const merged = combined.slice(offset, offset + pageLimit);

        return {
            total: combined.length,
            offset,
            limit: merged.length,
            servers: merged,
        };
    }, [
        listOptions.available,
        listOptions.category,
        listOptions.limit,
        listOptions.offset,
        listOptions.origin,
        snap.accountServers,
        snap.hasData,
        snap.mcpServers,
        snap.onchainServers,
    ]);

    const forceRefresh = useCallback(async () => {
        await snap.forceRefresh().catch(() => queryClient.invalidateQueries({ queryKey: REGISTRY_CACHE_KEY }));
    }, [queryClient, snap]);

    if (snap.hasData && snapshotListData) {
        return {
            ...fallbackQuery,
            data: snapshotListData,
            isLoading: false,
            isFetching: snap.isFetching,
            error: null,
            forceRefresh,
        };
    }

    return {
        ...fallbackQuery,
        isLoading: snap.isLoading || (fallbackEnabled && fallbackQuery.isLoading),
        error: fallbackEnabled ? fallbackQuery.error : snap.error,
        forceRefresh,
    };
}

export function useRegistrySearch(query: string, limit = DEFAULT_REGISTRY_PAGE_SIZE, options: SearchServersOptions = {}) {
    const trimmedQuery = query.trim();
    const debouncedQuery = useDebouncedValue(trimmedQuery, SEMANTIC_DEBOUNCE_MS);
    const { enabled = true, ...searchOptions } = options;
    const serializedOptions = JSON.stringify(searchOptions);
    const boundedLimit = Math.min(Math.max(1, limit), MAX_SEARCH_RESULTS);
    const snap = useConnectorCatalogSnapshot(enabled);

    const originsKey = useMemo(() => {
        const list = searchOptions.origin
            ? String(searchOptions.origin).split(",").map((v) => v.trim()).filter(Boolean)
            : ["mcp", "account", "onchain"];
        return list.join(",");
    }, [searchOptions.origin]);

    const normalizedDebounced = normalizeConnectorSearchText(debouncedQuery);
    const semanticEnabled = enabled && snap.hasData && normalizedDebounced.replace(/\s+/gu, "").length >= 2;

    const semanticQuery = useQuery<SemanticConnectorHit[], Error>({
        queryKey: [
            "connectors-semantic-search",
            snap.version ?? "unversioned",
            normalizedDebounced,
            boundedLimit,
            originsKey,
            searchOptions.category ?? "",
        ],
        queryFn: async ({ signal }) => {
            const target = new URL(`${CONNECTORS_ORIGIN}/`);
            target.searchParams.set("q", debouncedQuery);
            target.searchParams.set("limit", String(boundedLimit));
            target.searchParams.set("origin", originsKey);
            target.searchParams.set("compact", "1");
            if (searchOptions.category) {
                target.searchParams.set("category", searchOptions.category);
            }
            const response = await fetch(target, {
                method: "GET",
                headers: { Accept: "application/json" },
                signal,
            });
            if (!response.ok) {
                throw new Error(`Semantic connector search failed: ${response.status}`);
            }
            const body = (await response.json()) as { results?: unknown };
            if (!Array.isArray(body.results)) return [];
            return body.results.flatMap((entry): SemanticConnectorHit[] => {
                if (!entry || typeof entry !== "object") return [];
                const row = entry as Record<string, unknown>;
                if (typeof row.bindingId !== "string" || typeof row.origin !== "string" || typeof row.slug !== "string") {
                    return [];
                }
                if (row.origin !== "mcp" && row.origin !== "account" && row.origin !== "onchain") {
                    return [];
                }
                return [{
                    bindingId: row.bindingId,
                    origin: row.origin,
                    slug: row.slug,
                    score: typeof row.score === "number" ? row.score : 0,
                }];
            });
        },
        enabled: semanticEnabled,
        staleTime: METADATA_STALE_TIME,
        gcTime: REGISTRY_SEARCH_GC_TIME,
        retry: 1,
    });

    const fallbackEnabled = enabled && debouncedQuery.length >= 2 && !snap.hasData && Boolean(snap.error);
    const fallbackQuery = useQuery({
        queryKey: ["registry", "search", debouncedQuery, limit, serializedOptions],
        queryFn: () => searchServers(debouncedQuery, limit, searchOptions),
        enabled: fallbackEnabled,
        staleTime: METADATA_STALE_TIME,
        gcTime: REGISTRY_SEARCH_GC_TIME,
    });

    const hybridSearchData = useMemo<RegistrySearchResponse | undefined>(() => {
        if (!snap.hasData) return undefined;
        if (trimmedQuery.length < 2) {
            return { query: trimmedQuery.toLowerCase(), total: 0, servers: [] };
        }
        const allowedOrigins = new Set(originsKey.split(","));
        const pool = snap.allServers.filter((s) => {
            if (!allowedOrigins.has(s.origin)) return false;
            if (searchOptions.category && s.category !== searchOptions.category) return false;
            return true;
        });

        const localRanked = rankCatalogConnectors(pool, trimmedQuery, boundedLimit);
        const semanticAligned = normalizeConnectorSearchText(trimmedQuery) === normalizedDebounced
            ? (semanticQuery.data ?? [])
            : [];
        const merged = mergeSemanticConnectorRanks(pool, localRanked, semanticAligned, boundedLimit);

        return {
            query: trimmedQuery.toLowerCase(),
            total: merged.length,
            servers: merged,
        };
    }, [
        boundedLimit,
        normalizedDebounced,
        originsKey,
        searchOptions.category,
        semanticQuery.data,
        snap.allServers,
        snap.hasData,
        trimmedQuery,
    ]);

    if (snap.hasData && hybridSearchData) {
        const waitingForSemanticOnly =
            trimmedQuery.length >= 2
            && hybridSearchData.servers.length === 0
            && (trimmedQuery !== debouncedQuery || semanticQuery.isFetching);
        return {
            ...fallbackQuery,
            data: hybridSearchData,
            isLoading: waitingForSemanticOnly,
            isFetching: semanticQuery.isFetching,
            error: null,
        };
    }

    return {
        ...fallbackQuery,
        isLoading: (enabled && trimmedQuery.length >= 2 && snap.isLoading) || (fallbackEnabled && fallbackQuery.isLoading),
    };
}

export function useRegistryServer(registryId: string | null, defaultOrigin: CanonicalConnectorOrigin = "mcp") {
    const queryClient = useQueryClient();
    const placeholder = useMemo(() => {
        if (!registryId) return undefined;
        const cached = latestCachedConnectorCatalog(queryClient);
        if (!cached) return undefined;
        const binding = normalizeConnectorBinding(registryId, { defaultOrigin });
        const derived = deriveConnectorCatalog(cached);
        return derived.serverByBindingId.get(binding.registryId.toLowerCase())
            ?? derived.serverByBindingId.get(`${binding.origin}:${binding.slug.toLowerCase()}`);
    }, [defaultOrigin, queryClient, registryId]);

    return useQuery({
        queryKey: ["registry", "server", defaultOrigin, registryId],
        queryFn: () => {
            let cachedAccount: AccountToolkit | undefined;
            if (registryId) {
                const binding = normalizeConnectorBinding(registryId, { defaultOrigin });
                if (binding.origin === "account") {
                    const cached = latestCachedConnectorCatalog(queryClient);
                    cachedAccount = cached?.accounts.find(
                        (tk) => tk.slug.toLowerCase() === binding.slug.toLowerCase(),
                    );
                }
            }
            return fetchServer(registryId!, defaultOrigin, cachedAccount);
        },
        enabled: !!registryId,
        placeholderData: placeholder,
        staleTime: REGISTRY_STALE_TIME,
        gcTime: REGISTRY_GC_TIME,
        meta: durableQueryMeta,
    });
}

export function useRegistryMeta(options: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: ["registry", "meta"],
        queryFn: fetchRegistryMeta,
        enabled: options.enabled ?? true,
        staleTime: METADATA_STALE_TIME,
        gcTime: REGISTRY_GC_TIME,
    });
}

export function useRegistryCategories() {
    return useQuery({
        queryKey: ["registry", "categories"],
        queryFn: fetchCategories,
        staleTime: REGISTRY_STALE_TIME,
        gcTime: REGISTRY_GC_TIME,
    });
}

export function useRegistryTags() {
    return useQuery({
        queryKey: ["registry", "tags"],
        queryFn: fetchTags,
        staleTime: REGISTRY_STALE_TIME,
        gcTime: REGISTRY_GC_TIME,
    });
}

// =============================================================================
// Utility Functions
// =============================================================================

function registryServerTextMatches(server: RegistryServer, query: string): boolean {
    return server.name.toLowerCase().includes(query)
        || server.slug.toLowerCase().includes(query)
        || server.registryId.toLowerCase().includes(query)
        || server.description.toLowerCase().includes(query)
        || server.tags.some((tag) => tag.toLowerCase().includes(query));
}

export function mergeRegistrySearchResults(
    query: string,
    semanticServers: RegistryServer[] | undefined,
    allServers: RegistryServer[],
): RegistryServer[] {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return allServers;
    const byId = new Map<string, RegistryServer>();
    for (const server of semanticServers ?? []) byId.set(server.registryId, server);
    for (const server of allServers) {
        if (registryServerTextMatches(server, normalized)) byId.set(server.registryId, server);
    }
    return [...byId.values()];
}

export const ORIGIN_COLORS: Record<ServerOrigin, string> = {
    mcp: "purple",
    onchain: "green",
};

export function getOriginBadgeVariant(origin: ServerOrigin): "default" | "secondary" | "outline" {
    switch (origin) {
        case "onchain":
            return "secondary";
        default:
            return "outline";
    }
}

export function getOriginLabel(origin: ServerOrigin): string {
    switch (origin) {
        case "mcp":
            return "MCP";
        case "onchain":
            return "Onchain";
        default:
            return origin;
    }
}

export function getOriginIcon(origin: ServerOrigin): "server" | "coins" {
    switch (origin) {
        case "onchain":
            return "coins";
        default:
            return "server";
    }
}

export function isRemoteCapable(server: RegistryServer): boolean {
    return server.attributes.includes("hosting:remote-capable");
}

export function formatToolCount(count: number): string {
    if (count === 0) return "No tools";
    if (count === 1) return "1 tool";
    return `${count} tools`;
}
