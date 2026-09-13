/**
 * IPFS Storage Utility
 * Used for storing agent avatars, agent cards, and Workflow metadata.
 *
 * Pin/unpin goes through the API's server-side pin proxy (/api/ipfs/*) so
 * the Pinata JWT never ships in the web bundle. Reads still use the public
 * gateway directly.
 */

const env = import.meta.env ?? {};
const PINATA_GATEWAY = env.VITE_PINATA_GATEWAY || "jabyl.mypinata.cloud";

type NetworkId = string;

interface PinataUploadResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

interface PinataMetadata {
  name?: string;
  keyvalues?: Record<string, string>;
}

/**
 * Upload a file to Pinata IPFS
 */
export async function uploadFile(
  file: File,
  metadata?: PinataMetadata
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  if (metadata) {
    formData.append("pinataMetadata", JSON.stringify(metadata));
  }

  formData.append(
    "pinataOptions",
    JSON.stringify({ cidVersion: 1 })
  );

  const response = await fetch("/api/ipfs/pin/file", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`IPFS upload failed: ${error}`);
  }

  const result: PinataUploadResponse = await response.json();
  return result.IpfsHash;
}

/**
 * Upload JSON data to Pinata IPFS
 */
export async function uploadJSON<T extends object>(
  data: T,
  metadata?: PinataMetadata
): Promise<string> {
  const response = await fetch("/api/ipfs/pin/json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: metadata,
      pinataOptions: { cidVersion: 1 },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`IPFS JSON upload failed: ${error}`);
  }

  const result: PinataUploadResponse = await response.json();
  return result.IpfsHash;
}

/**
 * Get IPFS URL for a CID
 */
export function getIpfsUrl(cid: string): string {
  return `https://${PINATA_GATEWAY}/ipfs/${cid}`;
}

/**
 * Get IPFS URI (protocol format)
 */
export function getIpfsUri(cid: string): string {
  return `ipfs://${cid}`;
}

/**
 * Fetch JSON from IPFS
 */
export async function fetchFromIpfs<T = unknown>(cid: string): Promise<T> {
  const response = await fetch(getIpfsUrl(cid));
  if (!response.ok) {
    throw new Error(`Failed to fetch from IPFS: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Delete/unpin a file from IPFS by CID
 * Used for cleaning up temporary uploads (e.g., conversation attachments)
 */
export async function unpinFile(cid: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/ipfs/unpin/${encodeURIComponent(cid)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[ipfs] Failed to unpin ${cid}: ${error}`);
      return false;
    }

    console.log(`[ipfs] Successfully unpinned ${cid}`);
    return true;
  } catch (error) {
    console.error(`[ipfs] Error unpinning ${cid}:`, error);
    return false;
  }
}

/**
 * Upload a temporary file for conversation (will be cleaned up later)
 * Returns both the CID and the gateway URL
 */
export async function uploadConversationFile(
  file: File,
  conversationId: string
): Promise<{ cid: string; url: string }> {
  const cid = await uploadFile(file, {
    name: `conversation-${conversationId}-${file.name}`,
    keyvalues: {
      type: "conversation-attachment",
      conversationId,
      originalName: file.name,
      mimeType: file.type,
      uploadedAt: new Date().toISOString(),
    },
  });
  return { cid, url: getIpfsUrl(cid) };
}

/**
 * Clean up all files for a conversation
 */
export async function cleanupConversationFiles(cids: string[]): Promise<void> {
  console.log(`[pinata] Cleaning up ${cids.length} conversation files...`);
  await Promise.all(cids.map(cid => unpinFile(cid)));
}

// =============================================================================
// Agent Card Types (A2A Compatible)
// =============================================================================

export interface AgentCard {
  schemaVersion: string;
  name: string;
  description: string;
  skills: string[];
  x402: true;
  x402Support: boolean;
  image?: string; // Standard NFT metadata field (gateway URL for display and explorer compatibility)
  avatar?: string; // Explorer display field
  avatarUrl?: string;
  dnaHash: string;
  walletAddress: string; // Agent's derived wallet address - SINGLE SOURCE OF TRUTH
  walletTimestamp?: number; // Timestamp used in wallet derivation (backend needs this)
  network: NetworkId;
  model: string;
  target?: string;
  route?: {
    kind: "exact" | "bump" | "missing" | "invalid";
    from: string;
    to?: string;
    checked: string;
    reason?: string;
    source?: string;
    score?: number;
    candidates?: string[];
  };
  framework?: string; // Agent runtime framework
  licensePrice: string; // USDC in smallest unit (6 decimals) - cost to nest into Workflow
  creatorFee?: number;
  licenses: number; // License supply cap (0 = infinite)
  cloneable: boolean;
  knowledge?: string[]; // Filecoin-backed ipfs:// URIs for creator knowledge docs
  protocols: Array<{ name: string; version: string }>;
  connectors?: Array<{
    registryId: string;
    name?: string;
    origin?: string;
    tools?: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      inputSchema?: Record<string, unknown>;
    }>;
  }>;
  createdAt: string;
  creator?: string;
}

/**
 * Upload an agent avatar and return the IPFS CID
 */
export async function uploadAgentAvatar(file: File, agentName: string): Promise<string> {
  return uploadFile(file, {
    name: `${agentName}-avatar`,
    keyvalues: {
      type: "agent-avatar",
      agent: agentName,
    },
  });
}

/**
 * Upload an agent card to IPFS and return the CID
 */
export async function uploadAgentCard(card: AgentCard): Promise<string> {
  return uploadJSON(card, {
    name: `${card.name}-agent-card`,
    keyvalues: {
      type: "agent-card",
      agent: card.name,
      network: card.network,
    },
  });
}

// =============================================================================
// Workflow Metadata Types
// =============================================================================

export interface WorkflowMetadata {
  schemaVersion: string;
  title: string;
  description: string;
  image?: string;  // Standard NFT metadata field (gateway URL for display and explorer compatibility)
  // Identity - single source of truth derived at mint time
  dnaHash: string;
  walletAddress: string; // Derived wallet for x402 payments
  walletTimestamp: number; // Timestamp used in derivation
  network: NetworkId;
  // Nested agentCards - full agent metadata embedded
  agents: AgentCard[];
  // Workflow graph edges (source -> target connections)
  edges?: Array<{
    source: number; // agentId or index
    target: number; // agentId or index
    label?: string; // optional edge description
  }>;
  coordinator?: {
    hasCoordinator: boolean;
    model: string; // Only if hasCoordinator=true
  };
  pricing: {
    totalAgentPrice: string;
  };
  lease?: {
    enabled: boolean;
    durationDays: number;
    creatorPercent: number;
  };
  rfa?: {
    title: string;
    description: string;
    skills: string[];
    offerAmount: string;
  };
  creator: string;
  createdAt: string;
}

/**
 * Upload a Workflow banner and return the IPFS CID
 */
export async function uploadWorkflowBanner(file: File, title: string): Promise<string> {
  return uploadFile(file, {
    name: `${title}-banner`,
    keyvalues: {
      type: "workflow-banner",
      workflow: title,
    },
  });
}

/**
 * Upload Workflow metadata to IPFS and return the CID
 */
export async function uploadWorkflowMetadata(metadata: WorkflowMetadata): Promise<string> {
  return uploadJSON(metadata, {
    name: `${metadata.title}-metadata`,
    keyvalues: {
      type: "workflow-metadata",
      workflow: metadata.title,
    },
  });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate DNA hash from agent parameters
 * Matches contract: keccak256(abi.encodePacked(skills, chain, model))
 */
export function generateDnaHash(skills: string[], chain: number, model: string): string {
  // Use Web Crypto API for keccak256-like hash
  // Note: In production, use a proper keccak256 implementation (e.g., from viem)
  const data = `${skills.sort().join(",")}:${chain}:${model}`;
  return data; // This will be hashed on-chain; frontend stores the source data
}

/**
 * Check if IPFS pinning is available (server-side proxy; always reachable —
 * the API answers 503 if its Pinata JWT is not configured).
 */
export function isPinataConfigured(): boolean {
  return true;
}

/**
 * Convert file to base64 data URL for preview
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
