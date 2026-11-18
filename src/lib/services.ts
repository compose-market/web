/**
 * Backend Service API Client
 *
 * Talks to:
 * - Runtime unified connectors surface (`sdk.connectors.*`) — MCP tools catalog,
 *   tool execution, and onchain connectors
 * - Connectors worker (`https://connectors.compose.market`) — health probe
 * - API Gateway (`https://api.compose.market`) — via the shared SDK singleton
 */

import type { McpServerSummary } from "@compose-market/sdk";
import { sdk, CONNECTORS_BASE_URL } from "./sdk";
import { normalizeConnectorBinding } from "./connectors";

// Service URLs from environment or defaults
const CONNECTORS_URL = CONNECTORS_BASE_URL;

// =============================================================================
// Types
// =============================================================================

export interface ConnectorInfo {
  id: string;
  label: string;
  description: string;
  available: boolean;
  missingEnv?: string[];
}

export interface ConnectorTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  type: "connectorTool";
  connectorId: string;
  toolName: string;
  inputTemplate: Record<string, unknown>;
  saveAs: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface StepLog {
  stepId: string;
  name: string;
  connectorId: string;
  toolName: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "error";
  args: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  success: boolean;
  context: Record<string, unknown>;
  logs: StepLog[];
}

// =============================================================================
// Connectors broker catalog + execution
// =============================================================================

const DEFAULT_CONNECTOR_LIMIT = 50;

async function fetchToolSummariesPage(limit = DEFAULT_CONNECTOR_LIMIT, offset = 0): Promise<McpServerSummary[]> {
  const data = await sdk.connectors.mcps.list({ limit, offset });
  return data.servers || [];
}

export async function getConnectors(): Promise<ConnectorInfo[]> {
  const servers = await fetchToolSummariesPage();
  return servers.map((s) => ({
    id: s.slug,
    label: s.name,
    description: s.description || "",
    available: s.available ?? true,
  }));
}

export async function getConnectorTools(connectorId: string): Promise<ConnectorTool[]> {
  const data = await sdk.connectors.mcps.get(connectorId);
  return (data.tools || []) as ConnectorTool[];
}

/**
 * Call a tool on a connector directly via `sdk.connectors.mcps.execute`.
 */
export async function callConnectorTool(
  connectorId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; content: unknown; raw: unknown }> {
  const data = await sdk.connectors.mcps.execute(connectorId, toolName, { args }) as Record<string, unknown>;
  const ok = Boolean(data.ok ?? data.success ?? true);
  if (!ok) {
    throw new Error(`Connector call failed: ${String(data.message || data.error || data.kind || "Unknown error")}`);
  }
  return {
    success: ok,
    content: data.content ?? data.result,
    raw: data,
  };
}

// =============================================================================
// Connector execution API
// =============================================================================

export interface ConnectorExecutionResult {
  success: boolean;
  connectorId: string;
  tool: string;
  result?: unknown;
  txHash?: string;
  error?: string;
  content?: unknown;
}

export async function executeGoatConnector(
  connectorId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<ConnectorExecutionResult> {
  const data = await sdk.connectors.onchain.execute(connectorId, tool, { args }) as Record<string, unknown>;
  const rawResult = data.result as Record<string, unknown> | undefined;
  const ok = Boolean(data.ok ?? data.success ?? true);
  return {
    success: ok,
    connectorId,
    tool,
    result: data.result,
    txHash: (typeof rawResult?.txHash === "string" ? rawResult.txHash : undefined)
      || (typeof data.txHash === "string" ? data.txHash : undefined),
    error: ok ? undefined : String(data.message || data.kind || data.error || "Execution failed"),
  };
}

export async function executeSpawnedServer(
  slug: string,
  tool: string,
  args: Record<string, unknown>
): Promise<ConnectorExecutionResult> {
  const data = await sdk.connectors.mcps.execute(slug, tool, { args }) as {
    ok?: boolean;
    success?: boolean;
    result?: unknown;
    kind?: string;
    message?: string;
    error?: unknown;
  };
  const ok = Boolean(data.ok ?? data.success ?? true);
  return {
    success: ok,
    connectorId: slug,
    tool,
    content: data.result,
    error: ok ? undefined : (data.message || data.kind || (typeof data.error === "string" ? data.error : undefined)),
  };
}

export async function fetchToolsConnectorTools(
  serverSlug: string
): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
  const data = await sdk.connectors.mcps.get(serverSlug);
  return data.tools || [];
}

export async function fetchRemoteToolsConnectorTools(serverSlug: string): Promise<ConnectorTool[]> {
  try {
    const data = await sdk.connectors.mcps.get(serverSlug);
    return (data.tools || []) as ConnectorTool[];
  } catch (error) {
    console.warn(`Error fetching tools for ${serverSlug}:`, error);
    return [];
  }
}

/**
 * Execute a registry server tool based on origin.
 */
export async function executeRegistryTool(
  registryId: string,
  origin: string,
  slug: string,
  tool: string,
  args: Record<string, unknown>,
  _connectorId?: string
): Promise<ConnectorExecutionResult> {
  const binding = normalizeConnectorBinding({ registryId, origin, slug }, { defaultOrigin: "mcp" });
  if (binding.origin === "onchain") {
    const connectorId = binding.slug;
    return executeGoatConnector(connectorId, tool, args);
  }
  if (binding.origin === "account") {
    const data = await sdk.connectors.accounts.execute({
      toolkit: binding.slug,
      action: tool,
      params: args,
    });
    return {
      success: Boolean(data.success),
      connectorId: binding.slug,
      tool,
      result: data.data ?? data.result,
      content: data.data ?? data.result,
      error: data.success ? undefined : (data.error || "Account action failed"),
    };
  }
  return executeSpawnedServer(binding.slug, tool, args);
}

// =============================================================================
// Health Checks
// =============================================================================

export interface ServiceHealth {
  status: "ok" | "error";
  service: string;
  version?: string;
  timestamp?: string;
  error?: string;
}

export async function checkConnectorsHealth(): Promise<ServiceHealth> {
  try {
    const res = await fetch(`${CONNECTORS_URL}/`);
    const data = await res.json() as { service?: string; ok?: boolean; timestamp?: string };
    return {
      status: data.ok ? "ok" : "error",
      service: data.service || "connectors",
      timestamp: data.timestamp,
    };
  } catch (error) {
    return { status: "error", service: "connectors", error: String(error) };
  }
}

// Backwards-compat alias used by callers that haven't been updated yet.
export const checkConnectorHealth = checkConnectorsHealth;

export async function checkAllServicesHealth(): Promise<{
  connector: ServiceHealth;
  allHealthy: boolean;
}> {
  const connector = await checkConnectorsHealth();
  return {
    connector,
    allHealthy: connector.status === "ok",
  };
}
