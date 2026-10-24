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
    const origins = options.origin ? String(options.origin).split(",") : ["mcp", "onchain"];
    const requestedLimit = listOptions.limit;
    const offset = listOptions.offset ?? 0;
    const toolsLimit = Math.min(Math.max(1, requestedLimit ?? DEFAULT_REGISTRY_PAGE_SIZE), MAX_TOOLS_PAGE_SIZE);

    const tasks: Array<Promise<{ total: number; servers: RegistryServer[] }>> = [];

    if (origins.includes("mcp")) {
        tasks.push(
            (async () => {
                const params = new URLSearchParams({ limit: String(toolsLimit), offset: String(offset) });
                if (listOptions.category) params.set("category", listOptions.category);
                const res = await fetch(`${BROKER_BASE}/mcps?${params}`);
                if (!res.ok) throw new Error(`Failed to fetch tools catalog: ${res.status}`);
                const data = await res.json() as BrokerToolsListResponse;
                return {
                    total: data.total,
                    servers: data.servers.map(summaryToRegistryServer),
                };
            })(),
        );
    }

    if (origins.includes("onchain")) {
        tasks.push(
            fetch(`${BROKER_BASE}/onchain`).then(async (res) => {
                if (!res.ok) return { total: 0, servers: [] };
                const data = await res.json() as BrokerOnchainResponse;
                return {
                    total: data.connectors.length,
                    servers: data.connectors.map(connectorToRegistryServer),
                };
            }),
        );
    }

    const results = await Promise.all(tasks);

    let merged: RegistryServer[] = [];
    let total = 0;
    for (const r of results) {
        merged = merged.concat(r.servers);
        total += r.total;
    }

    merged = merged.filter((s) => origins.includes(s.origin));

    if (listOptions.category) {
        merged = merged.filter((s) => s.category === listOptions.category);
    }
    if (listOptions.available !== undefined) {
        merged = merged.filter((s) => s.available === listOptions.available);
    }

    return { total: merged.length, offset, limit: merged.length, servers: merged };
}

/**
 * Search the catalog across tools and onchain connectors.
 */
async function searchServers(query: string, limit = DEFAULT_REGISTRY_PAGE_SIZE, options: SearchServersOptions = {}): Promise<RegistrySearchResponse> {
    const normalizedQuery = query.toLowerCase().trim();
    if (normalizedQuery.length < 2) {
        return { query: normalizedQuery, total: 0, servers: [] };
    }
    const { enabled: _enabled, ...searchOptions } = options;
    const origins = searchOptions.origin ? String(searchOptions.origin).split(",") : ["mcp", "onchain"];
    const boundedLimit = Math.min(Math.max(1, limit), MAX_SEARCH_RESULTS);
    const params = new URLSearchParams({ q: query });
    params.set("limit", String(boundedLimit));
    const [toolsData, onchainData] = await Promise.all([
        origins.includes("mcp")
            ? fetch(`${BROKER_BASE}/mcps/search?${params}`).then(async (res) => {
                if (!res.ok) throw new Error(`Failed to search servers: ${res.status}`);
                return await res.json() as { query: string; total: number; servers: BrokerServerSummary[] };
            })
            : Promise.resolve<{ query: string; total: number; servers: BrokerServerSummary[] }>({ query: normalizedQuery, total: 0, servers: [] }),
        origins.includes("onchain")
            ? fetch(`${BROKER_BASE}/onchain`).then(async (res) => {
                if (!res.ok) return null;
                return await res.json() as BrokerOnchainResponse;
            })
            : Promise.resolve<BrokerOnchainResponse | null>(null),
    ]);
    const needle = normalizedQuery;
    let onchainServers: RegistryServer[] = [];
    if (onchainData) {
        onchainServers = onchainData.connectors
            .map(connectorToRegistryServer)
            .filter((server) => (
                server.name.toLowerCase().includes(needle)
                || server.slug.toLowerCase().includes(needle)
                || server.description.toLowerCase().includes(needle)
                || server.tags.some((tag) => tag.toLowerCase().includes(needle))
            ));
    }
    let servers = [
        ...toolsData.servers.map(summaryToRegistryServer),
        ...onchainServers,
    ];

    servers = servers.filter((s) => origins.includes(s.origin));

    if (searchOptions.category) {
        servers = servers.filter((server) => server.category === searchOptions.category);
    }
    servers = servers.slice(0, boundedLimit);
    return {
        query: toolsData.query || normalizedQuery,
        total: servers.length,
        servers,
    };
}

async function fetchServer(registryId: string): Promise<RegistryServer> {
    const binding = normalizeConnectorBinding(registryId, { defaultOrigin: "mcp" });
    if (binding.origin === "onchain") {
        const id = binding.slug;
        const res = await fetch(`${BROKER_BASE}/onchain/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`Failed to fetch onchain connector: ${res.status}`);
        const connector = await res.json() as BrokerOnchainConnector;
        return connectorToRegistryServer(connector);
    }
    const slug = binding.slug;
    const res = await fetch(`${BROKER_BASE}/mcps/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`Failed to fetch server: ${res.status}`);
    const card = await res.json() as BrokerServerCard;
    return cardToRegistryServer(card);
}

async function fetchRegistryMeta(): Promise<RegistryMeta> {
    const [toolsMeta, onchain] = await Promise.all([
        fetch(`${BROKER_BASE}/mcps/meta`).then((r) => r.json() as Promise<{ origins: Record<string, number>; total: number }>),
        fetch(`${BROKER_BASE}/onchain`).then((r) => r.ok ? r.json() as Promise<BrokerOnchainResponse> : Promise.resolve(null)),
    ]);
    return {
        totalServers: toolsMeta.total + (onchain?.connectors.length ?? 0),
        toolsServers: toolsMeta.origins["mcp"] ?? 0,
        onchainServers: onchain?.connectors.length ?? 0,
        loadedAt: new Date().toISOString(),
    };
}

async function fetchCategories(): Promise<string[]> {
    const res = await fetch(`${BROKER_BASE}/mcps/categories`);
    if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`);
    const data = await res.json() as { categories: string[] };
    return data.categories;
}

async function fetchTags(): Promise<string[]> {
    const res = await fetch(`${BROKER_BASE}/mcps/tags`);
    if (!res.ok) throw new Error(`Failed to fetch tags: ${res.status}`);
    const data = await res.json() as { tags: string[] };
    return data.tags;
}

// =============================================================================
// Constants
// =============================================================================

const REGISTRY_STALE_TIME = 6 * 60 * 60 * 1000;
const REGISTRY_GC_TIME = 12 * 60 * 60 * 1000;
const REGISTRY_SEARCH_GC_TIME = 10 * 60 * 1000;
const METADATA_STALE_TIME = 5 * 60 * 1000;
const REGISTRY_CACHE_KEY = ["registry", "servers"] as const;
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

    const serializedOptions = JSON.stringify(listOptions);
    const queryKey = useMemo(
        () => [...REGISTRY_CACHE_KEY, serializedOptions],
        [serializedOptions],
    );

    const query = useQuery({
        queryKey,
        queryFn: () => fetchServers(listOptions),
        enabled,
        staleTime: REGISTRY_STALE_TIME,
        gcTime: REGISTRY_GC_TIME,
    });

    const forceRefresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: REGISTRY_CACHE_KEY });
    }, [queryClient]);

    return {
        ...query,
        forceRefresh,
    };
}

export function useRegistrySearch(query: string, limit = DEFAULT_REGISTRY_PAGE_SIZE, options: SearchServersOptions = {}) {
    const trimmedQuery = query.trim();
    const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);
    const { enabled = true, ...searchOptions } = options;
    const serializedOptions = JSON.stringify(searchOptions);

    return useQuery({
        queryKey: ["registry", "search", debouncedQuery, limit, serializedOptions],
        queryFn: () => searchServers(debouncedQuery, limit, searchOptions),
        enabled: enabled && debouncedQuery.length >= 2,
        staleTime: METADATA_STALE_TIME,
        gcTime: REGISTRY_SEARCH_GC_TIME,
    });
}

export function useRegistryServer(registryId: string | null) {
    return useQuery({
        queryKey: ["registry", "server", registryId],
        queryFn: () => fetchServer(registryId!),
        enabled: !!registryId,
        staleTime: REGISTRY_STALE_TIME,
        gcTime: REGISTRY_GC_TIME,
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
