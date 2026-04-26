"use client";

/**
 * CostReceiptIndicator — compact badge that subscribes to sdk.events.receipt
 * and renders the final-amount of the most recent billable call. Drop this
 * into any page toolbar (playground, agent, workflow) without any page-level
 * receipt wiring.
 */

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { sdk } from "@/lib/sdk";
import type { ComposeReceipt } from "@compose-market/sdk";

function formatWeiUsd(wei: string | undefined): string | null {
    if (!wei) return null;
    const n = Number(wei);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `$${(n / 1_000_000).toFixed(4)}`;
}

function shortTx(hash: string | undefined): string | null {
    if (!hash) return null;
    return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function CostReceiptIndicator({ className }: { className?: string }) {
    const [receipt, setReceipt] = useState<ComposeReceipt | null>(null);

    useEffect(() => {
        return sdk.events.on("receipt", (event) => setReceipt(event.receipt));
    }, []);

    if (!receipt) return null;

    const usd = formatWeiUsd(receipt.finalAmountWei);
    const tx = shortTx(receipt.txHash);

    return (
        <div
            className={`inline-flex items-center gap-1.5 rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[10px] font-mono text-emerald-300 ${className ?? ""}`}
            title={`Last call ${receipt.subject ?? ""} settled ${receipt.finalAmountWei} wei${tx ? ` · tx ${receipt.txHash}` : ""}`}
        >
            <Receipt className="h-3 w-3" aria-hidden="true" />
            <span>{usd ?? "—"}</span>
            {tx ? <span className="text-emerald-200/60">{tx}</span> : null}
        </div>
    );
}
