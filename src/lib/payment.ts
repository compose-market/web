/**
 * x402 Payment Utilities
 * 
 * Chain-aware payment routing for multichain x402 support:
 * - Cronos chains (338, 25) use Cronos x402 V1 via wrapFetchWithCronosPayment
 * - Other EVM chains use ThirdWeb x402 V2 via wrapFetchWithPayment
 * 
 * This module is fully chain-agnostic - all chain configuration comes from @/lib/chains
 * 
 * @module lib/payment
 */

import type { Account } from "thirdweb/wallets";
import type { Wallet } from "thirdweb/wallets";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { isCronosChain, CHAIN_IDS, thirdwebClient, CHAIN_CONFIG } from "./chains";
import { wrapFetchWithCronosPayment } from "./cronos/facilitator";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Set to true to enable ECDSA signature v-value normalization.
 * This is typically only needed for older ThirdWeb SDK versions.
 * Currently disabled as modern SDK handles signatures correctly.
 */
const ENABLE_SIGNATURE_NORMALIZATION = false;
export const SESSION_BUDGET_EVENT = "compose:session-budget";
export const SESSION_INVALID_EVENT = "compose:session-invalid";

// =============================================================================
// Signature Normalization (For ThirdWeb x402)
// =============================================================================

/**
 * Normalizes ECDSA signature v value to legacy format (27/28)
 * Some chains/wallets produce EIP-155 v values that need normalization.
 * 
 * @param signature - The hex signature string
 * @param chainId - The chain ID (used for EIP-155 recovery)
 */
function normalizeSignatureV(signature: string, chainId: number): string {
  const cleanSig = signature.startsWith('0x') ? signature.slice(2) : signature;

  if (cleanSig.length !== 130) {
    return signature;
  }

  const vHex = cleanSig.slice(128);
  const vValue = parseInt(vHex, 16);

  let normalizedV: number;

  if (vValue === 0 || vValue === 1) {
    normalizedV = vValue + 27;
  } else if (vValue === 27 || vValue === 28) {
    normalizedV = vValue;
  } else if (vValue >= 35) {
    const yParity = (vValue - 35 - chainId * 2) % 2;
    normalizedV = yParity + 27;
  } else {
    normalizedV = vValue;
  }

  const prefix = signature.startsWith('0x') ? '0x' : '';
  return prefix + cleanSig.slice(0, 128) + normalizedV.toString(16).padStart(2, '0');
}

// =============================================================================
// Normalized Fetch (For ThirdWeb x402)
// =============================================================================

/**
 * Creates a fetch wrapper that can optionally normalize payment signature headers.
 * Used with ThirdWeb x402 for chains that need signature normalization.
 * 
 * @param chainId - Chain ID for EIP-155 v-value calculation (defaults to Cronos Testnet)
 * @returns A fetch-compatible function
 */
export function createNormalizedFetch(chainId: number = CHAIN_IDS.cronosTestnet): typeof fetch {
  const normalizedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (ENABLE_SIGNATURE_NORMALIZATION) {
      let paymentHeader: string | null = null;

      if (init?.headers instanceof Headers) {
        paymentHeader = init.headers.get('payment-signature') || init.headers.get('PAYMENT-SIGNATURE');
      } else if (typeof init?.headers === 'object' && init.headers !== null) {
        const headers = init.headers as Record<string, string>;
        paymentHeader = headers['payment-signature'] || headers['PAYMENT-SIGNATURE'];
      }

      if (paymentHeader) {
        try {
          const decoded = JSON.parse(atob(paymentHeader));

          if (decoded.payload?.signature) {
            const normalizedSig = normalizeSignatureV(decoded.payload.signature, chainId);
            decoded.payload.signature = normalizedSig;
            const normalizedPaymentHeader = btoa(JSON.stringify(decoded));

            if (init?.headers instanceof Headers) {
              init.headers.set('PAYMENT-SIGNATURE', normalizedPaymentHeader);
            } else if (typeof init?.headers === 'object' && init.headers !== null) {
              const headers = init.headers as Record<string, string>;
              delete headers['payment-signature'];
              delete headers['PAYMENT-SIGNATURE'];
              headers['PAYMENT-SIGNATURE'] = normalizedPaymentHeader;
            }
          }
        } catch {
          // Ignore normalization errors - proceed with original header
        }
      }
    }

    return fetch(input, init);
  };

  // Cast to fetch type for compatibility with wrapFetchWithPayment
  return normalizedFetch as typeof fetch;
}

// =============================================================================
// Chain-Aware Payment Fetch Factory
// =============================================================================

export interface PaymentFetchParams {
  /** Chain ID for payment routing (determines Cronos vs ThirdWeb flow) */
  chainId: number;
  /** ThirdWeb account for signing (used for Cronos EIP-712 signatures) */
  account: Account;
  /** ThirdWeb wallet (used for ThirdWeb x402 payments) */
  wallet: Wallet;
  /** Maximum payment amount in USDC wei (6 decimals) */
  maxValue: bigint;
  /** Session bypass: compose key token for Authorization header */
  sessionToken?: string;
  /** Session bypass: pre-built session headers to include */
  sessionHeaders?: Record<string, string>;
}

/**
 * Chain-aware payment fetch wrapper factory
 * 
 * Automatically routes payment handling based on chain:
 * - Cronos chains (338, 25): Uses Cronos x402 V1 with EIP-712 via @crypto.com/facilitator-client
 * - Other EVM chains: Uses ThirdWeb x402 V2
 * 
 * SESSION BYPASS: When sessionToken is provided, skips x402 payment flow entirely
 * and uses a simple fetch with session headers for <100ms latency.
 * 
 * @example
 * ```ts
 * // Standard x402 flow
 * const paymentFetch = createPaymentFetch({
 *   chainId: 338, // Cronos Testnet
 *   account,
 *   wallet,
 *   maxValue: BigInt(5000), // $0.005 USDC
 * });
 * 
 * // Session bypass flow (instant)
 * const sessionFetch = createPaymentFetch({
 *   chainId: 43114,
 *   account,
 *   wallet,
 *   maxValue: BigInt(5000),
 *   sessionToken: 'compose-abc123...',
 *   sessionHeaders: {
 *     'x-session-active': 'true',
 *     'x-session-budget-remaining': '5000000',
 *   },
 * });
 * ```
 */
export function createPaymentFetch(params: PaymentFetchParams): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const { chainId, account, wallet, maxValue, sessionToken, sessionHeaders } = params;

  const chainName = CHAIN_CONFIG[chainId]?.name || `Chain ${chainId}`;
  const isCronos = isCronosChain(chainId);

  /**
   * Helper to inject X-CHAIN-ID header into all requests.
   * This tells the backend which chain the client is using,
   * so it returns the correct 402 format (Cronos V1 vs ThirdWeb V2).
   */
  function injectChainHeader(init?: RequestInit): RequestInit {
    const headers = new Headers(init?.headers);
    headers.set('X-CHAIN-ID', chainId.toString());
    return { ...init, headers };
  }

  // SESSION BYPASS: Skip x402 entirely when we have a valid session token
  // This provides <100ms latency instead of ~2-3s for payment flow
  if (sessionToken) {
    console.log(`[payment] Using session bypass for chain ${chainId}`);
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      headers.set('X-CHAIN-ID', chainId.toString());
      headers.set('Authorization', `Bearer ${sessionToken}`);

      // Add all session headers
      if (sessionHeaders) {
        for (const [key, value] of Object.entries(sessionHeaders)) {
          headers.set(key, value);
        }
      }

      const response = await fetch(input, { ...init, headers });

      // Emit authoritative session budget state from backend response headers.
      // Header priority: session bypass headers → compose key headers → fallback
      if (typeof window !== "undefined") {
        const budgetRemainingHeader =
          response.headers.get("x-session-budget-remaining") ??
          response.headers.get("x-compose-key-budget-remaining") ??
          response.headers.get("x-budget-remaining");
        const budgetUsedHeader =
          response.headers.get("x-session-budget-used") ??
          response.headers.get("x-compose-key-budget-used");
        const budgetLimitHeader =
          response.headers.get("x-session-budget-limit") ??
          response.headers.get("x-compose-key-budget-limit");

        const budgetRemaining = budgetRemainingHeader ? Number.parseInt(budgetRemainingHeader, 10) : NaN;
        const budgetUsed = budgetUsedHeader ? Number.parseInt(budgetUsedHeader, 10) : NaN;
        const budgetLimit = budgetLimitHeader ? Number.parseInt(budgetLimitHeader, 10) : NaN;

        if (Number.isFinite(budgetRemaining) && budgetRemaining >= 0) {
          console.log(`[payment] Budget sync from headers: remaining=${budgetRemaining}, used=${budgetUsed}, limit=${budgetLimit}`);
          window.dispatchEvent(
            new CustomEvent(SESSION_BUDGET_EVENT, {
              detail: {
                budgetRemaining,
                budgetUsed: Number.isFinite(budgetUsed) && budgetUsed >= 0 ? budgetUsed : undefined,
                budgetLimit: Number.isFinite(budgetLimit) && budgetLimit >= 0 ? budgetLimit : undefined,
              },
            }),
          );
        } else {
          console.warn(`[payment] No valid budget headers in response; headers:`, {
            "x-session-budget-remaining": response.headers.get("x-session-budget-remaining"),
            "x-compose-key-budget-remaining": response.headers.get("x-compose-key-budget-remaining"),
            "x-budget-remaining": response.headers.get("x-budget-remaining"),
          });
        }

        if (response.status === 401 || response.status === 402 || response.status === 403) {
          window.dispatchEvent(
            new CustomEvent(SESSION_INVALID_EVENT, {
              detail: { status: response.status },
            }),
          );
        }
      }

      return response;
    };
  }

  if (isCronos) {
    // Route: Cronos x402 V1 payment flow
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

      return wrapFetchWithCronosPayment(url, {
        ...injectChainHeader(init),
        account,
        chainId,
      });
    };
  } else {
    // Route: ThirdWeb x402 V2 payment flow
    // Create fetch wrapper that injects X-CHAIN-ID header
    const chainAwareFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return fetch(input, injectChainHeader(init));
    };

    const normalizedFetch = createNormalizedFetch(chainId);

    // Compose: chain header → normalize → ThirdWeb payment
    const composedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const initWithChain = injectChainHeader(init);
      return normalizedFetch(input, initWithChain);
    };

    const thirdwebFetch = wrapFetchWithPayment(
      composedFetch as typeof fetch,
      thirdwebClient,
      wallet,
      { maxValue }
    );

    // Wrap to match our expected signature
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const normalizedInput = input instanceof URL ? input.toString() : input;
      return thirdwebFetch(normalizedInput, init);
    };
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { isCronosChain, CHAIN_IDS } from "./chains";
