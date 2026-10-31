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