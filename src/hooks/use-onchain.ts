/**
 * Hooks for reading on-chain Manowar protocol data.
 * Multi-chain: every contract read requires an explicit chainId or iterates
 * over all live supported EVM chains — zero hardcoded single-chain singletons.
 */
import { useQuery } from "@tanstack/react-query";
import { readContract } from "thirdweb";
import {
  getAgentFactoryContractForChain,
  getWorkflowContractForChain,
  getWarpContractForChain,
  getRFAContractForChain,
  formatUsdcPrice,
  weiToUsdc,
  type AgentData,
  type WorkflowData,
} from "@/lib/contracts";
import { useChain } from "@/contexts/Network";
import { evmChainId, isEvmNetwork, networkFromChainId, SUPPORTED_CHAINS } from "@/lib/chains";
import { getIpfsUrl } from "@/lib/pinata";
import type { NetworkId } from "@compose-market/sdk/chains";
import type { AgentCard, WorkflowMetadata } from "@/lib/pinata";

// =============================================================================
// Types
// =============================================================================

export interface OnchainAgent {
  id: number;
  dnaHash: string;
  walletAddress: string;
  network?: NetworkId;
  licenses: number;
  licensesMinted: number;
  licensesAvailable: number;
  licensePrice: string;
  licensePriceFormatted: string;
  creatorFee: number;
  creator: string;
  cloneable: boolean;
  isClone: boolean;
  parentAgentId: number;
  agentCardUri: string;
  metadata?: AgentCard;
  isWarped: boolean;
}

export interface OnchainWorkflow {
  id: number;
  title: string;
  description: string;
  image: string;
  workflowCardUri: string;
  totalPrice: string;
  units: number;
  unitsMinted: number;
  creator: string;
  leaseEnabled: boolean;
  leaseDuration: number;
  leasePercent: number;
  hasCoordinator: boolean;
  coordinatorModel: string;
  hasActiveRfa: boolean;
  rfaId: number;
  dnaHash?: string;
  walletAddress?: string;
  metadata?: WorkflowMetadata;
  agentIds?: number[];
  agentWallets?: number[];
  network?: NetworkId;
  chainId?: number;
}

// =============================================================================
// Contract Read Helpers
// =============================================================================

async function fetchAgentData(agentWallet: number, chainId: number): Promise<OnchainAgent | null> {
  try {
    const factoryContract = getAgentFactoryContractForChain(chainId);
    const data = await readContract({
      contract: factoryContract,
      method: "function getAgentData(uint256 agentWallet) view returns ((bytes32 dnaHash, uint256 licenses, uint256 licensesMinted, uint256 licensePrice, uint256 creatorFee, address creator, bool cloneable, bool isClone, uint256 parentAgentId, string agentCardUri))",
      params: [BigInt(agentWallet)],
    }) as AgentData;

    const licenses = Number(data.licenses);
    const licensesMinted = Number(data.licensesMinted);

    let isWarped = false;
    try {
      const warpContract = getWarpContractForChain(chainId);
      isWarped = await readContract({
        contract: warpContract,
        method: "function isWarped(uint256 agentWallet) view returns (bool)",
        params: [BigInt(agentWallet)],
      }) as boolean;
    } catch {
      isWarped = false;
    }

    return {
      id: agentWallet,
      dnaHash: data.dnaHash,
      walletAddress: "",
      network: networkFromChainId(chainId),
      licenses,
      licensesMinted,
      licensesAvailable: licenses === 0 ? Infinity : licenses - licensesMinted,
      licensePrice: weiToUsdc(data.licensePrice),
      licensePriceFormatted: formatUsdcPrice(data.licensePrice),
      creatorFee: Number(data.creatorFee ?? 1n),
      creator: data.creator,
      cloneable: data.cloneable,
      isClone: data.isClone,
      parentAgentId: Number(data.parentAgentId),
      agentCardUri: data.agentCardUri,
      isWarped,
    };
  } catch (error) {
    console.error(`Failed to fetch agent ${agentWallet} on chain ${chainId}:`, error);
    return null;
  }
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAgentMetadata(agent: OnchainAgent): Promise<OnchainAgent> {
  if (!agent.agentCardUri || !agent.agentCardUri.startsWith("ipfs://")) {
    return agent;
  }

  try {
    const cid = agent.agentCardUri.replace("ipfs://", "");
    if (!cid.startsWith("Qm") && !cid.startsWith("baf")) {
      console.warn(`[use-onchain] Skipping invalid CID for agent ${agent.id}: ${cid}`);
      return agent;
    }

    const url = getIpfsUrl(cid);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch metadata");
    const metadata = await response.json() as AgentCard;

    const walletAddress = metadata.walletAddress || agent.walletAddress;
    const creatorFee = finite(metadata.creatorFee) ?? agent.creatorFee;

    return { ...agent, metadata: { ...metadata, creatorFee }, walletAddress, creatorFee };
  } catch (error) {
    console.error(`Failed to fetch metadata for agent ${agent.id}:`, error);
    return agent;
  }
}

export async function fetchAgentByWalletAddress(walletAddress: string): Promise<OnchainAgent | null> {
  const normalizedSearch = walletAddress.toLowerCase();

  for (const { id: chainId } of SUPPORTED_CHAINS) {
    try {
      const contract = getAgentFactoryContractForChain(chainId);
      const total = await readContract({
        contract,
        method: "function totalAgents() view returns (uint256)",
        params: [],
      }) as bigint;

      const totalNum = Number(total);
      if (totalNum === 0) continue;

      for (let i = totalNum; i >= 1; i--) {
        const agent = await fetchAgentData(i, chainId);
        if (!agent) continue;

        const agentWithMeta = await fetchAgentMetadata(agent);
        if (agentWithMeta.walletAddress && agentWithMeta.walletAddress.toLowerCase() === normalizedSearch) {
          return agentWithMeta;
        }
      }
    } catch (error) {
      console.warn(`Failed to search agents on chain ${chainId}:`, error);
    }
  }

  console.error(`Agent with wallet ${walletAddress} not found on any chain`);
  return null;
}

async function fetchWorkflowData(workflowId: number, chainId: number): Promise<OnchainWorkflow | null> {
  try {
    const contract = getWorkflowContractForChain(chainId);
    const data = await readContract({
      contract,
      method: "function getWorkflowData(uint256 workflowId) view returns ((string title, string description, string banner, string workflowCardUri, uint256 totalPrice, uint256 units, uint256 unitsMinted, address creator, bool leaseEnabled, uint256 leaseDuration, uint8 leasePercent, bool hasCoordinator, string coordinatorModel, bool hasActiveRfa, uint256 rfaId))",
      params: [BigInt(workflowId)],
    }) as WorkflowData;
    const agentIds = await readContract({
      contract,
      method: "function getAgents(uint256 workflowId) view returns (uint256[])",
      params: [BigInt(workflowId)],
    }) as bigint[];
    const agents = agentIds.map((id) => Number(id));

    return {
      id: workflowId,
      title: data.title,
      description: data.description,
      image: data.banner,
      workflowCardUri: data.workflowCardUri,
      totalPrice: weiToUsdc(data.totalPrice),
      units: Number(data.units),
      unitsMinted: Number(data.unitsMinted),
      creator: data.creator,
      leaseEnabled: data.leaseEnabled,
      leaseDuration: Number(data.leaseDuration),
      leasePercent: data.leasePercent,
      hasCoordinator: data.hasCoordinator,
      coordinatorModel: data.coordinatorModel,
      hasActiveRfa: data.hasActiveRfa,
      rfaId: Number(data.rfaId),
      agentIds: agents,
      agentWallets: agents,
      network: networkFromChainId(chainId),
      chainId,
    };
  } catch (error) {
    console.error(`Failed to fetch workflow ${workflowId} on chain ${chainId}:`, error);
    return null;
  }
}

async function fetchWorkflowMetadata(workflow: OnchainWorkflow, chainId: number): Promise<OnchainWorkflow> {
  try {
    const contract = getWorkflowContractForChain(chainId);
    const tokenUri = await readContract({
      contract,
      method: "function tokenURI(uint256 tokenId) view returns (string)",
      params: [BigInt(workflow.id)],
    }) as string;

    if (!tokenUri) {
      console.warn(`[use-onchain] No tokenURI for workflow ${workflow.id}`);
      return workflow;
    }

    let metadataUrl = tokenUri;
    if (tokenUri.startsWith("ipfs://")) {
      const cid = tokenUri.replace("ipfs://", "");
      metadataUrl = getIpfsUrl(cid);
    }

    const response = await fetch(metadataUrl);
    if (!response.ok) throw new Error("Failed to fetch metadata");
    const metadata = await response.json() as WorkflowMetadata;

    return {
      ...workflow,
      metadata,
      dnaHash: metadata.dnaHash,
      walletAddress: metadata.walletAddress,
      network: (metadata.network ?? workflow.network) as NetworkId | undefined,
    };
  } catch (error) {
    console.error(`Failed to fetch metadata for workflow ${workflow.id}:`, error);
    return workflow;
  }
}

// =============================================================================
// Hooks
// =============================================================================

function useSelectedEvmChainId(explicitChainId?: number): number | null {
  const { paymentNetwork } = useChain();
  if (explicitChainId != null) return explicitChainId;
  return isEvmNetwork(paymentNetwork) ? evmChainId(paymentNetwork) : null;
}

export function useOnchainAgent(agentWallet: number | null, chainId?: number) {
  const resolvedChainId = useSelectedEvmChainId(chainId);
  return useQuery({
    queryKey: ["onchain-agent", resolvedChainId, agentWallet],
    queryFn: async () => {
      if (!agentWallet || resolvedChainId == null) return null;
      const agent = await fetchAgentData(agentWallet, resolvedChainId);
      if (!agent) return null;
      return fetchAgentMetadata(agent);
    },
    enabled: !!agentWallet && resolvedChainId != null,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export async function fetchOnchainWorkflows(options?: {
  includeRFA?: boolean;
  onlyComplete?: boolean;
}): Promise<OnchainWorkflow[]> {
  const { includeRFA = false, onlyComplete = true } = options || {};

  const chainPromises = SUPPORTED_CHAINS.map(async ({ id: chainId }) => {
    try {
      const contract = getWorkflowContractForChain(chainId);
      const total = await readContract({
        contract,
        method: "function totalWorkflows() view returns (uint256)",
        params: [],
      }) as bigint;

      const totalNum = Number(total);
      if (totalNum === 0) return [];

      const workflowPromises = Array.from({ length: totalNum }, (_, i) =>
        fetchWorkflowData(i + 1, chainId),
      );

      let workflows = (await Promise.all(workflowPromises)).filter((m): m is OnchainWorkflow => m !== null);
      workflows = await Promise.all(workflows.map((m) => fetchWorkflowMetadata(m, chainId)));

      if (onlyComplete && !includeRFA) {
        workflows = workflows.filter((m) => !m.hasActiveRfa);
      } else if (includeRFA && !onlyComplete) {
        workflows = workflows.filter((m) => m.hasActiveRfa);
      }

      return workflows;
    } catch (error) {
      console.warn(`Failed to fetch workflows from chain ${chainId}:`, error);
      return [];
    }
  });

  const chainsWorkflows = await Promise.all(chainPromises);
  return chainsWorkflows.flat();
}

export function useOnchainWorkflows(options?: {
  includeRFA?: boolean;
  onlyComplete?: boolean;
}) {
  const { includeRFA = false, onlyComplete = true } = options || {};

  return useQuery({
    queryKey: ["onchain-workflows", "all-chains", includeRFA, onlyComplete],
    queryFn: () => fetchOnchainWorkflows({ includeRFA, onlyComplete }),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useWorkflowsByCreator(creator: string | undefined) {
  const { data: allWorkflows, ...rest } = useOnchainWorkflows({ onlyComplete: false });

  return {
    ...rest,
    data: allWorkflows?.filter((m) =>
      m.creator.toLowerCase() === creator?.toLowerCase(),
    ),
  };
}

export function useWorkflowsWithRFA() {
  return useOnchainWorkflows({ includeRFA: true, onlyComplete: false });
}

export function useOnchainWorkflow(workflowId: number | null, chainId?: number) {
  const resolvedChainId = useSelectedEvmChainId(chainId);
  return useQuery({
    queryKey: ["onchain-workflow", resolvedChainId, workflowId],
    queryFn: async () => {
      if (!workflowId || resolvedChainId == null) return null;
      const workflow = await fetchWorkflowData(workflowId, resolvedChainId);
      if (!workflow) return null;
      return fetchWorkflowMetadata(workflow, resolvedChainId);
    },
    enabled: !!workflowId && resolvedChainId != null,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

async function fetchWorkflowByWalletAddress(walletAddress: string): Promise<OnchainWorkflow | null> {
  const normalizedSearch = walletAddress.toLowerCase();

  for (const { id: chainId } of SUPPORTED_CHAINS) {
    try {
      const contract = getWorkflowContractForChain(chainId);
      const total = await readContract({
        contract,
        method: "function totalWorkflows() view returns (uint256)",
        params: [],
      }) as bigint;

      const totalNum = Number(total);
      if (totalNum === 0) continue;

      for (let i = totalNum; i >= 1; i--) {
        const workflow = await fetchWorkflowData(i, chainId);
        if (!workflow) continue;

        const workflowWithMeta = await fetchWorkflowMetadata(workflow, chainId);
        if (workflowWithMeta.walletAddress && workflowWithMeta.walletAddress.toLowerCase() === normalizedSearch) {
          return workflowWithMeta;
        }
      }
    } catch (error) {
      console.warn(`Failed to search workflows on chain ${chainId}:`, error);
    }
  }

  console.error(`Workflow with wallet ${walletAddress} not found on any chain`);
  return null;
}

export function useOnchainWorkflowByWallet(walletAddress: string | null) {
  return useQuery({
    queryKey: ["onchain-workflow-wallet", walletAddress?.toLowerCase()],
    queryFn: async () => {
      if (!walletAddress) return null;
      return fetchWorkflowByWalletAddress(walletAddress);
    },
    enabled: !!walletAddress && walletAddress.startsWith("0x"),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useOnchainWorkflowByIdentifier(identifier: string | null) {
  const isWalletAddress = identifier?.startsWith("0x") && identifier.length === 42;
  const numericId = !isWalletAddress && identifier ? parseInt(identifier, 10) : null;
  const walletAddress = isWalletAddress ? identifier : null;

  const byIdQuery = useOnchainWorkflow(!isWalletAddress ? numericId : null);
  const byWalletQuery = useOnchainWorkflowByWallet(isWalletAddress ? walletAddress : null);

  if (isWalletAddress) {
    return byWalletQuery;
  }
  return byIdQuery;
}

// =============================================================================
// RFA (Request-For-Agent) Types & Hooks
// =============================================================================

export type RFAStatus = "None" | "Open" | "Fulfilled" | "Cancelled";

export interface OnchainRFA {
  id: number;
  workflowId: number;
  title: string;
  description: string;
  requiredSkills: string[];
  offerAmount: string;
  offerAmountFormatted: string;
  publisher: string;
  createdAt: number;
  status: RFAStatus;
  fulfilledByAgentId: number;
  agentCreator: string;
  network?: NetworkId;
  chainId?: number;
}

export interface RFASubmission {
  agentWallet: number;
  creator: string;
  submittedAt: number;
}

interface ContractRFAData {
  workflowId: bigint;
  title: string;
  description: string;
  requiredSkills: `0x${string}`[];
  offerAmount: bigint;
  publisher: string;
  createdAt: bigint;
  status: number;
  fulfilledByAgentId: bigint;
  agentCreator: string;
}

interface ContractSubmission {
  agentWallet: bigint;
  creator: string;
  submittedAt: bigint;
}

function parseRFAStatus(status: number): RFAStatus {
  switch (status) {
    case 1: return "Open";
    case 2: return "Fulfilled";
    case 3: return "Cancelled";
    default: return "None";
  }
}

function parseRFAData(id: number, data: ContractRFAData, chainId: number): OnchainRFA {
  const offerAmount = weiToUsdc(data.offerAmount);
  const offerNum = parseFloat(offerAmount);

  return {
    id,
    workflowId: Number(data.workflowId),
    title: data.title,
    description: data.description,
    requiredSkills: data.requiredSkills.map((s) => s),
    offerAmount,
    offerAmountFormatted: offerNum < 0.01 ? `$${offerNum.toFixed(4)}` : `$${offerNum.toFixed(2)}`,
    publisher: data.publisher,
    createdAt: Number(data.createdAt),
    status: parseRFAStatus(data.status),
    fulfilledByAgentId: Number(data.fulfilledByAgentId),
    agentCreator: data.agentCreator,
    chainId,
    network: networkFromChainId(chainId),
  };
}

/** Fetch single RFA data by ID */
async function fetchRFAData(rfaId: number): Promise<OnchainRFA | null> {
  try {
    const contract = getRFAContract();
    const data = await readContract({
      contract,
      method: "function getRFAData(uint256 rfaId) view returns ((uint256 workflowId, string title, string description, bytes32[] requiredSkills, uint256 offerAmount, address publisher, uint256 createdAt, uint8 status, uint256 fulfilledByAgentId, address agentCreator))",
      params: [BigInt(rfaId)],
    }) as ContractRFAData;

    return parseRFAData(rfaId, data);
  } catch (error) {
    console.error(`Failed to fetch RFA ${rfaId}:`, error);
    return null;
  }
}

/** Fetch submissions for an RFA */
async function fetchRFASubmissions(rfaId: number): Promise<RFASubmission[]> {
  try {
    const contract = getRFAContract();
    const submissions = await readContract({
      contract,
      method: "function getSubmissions(uint256 rfaId) view returns ((uint256 agentWallet, address creator, uint256 submittedAt)[])",
      params: [BigInt(rfaId)],
    }) as ContractSubmission[];

    return submissions.map(s => ({
      agentWallet: Number(s.agentWallet),
      creator: s.creator,
      submittedAt: Number(s.submittedAt),
    }));
  } catch (error) {
    console.error(`Failed to fetch submissions for RFA ${rfaId}:`, error);
    return [];
  }
}

/**
 * Fetch all open RFAs
 */
export async function fetchOpenRFAs(): Promise<OnchainRFA[]> {
  const contract = getRFAContract();

  const rfaIds = await readContract({
    contract,
    method: "function getOpenRFAs() view returns (uint256[])",
    params: [],
  }) as bigint[];

  if (rfaIds.length === 0) return [];

  const rfaPromises = rfaIds.map(id => fetchRFAData(Number(id)));
  const rfas = await Promise.all(rfaPromises);

  return rfas.filter((r): r is OnchainRFA => r !== null);
}

export function useOpenRFAs() {
  return useQuery({
    queryKey: ["rfa", "open"],
    queryFn: fetchOpenRFAs,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000, // Keep in cache 5 minutes
    retry: 2,
  });
}

/**
 * Fetch a single RFA by ID
 */
export function useRFAData(rfaId: number | null) {
  return useQuery({
    queryKey: ["rfa", "data", rfaId],
    queryFn: async () => {
      if (!rfaId) return null;
      return fetchRFAData(rfaId);
    },
    enabled: !!rfaId && rfaId > 0,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000, // Keep in cache 5 minutes
  });
}

/**
 * Fetch submissions for an RFA
 */
export function useRFASubmissions(rfaId: number | null) {
  return useQuery({
    queryKey: ["rfa", "submissions", rfaId],
    queryFn: async () => {
      if (!rfaId) return [];
      return fetchRFASubmissions(rfaId);
    },
    enabled: !!rfaId && rfaId > 0,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000, // Keep in cache 5 minutes
  });
}

/**
 * Fetch RFAs published by a specific address
 */
export function useRFAsByPublisher(publisher: string | undefined) {
  return useQuery({
    queryKey: ["rfa", "by-publisher", publisher?.toLowerCase()],
    queryFn: async () => {
      if (!publisher) return [];

      const contract = getRFAContract();
      const rfaIds = await readContract({
        contract,
        method: "function getRFAsByPublisher(address publisher) view returns (uint256[])",
        params: [publisher as `0x${string}`],
      }) as bigint[];

      if (rfaIds.length === 0) return [];

      const rfaPromises = rfaIds.map(id => fetchRFAData(Number(id)));
      const rfas = await Promise.all(rfaPromises);

      return rfas.filter((r): r is OnchainRFA => r !== null);
    },
    enabled: !!publisher,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000, // Keep in cache 5 minutes
  });
}

/**
 * Fetch RFAs for a specific Workflow
 */
export function useRFAsForWorkflow(workflowId: number | null) {
  return useQuery({
    queryKey: ["rfa", "by-workflow", workflowId],
    queryFn: async () => {
      if (!workflowId) return [];

      const contract = getRFAContract();
      const rfaIds = await readContract({
        contract,
        method: "function getRFAsForWorkflow(uint256 workflowId) view returns (uint256[])",
        params: [BigInt(workflowId)],
      }) as bigint[];

      if (rfaIds.length === 0) return [];

      const rfaPromises = rfaIds.map(id => fetchRFAData(Number(id)));
      const rfas = await Promise.all(rfaPromises);

      return rfas.filter((r): r is OnchainRFA => r !== null);
    },
    enabled: !!workflowId && workflowId > 0,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000, // Keep in cache 5 minutes
  });
}
