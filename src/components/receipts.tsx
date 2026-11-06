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