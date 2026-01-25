/**
 * Unified API Hook
 * 
 * Handles all API calls with:
 * - x402 payment wrapping (via thirdweb)
 * - 3 payment flows (playground, agent, manowar)
 * - Automatic response parsing via multimodal.ts
 */

import { useCallback } from "react";
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { thirdwebClient } from "@/lib/facilitator";
import { API_BASE_URL } from "@/lib/api";
import { parseMultimodalResponse } from "@/lib/multimodal";
import type { MultimodalResult } from "@/lib/api";

// Normalized fetch that works with thirdweb payment wrapper
const createNormalizedFetch = () => fetch;

// =============================================================================
// Configuration
// =============================================================================

// Backend URLs
const LAMBDA_URL = API_BASE_URL || "";
const MANOWAR_URL = import.meta.env.VITE_MANOWAR_URL
    ? import.meta.env.VITE_MANOWAR_URL.replace(/\/$/, "")
    : "https://manowar.compose.market";

// Default prices in USDC wei (6 decimals)
const PRICES = {
    playground: BigInt(5000),   // $0.005
    agent: BigInt(5000),        // $0.005
    manowar: BigInt(10000),     // $0.01 orchestration fee
} as const;

// =============================================================================
// Types
// =============================================================================

export type EndpointType = "playground" | "agent" | "manowar";

export interface SendMessageOptions {
    endpoint: EndpointType;
    path: string;
    body: Record<string, unknown>;
    price?: bigint;
    headers?: Record<string, string>;
    onStreamChunk?: (chunk: string) => void;
    uploadToPinata?: boolean;
    conversationId?: string;
}

export interface UseApiReturn {
    sendMessage: (options: SendMessageOptions) => Promise<MultimodalResult>;
    isConnected: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useApi(): UseApiReturn {
    const wallet = useActiveWallet();
    const account = useActiveAccount();
    const isConnected = !!wallet && !!account;

    /**
     * Send a message with x402 payment and automatic response parsing
     */
    const sendMessage = useCallback(async (options: SendMessageOptions): Promise<MultimodalResult> => {
        const {
            endpoint,
            path,
            body,
            price = PRICES[endpoint],
            headers = {},
            onStreamChunk,
            uploadToPinata = true,
            conversationId,
        } = options;

        if (!wallet) {
            return { type: "text", success: false, error: "Wallet not connected" };
        }

        try {
            // Build base URL based on endpoint type
            const baseUrl = endpoint === "playground" ? LAMBDA_URL : MANOWAR_URL;
            const fullUrl = `${baseUrl}${path}`;

            // Create payment-wrapped fetch
            const normalizedFetch = createNormalizedFetch();
            const fetchWithPayment = wrapFetchWithPayment(
                normalizedFetch,
                thirdwebClient,
                wallet,
                { maxValue: price }
            );

            // Add session headers if available
            const sessionHeaders: Record<string, string> = {};
            const budgetRemaining = sessionStorage.getItem("session_budget_remaining");
            if (budgetRemaining && parseInt(budgetRemaining) > 0) {
                sessionHeaders["x-session-active"] = "true";
                sessionHeaders["x-session-budget-remaining"] = budgetRemaining;
            }

            // Add user address for agent/manowar endpoints
            if (endpoint !== "playground" && account?.address) {
                sessionHeaders["x-session-user-address"] = account.address;
            }

            // Make the request
            const response = await fetchWithPayment(fullUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...sessionHeaders,
                    ...headers,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                return {
                    type: "text",
                    success: false,
                    error: errorData.error || errorData.message || `Request failed: ${response.status}`,
                };
            }

            // Parse response using multimodal parser
            return await parseMultimodalResponse(response, {
                onStreamChunk,
                uploadToPinata,
                conversationId,
            });

        } catch (err) {
            return {
                type: "text",
                success: false,
                error: err instanceof Error ? err.message : "Unknown error",
            };
        }
    }, [wallet, account]);

    return {
        sendMessage,
        isConnected,
    };
}

// =============================================================================
// Helper: Build endpoint-specific paths
// =============================================================================

export function buildAgentChatPath(agentWallet: string): string {
    return `/agent/${agentWallet}/chat`;
}

export function buildManowarChatPath(manowarWallet: string): string {
    return `/manowar/${manowarWallet}/chat`;
}


