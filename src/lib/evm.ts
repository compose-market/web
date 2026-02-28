/**
 * EVM x402 Payment Module (Frontend)
 * 
 * Handles x402 payment flows for ThirdWeb-supported EVM chains.
 * Uses ThirdWeb's wrapFetchWithPayment for chains with on-chain facilitator contracts.
 * 
 * NO MANUAL SIGNATURES - the smart wallet handles signing automatically through
 * account abstraction. The user experiences social login, not wallet popups.
 * 
 * @see https://portal.thirdweb.com/x402
 * @module lib/evm
 */

import { wrapFetchWithPayment } from "thirdweb/x402";
import type { Wallet } from "thirdweb/wallets";
import {
    CHAIN_IDS,
    CHAIN_OBJECTS,
    USDC_ADDRESSES,
    thirdwebClient,
    isCronosChain,
    getChainObject,
} from "./chains";

// Re-export ThirdWeb's wrapFetchWithPayment
export { wrapFetchWithPayment } from "thirdweb/x402";

// =============================================================================
// EVM Payment Wrapper
// =============================================================================

export interface EVMPaymentFetchOptions extends RequestInit {
    /** ThirdWeb wallet (smart wallet) */
    wallet: Wallet;
    /** Chain ID for payment */
    chainId: number;
}

/**
 * Wrap fetch with ThirdWeb x402 payment handling
 * 
 * Uses ThirdWeb's wrapFetchWithPayment for chains with on-chain facilitator contracts.
 * For Cronos chains, use wrapFetchWithCronosPayment from cronos.ts instead.
 * 
 * Works seamlessly with account abstraction - no manual signature UX.
 */
export async function wrapFetchWithEVMPayment(
    url: string | URL,
    options: EVMPaymentFetchOptions
): Promise<Response> {
    const { wallet, chainId, ...fetchOptions } = options;

    if (isCronosChain(chainId)) {
        throw new Error(
            `Chain ${chainId} is a Cronos chain. Use wrapFetchWithCronosPayment from cronos.ts instead.`
        );
    }

    const chain = getChainObject(chainId);
    const usdcAddress = USDC_ADDRESSES[chainId];

    if (!chain) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    if (!usdcAddress) {
        throw new Error(`No USDC address configured for chain ${chainId}`);
    }

    // ThirdWeb's wrapFetchWithPayment handles 402 responses automatically
    const paymentWrappedFetch = wrapFetchWithPayment(
        fetch,
        thirdwebClient,
        wallet,
        { maxValue: BigInt(1_000_000) } // Max 1 USDC per call
    );

    return paymentWrappedFetch(url.toString(), fetchOptions);
}

// =============================================================================
// Unified Payment Interface
// =============================================================================

export interface UnifiedPaymentFetchOptions extends RequestInit {
    wallet: Wallet;
    chainId: number;
}

/**
 * Unified payment-wrapped fetch that works across all supported chains
 * 
 * Automatically selects the correct payment handler:
 * - Uses ThirdWeb on-chain facilitator contracts
 * - Cronos chains (338, 25): Uses Cronos Labs REST API facilitator
 * 
 * Works seamlessly with account abstraction - no manual signatures.
 */
export async function getPaymentWrappedFetch(
    url: string | URL,
    options: UnifiedPaymentFetchOptions
): Promise<Response> {
    const { wallet, chainId, ...fetchOptions } = options;

    if (isCronosChain(chainId)) {
        // Cronos chains use REST API facilitator
        const { wrapFetchWithCronosPayment } = await import("./cronos/facilitator");
        const account = wallet.getAccount();
        if (!account) {
            throw new Error("Wallet has no active account");
        }
        return wrapFetchWithCronosPayment(url, {
            account,
            chainId,
            ...fetchOptions,
        });
    } else {
        // Other EVM chains use ThirdWeb on-chain facilitator
        return wrapFetchWithEVMPayment(url, {
            wallet,
            chainId,
            ...fetchOptions,
        });
    }
}

// Re-export chain utilities for convenience
export {
    CHAIN_IDS,
    CHAIN_OBJECTS,
    USDC_ADDRESSES,
    thirdwebClient,
    isCronosChain,
} from "./chains";
