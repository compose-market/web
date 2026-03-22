/**
 * Multi-Chain Balance Hook
 *
 * Fetches USDC balances from ALL supported chains in parallel.
 * Used for cross-chain liquidity detection for x402 payments.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SUPPORTED_CHAINS, getUsdcContractForChain, CHAIN_CONFIG } from "@/lib/chains";

export interface ChainBalance {
    chainId: number;
    chainName: string;
    balance: bigint;
    formatted: string;
    color: string;
}

interface MultiChainBalanceOptions {
    enabled?: boolean;
    deferUntilIdle?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
}

function useDeferredQueryEnabled(enabled: boolean, deferUntilIdle: boolean): boolean {
    const [idleReady, setIdleReady] = useState(!deferUntilIdle);

    useEffect(() => {
        if (!enabled) {
            setIdleReady(false);
            return;
        }

        if (!deferUntilIdle) {
            setIdleReady(true);
            return;
        }

        if (typeof window === "undefined") {
            setIdleReady(true);
            return;
        }

        let cancelled = false;
        const activate = () => {
            if (!cancelled) {
                setIdleReady(true);
            }
        };

        if ("requestIdleCallback" in window) {
            const id = window.requestIdleCallback(activate, { timeout: 1_500 });
            return () => {
                cancelled = true;
                window.cancelIdleCallback?.(id);
            };
        }

        const timeoutId = globalThis.setTimeout(activate, 250);
        return () => {
            cancelled = true;
            globalThis.clearTimeout(timeoutId);
        };
    }, [enabled, deferUntilIdle]);

    return enabled && idleReady;
}

async function fetchUsdcBalance(address: string, chainId: number): Promise<bigint> {
    try {
        const { readContract } = await import("thirdweb");
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
    const num = Number(balance) / 1_000_000;
    return num.toFixed(2);
}

export function useMultiChainBalance(address: string | undefined, options: MultiChainBalanceOptions = {}) {
    const queryEnabled = useDeferredQueryEnabled(
        Boolean(address) && (options.enabled ?? true),
        options.deferUntilIdle ?? false,
    );

    return useQuery({
        queryKey: ["multichain-balance", address],
        queryFn: async (): Promise<ChainBalance[]> => {
            if (!address) {
                return [];
            }

            const balances = await Promise.all(
                SUPPORTED_CHAINS.map(async ({ id: chainId }) => {
                    const balance = await fetchUsdcBalance(address, chainId);
                    const chainConfig = CHAIN_CONFIG[chainId];
                    return {
                        chainId,
                        chainName: chainConfig?.name || `Chain ${chainId}`,
                        balance,
                        formatted: formatUsdcBalance(balance),
                        color: chainConfig?.color || "gray",
                    };
                }),
            );

            return balances.sort((a, b) => {
                if (a.balance > b.balance) return -1;
                if (a.balance < b.balance) return 1;
                return 0;
            });
        },
        enabled: queryEnabled,
        staleTime: options.staleTime ?? 30 * 1000,
        refetchInterval: options.refetchInterval ?? 60 * 1000,
    });
}

export function useBestLiquidityChain(
    address: string | undefined,
    minAmount: bigint,
    preferredChainId?: number
) {
    const { data: balances, isLoading, error } = useMultiChainBalance(address);

    let bestChainId: number | null = null;
    let isPreferredChainUsed = false;

    if (balances && balances.length > 0) {
        if (preferredChainId) {
            const preferred = balances.find((balance) => balance.chainId === preferredChainId);
            if (preferred && preferred.balance >= minAmount) {
                bestChainId = preferredChainId;
                isPreferredChainUsed = true;
            }
        }

        if (!bestChainId) {
            const chainWithBalance = balances.find((balance) => balance.balance >= minAmount);
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

export function useTotalBalance(address: string | undefined, options: MultiChainBalanceOptions = {}) {
    const { data: balances, isLoading, error } = useMultiChainBalance(address, options);

    const total = balances?.reduce((sum, balance) => sum + balance.balance, BigInt(0)) || BigInt(0);

    return {
        total,
        formatted: formatUsdcBalance(total),
        balances,
        isLoading,
        error,
    };
}
