/**
 * Owner-wide Compose Key history plus the existing network-scoped mutations.
 * Listing is token-free and pair-aware; creation and revocation retain their
 * current wallet, network, and authorization behavior.
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useActiveWalletConnectionStatus } from "thirdweb/react";
import type { KeyRecord } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";

import { useReconciliation } from "@/hooks/use-reconciliation";
import { useSession } from "@/hooks/use-session";
import { useWalletPair } from "@/hooks/use-pair";
import { SESSION_BUDGET_PRESETS } from "@/lib/chains";
import { readCachedAccount, readCachedKeys, writeCachedKeys } from "@/lib/cache";
import { durableQueryMeta, DURABLE_CACHE_MAX_AGE } from "@/lib/queryClient";
import { sdk } from "@/lib/sdk";

export type { KeyRecord };

const STALE_TIME = 15_000;
const CACHE_KEY = "keys";

export interface CreateKeyInput {
  name: string;
  budgetUsd: string;
  durationHours: number;
  network?: NetworkId;
  purpose?: "session" | "api";
}

export interface UseKeysReturn {
  owner: string | null;
  keys: KeyRecord[];
  activeKeys: KeyRecord[];
  isLoading: boolean;
  isRefetching: boolean;
  error: Error | null;
  forceRefresh: () => Promise<void>;
  createKey: (input: CreateKeyInput) => Promise<{ token: string; keyId: string }>;
  revokeKey: (keyId: string) => Promise<void>;
  isCreating: boolean;
  isRevoking: boolean;
  createdToken: string | null;
  createdKeyId: string | null;
  clearCreatedToken: () => void;
  createError: string | null;
  budgetPresets: typeof SESSION_BUDGET_PRESETS;
}

function isActiveKey(key: KeyRecord): boolean {
  return !key.revokedAt && key.expiresAt > Date.now();
}

export function useKeys(): UseKeysReturn {
  const { ensureKeyToken } = useSession();
  const { owner: liveOwner, pair } = useWalletPair();
  const connectionStatus = useActiveWalletConnectionStatus();
  const [cachedAccount] = useState(() => readCachedAccount());
  const cachedAddr = cachedAccount?.address?.trim() ?? null;
  const normalizedCached = cachedAddr
    ? (/^0x[a-f0-9]{40}$/i.test(cachedAddr) ? cachedAddr.toLowerCase() : cachedAddr)
    : null;
  const owner = liveOwner ?? (
    connectionStatus !== "disconnected"
      ? normalizedCached
      : null
  );
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdKeyId, setCreatedKeyId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const persisted = useMemo(() => readCachedKeys(owner), [owner]);

  const query = useQuery<KeyRecord[], Error>({
    queryKey: [CACHE_KEY, owner],
    queryFn: async () => {
      if (!owner) throw new Error("An active EVM smart account is required");
      const keys = await sdk.keys.list({ userAddress: owner });
      const sorted = keys.sort((left, right) => right.createdAt - left.createdAt);
      writeCachedKeys(owner, sorted);
      return sorted;
    },
    initialData: persisted?.data,
    initialDataUpdatedAt: persisted?.updatedAt,
    staleTime: STALE_TIME,
    gcTime: DURABLE_CACHE_MAX_AGE,
    enabled: Boolean(owner),
    retry: 1,
    meta: durableQueryMeta,
  });

  useReconciliation({
    owner: pair ? liveOwner : null,
    subscribe: (options) => sdk.keys.subscribe(options),
    refetch: query.refetch,
  });

  const createMutation = useMutation({
    mutationFn: async (input: CreateKeyInput) => {
      const previousToken = sdk.keys.currentToken();
      const created = await sdk.keys.create({
        purpose: input.purpose ?? "api",
        budgetUsd: input.budgetUsd,
        durationHours: input.durationHours,
        network: input.network,
        name: input.name,
      });

      if (previousToken && previousToken !== created.token) sdk.keys.use(previousToken);
      return { token: created.token, keyId: created.keyId };
    },
    onSuccess: (result) => {
      setCreatedToken(result.token);
      setCreatedKeyId(result.keyId);
      setCreateError(null);
      void query.refetch();
    },
    onError: (error: unknown) => {
      setCreateError(error instanceof Error ? error.message : "Failed to create key");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (keyId: string) => {
      await ensureKeyToken();
      await sdk.keys.revoke(keyId);
    },
    onSuccess: () => {
      void query.refetch();
    },
  });

  const forceRefresh = useCallback(async () => {
    if (!owner) return;
    await query.refetch();
  }, [owner, query.refetch]);

  const createKey = useCallback(
    async (input: CreateKeyInput) => createMutation.mutateAsync(input),
    [createMutation],
  );
  const revokeKey = useCallback(
    async (keyId: string) => revokeMutation.mutateAsync(keyId),
    [revokeMutation],
  );
  const clearCreatedToken = useCallback(() => {
    setCreatedToken(null);
    setCreatedKeyId(null);
    setCreateError(null);
  }, []);

  const keys = query.data ?? [];
  const activeKeys = useMemo(() => keys.filter(isActiveKey), [keys]);

  return {
    owner,
    keys,
    activeKeys,
    isLoading: Boolean(owner) && query.isLoading,
    isRefetching: query.isFetching && !query.isLoading,
    error: query.error ?? null,
    forceRefresh,
    createKey,
    revokeKey,
    isCreating: createMutation.isPending,
    isRevoking: revokeMutation.isPending,
    createdToken,
    createdKeyId,
    clearCreatedToken,
    createError,
    budgetPresets: SESSION_BUDGET_PRESETS,
  };
}
