/**
 * Hooks for reading on-chain Manowar protocol data
 * Fetches agents and workflows from deployed contracts
 * Multi-chain: fetches from ALL supported chains
 */
import { useQuery } from "@tanstack/react-query";
import { readContract } from "thirdweb";
import {
  getAgentFactoryContract,
  getManowarContract,
  getWarpContract,
  getRFAContract,
  getAgentFactoryContractForChain,
  getManowarContractForChain,
  getWarpContractForChain,
  AgentFactoryABI,
  ManowarABI,
  WarpABI,
  formatUsdcPrice,
  weiToUsdc,
  type AgentData,
  type ManowarData,
} from "@/lib/contracts";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { getIpfsUrl } from "@/lib/pinata";
import type { AgentCard, ManowarMetadata } from "@/lib/pinata";

// =============================================================================
// Types
// =============================================================================

export interface OnchainAgent {
  id: number;
  dnaHash: string;
  walletAddress: string; // Derived wallet address (primary identifier)
  licenses: number;
  licensesMinted: number;
  licensesAvailable: number;
  licensePrice: string;
  licensePriceFormatted: string;
  creator: string;
  cloneable: boolean;
  isClone: boolean;
  parentAgentId: number;
  agentCardUri: string;
  // Resolved metadata from IPFS
  metadata?: AgentCard;
  // Warp status
  isWarped: boolean;
}

export interface OnchainManowar {
  id: number;
  title: string;
  description: string;
  image: string; // Standard NFT metadata field (gateway URL)
  manowarCardUri: string;
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
  // Identity fields from IPFS metadata
  dnaHash?: string;
  walletAddress?: string;
  // Resolved metadata
  metadata?: ManowarMetadata;
  agentIds?: number[];
}

// =============================================================================
// Contract Read Helpers
// =============================================================================

async function fetchAgentData(agentId: number, chainId?: number): Promise<OnchainAgent | null> {
  try {
    // Use chain-specific contract if chainId provided, otherwise default
    const factoryContract = chainId
      ? getAgentFactoryContractForChain(chainId)
      : getAgentFactoryContract();
    const data = await readContract({
      contract: factoryContract,
      method: "function getAgentData(uint256 agentId) view returns ((bytes32 dnaHash, uint256 licenses, uint256 licensesMinted, uint256 licensePrice, address creator, bool cloneable, bool isClone, uint256 parentAgentId, string agentCardUri))",
      params: [BigInt(agentId)],
    }) as AgentData;

    const licenses = Number(data.licenses);
    const licensesMinted = Number(data.licensesMinted);

    // Check if this agent was created via warp
    let isWarped = false;
    try {
      const warpContract = chainId
        ? getWarpContractForChain(chainId)
        : getWarpContract();
      isWarped = await readContract({
        contract: warpContract,
        method: "function isWarped(uint256 agentId) view returns (bool)",
        params: [BigInt(agentId)],
      }) as boolean;
    } catch {
      // Warp check failed, assume not warped
      isWarped = false;
    }

    // walletAddress will be populated from IPFS metadata in fetchAgentMetadata
    // chainId comes from metadata.chain field (see AgentCard type)
    return {
      id: agentId,
      dnaHash: data.dnaHash,
      walletAddress: "", // Populated from metadata
      licenses,
      licensesMinted,
      licensesAvailable: licenses === 0 ? Infinity : licenses - licensesMinted,
      licensePrice: weiToUsdc(data.licensePrice),
      licensePriceFormatted: formatUsdcPrice(data.licensePrice),
      creator: data.creator,
      cloneable: data.cloneable,
      isClone: data.isClone,
      parentAgentId: Number(data.parentAgentId),
      agentCardUri: data.agentCardUri,
      isWarped,
    };
  } catch (error) {
    console.error(`Failed to fetch agent ${agentId} on chain ${chainId}:`, error);
    return null;
  }
}

async function fetchAgentMetadata(agent: OnchainAgent): Promise<OnchainAgent> {
  if (!agent.agentCardUri || !agent.agentCardUri.startsWith("ipfs://")) {
    return agent;
  }

  try {
    const cid = agent.agentCardUri.replace("ipfs://", "");

    // Validate CID format - proper IPFS CIDs start with 'Qm' (v0) or 'bafy/bafk' (v1)
    // Skip fetching if CID looks invalid (e.g., timestamp-based names from old mints)
    if (!cid.startsWith("Qm") && !cid.startsWith("baf")) {
      console.warn(`[use-onchain] Skipping invalid CID for agent ${agent.id}: ${cid}`);
      return agent;
    }

    const url = getIpfsUrl(cid);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch metadata");
    const metadata = await response.json() as AgentCard;

    // walletAddress comes from IPFS metadata - this is the SINGLE SOURCE OF TRUTH
    // Frontend and backend both read this, neither derives it
    const walletAddress = metadata.walletAddress || agent.walletAddress;

    return { ...agent, metadata, walletAddress };
  } catch (error) {
    console.error(`Failed to fetch metadata for agent ${agent.id}:`, error);
    return agent;
  }
}

/**
 * Find an agent by its wallet address (stored in IPFS metadata)
 * Iterates through all agents and checks metadata for matching wallet
 */
export async function fetchAgentByWalletAddress(walletAddress: string): Promise<OnchainAgent | null> {
  try {
    const contract = getAgentFactoryContract();

    // Get total agents count
    const total = await readContract({
      contract,
      method: "function totalAgents() view returns (uint256)",
      params: [],
    }) as bigint;

    const totalNum = Number(total);
    const normalizedSearch = walletAddress.toLowerCase();

    // Search through all agents (most recent first for efficiency)
    // Agent IDs start at 1, not 0
    for (let i = totalNum; i >= 1; i--) {
      const agent = await fetchAgentData(i);
      if (!agent) continue;

      // Fetch metadata to get the wallet address (source of truth)
      const agentWithMeta = await fetchAgentMetadata(agent);

      if (agentWithMeta.walletAddress && agentWithMeta.walletAddress.toLowerCase() === normalizedSearch) {
        return agentWithMeta;
      }
    }

    return null;
  } catch (error) {
    console.error(`Failed to find agent by wallet ${walletAddress}:`, error);
    return null;
  }
}

async function fetchManowarData(manowarId: number, chainId?: number): Promise<OnchainManowar | null> {
  try {
    const contract = chainId
      ? getManowarContractForChain(chainId)
      : getManowarContract();
    const data = await readContract({
      contract,
      method: "function getManowarData(uint256 manowarId) view returns ((string title, string description, string banner, string manowarCardUri, uint256 totalPrice, uint256 units, uint256 unitsMinted, address creator, bool leaseEnabled, uint256 leaseDuration, uint8 leasePercent, bool hasCoordinator, string coordinatorModel, bool hasActiveRfa, uint256 rfaId))",
      params: [BigInt(manowarId)],
    }) as ManowarData;

    return {
      id: manowarId,
      title: data.title,
      description: data.description,
      image: data.banner, // Contract still uses 'banner' field name
      manowarCardUri: data.manowarCardUri,
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
    };
  } catch (error) {
    console.error(`Failed to fetch manowar ${manowarId} on chain ${chainId}:`, error);
    return null;
  }
}

async function fetchManowarMetadata(manowar: OnchainManowar, chainId?: number): Promise<OnchainManowar> {
  try {
    // Fetch metadata via tokenURI (standard ERC721)
    const contract = chainId
      ? getManowarContractForChain(chainId)
      : getManowarContract();
    const tokenUri = await readContract({
      contract,
      method: "function tokenURI(uint256 tokenId) view returns (string)",
      params: [BigInt(manowar.id)],
    }) as string;

    if (!tokenUri) {
      console.warn(`[use-onchain] No tokenURI for manowar ${manowar.id}`);
      return manowar;
    }

    // Handle IPFS URIs
    let metadataUrl = tokenUri;
    if (tokenUri.startsWith("ipfs://")) {
      const cid = tokenUri.replace("ipfs://", "");
      metadataUrl = getIpfsUrl(cid);
    }

    const response = await fetch(metadataUrl);
    if (!response.ok) throw new Error("Failed to fetch metadata");
    const metadata = await response.json() as ManowarMetadata;

    // walletAddress and dnaHash come from IPFS metadata - this is the SINGLE SOURCE OF TRUTH
    // Chain info comes from nested agents[0].chain
    return {
      ...manowar,
      metadata,
      dnaHash: metadata.dnaHash,
      walletAddress: metadata.walletAddress,
    };
  } catch (error) {
    console.error(`Failed to fetch metadata for manowar ${manowar.id}:`, error);
    return manowar;
  }
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch all on-chain agents from ALL supported chains
 * Each agent's chainId comes from its metadata.chain field
 */
export function useOnchainAgents(options?: { includeMetadata?: boolean }) {
  const { includeMetadata = true } = options || {};

  return useQuery({
    queryKey: ["onchain-agents", "all-chains", includeMetadata],
    queryFn: async () => {
      // Fetch from all supported chains in parallel
      const chainPromises = SUPPORTED_CHAINS.map(async ({ id: chainId }) => {
        try {
          const contract = getAgentFactoryContractForChain(chainId);

          // Get total agents count for this chain
          const total = await readContract({
            contract,
            method: "function totalAgents() view returns (uint256)",
            params: [],
          }) as bigint;

          const totalNum = Number(total);
          if (totalNum === 0) return [];

          // Fetch all agents from this chain (IDs start at 1)
          const agentPromises = Array.from({ length: totalNum }, (_, i) =>
            fetchAgentData(i + 1, chainId)
          );

          let agents = (await Promise.all(agentPromises)).filter((a): a is OnchainAgent => a !== null);

          // Optionally fetch metadata (which includes the chain field)
          if (includeMetadata) {
            agents = await Promise.all(agents.map(fetchAgentMetadata));
          }

          return agents;
        } catch (error) {
          console.warn(`Failed to fetch agents from chain ${chainId}:`, error);
          return [];
        }
      });

      // Merge all agents from all chains
      const chainsAgents = await Promise.all(chainPromises);
      return chainsAgents.flat();
    },
    staleTime: 30 * 1000, // 30 seconds
    retry: 2,
  });
}

/**
 * Fetch a single agent by numeric ID
 */
export function useOnchainAgent(agentId: number | null) {
  return useQuery({
    queryKey: ["onchain-agent", agentId],
    queryFn: async () => {
      if (!agentId) return null;
      const agent = await fetchAgentData(agentId);
      if (!agent) return null;
      return fetchAgentMetadata(agent);
    },
    enabled: !!agentId,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch a single agent by wallet address
 * This is the preferred method since wallet address is the canonical identifier
 */
export function useOnchainAgentByWallet(walletAddress: string | null) {
  return useQuery({
    queryKey: ["onchain-agent-wallet", walletAddress?.toLowerCase()],
    queryFn: async () => {
      if (!walletAddress) return null;
      return fetchAgentByWalletAddress(walletAddress);
    },
    enabled: !!walletAddress && walletAddress.startsWith("0x"),
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch a single agent by either ID or wallet address
 * Automatically detects the identifier type
 */
export function useOnchainAgentByIdentifier(identifier: string | null) {
  // Determine if identifier is a wallet address (0x...) or numeric ID
  // Wallet address = 0x + 40 hex chars = 42 total
  const isWalletAddress = identifier?.startsWith("0x") && identifier.length === 42;
  const numericId = !isWalletAddress && identifier ? parseInt(identifier) : null;
  const walletAddress = isWalletAddress ? identifier : null;

  const byIdQuery = useOnchainAgent(!isWalletAddress ? numericId : null);
  const byWalletQuery = useOnchainAgentByWallet(isWalletAddress ? walletAddress : null);

  if (isWalletAddress) {
    return byWalletQuery;
  }
  return byIdQuery;
}

/**
 * Fetch agents owned by a specific address
 */
export function useAgentsByCreator(creator: string | undefined) {
  const { data: allAgents, ...rest } = useOnchainAgents();

  return {
    ...rest,
    data: allAgents?.filter(a =>
      a.creator.toLowerCase() === creator?.toLowerCase()
    ),
  };
}

/**
 * Fetch all on-chain manowars from ALL supported chains
 * Chain info comes from nested agents[0].chain in metadata
 */
export function useOnchainManowars(options?: {
  includeRFA?: boolean;
  onlyComplete?: boolean;
}) {
  const { includeRFA = false, onlyComplete = true } = options || {};

  return useQuery({
    queryKey: ["onchain-manowars", "all-chains", includeRFA, onlyComplete],
    queryFn: async () => {
      // Fetch from all supported chains in parallel
      const chainPromises = SUPPORTED_CHAINS.map(async ({ id: chainId }) => {
        try {
          const contract = getManowarContractForChain(chainId);

          // Get total manowars count for this chain
          const total = await readContract({
            contract,
            method: "function totalManowars() view returns (uint256)",
            params: [],
          }) as bigint;

          const totalNum = Number(total);
          if (totalNum === 0) return [];

          // Fetch all manowars from this chain (IDs start at 1)
          const manowarPromises = Array.from({ length: totalNum }, (_, i) =>
            fetchManowarData(i + 1, chainId)
          );

          let manowars = (await Promise.all(manowarPromises)).filter((m): m is OnchainManowar => m !== null);

          // Fetch metadata for each manowar (to get walletAddress from IPFS)
          manowars = await Promise.all(manowars.map(m => fetchManowarMetadata(m, chainId)));

          // Filter based on options
          if (onlyComplete && !includeRFA) {
            manowars = manowars.filter(m => !m.hasActiveRfa);
          } else if (includeRFA && !onlyComplete) {
            manowars = manowars.filter(m => m.hasActiveRfa);
          }

          return manowars;
        } catch (error) {
          console.warn(`Failed to fetch manowars from chain ${chainId}:`, error);
          return [];
        }
      });

      // Merge all manowars from all chains
      const chainsManowars = await Promise.all(chainPromises);
      return chainsManowars.flat();
    },
    staleTime: 30 * 1000,
    retry: 2,
  });
}

/**
 * Fetch manowars owned by a specific address
 */
export function useManowarsByCreator(creator: string | undefined) {
  const { data: allManowars, ...rest } = useOnchainManowars({ onlyComplete: false });

  return {
    ...rest,
    data: allManowars?.filter(m =>
      m.creator.toLowerCase() === creator?.toLowerCase()
    ),
  };
}

/**
 * Fetch manowars with active RFAs (for marketplace RFA tab)
 */
export function useManowarsWithRFA() {
  return useOnchainManowars({ includeRFA: true, onlyComplete: false });
}



/**
 * Fetch a single manowar by ID (with IPFS metadata)
 */
export function useOnchainManowar(manowarId: number | null) {
  return useQuery({
    queryKey: ["onchain-manowar", manowarId],
    queryFn: async () => {
      if (!manowarId) return null;
      const manowar = await fetchManowarData(manowarId);
      if (!manowar) return null;
      return fetchManowarMetadata(manowar);
    },
    enabled: !!manowarId,
    staleTime: 30 * 1000,
  });
}

/**
 * Find a manowar by its wallet address (stored in IPFS metadata)
 * Iterates through all manowars and checks metadata for matching wallet
 */
async function fetchManowarByWalletAddress(walletAddress: string): Promise<OnchainManowar | null> {
  try {
    const contract = getManowarContract();

    // Get total manowars count
    const total = await readContract({
      contract,
      method: "function totalManowars() view returns (uint256)",
      params: [],
    }) as bigint;

    const totalNum = Number(total);
    const normalizedSearch = walletAddress.toLowerCase();

    // Search through all manowars (most recent first for efficiency)
    // Manowar IDs start at 1, not 0
    for (let i = totalNum; i >= 1; i--) {
      const manowar = await fetchManowarData(i);
      if (!manowar) continue;

      // Fetch metadata to get the wallet address (source of truth)
      const manowarWithMeta = await fetchManowarMetadata(manowar);

      if (manowarWithMeta.walletAddress && manowarWithMeta.walletAddress.toLowerCase() === normalizedSearch) {
        return manowarWithMeta;
      }
    }

    return null;
  } catch (error) {
    console.error(`Failed to find manowar by wallet ${walletAddress}:`, error);
    return null;
  }
}

/**
 * Fetch a single manowar by wallet address
 * This is the preferred method since wallet address is the canonical identifier
 */
export function useOnchainManowarByWallet(walletAddress: string | null) {
  return useQuery({
    queryKey: ["onchain-manowar-wallet", walletAddress?.toLowerCase()],
    queryFn: async () => {
      if (!walletAddress) return null;
      return fetchManowarByWalletAddress(walletAddress);
    },
    enabled: !!walletAddress && walletAddress.startsWith("0x"),
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch a single manowar by either ID or wallet address
 * Automatically detects the identifier type
 */
export function useOnchainManowarByIdentifier(identifier: string | null) {
  // Determine if identifier is a wallet address (0x...) or numeric ID
  // Wallet address = 0x + 40 hex chars = 42 total
  const isWalletAddress = identifier?.startsWith("0x") && identifier.length === 42;
  const numericId = !isWalletAddress && identifier ? parseInt(identifier) : null;
  const walletAddress = isWalletAddress ? identifier : null;

  const byIdQuery = useOnchainManowar(!isWalletAddress ? numericId : null);
  const byWalletQuery = useOnchainManowarByWallet(isWalletAddress ? walletAddress : null);

  if (isWalletAddress) {
    return byWalletQuery;
  }
  return byIdQuery;
}

// =============================================================================
// RFA (Request-For-Agent) Types & Hooks
// =============================================================================

/** RFA status enum matching contract */
export type RFAStatus = 'None' | 'Open' | 'Fulfilled' | 'Cancelled';

/** On-chain RFA data */
export interface OnchainRFA {
  id: number;
  manowarId: number;
  title: string;
  description: string;
  requiredSkills: string[]; // bytes32[] decoded to strings
  offerAmount: string; // USDC formatted (6 decimals)
  offerAmountFormatted: string; // Display string like "$0.50"
  publisher: string;
  createdAt: number; // Unix timestamp
  status: RFAStatus;
  fulfilledByAgentId: number;
  agentCreator: string;
}

/** RFA submission */
export interface RFASubmission {
  agentId: number;
  creator: string;
  submittedAt: number; // Unix timestamp
}

/** Contract RFA data structure */
interface ContractRFAData {
  manowarId: bigint;
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

/** Contract submission structure */
interface ContractSubmission {
  agentId: bigint;
  creator: string;
  submittedAt: bigint;
}

/** Convert status number to enum */
function parseRFAStatus(status: number): RFAStatus {
  switch (status) {
    case 1: return 'Open';
    case 2: return 'Fulfilled';
    case 3: return 'Cancelled';
    default: return 'None';
  }
}

/** Parse contract RFA data to typed structure */
function parseRFAData(id: number, data: ContractRFAData): OnchainRFA {
  const offerAmount = weiToUsdc(data.offerAmount);
  const offerNum = parseFloat(offerAmount);

  return {
    id,
    manowarId: Number(data.manowarId),
    title: data.title,
    description: data.description,
    requiredSkills: data.requiredSkills.map(s => s), // Keep as hex for now
    offerAmount,
    offerAmountFormatted: offerNum < 0.01 ? `$${offerNum.toFixed(4)}` : `$${offerNum.toFixed(2)}`,
    publisher: data.publisher,
    createdAt: Number(data.createdAt),
    status: parseRFAStatus(data.status),
    fulfilledByAgentId: Number(data.fulfilledByAgentId),
    agentCreator: data.agentCreator,
  };
}

/** Fetch single RFA data by ID */
async function fetchRFAData(rfaId: number): Promise<OnchainRFA | null> {
  try {
    const contract = getRFAContract();
    const data = await readContract({
      contract,
      method: "function getRFAData(uint256 rfaId) view returns ((uint256 manowarId, string title, string description, bytes32[] requiredSkills, uint256 offerAmount, address publisher, uint256 createdAt, uint8 status, uint256 fulfilledByAgentId, address agentCreator))",
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
      method: "function getSubmissions(uint256 rfaId) view returns ((uint256 agentId, address creator, uint256 submittedAt)[])",
      params: [BigInt(rfaId)],
    }) as ContractSubmission[];

    return submissions.map(s => ({
      agentId: Number(s.agentId),
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
export function useOpenRFAs() {
  return useQuery({
    queryKey: ["rfa", "open"],
    queryFn: async () => {
      const contract = getRFAContract();

      // Get all open RFA IDs
      const rfaIds = await readContract({
        contract,
        method: "function getOpenRFAs() view returns (uint256[])",
        params: [],
      }) as bigint[];

      if (rfaIds.length === 0) return [];

      // Fetch data for each RFA
      const rfaPromises = rfaIds.map(id => fetchRFAData(Number(id)));
      const rfas = await Promise.all(rfaPromises);

      return rfas.filter((r): r is OnchainRFA => r !== null);
    },
    staleTime: 30 * 1000,
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
  });
}

/**
 * Fetch RFAs for a specific Manowar
 */
export function useRFAsForManowar(manowarId: number | null) {
  return useQuery({
    queryKey: ["rfa", "by-manowar", manowarId],
    queryFn: async () => {
      if (!manowarId) return [];

      const contract = getRFAContract();
      const rfaIds = await readContract({
        contract,
        method: "function getRFAsForManowar(uint256 manowarId) view returns (uint256[])",
        params: [BigInt(manowarId)],
      }) as bigint[];

      if (rfaIds.length === 0) return [];

      const rfaPromises = rfaIds.map(id => fetchRFAData(Number(id)));
      const rfas = await Promise.all(rfaPromises);

      return rfas.filter((r): r is OnchainRFA => r !== null);
    },
    enabled: !!manowarId && manowarId > 0,
    staleTime: 30 * 1000,
  });
}

