"use client";

/**
 * CostReceiptIndicator — compact badge that hydrates the authenticated
 * cumulative session receipt and then subscribes to sdk.events.receipt.
 */

import { useEffect, useRef, useState } from "react";
import { Receipt as ReceiptIcon } from "lucide-react";
import { sdk } from "@/lib/sdk";
import { addAtomicAmounts, formatWeiUsd, shortTx } from "@/lib/receipts";
import { useSession } from "@/hooks/use-session";
import { receiptIdentityKey } from "@/hooks/use-receipts";
import type { NetworkId } from "@compose-market/sdk/chains";
import type { Receipt, CumulativeBill, ListResponse } from "@compose-market/sdk";

function receiptTx(receipt: Receipt | null): string | undefined {
    return receipt?.txHash;
}

async function listReceipts(network: NetworkId, signal: AbortSignal): Promise<ListResponse> {
    return await sdk.receipts.list({ network, limit: 1, signal });
}

export function CostReceiptIndicator({ className }: { className?: string }) {
    const { session, keyToken } = useSession();
    const [receipt, setReceipt] = useState<Receipt | null>(null);
    const [cumulative, setCumulative] = useState<CumulativeBill | null>(null);
    const seenReceiptKeysRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!keyToken || !session.network) return;
        seenReceiptKeysRef.current.clear();

        const controller = new AbortController();
        void listReceipts(session.network, controller.signal)
            .then((history) => {
                if (controller.signal.aborted) return;
                for (const item of history.receipts) {
                    seenReceiptKeysRef.current.add(receiptIdentityKey(item));
                }
                setCumulative(history.cumulative);
                setReceipt(history.receipts[0] ?? null);
            })
            .catch((error) => {
                if (!controller.signal.aborted) {
                    console.warn("[receipts] failed to hydrate receipt history", error);
                }
            });

        return () => controller.abort();
    }, [keyToken, session.network]);

    useEffect(() => {
        return sdk.events.on("receipt", (event) => {
            const incoming = event.receipt;
            setReceipt(incoming);
            if (!incoming) return;
            const key = receiptIdentityKey(incoming);
            if (seenReceiptKeysRef.current.has(key)) return;
            seenReceiptKeysRef.current.add(key);
            if (seenReceiptKeysRef.current.size > 256) {
                const oldest = seenReceiptKeysRef.current.values().next().value;
                if (oldest) seenReceiptKeysRef.current.delete(oldest);
            }
            setCumulative((prev) => prev
                ? {
                    ...prev,
                    totalAmountWei: addAtomicAmounts(prev.totalAmountWei, incoming.finalAmountWei),
                    receiptCount: prev.receiptCount + 1,
                }
                : {
                    totalAmountWei: incoming.finalAmountWei ?? "0",
                    receiptCount: 1,
                } as CumulativeBill);
        });
    }, []);

    const totalUsd = formatWeiUsd(cumulative?.totalAmountWei);
    const txHash = shortTx(receiptTx(receipt));

    if (!keyToken) return null;

    return (
        <div className={className}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ReceiptIcon className="w-3.5 h-3.5" />
                {totalUsd && <span className="font-mono">{totalUsd}</span>}
                {cumulative && <span className="text-muted-foreground/60">({cumulative.receiptCount})</span>}
                {txHash && (
                    <span className="font-mono text-muted-foreground/60 ml-1" title={receiptTx(receipt)}>
                        {txHash}
                    </span>
                )}
            </div>
        </div>
    );
}
