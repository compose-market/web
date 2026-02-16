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
import { createPaymentFetch } from "@/lib/payment";
import { useChain } from "@/contexts/ChainContext";
import { API_BASE_URL } from "@/lib/api";
import { parseMultimodalResponse } from "@/lib/multimodal";
import { useSession } from "@/hooks/use-session.tsx";
import type { MultimodalResult } from "@/lib/api";

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
    agent: BigInt(10000),        // $0.01
    manowar: BigInt(50000),     // $0.05 orchestration fee
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
    const { paymentChainId } = useChain();
    const { sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken } = useSession();
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

        if (!wallet || !account) {
            return { type: "text", success: false, error: "Wallet not connected" };
        }

        try {
            // Build base URL based on endpoint type
            const baseUrl = endpoint === "playground" ? LAMBDA_URL : MANOWAR_URL;
            const fullUrl = `${baseUrl}${path}`;

            let activeComposeKeyToken = composeKeyToken;
            if (sessionActive && budgetRemaining > 0 && !activeComposeKeyToken) {
                activeComposeKeyToken = await ensureComposeKeyToken();
            }
            const canUseSessionBypass = Boolean(sessionActive && budgetRemaining > 0 && activeComposeKeyToken);

            const sessionHeaders: Record<string, string> = {};
            if (canUseSessionBypass) {
                sessionHeaders["x-session-active"] = "true";
                sessionHeaders["x-session-budget-remaining"] = budgetRemaining.toString();
                sessionHeaders["x-session-user-address"] = account.address;
            }

            // Chain-aware payment: routes to Cronos x402 or ThirdWeb based on selected chain
            const fetchWithPayment = createPaymentFetch({
                chainId: paymentChainId,
                account,
                wallet,
                maxValue: price,
                sessionToken: canUseSessionBypass ? activeComposeKeyToken || undefined : undefined,
                sessionHeaders,
            });

            // Add user address for agent/manowar endpoints
            if (endpoint !== "playground" && account.address) {
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
                videoStatusFetch: fetchWithPayment,
            });

        } catch (err) {
            return {
                type: "text",
                success: false,
                error: err instanceof Error ? err.message : "Unknown error",
            };
        }
    }, [
        wallet,
        account,
        paymentChainId,
        sessionActive,
        budgetRemaining,
        composeKeyToken,
        ensureComposeKeyToken,
    ]);

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

