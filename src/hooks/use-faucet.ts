/**
 * Faucet Hook
 *
 * React Query hooks for faucet operations:
 * - Check faucet status across chains
 * - Check if address has claimed
 * - Claim USDC from faucet
 *
 * @module hooks/use-faucet
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";

// =============================================================================
// Types
// =============================================================================

export interface FaucetStatus {
    chainId: number;
    chainName: string;
    totalClaims: number;
    maxClaims: number;
    remainingClaims: number;
    faucetBalance: string;
    faucetBalanceFormatted: string;
    isPaused: boolean;
    faucetAddress: string;
    usdcAddress: string;
    isConfigured: boolean;
}

export interface FaucetStatusResponse {
    faucets: FaucetStatus[];
    claimAmount: number;
    claimAmountFormatted: string;
    maxClaims: number;
}

export interface ClaimResult {
    success: boolean;
    txHash?: string;
    error?: string;
    alreadyClaimed?: boolean;
    globalClaimStatus?: {
        claimedOnChain?: number;
        claimedOnChainName?: string;
        claimedAt?: number;
    };
}

export interface ClaimCheckResult {
    address: string;
    hasClaimed: boolean;
    claimedOnChain?: number;
    claimedOnChainName?: string;
    claimedAt?: number;
}

// =============================================================================
// API Functions
// =============================================================================

async function fetchFaucetStatus(): Promise<FaucetStatusResponse> {
    const response = await fetch(`${API_BASE_URL}/api/faucet/status`);
    if (!response.ok) {
        throw new Error("Failed to fetch faucet status");
    }
    return response.json();
}

async function fetchFaucetCheck(address: string): Promise<ClaimCheckResult> {
    const response = await fetch(`${API_BASE_URL}/api/faucet/check/${address}`);
    if (!response.ok) {
        throw new Error("Failed to check faucet status");
    }
    return response.json();
}

async function claimFaucetUSDC(address: string, chainId: number): Promise<ClaimResult> {
    const response = await fetch(`${API_BASE_URL}/api/faucet/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chainId }),
    });
    return response.json();
}

// =============================================================================
// Query Keys
// =============================================================================

const faucetKeys = {
    all: ["faucet"] as const,
    status: () => [...faucetKeys.all, "status"] as const,
    check: (address: string) => [...faucetKeys.all, "check", address.toLowerCase()] as const,
};

// =============================================================================
// Hooks
// =============================================================================

/**
 * Get faucet status for all supported chains
 */
export function useFaucetStatus() {
    return useQuery({
        queryKey: faucetKeys.status(),
        queryFn: fetchFaucetStatus,
        staleTime: 60 * 1000,
        refetchInterval: 120 * 1000,
    });
}

/**
 * Check if an address has claimed from any faucet
 */
export function useFaucetCheck(address: string | undefined) {
    return useQuery({
        queryKey: faucetKeys.check(address || ""),
        queryFn: () => fetchFaucetCheck(address!),
        enabled: !!address && address.startsWith("0x") && address.length === 42,
        staleTime: 30 * 1000,
    });
}

/**
 * Claim USDC from faucet
 */
export function useFaucetClaim() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ address, chainId }: { address: string; chainId: number }) =>
            claimFaucetUSDC(address, chainId),
        onSuccess: (data, variables) => {
            if (data.success) {
                queryClient.invalidateQueries({
                    queryKey: faucetKeys.check(variables.address),
                });
                queryClient.invalidateQueries({
                    queryKey: faucetKeys.status(),
                });
            }
        },
    });
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerTxUrl(txHash: string, chainId: number): string {
    const explorers: Record<number, string> = {
        338: "https://explorer.cronos.org/testnet",
        43113: "https://testnet.snowtrace.io",
        421614: "https://sepolia.arbiscan.io",
    };
    const baseUrl = explorers[chainId];
    return baseUrl ? `${baseUrl}/tx/${txHash}` : "#";
}

/**
 * Get chain color for UI
 */
export function getChainColor(chainId: number): string {
    const colors: Record<number, string> = {
        338: "text-blue-400",
        43113: "text-red-400",
        421614: "text-purple-400",
    };
    return colors[chainId] || "text-cyan-400";
}