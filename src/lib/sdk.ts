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
import type { NetworkId } from "@compose-market/sdk/chains";
import { readCachedAccount } from "./cache";
import {
    API_BASE_URL,
    AGENTS_BASE_URL,
    CHANNELS_BASE_URL,
    CONNECTORS_BASE_URL,
    RUNTIME_BASE_URL,
} from "./performance/urls";

const TOKEN_SCOPE = "compose.sdk.token";
const TOKEN_PREFIX = `${TOKEN_SCOPE}:`;
const API_AUTH_HYDRATED_PATHS = [
    "/api/analytics/inference",
    "/api/receipts",
    "/permissions",
    "/api/ipfs/",
    "/api/local/",
] as const;
const RUNTIME_AUTH_HYDRATED_PATHS = [
    "/agent/",
    "/api/workspace/",
] as const;

function normalizeOwner(address: string): string {
    const trimmed = address.trim();
    return /^0x[a-f0-9]{40}$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function isComposeTokenUnexpired(token: string): boolean {
    if (!token || !token.startsWith("compose-")) return false;
    const rawJwt = token.slice("compose-".length);
    const parts = rawJwt.split(".");
    if (parts.length !== 3) return true;
    try {
        const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
        const payload = JSON.parse(globalThis.atob(padded)) as { exp?: unknown };
        if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
            return payload.exp * 1000 > Date.now() + 5_000;
        }
    } catch {
        return false;
    }
    return true;
}

const env = import.meta.env ?? {};
const baseUrl = (env.VITE_API_URL ?? "https://api.compose.market").replace(/\/+$/, "");
const channelsUrl = (env.VITE_CHANNELS_URL ?? "https://services.compose.market").replace(/\/+$/, "");

export const sdk = new ComposeSDK({
    baseUrl,
    channelsUrl,
    userAgent: "compose-market-web",
    // The in-app UI does its own retries for non-idempotent mutations, so
    // cap the SDK retries at 2 for safe idempotent paths and 0 for the
    // rest (keys.revoke / keys.create already mark themselves doNotRetry
    // at the SDK layer).
    retry: { maxRetries: 2, initialDelayMs: 400, maxDelayMs: 6_000, jitter: true },
});

export const API_BASE_URL = sdk.baseUrl;
