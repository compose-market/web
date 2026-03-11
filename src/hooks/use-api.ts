/**
 * Unified API Hook
 * 
 * Handles all API calls with:
 * - x402 payment wrapping (via thirdweb)
 * - 3 payment flows (playground, agent, workflow)
 * - Automatic response parsing via multimodal.ts
 */

import { useCallback } from "react";
import { useActiveWallet } from "thirdweb/react";
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
const API_URL = API_BASE_URL;

// =============================================================================
// Types
// =============================================================================

export type EndpointType = "playground" | "agent" | "workflow";

export interface SendMessageOptions {
    endpoint: EndpointType;
    path: string;
    body: Record<string, unknown>;
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
    const { paymentChainId } = useChain();
    const { sessionActive, budgetRemaining, composeKeyToken, ensureComposeKeyToken } = useSession();
    const isConnected = !!wallet;

    /**
     * Send a message with x402 payment and automatic response parsing
     */
    const sendMessage = useCallback(async (options: SendMessageOptions): Promise<MultimodalResult> => {
        const {
            endpoint,
            path,
            body,
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
            const baseUrl = API_URL;
            const fullUrl = `${baseUrl}${path}`;

            let activeComposeKeyToken = composeKeyToken;
            if (sessionActive && budgetRemaining > 0 && !activeComposeKeyToken) {
                activeComposeKeyToken = await ensureComposeKeyToken();
            }
            if (!activeComposeKeyToken) {
                return {
                    type: "text",
                    success: false,
                    error: "Compose key session is required",
                };
            }

            const fetchWithPayment = createPaymentFetch({
                chainId: paymentChainId,
                sessionToken: activeComposeKeyToken,
            });

            // Make the request
            const response = await fetchWithPayment(fullUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
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

export function buildWorkflowChatPath(workflowWallet: string): string {
    return `/workflow/${workflowWallet}/chat`;
}
