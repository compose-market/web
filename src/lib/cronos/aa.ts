/**
 * Cronos Account Abstraction Client
 * 
 * Frontend utilities for gasless transactions on Cronos via ERC-4337.
 * Submits UserOperations through Lambda → EntryPoint → Paymaster flow.
 * 
 * @module lib/cronos-aa
 */

import type { Account } from "thirdweb/wallets";
import { encodeFunctionData, type Hex, type Address } from "viem";
import { isCronosChain } from "../chains";

// Lambda API endpoint
const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

// =============================================================================
// Types
// =============================================================================

export interface CronosTransactionParams {
    /** ThirdWeb account (Smart Account) */
    account: Account;
    /** Target contract address */
    to: Address;
    /** Encoded call data */
    data: Hex;
    /** Value in wei (optional, default 0) */
    value?: bigint;
    /** Chain ID (338 for Cronos Testnet) */
    chainId: number;
    /** Admin address (EOA signer) - required for first-time Cronos transactions to deploy account */
    adminAddress?: Address;
    /** Admin wallet (EOA) for signing - REQUIRED for Cronos AA transactions */
    adminWallet?: Account;
}

export interface CronosTransactionResult {
    success: boolean;
    txHash?: Hex;
    error?: string;
}

// =============================================================================
// Sign Intent (EIP-712)
// =============================================================================

/**
 * EIP-712 domain for Cronos AA intents
 */
function getIntentDomain(chainId: number, smartAccountAddress: Address) {
    return {
        name: "Compose.Market AA",
        version: "1",
        chainId: BigInt(chainId),
        verifyingContract: smartAccountAddress,
    };
}

/**
 * EIP-712 types for execute intent
 */
const EXECUTE_TYPES = {
    Execute: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
    ],
} as const;

/**
 * Sign an execute intent with the user's account
 * This creates a signature proving the user authorized this call
 */
export async function signExecuteIntent(
    account: Account,
    to: Address,
    value: bigint,
    data: Hex,
    chainId: number
): Promise<Hex> {
    const domain = getIntentDomain(chainId, account.address as Address);

    const signature = await account.signTypedData({
        domain,
        types: EXECUTE_TYPES,
        primaryType: "Execute",
        message: {
            to,
            value,
            data,
        },
    });

    return signature as Hex;
}

/**
 * Submit a gasless transaction on Cronos via Paymaster
 * 
 * Flow (Two-Step):
 * 1. Call /api/aa/prepare to build UserOp and get UserOpHash
 * 2. User signs the UserOpHash with their admin wallet (signMessage)
 * 3. Call /api/aa/submit with the signature
 * 4. Lambda adds Paymaster data and submits to EntryPoint
 */
export async function submitCronosTransaction(
    params: CronosTransactionParams
): Promise<CronosTransactionResult> {
    const { account, to, data, value = BigInt(0), chainId, adminAddress, adminWallet } = params;

    if (!isCronosChain(chainId)) {
        return {
            success: false,
            error: `Chain ${chainId} is not a Cronos chain. Use standard sendTransaction.`,
        };
    }

    console.log(`[cronos-aa] Submitting transaction on chain ${chainId}`);
    console.log(`[cronos-aa] Smart Account: ${account.address}`);
    console.log(`[cronos-aa] Target: ${to}`);
    if (adminAddress) {
        console.log(`[cronos-aa] Admin (for account deployment): ${adminAddress}`);
    }

    try {
        // Step 1: Prepare the UserOperation (get the hash to sign)
        console.log(`[cronos-aa] Step 1: Preparing UserOperation...`);
        const prepareResponse = await fetch(`${API_BASE}/api/aa/prepare`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                chainId,
                smartAccount: account.address,
                to,
                value: value.toString(),
                data,
                adminAddress,
            }),
        });

        const prepareResult = await prepareResponse.json();

        if (!prepareResponse.ok) {
            console.error(`[cronos-aa] Prepare failed:`, prepareResult);
            return {
                success: false,
                error: prepareResult.error || prepareResult.details || "Failed to prepare UserOperation",
            };
        }

        const { userOpHash, userOp } = prepareResult;
        console.log(`[cronos-aa] UserOpHash: ${userOpHash}`);

        // Step 2: Sign the UserOpHash with the ADMIN WALLET (not Smart Account)
        // Smart Accounts return wrapped EIP-1271 signatures, but EntryPoint needs raw ECDSA
        console.log(`[cronos-aa] Step 2: Signing UserOpHash...`);

        // Prefer adminWallet if provided, otherwise fall back to account
        const signer = adminWallet || account;
        console.log(`[cronos-aa] Signing with: ${signer.address}`);

        const signature = await signer.signMessage({
            message: { raw: userOpHash as `0x${string}` },
        });
        console.log(`[cronos-aa] Signature obtained (${signature.length} chars)`);

        // Step 3: Submit the signed UserOperation
        console.log(`[cronos-aa] Step 3: Submitting signed UserOp...`);
        const submitResponse = await fetch(`${API_BASE}/api/aa/submit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                chainId,
                smartAccount: account.address,
                signature,
                preparedUserOp: userOp, // Backend expects "preparedUserOp" key
            }),
        });

        const submitResult = await submitResponse.json();

        if (!submitResponse.ok) {
            console.error(`[cronos-aa] Submit failed:`, submitResult);
            return {
                success: false,
                error: submitResult.error || submitResult.details || "Transaction failed",
            };
        }

        console.log(`[cronos-aa] Transaction submitted: ${submitResult.txHash}`);
        return {
            success: true,
            txHash: submitResult.txHash,
        };
    } catch (error) {
        console.error(`[cronos-aa] Error:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// =============================================================================
// Batched Transaction (Single UserOp for multiple calls)
// =============================================================================

export interface BatchCall {
    to: Address;
    value?: bigint;
    data: Hex;
}

/**
 * Submit multiple calls as a single batched transaction via Smart Account's executeBatch
 * This reduces gas by combining multiple operations (e.g., approve + mint) into one UserOp
 * 
 * @example
 * await submitCronosBatchTransaction({
 *   account,
 *   calls: [
 *     { to: usdcAddress, data: approveData },
 *     { to: manowarAddress, data: mintData },
 *   ],
 *   chainId: 338,
 *   adminWallet,
 * });
 */
export async function submitCronosBatchTransaction(params: {
    account: Account;
    calls: BatchCall[];
    chainId: number;
    adminAddress?: Address;
    adminWallet?: Account;
}): Promise<CronosTransactionResult> {
    const { account, calls, chainId, adminAddress, adminWallet } = params;

    if (!isCronosChain(chainId)) {
        return {
            success: false,
            error: `Chain ${chainId} is not a Cronos chain.`,
        };
    }

    console.log(`[cronos-aa] Submitting batched transaction with ${calls.length} calls`);

    // Encode executeBatch(address[], uint256[], bytes[])
    const batchData = encodeFunctionData({
        abi: [{
            name: "executeBatch",
            type: "function",
            inputs: [
                { name: "_target", type: "address[]" },
                { name: "_value", type: "uint256[]" },
                { name: "_calldata", type: "bytes[]" },
            ],
            outputs: [],
        }],
        functionName: "executeBatch",
        args: [
            calls.map(c => c.to),
            calls.map(c => c.value ?? BigInt(0)),
            calls.map(c => c.data),
        ],
    });

    // Submit as a single transaction to the Smart Account itself
    // The Smart Account will execute all calls in sequence
    return submitCronosTransaction({
        account,
        to: account.address as Address,
        data: batchData,
        value: BigInt(0),
        chainId,
        adminAddress,
        adminWallet,
    });
}

// =============================================================================
// Helper: Encode Contract Call
// =============================================================================

/**
 * Encode a contract function call for use with submitCronosTransaction
 * 
 * @example
 * const data = encodeContractCall({
 *   abi: AgentFactoryABI,
 *   functionName: "mintAgent",
 *   args: [dnaHash, licenses, price, cloneable, cardUri],
 * });
 */
export function encodeContractCall<TAbi extends readonly unknown[]>(params: {
    abi: TAbi;
    functionName: string;
    args?: readonly unknown[];
}): Hex {
    return encodeFunctionData(params as any);
}

// =============================================================================
// Helper: Check if should use Cronos AA
// =============================================================================

/**
 * Determine if a transaction should use Cronos AA or ThirdWeb
 */
export function shouldUseCronosAA(chainId: number): boolean {
    return isCronosChain(chainId);
}

// =============================================================================
// Cross-Chain Account Registration
// =============================================================================

const CRONOS_REGISTRATION_KEY = "compose_cronos_registered";

function isAlreadyRegisteredOnCronos(adminAddress: string): boolean {
    try {
        const registered = localStorage.getItem(CRONOS_REGISTRATION_KEY);
        if (!registered) return false;
        const addresses: string[] = JSON.parse(registered);
        return addresses.includes(adminAddress.toLowerCase());
    } catch {
        return false;
    }
}

function markAsRegisteredOnCronos(adminAddress: string): void {
    try {
        const registered = localStorage.getItem(CRONOS_REGISTRATION_KEY);
        const addresses: string[] = registered ? JSON.parse(registered) : [];
        if (!addresses.includes(adminAddress.toLowerCase())) {
            addresses.push(adminAddress.toLowerCase());
            localStorage.setItem(CRONOS_REGISTRATION_KEY, JSON.stringify(addresses));
        }
    } catch { }
}

/**
 * Register Smart Account on Cronos. Called once per wallet.
 * @param adminAddress - EOA signer from wallet.getPersonalWallet()
 */
export async function registerOnCronos(
    adminAddress: string
): Promise<{ success: boolean; accountAddress?: string; txHash?: string; error?: string; alreadyRegistered?: boolean }> {
    if (isAlreadyRegisteredOnCronos(adminAddress)) {
        return { success: true, alreadyRegistered: true };
    }

    try {
        const response = await fetch(`${API_BASE}/api/aa/register-cronos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminAddress }),
        });

        const result = await response.json();

        if (!response.ok) {
            return { success: false, error: result.error || "Registration failed" };
        }

        markAsRegisteredOnCronos(adminAddress);

        return {
            success: true,
            accountAddress: result.accountAddress,
            txHash: result.txHash,
            alreadyRegistered: !result.txHash,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Get predicted Smart Account address on Cronos for an admin
 * 
 * @param adminAddress - The EOA signer address
 * @param chainId - Chain ID (default: Cronos Testnet 338)
 */
export async function getPredictedCronosAddress(
    adminAddress: string,
    chainId: number = 338
): Promise<string | null> {
    try {
        const response = await fetch(
            `${API_BASE}/api/aa/predict-address/${adminAddress}?chainId=${chainId}`
        );

        if (!response.ok) {
            console.error(`[cronos-aa] Failed to predict address`);
            return null;
        }

        const result = await response.json();
        return result.predictedAddress;
    } catch (error) {
        console.error(`[cronos-aa] Error predicting address:`, error);
        return null;
    }
}

