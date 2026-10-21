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

/**
 * Looks up a valid, unexpired persisted Compose Key JWT in `localStorage`
 * without mutating `sdk`'s active per-network token slot.
 */
export function findPersistedSessionKey(
    owner?: string | null,
    preferredNetwork?: NetworkId | null,
): string | null {
    try {
        const storage = globalThis.localStorage;
        if (!storage) return null;

        const candidates: string[] = [];
        if (owner) {
            candidates.push(normalizeOwner(owner));
        } else {
            const cached = readCachedAccount();
            if (cached?.address) candidates.push(normalizeOwner(cached.address));
            if (cached?.solanaAddress) candidates.push(normalizeOwner(cached.solanaAddress));
        }
        if (candidates.length === 0) return null;

        if (preferredNetwork) {
            for (const candidate of candidates) {
                const exact = storage.getItem(`${TOKEN_PREFIX}${candidate}:${preferredNetwork}`);
                if (exact && isComposeTokenUnexpired(exact)) return exact;
            }
        }

        for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (!key || !key.startsWith(TOKEN_PREFIX)) continue;
            const matched = candidates.some((candidate) => key.startsWith(`${TOKEN_PREFIX}${candidate}:`));
            if (!matched) continue;
            const token = storage.getItem(key);
            if (token && isComposeTokenUnexpired(token)) return token;
        }
    } catch {
        return null;
    }
    return null;
}

export function hasSessionAuth(
    owner?: string | null,
    preferredNetwork?: NetworkId | null,
): boolean {
    return Boolean(sdk.keys.currentToken() || findPersistedSessionKey(owner, preferredNetwork));
}

function matchesAuthPrefix(pathname: string, prefixes: readonly string[]): boolean {
    return prefixes.some((prefix) =>
        prefix.endsWith("/")
            ? pathname.startsWith(prefix)
            : pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

export function shouldAttachPersistedKey(url: URL): boolean {
    const apiOrigin = new URL(API_BASE_URL).origin;
    if (url.origin === apiOrigin) {
        return matchesAuthPrefix(url.pathname, API_AUTH_HYDRATED_PATHS);
    }
    const runtimeOrigin = new URL(RUNTIME_BASE_URL).origin;
    if (url.origin === runtimeOrigin) {
        return matchesAuthPrefix(url.pathname, RUNTIME_AUTH_HYDRATED_PATHS);
    }
    return false;
}

const apiAuthenticatedFetch: typeof fetch = (input, init) => {
    const rawUrl = typeof input === "string"
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;

    try {
        const parsed = new URL(rawUrl, API_BASE_URL);
        if (shouldAttachPersistedKey(parsed)) {
            const headers = new Headers(
                init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined),
            );
            if (!headers.has("Authorization")) {
                const headerOwner = headers.get("x-session-user-address") ?? parsed.searchParams.get("userAddress");
                const headerNetwork = (headers.get("x-network-id") ?? parsed.searchParams.get("network")) as NetworkId | null;
                const token = findPersistedSessionKey(headerOwner, headerNetwork);
                if (token) {
                    headers.set("Authorization", `Bearer ${token}`);
                    return globalThis.fetch(input, { ...init, headers });
                }
            }
        }
    } catch {
        // Non-URL input falls through untouched.
    }

    return globalThis.fetch(input, init);
};

export const sdk = new ComposeSDK({
    baseUrl: API_BASE_URL,
    agentsUrl: AGENTS_BASE_URL,
    connectorsUrl: CONNECTORS_BASE_URL,
    runtimeUrl: RUNTIME_BASE_URL,
    channelsUrl: CHANNELS_BASE_URL,
    userAgent: "compose-market-web",
    fetch: apiAuthenticatedFetch,
    // The in-app UI does its own retries for non-idempotent mutations, so
    // cap the SDK retries at 2 for safe idempotent paths and 0 for the
    // rest (keys.revoke / keys.create already mark themselves doNotRetry
    // at the SDK layer).
    retry: { maxRetries: 2, initialDelayMs: 400, maxDelayMs: 6_000, jitter: true },
});

export { API_BASE_URL, AGENTS_BASE_URL, CONNECTORS_BASE_URL, RUNTIME_BASE_URL };
