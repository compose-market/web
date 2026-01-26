/**
 * Multi-Chain Balance Hook
 * 
 * Fetches USDC balances from ALL supported chains in parallel.
 * Used for cross-chain liquidity detection for x402 payments.
 */
import { useQuery } from "@tanstack/react-query";
import { readContract } from "thirdweb";
import { SUPPORTED_CHAINS, getUsdcContractForChain, CHAIN_CONFIG } from "@/lib/chains";

// =============================================================================
// Types
// =============================================================================

export interface ChainBalance {
    chainId: number;
    chainName: string;
    balance: bigint;
    formatted: string; // Human readable (e.g., "123.45")
    color: string; // For UI badge
}

// =============================================================================
// Balance Fetching
// =============================================================================

async function fetchUsdcBalance(address: string, chainId: number): Promise<bigint> {
    try {
        const contract = getUsdcContractForChain(chainId);
        const balance = await readContract({
            contract,
            method: "function balanceOf(address account) view returns (uint256)",
            params: [address as `0x${string}`],
        }) as bigint;
        return balance;
    } catch (error) {
        console.warn(`Failed to fetch USDC balance on chain ${chainId}:`, error);
        return BigInt(0);
    }
}

function formatUsdcBalance(balance: bigint): string {
    const num = Number(balance) / 1_000_000; // USDC has 6 decimals
    return num.toFixed(2);
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch USDC balances from all supported chains
 * Returns array sorted by balance (highest first)
 */
export function useMultiChainBalance(address: string | undefined) {
    return useQuery({
        queryKey: ["multichain-balance", address],
        queryFn: async (): Promise<ChainBalance[]> => {
            if (!address) return [];

            // Fetch from all chains in parallel
            const balancePromises = SUPPORTED_CHAINS.map(async ({ id: chainId }) => {
                const balance = await fetchUsdcBalance(address, chainId);
                const chainConfig = CHAIN_CONFIG[chainId];
                return {
                    chainId,
                    chainName: chainConfig?.name || `Chain ${chainId}`,
                    balance,
                    formatted: formatUsdcBalance(balance),
                    color: chainConfig?.color || "gray",
                };
            });

            const balances = await Promise.all(balancePromises);

            // Sort by balance (highest first)
            return balances.sort((a, b) => {
                if (a.balance > b.balance) return -1;
                if (a.balance < b.balance) return 1;
                return 0;
            });
        },
        enabled: !!address,
        staleTime: 30 * 1000, // 30 seconds
        refetchInterval: 60 * 1000, // Refresh every minute
    });
}

/**
 * Find the chain with sufficient balance for a given amount
 * Returns the chainId with enough liquidity, or null if none found
 */
export function useBestLiquidityChain(
    address: string | undefined,
    minAmount: bigint,
    preferredChainId?: number
) {
    const { data: balances, isLoading, error } = useMultiChainBalance(address);

    // Find best chain
    let bestChainId: number | null = null;
    let isPreferredChainUsed = false;

    if (balances && balances.length > 0) {
        // First, check if preferred chain has enough balance
        if (preferredChainId) {
            const preferred = balances.find(b => b.chainId === preferredChainId);
            if (preferred && preferred.balance >= minAmount) {
                bestChainId = preferredChainId;
                isPreferredChainUsed = true;
            }
        }

        // If preferred chain doesn't work, find any chain with sufficient balance
        if (!bestChainId) {
            const chainWithBalance = balances.find(b => b.balance >= minAmount);
            if (chainWithBalance) {
                bestChainId = chainWithBalance.chainId;
            }
        }
    }

    return {
        bestChainId,
        isPreferredChainUsed,
        balances,
        isLoading,
        error,
    };
}

/**
 * Get total USDC balance across all chains
 */
export function useTotalBalance(address: string | undefined) {
    const { data: balances, isLoading, error } = useMultiChainBalance(address);

    const total = balances?.reduce((sum, b) => sum + b.balance, BigInt(0)) || BigInt(0);

    return {
        total,
        formatted: formatUsdcBalance(total),
        balances,
        isLoading,
        error,
    };
}
