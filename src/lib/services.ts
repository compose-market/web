/**
 * Backend Service API Client
 *
 * Provides typed functions for interacting with:
 * - Connector Hub (https://services.compose.market/connector)
 * - Sandbox Service (https://services.compose.market/sandbox)
 * - Exporter Service (https://services.compose.market/exporter)
 * - API Gateway (https://api.compose.market) — via the shared SDK singleton
 */

import { sdk } from "./sdk";

// Service URLs from environment or defaults
const CONNECTOR_URL = import.meta.env.VITE_CONNECTOR_URL || "https://services.compose.market/connector";
const EXPORTER_URL = import.meta.env.VITE_EXPORTER_URL || "https://services.compose.market/exporter";
// API Gateway URL for x402 payment-gated routes
const API_BASE = sdk.baseUrl;

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

export interface ExportOptions {
  workflow: WorkflowDefinition;
  projectName?: string;
  description?: string;
  author?: string;
}

// =============================================================================
// Connector Hub API
// =============================================================================

/**
 * Fetch list of available connectors
 */
export async function getConnectors(): Promise<ConnectorInfo[]> {
  const res = await fetch(`${CONNECTOR_URL}/connectors`);
  if (!res.ok) {
    throw new Error(`Failed to fetch connectors: ${res.status}`);
  }
  const data = await res.json();
  return data.connectors;
}

/**
 * Fetch tools for a specific connector
 */
export async function getConnectorTools(connectorId: string): Promise<ConnectorTool[]> {
  const res = await fetch(`${CONNECTOR_URL}/connectors/${encodeURIComponent(connectorId)}/tools`);
  if (!res.ok) {
    throw new Error(`Failed to fetch tools for ${connectorId}: ${res.status}`);
  }
  const data = await res.json();
  return data.tools;
}

/**
 * Call a tool on a connector directly
 */
export async function callConnectorTool(
  connectorId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; content: unknown; raw: unknown }> {
  const res = await fetch(`${CONNECTOR_URL}/connectors/${encodeURIComponent(connectorId)}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolName, args }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Connector call failed: ${text}`);
  }

  return res.json();
}

// =============================================================================
// Plugin Execution API (GOAT, Eliza, MCP)
// =============================================================================

export interface PluginExecutionResult {
  success: boolean;
  pluginId: string;
  tool: string;
  result?: unknown;
  txHash?: string;
  error?: string;
  content?: unknown;
}

/**
 * Execute a GOAT plugin tool
 */
export async function executeGoatPlugin(
  pluginId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<PluginExecutionResult> {
  const res = await fetch(`${CONNECTOR_URL}/plugins/${encodeURIComponent(pluginId)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });

  return res.json();
}

/**
 * Execute a spawned MCP server tool
 */
export async function executeSpawnedServer(
  slug: string,
  tool: string,
  args: Record<string, unknown>
): Promise<PluginExecutionResult> {
  const res = await fetch(`${CONNECTOR_URL}/mcp/servers/${encodeURIComponent(slug)}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });

  const data = await res.json();
  return {
    success: data.success ?? !data.error,
    pluginId: slug,
    tool,
    content: data.content,
    error: data.error,
  };
}

/**
 * Fetch tools from a spawned MCP server (on-demand)
 */
export async function fetchMcpServerTools(
  serverSlug: string
): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
  const res = await fetch(`${CONNECTOR_URL}/mcp/servers/${encodeURIComponent(serverSlug)}/tools`);

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Failed to fetch tools: ${res.status}`);
  }

  const data = await res.json();
  return data.tools || [];
}

/**
 * Execute a spawned MCP server tool
 * Routes through api/ (API_BASE) for x402 payment handling
 */
export async function executeMcpServer(
  serverSlug: string,
  tool: string,
  args: Record<string, unknown>
): Promise<PluginExecutionResult> {
  // Route through api/ for x402 payment
  const res = await fetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(serverSlug)}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });

  const data = await res.json();
  return {
    success: data.success ?? !data.error,
    pluginId: serverSlug,
    tool,
    content: data.content,
    error: data.error || data.message,
  };
}

/**
 * Fetch tools from an MCP server (spawns on-demand via MCP spawner)
 */
export async function fetchRemoteMcpServerTools(serverSlug: string): Promise<ConnectorTool[]> {
  try {
    // Route through connector which proxies to MCP spawner
    const res = await fetch(`${CONNECTOR_URL}/mcp/servers/${encodeURIComponent(serverSlug)}/tools`);
    if (!res.ok) {
      console.warn(`Failed to fetch MCP tools for ${serverSlug}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.tools || [];
  } catch (error) {
    console.warn(`Error fetching MCP tools for ${serverSlug}:`, error);
    return [];
  }
}

// Alias for backwards compatibility
export const fetchMCPServerTools = fetchRemoteMcpServerTools;

/**
 * Execute an MCP server tool (spawns on-demand via MCP spawner)
 * Routes through api/ (API_BASE) for x402 payment handling
 */
export async function executeRemoteMcpServer(
  serverSlug: string,
  tool: string,
  args: Record<string, unknown>
): Promise<PluginExecutionResult> {
  // Route through api/ for x402 payment
  const res = await fetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(serverSlug)}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });

  const data = await res.json();
  return {
    success: data.success ?? !data.error,
    pluginId: serverSlug,
    tool,
    content: data.content,
    error: data.error || data.message,
  };
}

/**
 * Execute a registry server tool based on origin
 */
export async function executeRegistryTool(
  registryId: string,
  origin: string,
  slug: string,
  tool: string,
  args: Record<string, unknown>,
  connectorId?: string
): Promise<PluginExecutionResult> {
  // Route to appropriate endpoint based on origin
  if (origin === "goat") {
    // Extract plugin ID from registry ID (goat:goat-erc20 -> goat-erc20)
    const pluginId = registryId.replace("goat:", "");
    return executeGoatPlugin(pluginId, tool, args);
  }

  if (origin === "mcp" || origin === "mcp") {
    // Use remote SSE proxy endpoint for MCP servers
    return executeRemoteMcpServer(slug, tool, args);
  }

  if (origin === "internal") {
    // Internal connectors use the connector ID from entryPoint if available
    const actualConnectorId = connectorId || registryId.replace("internal:compose-", "");
    const result = await callConnectorTool(actualConnectorId, tool, args);
    return {
      success: result.success,
      pluginId: actualConnectorId,
      tool,
      content: result.content,
    };
  }

  // Default: try spawned MCP server (verified npm packages only)
  return executeSpawnedServer(slug, tool, args);
}

// =============================================================================
// Sandbox API
// =============================================================================

/**
 * Execute a workflow in the sandbox
 */
export async function runWorkflow(
  workflow: WorkflowDefinition,
  input: Record<string, unknown> = {}
): Promise<WorkflowRunResult> {
  const res = await fetch(`sandbox/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow, input }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Workflow execution failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Validate a workflow without executing
 */
export async function validateWorkflow(
  workflow: WorkflowDefinition
): Promise<{ valid: boolean; errors: string[] }> {
  const res = await fetch(`sandbox/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Validation failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch connectors via sandbox proxy
 */
export async function getSandboxConnectors(): Promise<ConnectorInfo[]> {
  const res = await fetch(`sandbox/connectors`);
  if (!res.ok) {
    throw new Error(`Failed to fetch connectors: ${res.status}`);
  }
  const data = await res.json();
  return data.connectors;
}

// =============================================================================
// Exporter API
// =============================================================================

/**
 * Export a workflow as a downloadable zip file
 */
export async function exportWorkflow(options: ExportOptions): Promise<Blob> {
  const res = await fetch(`${EXPORTER_URL}/export/workflow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Export failed: ${res.status}`);
  }

  return res.blob();
}

/**
 * Export and automatically trigger download
 */
export async function downloadWorkflow(options: ExportOptions): Promise<void> {
  const blob = await exportWorkflow(options);

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${options.projectName || options.workflow.name || "workflow"}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

export async function checkConnectorHealth(): Promise<ServiceHealth> {
  try {
    const res = await fetch(`${CONNECTOR_URL}/health`);
    return res.json();
  } catch (error) {
    return { status: "error", service: "connector", error: String(error) };
  }
}

export async function checkSandboxHealth(): Promise<ServiceHealth> {
  try {
    const res = await fetch(`sandbox/health`);
    return res.json();
  } catch (error) {
    return { status: "error", service: "sandbox", error: String(error) };
  }
}

export async function checkExporterHealth(): Promise<ServiceHealth> {
  try {
    const res = await fetch(`${EXPORTER_URL}/health`);
    return res.json();
  } catch (error) {
    return { status: "error", service: "exporter", error: String(error) };
  }
}

export async function checkAllServicesHealth(): Promise<{
  connector: ServiceHealth;
  sandbox: ServiceHealth;
  exporter: ServiceHealth;
  allHealthy: boolean;
}> {
  const [connector, sandbox, exporter] = await Promise.all([
    checkConnectorHealth(),
    checkSandboxHealth(),
    checkExporterHealth(),
  ]);

  return {
    connector,
    sandbox,
    exporter,
    allHealthy:
      connector.status === "ok" &&
      sandbox.status === "ok" &&
      exporter.status === "ok",
  };
}

