/**
 * Shared `@compose-market/sdk` singleton.
 *
 * One SDK instance per browser tab. Storage adapter is the browser's
 * `localStorage` (auto-detected); tokens are scoped per `(userAddress, chainId)`
 * and survive reloads.
 *
 * Every HTTP call to `api.compose.market` in this app goes through this
 * instance. Any direct `fetch(`${VITE_API_URL}/...`)` is a migration bug.
 */

import { ComposeSDK } from "@compose-market/sdk";

const baseUrl = (import.meta.env.VITE_API_URL ?? "https://api.compose.market").replace(/\/+$/, "");

export const sdk = new ComposeSDK({
    baseUrl,
    userAgent: "compose-market-web",
    // The in-app UI does its own retries for non-idempotent mutations, so
    // cap the SDK retries at 2 for safe idempotent paths and 0 for the
    // rest (keys.revoke / keys.create already mark themselves doNotRetry
    // at the SDK layer).
    retry: { maxRetries: 2, initialDelayMs: 400, maxDelayMs: 6_000, jitter: true },
});

export const API_BASE_URL = sdk.baseUrl;
