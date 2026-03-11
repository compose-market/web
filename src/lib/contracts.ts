/**
 * Manowar Protocol Contract Configuration
 * Multi-chain support with Avalanche Fuji as default
 * 
 * Contract addresses are defined in chains.ts (single source of truth)
 */

import { getContract, prepareContractCall } from "thirdweb";
import {
  thirdwebClient,
  paymentChain,
  CHAIN_IDS,
  CHAIN_OBJECTS,
  CONTRACT_ADDRESSES,
  getContractAddress,
  getContractAddressForChain,
} from "./chains";
import { keccak256, encodePacked, type Address } from "viem";

// Re-export from chains.ts for backwards compatibility
export { CONTRACT_ADDRESSES, getContractAddress, getContractAddressForChain };

// =============================================================================
// ABIs (Minimal - only functions we need on frontend)
// =============================================================================

export const AgentFactoryABI = [
  // Read functions
  {
    name: "getAgentData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{
      name: "data",
      type: "tuple",
      components: [
        { name: "dnaHash", type: "bytes32" },
        { name: "licenses", type: "uint256" },
        { name: "licensesMinted", type: "uint256" },
        { name: "licensePrice", type: "uint256" },
        { name: "creator", type: "address" },
        { name: "cloneable", type: "bool" },
        { name: "isClone", type: "bool" },
        { name: "parentAgentId", type: "uint256" },
        { name: "agentCardUri", type: "string" },
      ],
    }],
  },
  {
    name: "totalAgents",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "total", type: "uint256" }],
  },
  {
    name: "hasAvailableLicenses",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "available", type: "bool" }],
  },
  {
    name: "getDnaHash",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "dnaHash", type: "bytes32" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "uri", type: "string" }],
  },
  {
    name: "isLicensedTo",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "workflowContract", type: "address" },
      { name: "workflowId", type: "uint256" },
    ],
    outputs: [{ name: "licensed", type: "bool" }],
  },
  {
    name: "getLicenseRecords",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{
      name: "records",
      type: "tuple[]",
      components: [
        { name: "workflowContract", type: "address" },
        { name: "workflowId", type: "uint256" },
        { name: "licensedAt", type: "uint256" },
      ],
    }],
  },
  {
    name: "agentExists",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "exists", type: "bool" }],
  },
  // Write functions
  {
    name: "mintAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dnaHash", type: "bytes32" },
      { name: "licenses", type: "uint256" },
      { name: "licensePrice", type: "uint256" },
      { name: "cloneable", type: "bool" },
      { name: "agentCardUri", type: "string" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "updatePrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newPrice", type: "uint256" },
    ],
    outputs: [],
  },
  // Events
  {
    name: "AgentMinted",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "dnaHash", type: "bytes32", indexed: false },
      { name: "licenses", type: "uint256", indexed: false },
      { name: "licensePrice", type: "uint256", indexed: false },
      { name: "cloneable", type: "bool", indexed: false },
    ],
  },
  {
    name: "AgentLicensed",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "workflowContract", type: "address", indexed: true },
      { name: "workflowId", type: "uint256", indexed: true },
      { name: "licenseNumber", type: "uint256", indexed: false },
    ],
  },
] as const;

export const WorkflowABI = [
  // Read functions
  {
    name: "getWorkflowData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [{
      name: "data",
      type: "tuple",
      components: [
        { name: "title", type: "string" },
        { name: "description", type: "string" },
        { name: "banner", type: "string" },
        { name: "workflowCardUri", type: "string" },
        { name: "totalPrice", type: "uint256" },
        { name: "units", type: "uint256" },
        { name: "unitsMinted", type: "uint256" },
        { name: "creator", type: "address" },
        { name: "leaseEnabled", type: "bool" },
        { name: "leaseDuration", type: "uint256" },
        { name: "leasePercent", type: "uint8" },
        { name: "hasCoordinator", type: "bool" },
        { name: "coordinatorModel", type: "string" },
        { name: "hasActiveRfa", type: "bool" },
        { name: "rfaId", type: "uint256" },
      ],
    }],
  },
  {
    name: "totalWorkflows",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "total", type: "uint256" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "uri", type: "string" }],
  },
  {
    name: "getAgents",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [{ name: "agentIds", type: "uint256[]" }],
  },
  {
    name: "getAgentCount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [{ name: "count", type: "uint256" }],
  },
  {
    name: "isComplete",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [{ name: "complete", type: "bool" }],
  },
  {
    name: "getCompleteWorkflows",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "workflowIds", type: "uint256[]" }],
  },
  {
    name: "getWorkflowsWithRFA",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "workflowIds", type: "uint256[]" }],
  },
  {
    name: "getWorkflowsByCreator",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "workflowIds", type: "uint256[]" }],
  },
  {
    name: "calculateTotalPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [{ name: "total", type: "uint256" }],
  },
  // Write functions
  {
    name: "mintWorkflow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "title", type: "string" },
          { name: "description", type: "string" },
          { name: "banner", type: "string" },
          { name: "workflowCardUri", type: "string" },
          { name: "units", type: "uint256" },
          { name: "leaseEnabled", type: "bool" },
          { name: "leaseDuration", type: "uint256" },
          { name: "leasePercent", type: "uint8" },
          { name: "hasCoordinator", type: "bool" },
          { name: "coordinatorModel", type: "string" },
        ],
      },
      { name: "agentIds", type: "uint256[]" },
    ],
    outputs: [{ name: "workflowId", type: "uint256" }],
  },
  {
    name: "addAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "agentId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setCoordinator",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "hasCoordinator", type: "bool" },
      { name: "model", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "updateLeaseSettings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "enabled", type: "bool" },
      { name: "duration", type: "uint256" },
      { name: "percent", type: "uint8" },
    ],
    outputs: [],
  },
  // Events
  {
    name: "WorkflowMinted",
    type: "event",
    inputs: [
      { name: "workflowId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "title", type: "string", indexed: false },
      { name: "x402Price", type: "uint256", indexed: false },
      { name: "units", type: "uint256", indexed: false },
    ],
  },
] as const;

export const CloneABI = [
  {
    name: "cloneAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "originalAgentId", type: "uint256" },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "licensePrice", type: "uint256" },
          { name: "model", type: "string" },
          { name: "licenses", type: "uint256" },
        ],
      },
      { name: "newAgentCardUri", type: "string" },
    ],
    outputs: [{ name: "clonedAgentId", type: "uint256" }],
  },
  {
    name: "canClone",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "canClone", type: "bool" }],
  },
  {
    name: "getClonesOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "originalAgentId", type: "uint256" }],
    outputs: [{ name: "cloneIds", type: "uint256[]" }],
  },
] as const;

export const WarpABI = [
  {
    name: "warpAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "originalAgentHash", type: "bytes32" },
      { name: "originalCreator", type: "address" },
      { name: "licenses", type: "uint256" },
      { name: "licensePrice", type: "uint256" },
      { name: "agentCardUri", type: "string" },
    ],
    outputs: [{ name: "warpedAgentId", type: "uint256" }],
  },
  {
    name: "isWarped",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "isWarped", type: "bool" }],
  },
  {
    name: "getWarpedData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "warpedAgentId", type: "uint256" }],
    outputs: [{
      name: "data",
      type: "tuple",
      components: [
        { name: "originalCreator", type: "address" },
        { name: "warper", type: "address" },
        { name: "originalAgentHash", type: "bytes32" },
        { name: "royaltyExpiryDate", type: "uint256" },
        { name: "royaltiesClaimed", type: "bool" },
        { name: "accumulatedRoyalties", type: "uint256" },
      ],
    }],
  },
  {
    name: "totalWarped",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "total", type: "uint256" }],
  },
  {
    name: "getWarpedAgentId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "externalHash", type: "bytes32" }],
    outputs: [{ name: "warpedAgentId", type: "uint256" }],
  },
] as const;

export const RFAABI = [
  {
    name: "createRFA",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "requiredSkills", type: "bytes32[]" },
      { name: "offerAmount", type: "uint256" },
    ],
    outputs: [{ name: "rfaId", type: "uint256" }],
  },
  {
    name: "submitAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rfaId", type: "uint256" },
      { name: "agentId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "acceptAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rfaId", type: "uint256" },
      { name: "agentId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getRFAData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "rfaId", type: "uint256" }],
    outputs: [{
      name: "data",
      type: "tuple",
      components: [
        { name: "workflowId", type: "uint256" },
        { name: "title", type: "string" },
        { name: "description", type: "string" },
        { name: "requiredSkills", type: "bytes32[]" },
        { name: "offerAmount", type: "uint256" },
        { name: "publisher", type: "address" },
        { name: "createdAt", type: "uint256" },
        { name: "status", type: "uint8" },
        { name: "fulfilledByAgentId", type: "uint256" },
        { name: "agentCreator", type: "address" },
      ],
    }],
  },
  {
    name: "getOpenRFAs",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "rfaIds", type: "uint256[]" }],
  },
  {
    name: "getSubmissions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "rfaId", type: "uint256" }],
    outputs: [{
      name: "submissions",
      type: "tuple[]",
      components: [
        { name: "agentId", type: "uint256" },
        { name: "creator", type: "address" },
        { name: "submittedAt", type: "uint256" },
      ],
    }],
  },
] as const;

function requireFunctionAbi<
  TAbi extends readonly { name?: string; type?: string }[],
>(abi: TAbi, name: string) {
  const method = abi.find(
    (item): item is Extract<TAbi[number], { name: string; type: "function" }> =>
      item.type === "function" && item.name === name,
  );
  if (!method) {
    throw new Error(`Missing function ABI for ${name}`);
  }
  return method;
}

const MINT_AGENT_METHOD = requireFunctionAbi(AgentFactoryABI, "mintAgent");
const MINT_WORKFLOW_METHOD = requireFunctionAbi(WorkflowABI, "mintWorkflow");
const WARP_AGENT_METHOD = requireFunctionAbi(WarpABI, "warpAgent");

// =============================================================================
// Contract Instances
// =============================================================================

export function getAgentFactoryContract() {
  return getContract({
    address: getContractAddress("AgentFactory"),
    chain: paymentChain,
    client: thirdwebClient,
  });
}

export function getWorkflowContract() {
  return getContract({
    address: getContractAddress("Workflow"),
    chain: paymentChain,
    client: thirdwebClient,
  });
}

export function getCloneContract() {
  return getContract({
    address: getContractAddress("Clone"),
    chain: paymentChain,
    client: thirdwebClient,
  });
}

export function getWarpContract() {
  return getContract({
    address: getContractAddress("Warp"),
    chain: paymentChain,
    client: thirdwebClient,
  });
}

export function getRFAContract() {
  return getContract({
    address: getContractAddress("RFA"),
    chain: paymentChain,
    client: thirdwebClient,
  });
}

// Chain-specific contract getters (for multi-chain fetching)
export function getAgentFactoryContractForChain(chainId: number) {
  const chain = CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS];
  if (!chain) throw new Error(`Chain ${chainId} not configured`);
  return getContract({
    address: getContractAddressForChain("AgentFactory", chainId),
    chain,
    client: thirdwebClient,
  });
}

export function getWorkflowContractForChain(chainId: number) {
  const chain = CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS];
  if (!chain) throw new Error(`Chain ${chainId} not configured`);
  return getContract({
    address: getContractAddressForChain("Workflow", chainId),
    chain,
    client: thirdwebClient,
  });
}

export function getWarpContractForChain(chainId: number) {
  const chain = CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS];
  if (!chain) throw new Error(`Chain ${chainId} not configured`);
  return getContract({
    address: getContractAddressForChain("Warp", chainId),
    chain,
    client: thirdwebClient,
  });
}

export function getRFAContractForChain(chainId: number) {
  const chain = CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS];
  if (!chain) throw new Error(`Chain ${chainId} not configured`);
  return getContract({
    address: getContractAddressForChain("RFA", chainId),
    chain,
    client: thirdwebClient,
  });
}

export function prepareMintAgentCall(
  contract: ReturnType<typeof getAgentFactoryContractForChain>,
  args: {
    dnaHash: `0x${string}`;
    licenses: bigint;
    licensePrice: bigint;
    cloneable: boolean;
    agentCardUri: string;
  },
) {
  return prepareContractCall({
    contract,
    method: MINT_AGENT_METHOD,
    params: [
      args.dnaHash,
      args.licenses,
      args.licensePrice,
      args.cloneable,
      args.agentCardUri,
    ],
  });
}

export function prepareWarpAgentCall(
  contract: ReturnType<typeof getWarpContractForChain>,
  args: {
    originalAgentHash: `0x${string}`;
    originalCreator: `0x${string}`;
    licenses: bigint;
    licensePrice: bigint;
    agentCardUri: string;
  },
) {
  return prepareContractCall({
    contract,
    method: WARP_AGENT_METHOD,
    params: [
      args.originalAgentHash,
      args.originalCreator,
      args.licenses,
      args.licensePrice,
      args.agentCardUri,
    ],
  });
}

export function prepareMintWorkflowCall(
  contract: ReturnType<typeof getWorkflowContractForChain>,
  args: {
    params: {
      title: string;
      description: string;
      banner: string;
      workflowCardUri: string;
      units: bigint;
      leaseEnabled: boolean;
      leaseDuration: bigint;
      leasePercent: number;
      hasCoordinator: boolean;
      coordinatorModel: string;
    };
    agentIds: bigint[];
  },
) {
  return prepareContractCall({
    contract,
    method: MINT_WORKFLOW_METHOD,
    params: [args.params, args.agentIds],
  });
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate DNA hash from agent parameters (matches contract logic)
 * 
 * The dnaHash uniquely identifies an agent and is used to derive its wallet.
 * The derivation formula includes timestamp to ensure uniqueness even for identical skills/chain/model.
 * 
 * Formula: keccak256(skills + chainId + model + timestamp)
 */
export function computeDnaHash(
  skills: string[],
  chainId: number,
  model: string
): `0x${string}` {
  // Sort skills for deterministic hashing
  const sortedSkills = [...skills].sort();
  const skillsStr = sortedSkills.join(",");

  return keccak256(
    encodePacked(
      ["string", "uint256", "string"],
      [skillsStr, BigInt(chainId), model]
    )
  );
}

/**
 * Derive agent wallet address from dnaHash + timestamp
 * 
 * - dnaHash = keccak256(skills, chainId, model) - sent to contract
 * - timestamp makes each wallet unique even for same skills/chain/model
 * - walletAddress is stored in IPFS metadata as single source of truth
 * 
 * Formula: walletAddress = privateKeyToAddress(keccak256(dnaHash + timestamp + ":agent:wallet"))
 * 
 * IMPORTANT: Both frontend (this function) and backend (agent-wallet.ts) use
 * the same derivation formula. The walletAddress is stored in IPFS metadata and
 * the backend verifies it can derive the same address from dnaHash + walletTimestamp.
 */
export function deriveAgentWalletAddress(dnaHash: `0x${string}`, timestamp: number): `0x${string}` {
  // Derive private key from dnaHash + timestamp for uniqueness
  const derivationSeed = keccak256(
    encodePacked(
      ["bytes32", "uint256", "string"],
      [dnaHash, BigInt(timestamp), ":agent:wallet"]
    )
  );

  // Compute public address from private key
  return computeAddressFromPrivateKey(derivationSeed);
}

/**
 * Compute Ethereum address from private key
 * Uses the standard secp256k1 -> keccak256 -> last 20 bytes flow
 */
function computeAddressFromPrivateKey(privateKey: `0x${string}`): `0x${string}` {
  // viem's privateKeyToAccount works in browser via noble-curves
  // Use dynamic import for code splitting
  try {
    const { privateKeyToAccount } = require("viem/accounts") as typeof import("viem/accounts");
    const account = privateKeyToAccount(privateKey);
    return account.address;
  } catch {
    // Fallback: return a deterministic placeholder based on the private key
    // This shouldn't happen in practice as viem works in browser
    const fallback = keccak256(privateKey);
    return `0x${fallback.slice(26)}` as `0x${string}`;
  }
}

/**
 * Convert USDC amount to wei (6 decimals)
 */
export function usdcToWei(amount: number | string): bigint {
  const amountNum = typeof amount === "string" ? parseFloat(amount) : amount;
  return BigInt(Math.round(amountNum * 1_000_000));
}

/**
 * Convert USDC wei to display amount
 */
export function weiToUsdc(wei: bigint): string {
  return (Number(wei) / 1_000_000).toFixed(6);
}

/**
 * Format price for display
 */
export function formatUsdcPrice(wei: bigint): string {
  const usdc = Number(wei) / 1_000_000;
  return usdc < 0.01 ? `$${usdc.toFixed(4)}` : `$${usdc.toFixed(2)}`;
}

/**
 * Compute hash for external agent (used as originalAgentHash in Warp contract)
 * Creates a unique identifier for an agent from an external registry
 */
export function computeExternalAgentHash(registry: string, address: string): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "string"],
      [registry, address]
    )
  );
}

/**
 * Compute Workflow DNA hash for unique identification
 * 
 * This creates a unique identifier for a Workflow based on:
 * - The Workflow contract address
 * - The agent IDs included in the workflow
 * - A timestamp (for uniqueness even with same agents)
 * 
 * This hash is stored on-chain and in IPFS metadata at minting time.
 * Both frontend and backend fetch it from there - never duplicate derivation.
 */
export function computeWorkflowDnaHash(
  agentIds: number[],
  timestamp: number
): `0x${string}` {
  const workflowContractAddress = getContractAddress("Workflow");
  const sortedAgentIds = [...agentIds].sort((a, b) => a - b);
  const agentIdsStr = sortedAgentIds.join(",");

  return keccak256(
    encodePacked(
      ["address", "string", "uint256", "string"],
      [workflowContractAddress, agentIdsStr, BigInt(timestamp), ":workflow:dna"]
    )
  );
}

/**
 * Derive workflow wallet address from DNA hash + timestamp
 * 
 * Similar to agent wallet derivation, this creates a unique wallet address
 * for the Workflow. This wallet can be used for:
 * - Receiving x402 payments
 * - Signing workflow-level transactions
 * - Unique identification in the system
 * 
 * The wallet address is stored in IPFS metadata as the single source of truth.
 */
export function deriveWorkflowWalletAddress(dnaHash: `0x${string}`, timestamp: number): `0x${string}` {
  const derivationSeed = keccak256(
    encodePacked(
      ["bytes32", "uint256", "string"],
      [dnaHash, BigInt(timestamp), ":workflow:wallet"]
    )
  );

  return computeAddressFromPrivateKey(derivationSeed);
}

// =============================================================================
// Types
// =============================================================================

export interface AgentData {
  dnaHash: `0x${string}`;
  licenses: bigint;
  licensesMinted: bigint;
  licensePrice: bigint;
  creator: Address;
  cloneable: boolean;
  isClone: boolean;
  parentAgentId: bigint;
  agentCardUri: string;
}

export interface WorkflowData {
  title: string;
  description: string;
  banner: string;
  workflowCardUri: string;
  totalPrice: bigint;
  units: bigint;
  unitsMinted: bigint;
  creator: Address;
  leaseEnabled: boolean;
  leaseDuration: bigint;
  leasePercent: number;
  hasCoordinator: boolean;
  coordinatorModel: string;
  hasActiveRfa: boolean;
  rfaId: bigint;
}

export interface MintAgentParams {
  skills: string[];
  chainId: number;
  model: string;
  licenses: number; // 0 = infinite (Renamed from units)
  licensePrice: number; // USDC (Renamed from price)
  cloneable: boolean;
  agentCardUri: string;
}

export interface MintWorkflowParams {
  title: string;
  description: string;
  banner: string;
  workflowCardUri: string;
  units: number; // 0 = infinite
  leaseEnabled: boolean;
  leaseDuration: number; // days
  leasePercent: number; // 0-20
  hasCoordinator: boolean;
  coordinatorModel: string;
  agentIds: number[];
}

// =============================================================================
// RFA (Request-For-Agent) Helpers
// =============================================================================

/**
 * RFA Categories - based on actual MCP/GOAT registry categories
 */
export const RFA_CATEGORIES = [
  { id: 'defi', label: 'DeFi', description: 'Trading, swaps, liquidity' },
  { id: 'social', label: 'Social', description: 'Discord, Twitter, Telegram' },
  { id: 'ai', label: 'AI', description: 'LLM, inference, embeddings' },
  { id: 'blockchain', label: 'Blockchain', description: 'Web3, on-chain operations' },
  { id: 'storage', label: 'Storage', description: 'IPFS, files' },
  { id: 'productivity', label: 'Productivity', description: 'Tasks, automation' },
  { id: 'network', label: 'Network', description: 'HTTP, APIs' },
  { id: 'utility', label: 'Utility', description: 'General tools' },
] as const;

export type RFACategoryId = typeof RFA_CATEGORIES[number]['id'];

/**
 * Encode a skill/category string as bytes32 for the RFA contract
 * Uses keccak256 hash of the lowercased skill string
 */
export function encodeSkillAsBytes32(skill: string): `0x${string}` {
  return keccak256(
    encodePacked(['string'], [skill.toLowerCase()])
  );
}

/**
 * RFA bounty constraints
 */
export const RFA_BOUNTY_LIMITS = {
  MIN_BOUNTY: 0.10, // $0.10 USDC minimum
  MAX_BOUNTY: 1.00, // $1.00 USDC maximum
  DEFAULT_BOUNTY: 0.50, // $0.50 USDC default
  BASIC_BOUNTY: 0.10, // Basic form completion bounty
  README_BONUS_MAX: 0.90, // Maximum README bonus
} as const;
