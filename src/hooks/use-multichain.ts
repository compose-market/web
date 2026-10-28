/**
 * Multi-Chain Balance Hook
 *
 * Fetches USDC balances from ALL supported chains in parallel —
 * both EVM (via Thirdweb ERC-20 reads) and Solana (via SPL token
 * account reads on the real Solana RPC).
 *
 * Used for cross-chain liquidity detection for x402 payments and
 * for the network-selector balance display.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EvmNetworkId, NearNetworkId, NetworkId, SolanaNetworkId, FacilitatorChain } from "@compose-market/sdk/chains";
import { evmChainId, isEvmNetwork, isNearNetwork, isSolanaNetwork } from "@/lib/performance/networks";
import { useChain } from "@/contexts/Network";
import { durableQueryMeta } from "@/lib/queryClient";

export interface ChainBalance {
    network: NetworkId;
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

interface MultiChainBalanceAccounts {
    evmAddress?: string | null;
    solanaAddress?: string | null;
    nearAddress?: string | null;
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

async function fetchEvmUsdcBalance(address: string, network: EvmNetworkId): Promise<bigint> {
    try {
        const [{ readContract }, { getUsdcContractForNetwork }] = await Promise.all([
            import("thirdweb"),
            import("@/lib/chains"),
        ]);
        const contract = getUsdcContractForNetwork(network);
        const balance = await readContract({
            contract,
            method: "function balanceOf(address account) view returns (uint256)",
            params: [address as `0x${string}`],
        }) as bigint;
        return balance;
    } catch (error) {
        console.warn(`Failed to fetch USDC balance on ${network}:`, error);
        return BigInt(0);
    }
}

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function decodeBase64(value: string): Uint8Array {
    const binary = globalThis.atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary);
}

function readBigUInt64LE(data: Uint8Array, offset: number): bigint {
    let value = BigInt(0);
    for (let index = 0; index < 8; index += 1) {
        value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8);
    }
    return value;
}

async function readSolanaTokenProgram(
    rpc: { getAccountInfo: (addr: any) => { send: () => Promise<{ value?: { owner?: string } | null }> } },
    usdcMint: string,
): Promise<string> {
    const { address } = await import("@solana/kit");
    const info = await rpc.getAccountInfo(address(usdcMint)).send();
    const owner = info.value?.owner;
    if (owner === SPL_TOKEN_PROGRAM || owner === SPL_TOKEN_2022_PROGRAM) {
        return owner;
    }
    throw new Error(owner ? `Unsupported Solana token program: ${owner}` : `Solana mint not found: ${usdcMint}`);
}

export async function fetchSolanaUsdcBalance(
    ownerAddress: string,
    usdcMint: string,
    network: SolanaNetworkId,
    rpcUrl: string,
): Promise<bigint> {
    try {
        const [{ getProgramDerivedAddress, getAddressEncoder, address }, { createSolanaRpcFromNetwork }] = await Promise.all([
            import("@solana/kit"),
            import("@/lib/svm/swig"),
        ]);
        const rpc = createSolanaRpcFromNetwork(network, rpcUrl);
        const tokenProgram = await readSolanaTokenProgram(rpc, usdcMint);
        const encoder = getAddressEncoder();
        const [ata] = await getProgramDerivedAddress({
            programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
            seeds: [
                encoder.encode(address(ownerAddress)),
                encoder.encode(address(tokenProgram)),
                encoder.encode(address(usdcMint)),
            ],
        });

        const info = await rpc.getAccountInfo(ata, { encoding: "base64" }).send();

        if (!info.value) return BigInt(0);

        const data = decodeBase64(info.value.data[0] as string);
        if (data.length < 72) return BigInt(0);

        return readBigUInt64LE(data, 64);
    } catch (error) {
        console.warn(`Failed to fetch Solana USDC balance on ${network}:`, error);
        return BigInt(0);
    }
}

function formatUsdcBalance(balance: bigint): string {
    const num = Number(balance) / 1_000_000;
    return num.toFixed(2);
}

export function useMultiChainBalance(accounts: MultiChainBalanceAccounts, options: MultiChainBalanceOptions = {}) {
    const evmAddress = accounts.evmAddress ?? null;
    const solanaAddress = accounts.solanaAddress ?? null;
    const queryEnabled = useDeferredQueryEnabled(
        Boolean(evmAddress || solanaAddress) && (options.enabled ?? true),
        options.deferUntilIdle ?? false,
    );

    const { chains } = useChain();

    return useQuery({
        queryKey: ["multichain-balance", evmAddress, solanaAddress, chains],
        queryFn: async (): Promise<ChainBalance[]> => {
            if (!evmAddress && !solanaAddress) {
                return [];
            }

            const balances = await Promise.all(
                chains.map(async (chain: FacilitatorChain): Promise<ChainBalance> => {
                    const network = chain.network;

                    if (isEvmNetwork(network)) {
                        const balance = evmAddress
                            ? await fetchEvmUsdcBalance(evmAddress, network)
                            : BigInt(0);
                        return {
                            network,
                            chainName: chain.name || `Chain ${evmChainId(network)}`,
                            balance,
                            formatted: formatUsdcBalance(balance),
                            color: chain.isTestnet ? "red" : "cyan",
                        };
                    }

                    const balance = solanaAddress
                        ? await fetchSolanaUsdcBalance(
                            solanaAddress,
                            chain.assetAddress,
                            network as SolanaNetworkId,
                            chain.rpcUrl,
                        )
                        : BigInt(0);

                    return {
                        network,
                        chainName: chain.name || network,
                        balance,
                        formatted: formatUsdcBalance(balance),
                        color: chain.isTestnet ? "red" : "cyan",
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
        // Dehydrate into the IndexedDB persister so balances render instantly
        // on page reload (revalidated by staleTime/refetchInterval above).
        meta: durableQueryMeta,
    });
}

export function useBestLiquidityChain(
    accounts: MultiChainBalanceAccounts,
    minAmount: bigint,
    preferredNetwork?: NetworkId,
    options: MultiChainBalanceOptions = {},
) {
    const { data: balances, isLoading, error } = useMultiChainBalance(accounts, options);

    let bestNetwork: NetworkId | null = null;
    let isPreferredChainUsed = false;

    if (balances && balances.length > 0) {
        if (preferredNetwork) {
            const preferred = balances.find((balance) => balance.network === preferredNetwork);
            if (preferred && preferred.balance >= minAmount) {
                bestNetwork = preferred.network;
                isPreferredChainUsed = true;
            }
        }

        if (!bestNetwork) {
            const chainWithBalance = balances.find((balance) => balance.balance >= minAmount);
            if (chainWithBalance) {
                bestNetwork = chainWithBalance.network;
            }
        }
    }

    return {
        bestNetwork,
        isPreferredChainUsed,
        balances,
        isLoading,
        error,
    };
}

export function useTotalBalance(accounts: MultiChainBalanceAccounts, options: MultiChainBalanceOptions = {}) {
    const { data: balances, isLoading, error } = useMultiChainBalance(accounts, options);

    const total = balances?.reduce((sum, balance) => sum + balance.balance, BigInt(0)) || BigInt(0);

    return {
        total,
        formatted: formatUsdcBalance(total),
        balances,
        isLoading,
        error,
    };
}
