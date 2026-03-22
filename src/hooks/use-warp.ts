/**
 * Hooks for Warp contract interactions
 * Allows checking warp status and fetching warped agents
 */
import { useQuery } from "@tanstack/react-query";
import { readContract } from "thirdweb";
import { keccak256, encodePacked, type Address } from "viem";
import { getWarpContract, getAgentFactoryContract } from "@/lib/contracts";

// =============================================================================
// Types
// =============================================================================

export interface WarpedAgentData {
  originalCreator: Address;
  warper: Address;
  originalAgentHash: `0x${string}`;
  royaltyExpiryDate: bigint;
  royaltiesClaimed: boolean;
  accumulatedRoyalties: bigint;
}

export type WarpStatus = "native" | "warped" | "must-warp";

// =============================================================================
// Hash Computation
// =============================================================================

/**
 * Compute hash for external agent (used as originalAgentHash in warp contract)
 * This creates a unique identifier for an agent from an external registry
 */
export function computeExternalAgentHash(registry: string, address: string): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "string"],
      [registry, address]
    )
  );
}

// =============================================================================
// Contract Read Functions
// =============================================================================

/**
 * Check if a manowar agent (by ID) is warped
 */
async function checkIsWarped(agentId: number): Promise<boolean> {
  try {
    const contract = getWarpContract();
    const isWarped = await readContract({
      contract,
      method: "function isWarped(uint256 agentId) view returns (bool)",
      params: [BigInt(agentId)],
    });
    return isWarped as boolean;
  } catch (error) {
    console.error(`Failed to check warp status for agent ${agentId}:`, error);
    return false;
  }
}

/**
 * Get warped agent data by ID
 */
async function fetchWarpedData(warpedAgentId: number): Promise<WarpedAgentData | null> {
  try {
    const contract = getWarpContract();
    const data = await readContract({
      contract,
      method: "function getWarpedData(uint256 warpedAgentId) view returns ((address originalCreator, address warper, bytes32 originalAgentHash, uint256 royaltyExpiryDate, bool royaltiesClaimed, uint256 accumulatedRoyalties))",
      params: [BigInt(warpedAgentId)],
    });
    return data as WarpedAgentData;
  } catch (error) {
    console.error(`Failed to fetch warped data for agent ${warpedAgentId}:`, error);
    return null;
  }
}

/**
 * Check if an external agent hash has been warped
 * Returns the warped agent ID if found, 0 otherwise
 */
async function getWarpedAgentIdByHash(externalHash: `0x${string}`): Promise<number> {
  try {
    const contract = getWarpContract();
    const warpedId = await readContract({
      contract,
      method: "function getWarpedAgentId(bytes32 externalHash) view returns (uint256)",
      params: [externalHash],
    });
    return Number(warpedId);
  } catch (error) {
    console.error(`Failed to check warped agent ID for hash ${externalHash}:`, error);
    return 0;
  }
}

// =============================================================================
// React Query Hooks
// =============================================================================

/**
 * Hook to check if a manowar agent is warped
 */
export function useIsWarped(agentId: number | null) {
  return useQuery({
    queryKey: ["is-warped", agentId],
    queryFn: async () => {
      if (!agentId) return false;
      return checkIsWarped(agentId);
    },
    enabled: !!agentId,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook to get warped agent data
 */
export function useWarpedData(warpedAgentId: number | null) {
  return useQuery({
    queryKey: ["warped-data", warpedAgentId],
    queryFn: async () => {
      if (!warpedAgentId) return null;
      return fetchWarpedData(warpedAgentId);
    },
    enabled: !!warpedAgentId,
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to check if an external agent has been warped
 * Returns { isWarped: boolean, warpedAgentId: number }
 */
export function useIsExternalWarped(registry: string | null, address: string | null) {
  return useQuery({
    queryKey: ["is-external-warped", registry, address],
    queryFn: async () => {
      if (!registry || !address) return { isWarped: false, warpedAgentId: 0 };
      
      const externalHash = computeExternalAgentHash(registry, address);
      const warpedAgentId = await getWarpedAgentIdByHash(externalHash);
      
      return {
        isWarped: warpedAgentId > 0,
        warpedAgentId,
        externalHash,
      };
    },
    enabled: !!registry && !!address,
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to get warp status for any agent
 * Returns WarpStatus: "native" | "warped" | "must-warp"
 */
export function useWarpStatus(agent: {
  registry: string;
  id: string;
  address?: string;
} | null) {
  const isManowar = agent?.registry === "manowar";
  const manowarId = isManowar && agent?.id ? parseInt(agent.id.replace("manowar-", "")) : null;
  
  // For manowar agents, check isWarped directly
  const { data: isWarpedOnchain } = useIsWarped(manowarId);
  
  // For external agents, check if the hash has been warped
  const externalRegistry = !isManowar ? (agent?.registry || null) : null;
  const externalAddress = !isManowar ? (agent?.address || agent?.id || null) : null;
  const { data: externalWarpData } = useIsExternalWarped(externalRegistry, externalAddress);
  
  if (!agent) return { status: null as WarpStatus | null, warpedAgentId: null };
  
  if (isManowar) {
    // Manowar agents: check if this specific agent was created via warp
    return {
      status: isWarpedOnchain ? "warped" as WarpStatus : "native" as WarpStatus,
      warpedAgentId: isWarpedOnchain ? manowarId : null,
    };
  } else {
    // External agents: check if they've been warped into Manowar
    return {
      status: externalWarpData?.isWarped ? "warped" as WarpStatus : "must-warp" as WarpStatus,
      warpedAgentId: externalWarpData?.warpedAgentId || null,
    };
  }
}

/**
 * Hook to fetch all warped agent IDs
 * Iterates through all manowar agents and checks which are warped
 */
export function useWarpedAgents() {
  return useQuery({
    queryKey: ["warped-agents"],
    queryFn: async () => {
      // Get total agents from AgentFactory
      const factoryContract = getAgentFactoryContract();
      const totalAgents = await readContract({
        contract: factoryContract,
        method: "function totalAgents() view returns (uint256)",
        params: [],
      }) as bigint;
      
      const total = Number(totalAgents);
      if (total === 0) return [];
      
      // Check warp status for each agent
      const warpedAgentIds: number[] = [];
      
      // Use Promise.all for parallel fetching
      const warpChecks = await Promise.all(
        Array.from({ length: total }, (_, i) => checkIsWarped(i + 1))
      );
      
      warpChecks.forEach((isWarped, i) => {
        if (isWarped) {
          warpedAgentIds.push(i + 1);
        }
      });
      
      return warpedAgentIds;
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to batch check warp status for multiple agent IDs
 */
export function useBatchWarpStatus(agentIds: number[]) {
  return useQuery({
    queryKey: ["batch-warp-status", agentIds.join(",")],
    queryFn: async () => {
      if (agentIds.length === 0) return new Map<number, boolean>();
      
      const results = await Promise.all(
        agentIds.map(async (id) => ({
          id,
          isWarped: await checkIsWarped(id),
        }))
      );
      
      return new Map(results.map(r => [r.id, r.isWarped]));
    },
    enabled: agentIds.length > 0,
    staleTime: 60 * 1000,
  });
}
