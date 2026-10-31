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