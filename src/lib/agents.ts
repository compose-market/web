/**
 * Agent Discovery System
 * Generic types and functions for discovering agents across multiple registries
 * 
 * Registries:
 * - Agentverse: Fetch.ai autonomous agent marketplace
 * - GOAT: DeFi tool plugins (60+ plugins)
 * - ElizaOS: Agent framework plugins (200+ plugins)
 */

import { apiUrl } from "./api";

// =============================================================================
// Registry System
// =============================================================================

/**
 * Agent registries/ecosystems that can be queried
 * 
 * Note: Only registries with type="agent" are shown in the Agents tab.
 * GOAT and ElizaOS are PLUGINS, not agents - they appear in the Connectors tab.
 */
export const AGENT_REGISTRIES = {
  agentverse: {
    id: "agentverse",
    name: "Agentverse",
    description: "Fetch.ai autonomous agent marketplace",
    url: "https://agentverse.ai",
    color: "purple",
    type: "agent" as const, // True AI agents
    enabled: true,
  },
  goat: {
    id: "goat",
    name: "GOAT SDK",
    description: "DeFi & Web3 tool plugins (60+ plugins)",
    url: "https://ohmygoat.dev",
    color: "green",
    type: "plugin" as const, // Plugins, not agents - shown in Connectors tab
    enabled: false, // Disabled for agent search - use registry API instead
  },
  eliza: {
    id: "eliza",
    name: "ElizaOS",
    description: "Agent framework plugins (200+ plugins)",
    url: "https://elizaos.ai",
    color: "fuchsia",
    type: "plugin" as const, // Plugins, not agents - shown in Connectors tab
    enabled: false, // Disabled for agent search - use registry API instead
  },
  manowar: {
    id: "manowar",
    name: "ManoWar",
    description: "Compose.Market native agents",
    url: null,
    color: "cyan",
    type: "agent" as const, // True AI agents
    enabled: true, // On-chain ERC8004 agents
  },
} as const;

export type AgentRegistryId = keyof typeof AGENT_REGISTRIES;

// =============================================================================
// Generic Agent Types
// =============================================================================

export interface AgentProtocol {
  name: string;
  version: string;
  digest?: string;
}

/**
 * Warp status for agents
 * - native: Manowar agent (no warp needed, can be used directly)
 * - warped: External agent that has been warped into Manowar
 * - must-warp: External agent that needs to be warped before use
 */
export type WarpStatus = "native" | "warped" | "must-warp";

/**
 * Unified agent type across all registries
 */
export interface Agent {
  // Core identity
  id: string;
  address: string;
  name: string;
  description: string;

  // Registry source
  registry: AgentRegistryId;

  // Optional details
  readme?: string;
  protocols: AgentProtocol[];
  avatarUrl: string | null;

  // Metrics
  totalInteractions: number;
  recentInteractions: number;
  rating: number;

  // Status
  status: "active" | "inactive";
  type: "hosted" | "local";
  featured: boolean;
  verified: boolean;

  // Categorization
  category: string;
  tags: string[];

  // Metadata
  owner: string;
  createdAt: string;
  updatedAt: string;
  externalUrl?: string;

  // Warp status (for compose flow validation)
  warpStatus?: WarpStatus;
  warpedAgentId?: number; // Manowar agent ID if this external agent has been warped
  isWarped?: boolean; // True if this is a warped manowar agent

  // Manowar-specific properties
  onchainAgentId?: number; // Numeric agent ID for on-chain agents
  pricePerRequest?: string; // Price per request in USDC (e.g., "0.01")
}

export interface AgentSearchResponse {
  agents: Agent[];
  total: number;
  offset: number;
  limit: number;
  tags: string[];
  categories: string[];
  registries: AgentRegistryId[];
}

export interface SearchAgentsOptions {
  search?: string;
  category?: string;
  tags?: string[];
  registries?: AgentRegistryId[];
  status?: "active" | "inactive";
  limit?: number;
  offset?: number;
  sort?: "relevancy" | "created-at" | "last-modified" | "interactions";
  direction?: "asc" | "desc";
}

// =============================================================================
// Agentverse-Specific Types (internal)
// =============================================================================

interface AgentverseProtocol {
  name: string;
  version: string;
  digest: string;
}

interface AgentverseAgent {
  address: string;
  prefix: string;
  name: string;
  description: string;
  readme: string;
  protocols: AgentverseProtocol[];
  avatar_href: string | null;
  total_interactions: number;
  recent_interactions: number;
  rating: number;
  status: "active" | "inactive";
  type: "hosted" | "local";
  featured: boolean;
  category: string;
  system_wide_tags: string[];
  geo_location: { name: string } | null;
  handle: string | null;
  domain: string | null;
  metadata: Record<string, unknown> | null;
  last_updated: string;
  created_at: string;
  owner: string;
}

interface AgentverseSearchResponse {
  agents: AgentverseAgent[];
  total: number;
  offset: number;
  limit: number;
  tags: string[];
  categories: string[];
}

// =============================================================================
// Adapter Functions
// =============================================================================

/**
 * Tags to filter out (not useful for users)
 */
const FILTERED_TAGS = new Set([
  "fetch-ai",
  "fetchai",
  "hosted",
  "local",
  "system",
  "internal",
]);

/**
 * Normalize tags for better display
 */
function normalizeTags(tags: string[]): string[] {
  return tags
    .filter(t => !FILTERED_TAGS.has(t.toLowerCase()))
    .map(t => t.toLowerCase().replace(/[_-]/g, " "))
    .filter((t, i, arr) => arr.indexOf(t) === i) // dedupe
    .slice(0, 5); // limit to 5 tags
}

/**
 * Extract capability tags from description and protocols
 */
function extractCapabilityTags(description: string, protocols: AgentProtocol[]): string[] {
  const tags = new Set<string>();
  const descLower = description.toLowerCase();

  // Capability keywords
  const capabilities: Record<string, string[]> = {
    "defi": ["swap", "trade", "liquidity", "yield", "lending", "borrow", "stake"],
    "trading": ["trade", "exchange", "buy", "sell", "order", "market"],
    "nft": ["nft", "mint", "collection", "artwork", "token"],
    "social": ["twitter", "discord", "telegram", "post", "message", "chat"],
    "ai": ["gpt", "llm", "model", "inference", "generate", "analyze"],
    "data": ["data", "api", "fetch", "query", "analytics", "price"],
    "automation": ["automate", "schedule", "trigger", "workflow", "bot"],
    "payments": ["pay", "transfer", "send", "receive", "wallet"],
  };

  for (const [tag, keywords] of Object.entries(capabilities)) {
    if (keywords.some(kw => descLower.includes(kw))) {
      tags.add(tag);
    }
  }

  // Check protocols
  protocols.forEach(p => {
    const pName = p.name.toLowerCase();
    if (pName.includes("swap") || pName.includes("trade")) tags.add("trading");
    if (pName.includes("nft")) tags.add("nft");
    if (pName.includes("chat") || pName.includes("message")) tags.add("social");
  });

  return Array.from(tags);
}

/**
 * Convert Agentverse agent to unified Agent type
 */
function agentverseToAgent(av: AgentverseAgent): Agent {
  const protocols = av.protocols?.map(p => ({
    name: p.name,
    version: p.version,
    digest: p.digest,
  })) || [];

  // Get normalized tags + capability tags
  const baseTags = normalizeTags(av.system_wide_tags || []);
  const capabilityTags = extractCapabilityTags(av.description || av.readme || "", protocols);
  const allTags = Array.from(new Set([...baseTags, ...capabilityTags]));

  return {
    id: av.address,
    address: av.address,
    name: av.name,
    description: av.description || getReadmeExcerpt(av.readme),
    registry: "agentverse",
    readme: av.readme,
    protocols,
    avatarUrl: av.avatar_href,
    totalInteractions: av.total_interactions,
    recentInteractions: av.recent_interactions,
    rating: av.rating,
    status: av.status,
    type: av.type,
    featured: av.featured,
    verified: av.system_wide_tags?.includes("verified") || false,
    category: av.category || deriveCategory(allTags),
    tags: allTags,
    owner: av.owner,
    createdAt: av.created_at,
    updatedAt: av.last_updated,
    externalUrl: `https://agentverse.ai/agents/details/${av.address}/profile`,
  };
}

/**
 * Registry server record (from connector registry)
 */
interface RegistryServer {
  registryId: string;
  origin: string;
  name: string;
  namespace: string;
  slug: string;
  description: string;
  category?: string;
  tags: string[];
  toolCount: number;
  tools?: Array<{ name: string; description?: string }>;
}

/**
 * Convert registry server to Agent type
 */
function registryServerToAgent(server: RegistryServer, registry: AgentRegistryId): Agent {
  const protocols = server.tools?.map(t => ({
    name: t.name,
    version: "1.0.0",
  })) || [];

  const capabilityTags = extractCapabilityTags(server.description, protocols);
  const allTags = Array.from(new Set([...server.tags, ...capabilityTags])).slice(0, 8);

  return {
    id: server.registryId,
    address: server.registryId,
    name: server.name,
    description: server.description,
    registry,
    readme: "",
    protocols,
    avatarUrl: null,
    totalInteractions: 0,
    recentInteractions: 0,
    rating: 4.5, // Default rating for plugins
    status: "active",
    type: "hosted",
    featured: false,
    verified: true, // GOAT/ElizaOS plugins are verified
    category: server.category || deriveCategory(allTags),
    tags: allTags,
    owner: server.namespace,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Derive category from tags
 */
function deriveCategory(tags: string[]): string {
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  if (tagSet.has("defi") || tagSet.has("trading") || tagSet.has("swap")) return "DeFi";
  if (tagSet.has("nft")) return "NFT";
  if (tagSet.has("social") || tagSet.has("discord") || tagSet.has("twitter")) return "Social";
  if (tagSet.has("ai") || tagSet.has("llm")) return "AI";
  if (tagSet.has("data") || tagSet.has("analytics")) return "Data";
  if (tagSet.has("automation")) return "Automation";

  return "Utility";
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Search Agentverse registry
 */
async function searchAgentverse(
  options: SearchAgentsOptions
): Promise<{ agents: Agent[]; total: number; tags: string[]; categories: string[] }> {
  const params = new URLSearchParams();

  if (options.search) params.set("search", options.search);
  if (options.category) params.set("category", options.category);
  if (options.tags?.length) params.set("tags", options.tags.join(","));
  if (options.status) params.set("status", options.status);
  if (options.limit) params.set("limit", options.limit.toString());
  if (options.offset) params.set("offset", options.offset.toString());
  if (options.sort) params.set("sort", options.sort);
  if (options.direction) params.set("direction", options.direction);

  const response = await fetch(apiUrl(`/api/agentverse/agents?${params}`));

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Failed to fetch agents: ${response.status}`);
  }

  const data: AgentverseSearchResponse = await response.json();

  return {
    agents: data.agents.map(agentverseToAgent),
    total: data.total,
    tags: data.tags,
    categories: data.categories,
  };
}

/**
 * Get connector registry base URL
 */
function getConnectorBaseUrl(): string {
  const connectorUrl = import.meta.env.VITE_CONNECTOR_URL;
  if (connectorUrl) {
    return connectorUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return "https://services.compose.market/connector";
  }

  return "http://localhost:4001";
}

/**
 * Search GOAT plugins from connector registry
 */
async function searchGoat(
  options: SearchAgentsOptions
): Promise<{ agents: Agent[]; total: number; tags: string[]; categories: string[] }> {
  try {
    const params = new URLSearchParams({
      origin: "goat",
      limit: String(options.limit || 50),
      offset: String(options.offset || 0),
    });

    const response = await fetch(`${getConnectorBaseUrl()}/registry/servers?${params}`);

    if (!response.ok) {
      console.warn("Failed to fetch GOAT plugins:", response.status);
      return { agents: [], total: 0, tags: [], categories: [] };
    }

    const data = await response.json();
    const servers: RegistryServer[] = data.servers || [];

    // Filter by search if provided
    let filtered = servers;
    if (options.search) {
      const q = options.search.toLowerCase();
      filtered = servers.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Filter by tags
    if (options.tags?.length) {
      filtered = filtered.filter(s =>
        options.tags!.some(t => s.tags.includes(t.toLowerCase()))
      );
    }

    const agents = filtered.map(s => registryServerToAgent(s, "goat"));
    const allTags = new Set<string>();
    const allCategories = new Set<string>();

    agents.forEach(a => {
      a.tags.forEach(t => allTags.add(t));
      if (a.category) allCategories.add(a.category);
    });

    return {
      agents,
      total: data.total || agents.length,
      tags: Array.from(allTags).sort(),
      categories: Array.from(allCategories).sort(),
    };
  } catch (err) {
    console.warn("Error fetching GOAT plugins:", err);
    return { agents: [], total: 0, tags: [], categories: [] };
  }
}

/**
 * Search ElizaOS plugins from connector registry
 */
async function searchEliza(
  options: SearchAgentsOptions
): Promise<{ agents: Agent[]; total: number; tags: string[]; categories: string[] }> {
  try {
    const params = new URLSearchParams({
      origin: "eliza",
      limit: String(options.limit || 50),
      offset: String(options.offset || 0),
    });

    const response = await fetch(`${getConnectorBaseUrl()}/registry/servers?${params}`);

    if (!response.ok) {
      console.warn("Failed to fetch ElizaOS plugins:", response.status);
      return { agents: [], total: 0, tags: [], categories: [] };
    }

    const data = await response.json();
    const servers: RegistryServer[] = data.servers || [];

    // Filter by search if provided
    let filtered = servers;
    if (options.search) {
      const q = options.search.toLowerCase();
      filtered = servers.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Filter by tags
    if (options.tags?.length) {
      filtered = filtered.filter(s =>
        options.tags!.some(t => s.tags.includes(t.toLowerCase()))
      );
    }

    const agents = filtered.map(s => registryServerToAgent(s, "eliza"));
    const allTags = new Set<string>();
    const allCategories = new Set<string>();

    agents.forEach(a => {
      a.tags.forEach(t => allTags.add(t));
      if (a.category) allCategories.add(a.category);
    });

    return {
      agents,
      total: data.total || agents.length,
      tags: Array.from(allTags).sort(),
      categories: Array.from(allCategories).sort(),
    };
  } catch (err) {
    console.warn("Error fetching ElizaOS plugins:", err);
    return { agents: [], total: 0, tags: [], categories: [] };
  }
}

/**
 * Search ManoWar registry (placeholder for future)
 */
async function searchManowar(
  _options: SearchAgentsOptions
): Promise<{ agents: Agent[]; total: number; tags: string[]; categories: string[] }> {
  // TODO: Implement when ManoWar registry is ready
  return { agents: [], total: 0, tags: [], categories: [] };
}

/**
 * Unified search across all enabled registries
 */
export async function searchAgents(
  options: SearchAgentsOptions = {}
): Promise<AgentSearchResponse> {
  const registries = options.registries?.length
    ? options.registries.filter(r => AGENT_REGISTRIES[r]?.enabled)
    : (Object.keys(AGENT_REGISTRIES) as AgentRegistryId[]).filter(r => AGENT_REGISTRIES[r].enabled);

  // Fetch from all selected registries in parallel
  const results = await Promise.allSettled(
    registries.map(async (registry) => {
      switch (registry) {
        case "agentverse":
          return searchAgentverse(options);
        case "goat":
          return searchGoat(options);
        case "eliza":
          return searchEliza(options);
        case "manowar":
          return searchManowar(options);
        default:
          return { agents: [], total: 0, tags: [], categories: [] };
      }
    })
  );

  // Merge results
  const allAgents: Agent[] = [];
  const allTags = new Set<string>();
  const allCategories = new Set<string>();
  let totalCount = 0;

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      allAgents.push(...result.value.agents);
      result.value.tags.forEach(t => allTags.add(t));
      result.value.categories.forEach(c => allCategories.add(c));
      totalCount += result.value.total;
    } else {
      console.warn(`Failed to fetch from ${registries[i]}:`, result.reason);
    }
  });

  // Sort merged results
  if (options.sort === "interactions") {
    allAgents.sort((a, b) =>
      options.direction === "asc"
        ? a.totalInteractions - b.totalInteractions
        : b.totalInteractions - a.totalInteractions
    );
  } else if (options.sort === "created-at") {
    allAgents.sort((a, b) =>
      options.direction === "asc"
        ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } else if (options.sort === "relevancy" && options.search) {
    // Score-based relevancy sort
    const q = options.search.toLowerCase();
    allAgents.sort((a, b) => {
      const scoreA = getRelevancyScore(a, q);
      const scoreB = getRelevancyScore(b, q);
      return options.direction === "asc" ? scoreA - scoreB : scoreB - scoreA;
    });
  }

  return {
    agents: allAgents,
    total: totalCount,
    offset: options.offset || 0,
    limit: options.limit || 30,
    tags: Array.from(allTags).sort(),
    categories: Array.from(allCategories).sort(),
    registries,
  };
}

/**
 * Calculate relevancy score for search ranking
 */
function getRelevancyScore(agent: Agent, query: string): number {
  let score = 0;
  const nameLower = agent.name.toLowerCase();
  const descLower = agent.description.toLowerCase();

  // Exact name match
  if (nameLower === query) score += 100;
  // Name contains query
  else if (nameLower.includes(query)) score += 50;

  // Description contains query
  if (descLower.includes(query)) score += 20;

  // Tag match
  if (agent.tags.some(t => t.toLowerCase().includes(query))) score += 15;

  // Category match
  if (agent.category?.toLowerCase().includes(query)) score += 10;

  // Verified boost
  if (agent.verified) score += 5;

  // Interaction boost
  score += Math.min(agent.totalInteractions / 1000, 10);

  return score;
}

/**
 * Get a single agent by address
 */
export async function getAgent(address: string): Promise<Agent> {
  // For now, only Agentverse is implemented
  const response = await fetch(apiUrl(`/api/agentverse/agents/${encodeURIComponent(address)}`));

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Failed to fetch agent: ${response.status}`);
  }

  const data: AgentverseAgent = await response.json();
  return agentverseToAgent(data);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format interaction count for display
 */
export function formatInteractions(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

/**
 * Get a short excerpt from README
 */
export function getReadmeExcerpt(readme: string, maxLength = 150): string {
  if (!readme) return "";

  // Remove markdown badges and images
  let clean = readme
    .replace(/!\[.*?\]\(.*?\)/g, "") // Remove images
    .replace(/\[.*?\]\(.*?\)/g, "") // Remove links
    .replace(/```[\s\S]*?```/g, "") // Remove code blocks
    .replace(/#{1,6}\s+/g, "") // Remove headers
    .replace(/\*{1,2}(.*?)\*{1,2}/g, "$1") // Remove bold/italic
    .replace(/\n{2,}/g, " ") // Collapse newlines
    .trim();

  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength).trim() + "...";
}

/**
 * Get display color for rating
 */
export function getRatingColor(rating: number): string {
  if (rating >= 4) return "text-green-400";
  if (rating >= 3) return "text-yellow-400";
  if (rating >= 2) return "text-orange-400";
  return "text-red-400";
}

/**
 * Common tags for filtering (capability-based)
 */
export const COMMON_TAGS = [
  "defi",
  "trading",
  "nft",
  "social",
  "ai",
  "data",
  "automation",
  "payments",
  "discord",
  "twitter",
  "telegram",
  "ethereum",
  "solana",
] as const;

/**
 * Check if agent has a specific capability based on protocols
 */
export function hasProtocol(agent: Agent, protocolName: string): boolean {
  return agent.protocols?.some(p =>
    p.name.toLowerCase().includes(protocolName.toLowerCase())
  ) ?? false;
}

/**
 * Get registry display info
 */
export function getRegistryInfo(registryId: AgentRegistryId) {
  return AGENT_REGISTRIES[registryId];
}

/**
 * Get all enabled registries
 */
export function getEnabledRegistries(): AgentRegistryId[] {
  return (Object.keys(AGENT_REGISTRIES) as AgentRegistryId[])
    .filter(id => AGENT_REGISTRIES[id].enabled);
}

