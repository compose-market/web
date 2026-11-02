/**
 * Real-time Turn Receipt Reconciliation Hook & Pure Helpers.
 *
 * Reuses the canonical x402 receipts ledger (`sdk.receipts.list`) and the
 * real-time analytics SSE stream (`sdk.analytics.subscribe` + `sdk.analytics.get`)
 * to replace initial `queued` snapshots (or agent-fee-only SSE frames) with
 * the complete, settled on-chain receipts for every message turn.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { InferenceAnalytics, Receipt } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";

import { findPersistedSessionKey, sdk } from "@/lib/sdk";
import { addAtomicAmounts } from "@/lib/receipts";
import { useReconciliation } from "@/hooks/use-reconciliation";
import type { Message } from "@/hooks/use-chat";

type SettlementStatus = NonNullable<Receipt["settlementStatus"]>;

const STATUS_RANK: Record<SettlementStatus, number> = {
  queued: 1,
  submitted: 2,
  claimed: 3,
  settled: 4,
  failed: 4,
};

function statusRank(status: Receipt["settlementStatus"]): number {
  return status ? (STATUS_RANK[status] ?? 0) : 0;
}

export function receiptIdentityKey(receipt: Receipt): string {
  if (receipt.paymentIntentId) return `pi:${receipt.paymentIntentId}`;
  if (receipt.id) return `id:${receipt.id}`;
  if (receipt.txHash) return `tx:${receipt.network}:${receipt.txHash.toLowerCase()}`;
  return `raw:${receipt.service ?? ""}:${receipt.subject ?? ""}:${receipt.finalAmountWei}:${receipt.settledAt}`;
}

function mergeTwoReceipts(current: Receipt, incoming: Receipt): Receipt {
  const currentRank = statusRank(current.settlementStatus);
  const incomingRank = statusRank(incoming.settlementStatus);
  const preferIncoming = incomingRank > currentRank
    || (incomingRank === currentRank && Boolean(incoming.txHash) && !current.txHash)
    || (incomingRank === currentRank && Boolean(incoming.id?.startsWith("rct_")) && !current.id?.startsWith("rct_"));

  const base = preferIncoming ? { ...current, ...incoming } : { ...incoming, ...current };
  return {
    ...base,
    id: incoming.id?.startsWith("rct_") ? incoming.id : (current.id ?? incoming.id),
    paymentIntentId: incoming.paymentIntentId ?? current.paymentIntentId,
    txHash: incoming.txHash ?? current.txHash,
    claimTxHash: incoming.claimTxHash ?? current.claimTxHash,
    settleTxHash: incoming.settleTxHash ?? current.settleTxHash,
    settlementStatus: incomingRank >= currentRank
      ? (incoming.settlementStatus ?? current.settlementStatus)
      : current.settlementStatus,
    settledAt: (incoming.settledAt && incoming.settledAt > 0 && incomingRank >= currentRank)
      ? incoming.settledAt
      : (current.settledAt ?? incoming.settledAt ?? 0),
    rootRunId: incoming.rootRunId ?? current.rootRunId,
    executionRunId: incoming.executionRunId ?? current.executionRunId,
    parentExecutionRunId: incoming.parentExecutionRunId ?? current.parentExecutionRunId,
    providerAmountWei: incoming.providerAmountWei ?? current.providerAmountWei,
    platformFeeWei: incoming.platformFeeWei ?? current.platformFeeWei,
    lineItems: (incoming.lineItems && incoming.lineItems.length > 0) ? incoming.lineItems : current.lineItems,
    bills: (incoming.bills && incoming.bills.length > 0) ? incoming.bills : current.bills,
  };
}

export function mergeReceiptList(existing: Receipt[] | undefined, incoming: Receipt | Receipt[]): Receipt[] {
  const additions = Array.isArray(incoming) ? incoming : [incoming];
  const byKey = new Map<string, Receipt>();
  for (const item of existing ?? []) {
    byKey.set(receiptIdentityKey(item), item);
  }
  for (const item of additions) {
    const key = receiptIdentityKey(item);
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeTwoReceipts(prev, item) : item);
  }
  return Array.from(byKey.values());
}

export function enrichReceiptWithAnalytics(
  receipt: Receipt,
  settlementsByIntent: ReadonlyMap<string, InferenceAnalytics.InferenceSettlement>,
): Receipt {
  if (!receipt.paymentIntentId) return receipt;
  const match = settlementsByIntent.get(receipt.paymentIntentId);
  if (!match) return receipt;
  const mappedStatus: SettlementStatus = match.status;
  const settledAtMs = match.settledAt ? Date.parse(match.settledAt) : Number.NaN;
  const enriched: Receipt = {
    ...receipt,
    finalAmountWei: match.billing.finalAmountAtomic || receipt.finalAmountWei,
    providerAmountWei: match.billing.inferenceAmountAtomic || receipt.providerAmountWei,
    platformFeeWei: match.billing.platformFeeAtomic || receipt.platformFeeWei,
    settlementStatus: mappedStatus,
    ...(match.transactionHash ? { txHash: match.transactionHash } : {}),
    ...(match.claimTransactionHash ? { claimTxHash: match.claimTransactionHash } : {}),
    ...(match.settleTransactionHash ? { settleTxHash: match.settleTransactionHash } : {}),
    ...(Number.isFinite(settledAtMs) && settledAtMs > 0 ? { settledAt: settledAtMs } : {}),
  };
  return mergeTwoReceipts(receipt, enriched);
}

export function reconcileMessageReceipts(
  existing: Receipt[] | undefined,
  fetchedReceipts: Receipt[],
  analyticsSettlements: readonly InferenceAnalytics.InferenceSettlement[],
): Receipt[] {
  const byIntent = new Map<string, InferenceAnalytics.InferenceSettlement>();
  for (const row of analyticsSettlements) {
    if (row.paymentIntentId) {
      byIntent.set(row.paymentIntentId, row);
    }
  }
  const merged = mergeReceiptList(existing, fetchedReceipts);
  return merged.map((receipt) => enrichReceiptWithAnalytics(receipt, byIntent));
}

export interface TurnReceiptSummary {
  items: Receipt[];
  totalAmountWei: string;
  providerAmountWei: string;
  platformFeeWei: string;
  status: SettlementStatus;
  settledCount: number;
  totalCount: number;
  primaryTxHash?: string;
  primaryNetwork?: string;
}

export function summarizeTurnReceipts(
  receipts: Receipt[] | undefined,
  fallbackReceipt?: Receipt,
): TurnReceiptSummary | null {
  const items = receipts && receipts.length > 0
    ? receipts
    : fallbackReceipt
      ? [fallbackReceipt]
      : [];
  if (items.length === 0) return null;

  let totalAmountWei = "0";
  let providerAmountWei = "0";
  let platformFeeWei = "0";
  let settledCount = 0;
  let failedCount = 0;
  let submittedCount = 0;
  let primaryTxHash: string | undefined;
  let primaryNetwork: string | undefined;

  for (const item of items) {
    if (item.finalAmountWei) {
      totalAmountWei = addAtomicAmounts(totalAmountWei, item.finalAmountWei);
    }
    if (item.providerAmountWei) {
      providerAmountWei = addAtomicAmounts(providerAmountWei, item.providerAmountWei);
    }
    if (item.platformFeeWei) {
      platformFeeWei = addAtomicAmounts(platformFeeWei, item.platformFeeWei);
    }
    const status = item.settlementStatus ?? (item.txHash ? "settled" : "queued");
    if (status === "settled") settledCount += 1;
    else if (status === "failed") failedCount += 1;
    else if (status === "submitted" || status === "claimed") submittedCount += 1;

    if (!primaryTxHash && (item.settleTxHash || item.txHash)) {
      primaryTxHash = item.settleTxHash ?? item.txHash;
    }
    if (!primaryNetwork && item.network) {
      primaryNetwork = item.network;
    }
  }

  let status: SettlementStatus = "queued";
  if (settledCount === items.length) status = "settled";
  else if (failedCount === items.length) status = "failed";
  else if (submittedCount > 0 || settledCount > 0) status = "submitted";

  return {
    items,
    totalAmountWei,
    providerAmountWei,
    platformFeeWei,
    status,
    settledCount,
    totalCount: items.length,
    primaryTxHash,
    primaryNetwork,
  };
}

function messageHasPendingReceipts(message: Message): boolean {
  if (message.role !== "assistant") return false;
  const list = message.receipts && message.receipts.length > 0
    ? message.receipts
    : message.receipt
      ? [message.receipt]
      : [];
  if (list.length === 0) {
    return Boolean(message.executionRunId || message.rootRunId);
  }
  return list.some((item) => {
    const status = item.settlementStatus;
    return status !== "settled" && status !== "failed";
  });
}

function receiptsChanged(prev: Receipt[] | undefined, next: Receipt[]): boolean {
  if (!prev || prev.length !== next.length) return next.length > 0;
  for (let i = 0; i < next.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id
      || a.paymentIntentId !== b.paymentIntentId
      || a.settlementStatus !== b.settlementStatus
      || a.txHash !== b.txHash
      || a.finalAmountWei !== b.finalAmountWei
      || a.settledAt !== b.settledAt
    ) {
      return true;
    }
  }
  return false;
}

export function useTurnReceipts({
  messages,
  userAddress,
  network,
  mode,
  isStreaming = false,
  onReconcile,
}: {
  messages: Message[];
  userAddress: string | null | undefined;
  network: NetworkId | null | undefined;
  mode: "agent" | "playground";
  isStreaming?: boolean;
  onReconcile: (messageId: string, receipts: Receipt[]) => void;
}): void {
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onReconcileRef = useRef(onReconcile);
  onReconcileRef.current = onReconcile;
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  const owner = useMemo(() => {
    if (!userAddress || !network) return null;
    return network.startsWith("eip155:") ? userAddress.toLowerCase() : userAddress;
  }, [network, userAddress]);

  const targetSignature = useMemo(() => {
    return messages
      .filter((msg) => msg.role === "assistant" && (msg.executionRunId || msg.rootRunId || msg.receipt || (msg.receipts?.length ?? 0) > 0))
      .map((msg) => `${msg.id}:${msg.executionRunId ?? ""}:${msg.rootRunId ?? ""}:${msg.receipt?.paymentIntentId ?? msg.receipt?.id ?? ""}:${msg.receipts?.length ?? 0}:${msg.receipts?.every((r) => r.settlementStatus === "settled" || r.settlementStatus === "failed") ? "done" : "open"}`)
      .join("|");
  }, [messages]);

  const hasPending = useMemo(
    () => messages.some(messageHasPendingReceipts),
    [messages],
  );

  const reconcileAll = useCallback(async () => {
    if (!owner || !network || isStreamingRef.current) return;
    if (!sdk.keys.currentToken() && !findPersistedSessionKey(owner, network)) return;
    const candidates = messagesRef.current.filter(
      (msg) => msg.role === "assistant" && (msg.executionRunId || msg.rootRunId || msg.receipt || (msg.receipts?.length ?? 0) > 0),
    );
    if (candidates.length === 0) return;

    const toIso = new Date().toISOString();
    const fromIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const analyticsPromise: Promise<InferenceAnalytics.InferenceSettlement[]> = Promise.resolve(
      sdk.analytics.get({ networks: [network], from: fromIso, to: toIso, limit: 50 }, { userAddress: owner }),
    )
      .then((res) => res.settlements?.data ?? [])
      .catch(() => [] as InferenceAnalytics.InferenceSettlement[]);

    if (mode === "agent") {
      const recentCandidates = candidates.slice(-6);
      const [analyticsSettlements, ...lists] = await Promise.all([
        analyticsPromise,
        ...recentCandidates.map((msg): Promise<Receipt[]> => {
          const queryByRoot = Boolean(msg.proposal && msg.rootRunId);
          return Promise.resolve(
            sdk.receipts.list({
              network,
              limit: 40,
              ...(queryByRoot
                ? { rootRunId: msg.rootRunId }
                : msg.executionRunId
                  ? { executionRunId: msg.executionRunId }
                  : msg.rootRunId
                    ? { rootRunId: msg.rootRunId }
                    : {}),
            }),
          )
            .then((res) => res.receipts ?? [])
            .catch(() => [] as Receipt[]);
        }),
      ]);

      recentCandidates.forEach((msg, idx) => {
        const fetched: Receipt[] = lists[idx] ?? [];
        const existing = msg.receipts && msg.receipts.length > 0
          ? msg.receipts
          : msg.receipt
            ? [msg.receipt]
            : [];
        // Keep only receipts matching this message when queried without a run filter
        const relevant = (msg.executionRunId || msg.rootRunId)
          ? fetched
          : fetched.filter((r: Receipt) => existing.some((e) =>
            (e.paymentIntentId && e.paymentIntentId === r.paymentIntentId)
            || (e.id && e.id === r.id),
          ));
        const next = reconcileMessageReceipts(existing, relevant, analyticsSettlements);
        if (next.length > 0 && receiptsChanged(msg.receipts, next)) {
          onReconcileRef.current(msg.id, next);
        }
      });
      return;
    }

    // Playground mode: match each assistant turn by paymentIntentId or receipt id
    const [analyticsSettlements, allReceipts] = await Promise.all([
      analyticsPromise,
      Promise.resolve(sdk.receipts.list({ network, limit: 40 }))
        .then((res) => res.receipts ?? [])
        .catch(() => [] as Receipt[]),
    ]);
    for (const msg of candidates.slice(-10)) {
      const existing = msg.receipts && msg.receipts.length > 0
        ? msg.receipts
        : msg.receipt
          ? [msg.receipt]
          : [];
      if (existing.length === 0) continue;
      const matched = allReceipts.filter((candidate: Receipt) => existing.some((item) =>
        (item.paymentIntentId && candidate.paymentIntentId === item.paymentIntentId)
        || (item.id && candidate.id === item.id)
        || (item.txHash && candidate.txHash?.toLowerCase() === item.txHash.toLowerCase()),
      ));
      const next = reconcileMessageReceipts(existing, matched, analyticsSettlements);
      if (next.length > 0 && receiptsChanged(msg.receipts, next)) {
        onReconcileRef.current(msg.id, next);
      }
    }
  }, [mode, network, owner]);

  // Real-time invalidation via existing GET /api/analytics/inference/events SSE
  useReconciliation({
    owner: owner && (hasPending || targetSignature.length > 0) ? owner : null,
    subscribe: (options) => sdk.analytics.subscribe(options),
    refetch: reconcileAll,
  });

  // Trigger immediately when a turn completes (isStreaming -> false) or new run/receipt arrives
  useEffect(() => {
    if (!owner || !network || isStreaming || !targetSignature) return;
    const timer = window.setTimeout(() => {
      void reconcileAll();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isStreaming, network, owner, reconcileAll, targetSignature]);

  // Bounded backoff check while any message has queued/submitted receipts
  useEffect(() => {
    if (!owner || !network || isStreaming || !hasPending) return;
    const delays = [2500, 6000, 12000];
    const timers = delays.map((delay) => window.setTimeout(() => {
      void reconcileAll();
    }, delay));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [hasPending, isStreaming, network, owner, reconcileAll, targetSignature]);
}
