/**
 * Cronos x402 Payment Module (Frontend)
 * 
 * Handles x402 payment flows for Cronos chains (338, 25).
 * Uses EIP-712 typed data signing via the smart wallet (account abstraction).
 * 
 * NO MANUAL SIGNATURES - the smart wallet handles signing automatically through
 * account abstraction. The user experiences social login, not wallet popups.
 * 
 * @see https://docs.cronos.org/cronos-x402-facilitator/quick-start-for-buyers
 * @module lib/cronos
 */

import type { Account } from "thirdweb/wallets";
import {
    CHAIN_IDS,
    USDC_ADDRESSES,
    getCronosNetworkString,
    isCronosChain,
} from "../chains";

// =============================================================================
// EIP-712 Configuration for Cronos USDC.e
// =============================================================================

/**
 * EIP-712 domain configuration for Cronos USDC.e
 * CRITICAL: Must match on-chain contract configuration
 */
export const CRONOS_EIP712_CONFIG = {
    tokenName: "Bridged USDC (Stargate)",
    tokenVersion: "1",
    decimals: 6,
} as const;

/**
 * Get EIP-712 domain for Cronos USDC.e
 */
export function getCronosEIP712Domain(chainId: number) {
    const usdcAddress = USDC_ADDRESSES[chainId];
    if (!usdcAddress) {
        throw new Error(`No USDC address for chain ${chainId}`);
    }

    return {
        name: CRONOS_EIP712_CONFIG.tokenName,
        version: CRONOS_EIP712_CONFIG.tokenVersion,
        chainId: chainId, // EIP-712 uses uint256, must be number/bigint
        verifyingContract: usdcAddress,
    };
}

/**
 * EIP-712 typed data types for TransferWithAuthorization (EIP-3009)
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
    TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
    ],
} as const;

// =============================================================================
// Payment Header Generation
// =============================================================================

function generateNonce(): `0x${string}` {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface CronosPaymentHeaderParams {
    account: Account;
    payTo: `0x${string}`;
    amount: string;
    chainId: number;
    validitySeconds?: number;
}

/**
 * Create a Cronos x402 V1 payment header
 * 
 * Uses EIP-712 typed data signing through the smart wallet.
 * The account abstraction layer handles the signing - no manual signature UX.
 */
export async function createCronosPaymentHeader(params: CronosPaymentHeaderParams): Promise<string> {
    const { account, payTo, amount, chainId, validitySeconds = 300 } = params;

    if (!isCronosChain(chainId)) {
        throw new Error(`Chain ${chainId} is not a Cronos chain`);
    }

    const asset = USDC_ADDRESSES[chainId];
    if (!asset) {
        throw new Error(`No USDC address for Cronos chain ${chainId}`);
    }

    const network = getCronosNetworkString(chainId);
    const nonce = generateNonce();
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + validitySeconds;

    const domain = getCronosEIP712Domain(chainId);
    const message = {
        from: account.address,
        to: payTo,
        value: BigInt(amount),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce: nonce,
    };

    // Smart wallet signs via account abstraction - no popup
    const signature = await account.signTypedData({
        domain,
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
    });

    const paymentHeader = {
        x402Version: 1,
        scheme: "exact",
        network: network,
        payload: {
            from: account.address,
            to: payTo,
            value: amount,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: nonce,
            signature: signature,
            asset: asset,
        },
    };

    return btoa(JSON.stringify(paymentHeader));
}

// =============================================================================
// Payment-Wrapped Fetch
// =============================================================================

export interface CronosPaymentFetchOptions extends RequestInit {
    account: Account;
    chainId: number;
    maxRetries?: number;
}

/**
 * Cronos x402 V1 402 response format
 * Uses `accepts` array matching x402-examples SDK format
 */
interface Cronos402Response {
    x402Version: 1;
    error: string;
    accepts: Array<{
        scheme: "exact";
        network: "cronos-testnet" | "cronos-mainnet";
        payTo: `0x${string}`;
        asset: `0x${string}` | string;
        maxAmountRequired: string;
        maxTimeoutSeconds: number;
        description?: string;
        mimeType?: string;
        resource?: string;
        extra?: { paymentId?: string };
    }>;
}

/**
 * Wrap fetch with Cronos x402 payment handling
 * 
 * If the server returns 402, this automatically:
 * 1. Parses the payment requirements from `accepts[0]`
 * 2. Creates a signed payment header via account abstraction
 * 3. Retries the request with the X-PAYMENT header
 * 
 * Works seamlessly with social login - no wallet signature UX.
 */
export async function wrapFetchWithCronosPayment(
    url: string | URL,
    options: CronosPaymentFetchOptions
): Promise<Response> {
    const { account, chainId, maxRetries = 1, ...fetchOptions } = options;

    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetch(url, fetchOptions);
        lastResponse = response;

        if (response.status !== 402) {
            return response;
        }

        // Parse 402 response - expects accepts array format
        let accepts0: Cronos402Response["accepts"][0];
        try {
            const body = await response.clone().json() as Cronos402Response;

            if (body.x402Version !== 1) {
                console.warn(`[cronos-x402] Unexpected x402 version: ${body.x402Version}`);
                return response;
            }

            if (!body.accepts || body.accepts.length === 0) {
                console.error("[cronos-x402] 402 response missing accepts array");
                return response;
            }

            accepts0 = body.accepts[0];
        } catch (e) {
            console.error("[cronos-x402] Failed to parse 402 response:", e);
            return response;
        }

        // Verify network matches
        const expectedNetwork = getCronosNetworkString(chainId);
        if (accepts0.network !== expectedNetwork) {
            console.warn(`[cronos-x402] Network mismatch: expected ${expectedNetwork}, got ${accepts0.network}`);
            return response;
        }

        if (attempt >= maxRetries) {
            return response;
        }

        // Generate payment header via account abstraction
        const paymentHeader = await createCronosPaymentHeader({
            account,
            payTo: accepts0.payTo,
            amount: accepts0.maxAmountRequired,
            chainId,
            validitySeconds: accepts0.maxTimeoutSeconds || 300,
        });

        // Retry with X-PAYMENT header - must use new Headers() to properly merge
        // (Headers class objects can't be spread with {...})
        const retryHeaders = new Headers(fetchOptions.headers);
        retryHeaders.set("X-PAYMENT", paymentHeader);
        retryHeaders.set("X-CHAIN-ID", chainId.toString()); // Ensure chainId is preserved

        const paidResponse = await fetch(url, {
            ...fetchOptions,
            headers: retryHeaders,
        });

        return paidResponse;
    }

    return lastResponse!;
}

// Re-export chain utilities for convenience
export { isCronosChain, getCronosNetworkString, CHAIN_IDS } from "../chains";