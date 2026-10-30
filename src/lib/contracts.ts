/**
 * Manowar Protocol Contract Configuration
 * Multi-chain support — every contract accessor requires an explicit chainId.
 *
 * EVM ABIs are imported directly from `@compose-market/sdk/blockchain`.
 */

import { getContract, prepareContractCall } from "thirdweb";
import {
  AgentFactoryABI,
  CloneABI,
  RFAABI,
  WarpABI,
  WorkflowABI,
} from "@compose-market/sdk/blockchain";
import {
  thirdwebClient,
  CHAIN_OBJECTS,
  CONTRACT_ADDRESSES,
  getContractAddress,
  getContractAddressForChain,
} from "./chains";
import { keccak256, encodePacked, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Re-export from chains.ts for backwards compatibility
export { CONTRACT_ADDRESSES, getContractAddress, getContractAddressForChain };
export { formatUsdcPrice, RFA_BOUNTY_LIMITS, weiToUsdc } from "./performance/chains-data";

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
        { name: "creatorFee", type: "uint256" },
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
      { name: "creatorFee", type: "uint256" },
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
      { name: "creatorFee", type: "uint256", indexed: false },
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

// =============================================================================
// Chain-Specific Contract Instances (Zero Single-Chain Singletons)
// =============================================================================

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

export function getCloneContractForChain(chainId: number) {
  const chain = CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS];
  if (!chain) throw new Error(`Chain ${chainId} not configured`);
  return getContract({
    address: getContractAddressForChain("Clone", chainId),
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
    creatorFee?: bigint | number;
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
      BigInt(args.creatorFee ?? 1),
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

export function computeDnaHash(
  skills: string[],
  chainId: number | string,
  model: string,
): `0x${string}` {
  const sortedSkills = [...skills].sort();
  const skillsStr = sortedSkills.join(",");

  if (typeof chainId === "string") {
    return keccak256(
      encodePacked(
        ["string", "string", "string"],
        [skillsStr, chainId, model],
      ),
    );
  }

  return keccak256(
    encodePacked(
      ["string", "uint256", "string"],
      [skillsStr, BigInt(chainId), model],
    ),
  );
}

export function deriveAgentWalletAddress(dnaHash: `0x${string}`, timestamp: number): `0x${string}` {
  const derivationSeed = keccak256(
    encodePacked(
      ["bytes32", "uint256", "string"],
      [dnaHash, BigInt(timestamp), ":agent:wallet"],
    ),
  );
  return computeAddressFromPrivateKey(derivationSeed);
}

function computeAddressFromPrivateKey(privateKey: `0x${string}`): `0x${string}` {
  const account = privateKeyToAccount(privateKey);
  return account.address;
}

/**
 * Convert decimal stablecoin amount to 6-decimal atomic micro-units using
 * exact decimal-string parsing (zero binary float drift).
 */
export function usdcToWei(amount: number | string): bigint {
  const raw = (typeof amount === "number" ? amount.toFixed(6) : amount).trim();
  const match = raw.match(/^(\d+)(?:\.(\d*))?$/);
  if (!match) {
    const parsed = typeof amount === "number" ? amount : Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 0n;
    return BigInt(Math.round(parsed * 1_000_000));
  }
  const whole = match[1];
  const frac = (match[2] ?? "").slice(0, 6).padEnd(6, "0");
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}

export function computeExternalAgentHash(registry: string, address: string): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "string"],
      [registry, address],
    ),
  );
}

export function computeWorkflowDnaHash(
  agentIds: number[],
  timestamp: number,
  deploymentAddress: string,
): `0x${string}` {
  const sortedAgentIds = [...agentIds].sort((a, b) => a - b);
  const agentIdsStr = sortedAgentIds.join(",");

  if (!deploymentAddress.startsWith("0x")) {
    return keccak256(
      encodePacked(
        ["string", "string", "uint256", "string"],
        [deploymentAddress, agentIdsStr, BigInt(timestamp), ":workflow:dna"],
      ),
    );
  }

  return keccak256(
    encodePacked(
      ["address", "string", "uint256", "string"],
      [deploymentAddress as `0x${string}`, agentIdsStr, BigInt(timestamp), ":workflow:dna"],
    ),
  );
}

export function deriveWorkflowWalletAddress(dnaHash: `0x${string}`, timestamp: number): `0x${string}` {
  const derivationSeed = keccak256(
    encodePacked(
      ["bytes32", "uint256", "string"],
      [dnaHash, BigInt(timestamp), ":workflow:wallet"],
    ),
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
  creatorFee: bigint;
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
  licenses: number;
  licensePrice: number;
  creatorFee?: number;
  cloneable: boolean;
  agentCardUri: string;
}

export interface MintWorkflowParams {
  title: string;
  description: string;
  banner: string;
  workflowCardUri: string;
  units: number;
  leaseEnabled: boolean;
  leaseDuration: number;
  leasePercent: number;
  hasCoordinator: boolean;
  coordinatorModel: string;
  agentIds: number[];
}

// =============================================================================
// RFA (Request-For-Agent) Helpers
// =============================================================================

export const RFA_CATEGORIES = [
  { id: "defi", label: "DeFi", description: "Trading, swaps, liquidity" },
  { id: "social", label: "Social", description: "Discord, Twitter, Telegram" },
  { id: "ai", label: "AI", description: "LLM, inference, embeddings" },
  { id: "blockchain", label: "Blockchain", description: "Web3, on-chain operations" },
  { id: "storage", label: "Storage", description: "IPFS, files" },
  { id: "productivity", label: "Productivity", description: "Tasks, automation" },
  { id: "network", label: "Network", description: "HTTP, APIs" },
  { id: "utility", label: "Utility", description: "General tools" },
] as const;

export type RFACategoryId = typeof RFA_CATEGORIES[number]["id"];

export function encodeSkillAsBytes32(skill: string): `0x${string}` {
  return keccak256(
    encodePacked(["string"], [skill.toLowerCase()]),
  );
}
