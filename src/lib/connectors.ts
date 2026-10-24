import type { AccountAuthMode, AccountToolkit } from "@compose-market/sdk";

export type CanonicalConnectorOrigin = "mcp" | "account" | "onchain";
type ConnectorOriginInput = CanonicalConnectorOrigin | "tools" | "goat" | "accounts" | "composio";

export interface ConnectorBindingInput {
  registryId?: string;
  origin?: string;
  slug?: string;
  id?: string;
}

export interface NormalizedConnectorBinding {
  origin: CanonicalConnectorOrigin;
  slug: string;
  registryId: `${CanonicalConnectorOrigin}:${string}`;
  original: string;
}

const ORIGIN_ALIASES: Record<ConnectorOriginInput, CanonicalConnectorOrigin> = {
  tools: "mcp",
  mcp: "mcp",
  account: "account",
  accounts: "account",
  composio: "account",
  onchain: "onchain",
  goat: "onchain",
};

function canonicalOrigin(value: string | undefined, defaultOrigin: CanonicalConnectorOrigin): CanonicalConnectorOrigin {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "tools"
    || normalized === "onchain"
    || normalized === "mcp"
    || normalized === "goat"
    || normalized === "account"
    || normalized === "accounts"
    || normalized === "composio"
  ) {
    return ORIGIN_ALIASES[normalized];
  }
  return defaultOrigin;
}

function splitPrefixed(value: string): { prefix?: ConnectorOriginInput; slug: string } {
  let slug = value.trim();
  let prefix: ConnectorOriginInput | undefined;
  while (true) {
    const match = slug.match(/^(tools|onchain|mcp|goat|account|accounts|composio)([:\-])(.+)$/i);
    if (!match) break;
    prefix = match[1].toLowerCase() as ConnectorOriginInput;
    slug = match[3].trim();
  }
  return { prefix, slug };
}

export function normalizeConnectorBinding(
  input: string | ConnectorBindingInput,
  options: { defaultOrigin?: CanonicalConnectorOrigin } = {},
): NormalizedConnectorBinding {
  const defaultOrigin = options.defaultOrigin ?? "mcp";
  const original = typeof input === "string" ? input : input.registryId || input.slug || input.id || "";
  const explicitOrigin = typeof input === "string" ? undefined : input.origin;
  const { prefix, slug } = splitPrefixed(original);
  const origin = canonicalOrigin(explicitOrigin || prefix, defaultOrigin);
  if (!slug) throw new Error("Connector registryId is required");
  return {
    origin,
    slug,
    registryId: `${origin}:${slug}`,
    original,
  };
}

// =============================================================================
// Versioned Catalog Snapshot & Local Hybrid Search Helpers
// =============================================================================

export interface ConnectorCatalogHealth {
  version: string;
  lastUpdated: string | null;
  counts: {
    total: number;
    mcp: number;
    account: number;
    onchain: number;
  };
}

export interface ConnectorCatalogMcpSummary {
  slug: string;
  origin: "mcp";
  name: string;
  namespace: string;
  description: string;
  tags: string[];
  category: string | null;
  repoUrl?: string | null;
  image?: string | null;
  status: "live" | "credential_gated";
  statefulness: "stateless" | "stateful" | "unknown";
  cardVersion: string;
  inspectedAt: string | null;
  toolCount: number;
  toolNames?: string[];
}

export interface ConnectorCatalogOnchainSummary {
  id: string;
  slug: string;
  origin: "onchain";
  name: string;
  description: string;
  category: string;
  tags: string[];
  toolCount: number;
  requiresApiKey?: boolean;
  apiKeyConfigured?: boolean;
  toolNames: string[];
}

export interface ConnectorCatalogIndexPayload {
  version: string;
  lastUpdated: string;
  counts: {
    total: number;
    mcp: number;
    mcpLive: number;
    mcpGated: number;
    account: number;
    onchain: number;
    accountAuth: {
      oauth: number;
      apiKey: number;
      noAuth: number;
    };
  };
  meta: {
    origins: Record<string, number>;
    statuses: Record<string, number>;
    total: number;
  };
  categories: string[];
  tags: string[];
  accountsConfigured: boolean;
  mcps: ConnectorCatalogMcpSummary[];
  accounts: AccountToolkit[];
  onchain: {
    connectors: ConnectorCatalogOnchainSummary[];
    status: {
      initialized: boolean;
      walletAddress: string | null;
      chain: string;
      chainId: number;
      rpcUrl: string | null;
      error: string | null;
      totalTools: number;
    };
  };
}

export interface SemanticConnectorHit {
  bindingId: string;
  origin: CanonicalConnectorOrigin;
  slug: string;
  score: number;
}

export interface ConnectorRankableItem {
  registryId: string;
  origin: CanonicalConnectorOrigin;
  slug: string;
  name: string;
  description: string;
  category?: string;
  tags: string[];
  status?: "live" | "credential_gated";
  authMode?: AccountAuthMode;
  noAuth?: boolean;
}

export interface RankedCatalogConnector<T extends ConnectorRankableItem = ConnectorRankableItem> {
  item: T;
  score: number;
  source: "local" | "semantic" | "hybrid";
}

export function connectorsOrigin(value: string): string {
  return new URL(value).origin;
}

export function isSupersededConnectorCatalogQueryKey(
  queryKey: readonly unknown[],
  origin: string,
  activeVersion: string,
): boolean {
  return queryKey[0] === "connectors-catalog"
    && queryKey[1] === origin
    && queryKey[2] !== activeVersion;
}

export async function fetchConnectorCatalogHealth(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<ConnectorCatalogHealth> {
  const response = await fetcher(`${origin}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to load connector catalog health: ${response.status}`);
  }
  const body = (await response.json()) as Partial<ConnectorCatalogHealth>;
  if (typeof body.version !== "string" || !body.version || !body.counts) {
    throw new Error("Connector catalog snapshot version unavailable");
  }
  return {
    version: body.version,
    lastUpdated: typeof body.lastUpdated === "string" ? body.lastUpdated : null,
    counts: body.counts,
  };
}

export async function fetchConnectorCatalogIndex(
  origin: string,
  version: string,
  fetcher: typeof fetch = fetch,
  options?: { cache?: RequestCache; signal?: AbortSignal },
): Promise<ConnectorCatalogIndexPayload> {
  const target = new URL(`${origin}/index`);
  target.searchParams.set("version", version);
  const response = await fetcher(target, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: options?.cache ?? "force-cache",
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to load connector catalog index: ${response.status}`);
  }
  const body = (await response.json()) as Partial<ConnectorCatalogIndexPayload>;
  if (body.version !== version || !Array.isArray(body.mcps) || !Array.isArray(body.accounts) || !body.onchain) {
    throw new Error("Invalid connector catalog index response");
  }
  return body as ConnectorCatalogIndexPayload;
}
