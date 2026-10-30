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

export {
  AgentFactoryABI,
  CloneABI,
  RFAABI,
  WarpABI,
  WorkflowABI,
};
export { CONTRACT_ADDRESSES, getContractAddress, getContractAddressForChain };
export { formatUsdcPrice, RFA_BOUNTY_LIMITS, weiToUsdc } from "./performance/networks";

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
