import type { DirectoryAgent, InferenceAnalytics, KeyRecord } from "@compose-market/sdk";
import type { CatalogModel } from "@/lib/models";
import type { BenchmarksApiResponse } from "@/types/benchmarks";

/**
 * Last-known wallet identity & synchronous snapshot caches.
 *
 * Thirdweb v5 persists only *identity* (wallet ids, in-app auth JWT), never
 * *derived state*: on every full page reload it re-authenticates the in-app
 * wallet (2× GET embedded-wallet.thirdweb.com/api/2024-05-05/accounts),
 * re-fetches chain metadata (zksync check), and re-derives the smart account
 * address via an eth_call to the account factory — all serially, all cached
 * in memory only. Until that finishes, useActiveAccount() is undefined.
 *
 * The smart account address is deterministic per (admin, factory, chain) and
 * permanent, and the Swig wallet PDA is deterministic per admin — so caching
 * them once is valid forever. We render the cached address instantly on
 * reload while thirdweb reconnects in the background. Signing still requires
 * the live account; this cache is never used to authorize anything.
 */

const LAST_ACCOUNT_KEY = "last_account";

export interface CachedAccount {
    /** EVM smart account address (useActiveAccount().address). */
    address: string;
    /** Solana Swig wallet PDA, if it had resolved in a previous session. */
    solanaAddress?: string;
    /** Payment network selected when the cache was written. */
    network: string;
    updatedAt: number;
}

export function readCachedAccount(): CachedAccount | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(LAST_ACCOUNT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedAccount;
        if (typeof parsed?.address !== "string" || !parsed.address) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeCachedAccount(address: string, network: string, solanaAddress?: string | null): void {
    try {
        localStorage.setItem(
            LAST_ACCOUNT_KEY,
            JSON.stringify({
                address,
                network,
                updatedAt: Date.now(),
                ...(solanaAddress ? { solanaAddress } : {}),
            } satisfies CachedAccount),
        );
    } catch {
        // Quota / private-mode failures are non-fatal: next reload just reconnects blind.
    }
}

export function clearCachedAccount(): void {
    try {
        localStorage.removeItem(LAST_ACCOUNT_KEY);
    } catch {
        // Ignore — nothing else to do.
    }
}

// =============================================================================
// SVM — Swig account existence cache
// =============================================================================

/**
 * The Swig account is permanent once created on-chain (the authority lives in
 * the account data forever). A cache hit therefore means "verified to exist in
 * a previous session" — callers may skip the blocking existence-check RPC on
 * reload and revalidate in the background instead. Keyed per (admin, network)
 * so switching wallets or clusters never collides.
 */

const SWIG_CREATED_PREFIX = "swig_created";

function swigCreatedKey(adminAddress: string, network: string): string {
    return `${SWIG_CREATED_PREFIX}:${adminAddress.toLowerCase()}:${network}`;
}

export function readSwigCreated(adminAddress: string, network: string): boolean {
    if (typeof window === "undefined") return false;
    try {
        return localStorage.getItem(swigCreatedKey(adminAddress, network)) === "1";
    } catch {
        return false;
    }
}

export function writeSwigCreated(adminAddress: string, network: string): void {
    try {
        localStorage.setItem(swigCreatedKey(adminAddress, network), "1");
    } catch {
        // Quota / private-mode failures are non-fatal: next reload rechecks on-chain.
    }
}

export function clearSwigCreated(adminAddress: string, network: string): void {
    try {
        localStorage.removeItem(swigCreatedKey(adminAddress, network));
    } catch {
        // Ignore — nothing else to do.
    }
}

// =============================================================================
// Platform Catalog & Owner Snapshots — Synchronous Hard-Reload Hydration
// =============================================================================

const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ANALYTICS_ENTRIES_PER_OWNER = 4;

export interface Snapshot<T> {
    data: T;
    updatedAt: number;
}

export interface CatalogSnapshot<T> {
    version: string;
    items: T[];
    lastUpdated: string | null;
    updatedAt: number;
}

function canUseStorage(): boolean {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function ownerKey(address: string): string {
    return /^0x[0-9a-f]{40}$/i.test(address) ? address.toLowerCase() : address;
}

function isFresh(updatedAt: unknown): updatedAt is number {
    return typeof updatedAt === "number"
        && Number.isFinite(updatedAt)
        && updatedAt > 0
        && Date.now() - updatedAt < SNAPSHOT_MAX_AGE_MS;
}
