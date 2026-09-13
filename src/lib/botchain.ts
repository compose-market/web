/**
 * Botchain Account Abstraction Client
 *
 * Gasless session approvals on Botchain via ERC-4337 v0.6. Thirdweb is
 * identity-only here: the admin wallet signs the UserOperation hash
 * off-chain; the API relays it with a merchant-paid transaction
 * (prepare → sign → submit), mirroring the SVM fee-payer relay flow.
 *
 * The facilitator owns the approval intent (asset, spender, encoding) —
 * the client only supplies the session budget amount.
 *
 * @module lib/botchain/aa
 */

import type { Account } from "thirdweb/wallets";

import { sdk } from "@/lib/sdk";

/**
 * Submit the session spending approval on Botchain via the merchant relay.
 *
 * Flow:
 * 1. `sdk.botchain.prepareSessionApproval` builds the v0.6 UserOperation and
 *    returns the EntryPoint-computed `userOpHash`.
 * 2. The admin wallet signs the raw hash — EntryPoint validation needs raw
 *    ECDSA from the owner, not the smart account's wrapped ERC-1271 form.
 * 3. `sdk.botchain.submitSessionApproval` relays it; the merchant wallet
 *    pays the submission transaction.
 */
export async function submitBotchainSessionApproval(params: {
    adminWallet: Account;
    owner: string;
    account: string;
    /** Session budget to approve, in asset base units (wei) — decimal string. */
    amount: string;
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const { adminWallet, owner, account, amount } = params;

    const prepared = await sdk.botchain.prepareSessionApproval({
        owner,
        account,
        amount,
    });

    const signature = await adminWallet.signMessage({
        message: { raw: prepared.userOpHash as `0x${string}` },
    });

    const result = await sdk.botchain.submitSessionApproval({
        owner,
        account,
        userOperation: { ...prepared.userOp, signature: signature as string },
    });

    if (result.status === "pending") {
        return {
            success: false,
            txHash: result.transactionHash,
            error: "Session approval transaction is still pending; retry shortly",
        };
    }
    if (!result.success) {
        return {
            success: false,
            txHash: result.transactionHash,
            error: result.reason ?? "Botchain session approval failed",
        };
    }
    return { success: true, txHash: result.transactionHash };
}
