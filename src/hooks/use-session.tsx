import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { usePostHog } from "@posthog/react";
import { useQuery } from "@tanstack/react-query";
import { useActiveAccount, useActiveWalletConnectionStatus, useAdminWallet } from "thirdweb/react";
import { useSelectedUserAddress } from "@/hooks/use-address";
import {
    Error,
    type ActiveSessionMetadata,
    type BudgetEvent,
    type SessionActiveEvent,
    type SessionExpiredEvent,
    type SessionInvalidEvent,
} from "@compose-market/sdk";
import type { EvmNetworkId, NetworkId } from "@compose-market/sdk/chains";

import { useChain } from "@/contexts/Network";
import { mpError, mpTrack } from "@/lib/mixpanel";
import {
    SESSION_BUDGET_PRESETS,
    TREASURY_WALLET,
    evmChainId,
    getEvmChainObject,
    getUsdcAddressForNetwork,
    inferencePriceWei,
    isEvmNetwork,
    requireEvmNetwork,
    thirdwebClient,
} from "@/lib/chains";
import { sdk } from "@/lib/sdk";
import { readCachedAccount } from "@/lib/cache";
import { durableQueryMeta, DURABLE_CACHE_MAX_AGE } from "@/lib/queryClient";
import { buildSwigApproveTransaction } from "@/lib/svm/swig";
import { deriveSwigConfigAddress } from "@/lib/svm/account";
import { fetchSolanaUsdcBalance } from "@/hooks/use-multichain";
import { submitBotchainSessionApproval } from "@/lib/botchain";
import type { SolanaNetworkId } from "@compose-market/sdk/chains";

type SessionThirdwebDeps = {
    getContract: typeof import("thirdweb").getContract;
    sendTransaction: typeof import("thirdweb").sendTransaction;
    allowance: typeof import("thirdweb/extensions/erc20").allowance;
    approve: typeof import("thirdweb/extensions/erc20").approve;
    balanceOf: typeof import("thirdweb/extensions/erc20").balanceOf;
};

let sessionThirdwebDepsPromise: Promise<SessionThirdwebDeps> | null = null;

export interface SessionState {
    isActive: boolean;
    budgetLimit: number;
    budgetUsed: number;
    budgetLocked: number;
    budgetRemaining: number;
    expiresAt: number | null;
    network: NetworkId | null;
    keyToken: string | null;
}

export interface SessionSetupTransaction {
    kind: "activation" | "approval";
    title: string;
    description: string;
    transactionHash: string;
    network: NetworkId;
}

export interface SessionCreationResult {
    success: boolean;
    transactions: SessionSetupTransaction[];
}

interface SessionContextValue {
    session: SessionState;
    isCreating: boolean;
    error: string | null;
    createSession: (budgetUSDC: number, durationHours?: number) => Promise<SessionCreationResult>;
    ensureKeyToken: () => Promise<string | null>;
    /** One session bootstrap: cached token → state token → freshly minted. */
    resolveActiveKeyToken: () => Promise<string | null>;
    endSession: () => void;
    hasBudget: (requiredWei?: number) => boolean;
    formatBudget: (weiAmount: number) => string;
    budgetPresets: typeof SESSION_BUDGET_PRESETS;
    sessionActive: boolean;
    budgetRemaining: number;
    budgetLimit: number;
    keyToken: string | null;
}

const defaultSession: SessionState = {
    isActive: false,
    budgetLimit: 0,
    budgetUsed: 0,
    budgetLocked: 0,
    budgetRemaining: 0,
    expiresAt: null,
    network: null,
    keyToken: null,
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function toNumberSafe(value: string | number | null | undefined, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function toBudgetUsdString(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
        throw new globalThis.Error("Session budget must be a positive USDC amount");
    }
    return value.toFixed(6).replace(/\.?0+$/, "");
}

function getSessionName(): string {
    return `Session ${new Date().toISOString().slice(0, 10)}`;
}

async function loadSessionThirdwebDeps(): Promise<SessionThirdwebDeps> {
    if (!sessionThirdwebDepsPromise) {
        sessionThirdwebDepsPromise = Promise.all([
            import("thirdweb"),
            import("thirdweb/extensions/erc20"),
        ]).then(([thirdweb, erc20]) => ({
            getContract: thirdweb.getContract,
            sendTransaction: thirdweb.sendTransaction,
            allowance: erc20.allowance,
            approve: erc20.approve,
            balanceOf: erc20.balanceOf,
        }));
    }
    return sessionThirdwebDepsPromise;
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const account = useActiveAccount();
    const connectionStatus = useActiveWalletConnectionStatus();
    const adminWallet = useAdminWallet();
    const { paymentNetwork, solanaChains } = useChain();
    const {
        userAddress,
        isResolving: userAddressResolving,
        evmSignerAddress,
        solanaAddress,
        isActivated: solanaActivated,
        activate: activateSolana,
    } = useSelectedUserAddress();
    const posthog = usePostHog();
    const [session, setSession] = useState<SessionState>(defaultSession);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cachedAccount] = useState(() => readCachedAccount());
    const sessionRef = useRef<SessionState>(defaultSession);
    const attachedWalletKeyRef = useRef<string | null>(null);

    // Metadata-only preload. This does NOT attach a wallet, hydrate/use/clear
    // a token, start SSE, or participate in signing. It only asks the same
    // Valkey-backed GET /api/session endpoint whether the cached address has
    // an active session, while Thirdweb restores the real signer in parallel.
    const cachedUserAddress = isEvmNetwork(paymentNetwork)
        ? cachedAccount?.address ?? null
        : cachedAccount?.solanaAddress ?? null;
    const canPreloadSession = !userAddress
        && connectionStatus !== "disconnected"
        && Boolean(cachedUserAddress);
    const { data: preloadedSession } = useQuery<SessionState, globalThis.Error>({
        queryKey: ["session-metadata", cachedUserAddress, paymentNetwork],
        queryFn: async ({ signal }) => {
            if (!cachedUserAddress) return defaultSession;
            const response = await sdk.fetch("/api/session", {
                method: "GET",
                signal,
                key: null,
                paymentMode: "key",
                userAddress: cachedUserAddress,
                network: paymentNetwork,
            });
            if (!response.ok) {
                throw new globalThis.Error(`Session metadata lookup failed: ${response.status}`);
            }
            const status = await response.json() as ActiveSessionMetadata;
            if (!status.hasSession) return defaultSession;
            return {
                isActive: status.status?.isActive ?? true,
                budgetLimit: toNumberSafe(status.budgetLimit),
                budgetUsed: toNumberSafe(status.budgetUsed),
                budgetLocked: toNumberSafe(status.budgetLocked),
                budgetRemaining: toNumberSafe(status.budgetRemaining),
                expiresAt: typeof status.expiresAt === "number" ? status.expiresAt : null,
                network: status.network ?? paymentNetwork,
                // The live attach/getActive flow below remains the only token owner.
                keyToken: null,
            };
        },
        enabled: canPreloadSession,
        staleTime: 15_000,
        gcTime: DURABLE_CACHE_MAX_AGE,
        retry: 1,
        meta: durableQueryMeta,
    });

    useEffect(() => {
        if (!canPreloadSession || !preloadedSession) return;
        setSession(preloadedSession);
    }, [canPreloadSession, preloadedSession]);

    // Keep the SDK wallet context aligned with the selected payment network.
    // On Solana, wait for the deterministic smart account instead of falling
    // back to the EVM smart account.
    useEffect(() => {
        if (!account?.address) {
            attachedWalletKeyRef.current = null;
            sdk.wallets.clear();
            setSession(defaultSession);
            return;
        }

        if (!userAddress) {
            attachedWalletKeyRef.current = null;
            sdk.wallets.clear();
            setSession(defaultSession);
            return;
        }

        const walletKey = `${userAddress}:${paymentNetwork}`;
        if (attachedWalletKeyRef.current !== walletKey) {
            attachedWalletKeyRef.current = walletKey;
            setSession(defaultSession);
        }

        sdk.wallets.attach({
            address: userAddress,
            network: paymentNetwork,
        });
    }, [account?.address, paymentNetwork, userAddress]);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    useEffect(() => {
        if (!account?.address) return;
        posthog?.identify(account.address, { wallet_address: account.address });
    }, [account?.address, posthog]);

    const syncSessionFromBackend = useCallback(async (): Promise<SessionState | null> => {
        if (!userAddress || userAddressResolving) return null;

        try {
            const status = await sdk.keys.getActive();
            if (!status.hasSession) {
                setSession(defaultSession);
                return null;
            }

            const next: SessionState = {
                isActive: status.status?.isActive ?? true,
                budgetLimit: toNumberSafe(status.budgetLimit),
                budgetUsed: toNumberSafe(status.budgetUsed),
                budgetLocked: toNumberSafe(status.budgetLocked),
                budgetRemaining: toNumberSafe(status.budgetRemaining),
                expiresAt: typeof status.expiresAt === "number" ? status.expiresAt : null,
                network: status.network ?? paymentNetwork,
                keyToken: sdk.keys.currentToken(),
            };
            setSession(next);
            return next;
        } catch (syncError) {
            console.warn("[session] sdk.keys.getActive failed", syncError);
            return null;
        }
    }, [paymentNetwork, userAddress, userAddressResolving]);

    // On wallet connect: hydrate session metadata from the server (the SDK
    // already re-attached any persisted token via its storage adapter).
    useEffect(() => {
        if (!userAddress || userAddressResolving) return;
        void syncSessionFromBackend();
    }, [paymentNetwork, syncSessionFromBackend, userAddress, userAddressResolving]);

    const ensureKeyToken = useCallback(async (): Promise<string | null> => {
        if (!userAddress || userAddressResolving) return null;
        const cached = sdk.keys.currentToken();
        if (cached) return cached;
        const stateToken = sessionRef.current.keyToken;
        if (stateToken) {
            sdk.keys.use(stateToken);
            return stateToken;
        }
        await syncSessionFromBackend();
        const refreshed = sdk.keys.currentToken() ?? sessionRef.current.keyToken;
        if (refreshed) sdk.keys.use(refreshed);
        return refreshed;
    }, [syncSessionFromBackend, userAddress, userAddressResolving]);

    const resolveActiveKeyToken = useCallback(async (): Promise<string | null> => {
        const cached = sdk.keys.currentToken() ?? sessionRef.current.keyToken;
        if (cached) {
            sdk.keys.use(cached);
            return cached;
        }
        return ensureKeyToken();
    }, [ensureKeyToken]);

    // Subscribe to the SDK event bus for live budget / invalid / active /
    // expired signals. No window events — the SDK is the only emitter.
    useEffect(() => {
        if (!userAddress || userAddressResolving) return;

        const disposers: Array<() => void> = [];

        disposers.push(sdk.events.on("budget", (event: BudgetEvent) => {
            setSession((previous) => {
                if (!previous.network) return previous;
                return {
                    ...previous,
                    budgetLimit: toNumberSafe(event.snapshot.limitWei, previous.budgetLimit),
                    budgetUsed: toNumberSafe(event.snapshot.usedWei, previous.budgetUsed),
                    budgetLocked: toNumberSafe(event.snapshot.lockedWei, previous.budgetLocked),
                    budgetRemaining: toNumberSafe(event.snapshot.remainingWei, previous.budgetRemaining),
                    isActive: toNumberSafe(event.snapshot.remainingWei, previous.budgetRemaining) > 0
                        || toNumberSafe(event.snapshot.lockedWei, previous.budgetLocked) > 0,
                };
            });
        }));

        disposers.push(sdk.events.on("sessionInvalid", (_event: SessionInvalidEvent) => {
            // Server marked the session dead. Re-sync to read the ground truth
            // (and pick up the new "no session" state if the server already
            // tore it down).
            void syncSessionFromBackend();
        }));

        disposers.push(sdk.events.on("sessionActive", (event: SessionActiveEvent) => {
            setSession((previous) => ({
                ...previous,
                isActive: true,
                budgetLimit: toNumberSafe(event.budgetLimit, previous.budgetLimit),
                budgetUsed: toNumberSafe(event.budgetUsed, previous.budgetUsed),
                budgetLocked: toNumberSafe(event.budgetLocked, previous.budgetLocked),
                budgetRemaining: toNumberSafe(event.budgetRemaining, previous.budgetRemaining),
                expiresAt: typeof event.expiresAt === "number" ? event.expiresAt : previous.expiresAt,
                network: event.network ?? previous.network,
            }));
        }));

        disposers.push(sdk.events.on("sessionExpired", (_event: SessionExpiredEvent) => {
            sdk.keys.clearToken();
            setSession(defaultSession);
        }));

        return () => {
            for (const dispose of disposers) dispose();
        };
    }, [syncSessionFromBackend, userAddress, userAddressResolving]);

    // Subscribe to the live `/api/session/events` SSE stream. The SDK drives
    // reconnection; we just own the lifetime.
    useEffect(() => {
        const network = session.network ?? paymentNetwork;
        if (!userAddress || userAddressResolving || !session.isActive || !network) return;

        const controller = new AbortController();
        (async () => {
            try {
                const iter = sdk.session.subscribe({
                    userAddress,
                    network,
                    signal: controller.signal,
                });
                for await (const _event of iter) {
                    // Events are already dispatched onto `sdk.events`; nothing
                    // to do here beyond keeping the iterator alive.
                    void _event;
                }
            } catch (subscribeError) {
                if (controller.signal.aborted) return;
                console.warn("[session] /api/session/events subscription ended", subscribeError);
            }
        })();

        return () => controller.abort();
    }, [paymentNetwork, session.network, session.isActive, userAddress, userAddressResolving]);

    useEffect(() => {
        if (!userAddress || userAddressResolving || !session.isActive) return;
        const onVisible = () => {
            if (!document.hidden) void syncSessionFromBackend();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [session.isActive, syncSessionFromBackend, userAddress, userAddressResolving]);

    const createSession = useCallback(async (budgetUSDC: number, durationHours: number = 24) => {
        const transactions: SessionSetupTransaction[] = [];
        if (!account) {
            setError("Wallet not connected");
            return { success: false, transactions };
        }

        if (!userAddress) {
            setError("Solana account is still resolving");
            return { success: false, transactions };
        }

        setIsCreating(true);
        setError(null);

        try {
            if (!isEvmNetwork(paymentNetwork) && !solanaActivated) {
                const activation = await activateSolana();
                if (activation) {
                    transactions.push({
                        kind: "activation",
                        title: "Solana account activated",
                        description: `Reimbursed ${(Number(activation.reimbursementLamports) / 1_000_000_000).toFixed(9).replace(/0+$/, "").replace(/\.$/, "")} SOL for account setup.`,
                        transactionHash: activation.signature,
                        network: paymentNetwork,
                    });
                }
            }

            const budgetWei = Math.floor(budgetUSDC * 1_000_000);
            let evmNetwork: EvmNetworkId | null = null;
            if (isEvmNetwork(paymentNetwork)) {
                evmNetwork = requireEvmNetwork(paymentNetwork, "Session payment approval");
                const activeChain = getEvmChainObject(evmNetwork);
                const usdcAddress = getUsdcAddressForNetwork(evmNetwork);
                if (!activeChain || !usdcAddress) {
                    throw new globalThis.Error(`Session payments are not configured for ${paymentNetwork}`);
                }

                const { getContract, sendTransaction, allowance, approve, balanceOf } = await loadSessionThirdwebDeps();
                const usdcContract = getContract({
                    address: usdcAddress,
                    chain: activeChain,
                    client: thirdwebClient,
                });

                const [currentBalance, currentAllowance] = await Promise.all([
                    balanceOf({ contract: usdcContract, address: account.address }),
                    allowance({ contract: usdcContract, owner: account.address, spender: TREASURY_WALLET }),
                ]);

                if (currentBalance < BigInt(budgetWei)) {
                    const balanceUSDC = Number(currentBalance) / 1_000_000;
                    throw new globalThis.Error(
                        `Insufficient USDC balance. You have $${balanceUSDC.toFixed(2)} but want to budget $${budgetUSDC.toFixed(2)}`,
                    );
                }

                if (currentAllowance < BigInt(budgetWei)) {
                    // Botchain has no Thirdweb bundler: route the session
                    // approval through the merchant relay instead — the
                    // admin signs the UserOperation hash (identity only),
                    // the API pays for its submission.
                    if (paymentNetwork === "eip155:677") {
                        const adminAccount = adminWallet?.getAccount?.();
                        if (!adminAccount) {
                            throw new globalThis.Error("Admin account unavailable for Botchain session approval");
                        }
                        const approvalResult = await submitBotchainSessionApproval({
                            adminWallet: adminAccount,
                            owner: adminAccount.address,
                            account: account.address,
                            amount: String(budgetWei),
                        });
                        if (!approvalResult.success || !approvalResult.txHash) {
                            throw new globalThis.Error(approvalResult.error ?? "Botchain session approval failed");
                        }
                        transactions.push({
                            kind: "approval",
                            title: "Session spending approved",
                            description: `Approved $${budgetUSDC.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} USDC for this session.`,
                            transactionHash: approvalResult.txHash,
                            network: paymentNetwork,
                        });
                    } else {
                        const approval = await sendTransaction({
                            transaction: approve({
                                contract: usdcContract,
                                spender: TREASURY_WALLET,
                                amountWei: BigInt(budgetWei),
                            }),
                            account,
                        });
                        transactions.push({
                            kind: "approval",
                            title: "Session spending approved",
                            description: `Approved $${budgetUSDC.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} USDC for this session.`,
                            transactionHash: approval.transactionHash,
                            network: paymentNetwork,
                        });
                    }
                }
            } else {
                // Solana path: build + relay a Swig-signed SPL approve that
                // delegates USDC spending from the Swig wallet to the
                // facilitator (SVM_TREASURY_SERVER_WALLET_PUBLIC).
                // This is the SVM equivalent of EVM's approve(treasury, budget).
                if (!solanaAddress) {
                    throw new globalThis.Error("Solana smart account is being created, please wait...");
                }
                if (!evmSignerAddress) {
                    throw new globalThis.Error("EVM signer address not available for Swig signing");
                }

                const solanaChain = solanaChains.find((c) => c.network === paymentNetwork);
                if (!solanaChain) {
                    throw new globalThis.Error(`No Solana chain configured for ${paymentNetwork}`);
                }

                const solanaBalance = await fetchSolanaUsdcBalance(
                    solanaAddress,
                    solanaChain.assetAddress,
                    paymentNetwork as SolanaNetworkId,
                    solanaChain.rpcUrl,
                );

                if (solanaBalance < BigInt(budgetWei)) {
                    const balanceUSDC = Number(solanaBalance) / 1_000_000;
                    throw new globalThis.Error(
                        `Insufficient USDC balance. You have $${balanceUSDC.toFixed(2)} but want to budget $${budgetUSDC.toFixed(2)}`,
                    );
                }

                const { feePayer } = await sdk.svm.feePayer();

                const signerAccount = adminWallet?.getAccount?.();
                if (!signerAccount) {
                    throw new globalThis.Error("EVM signer account not available");
                }

                const swigConfigAddress = await deriveSwigConfigAddress(evmSignerAddress);

                const unsignedApproveTxB64 = await buildSwigApproveTransaction({
                    swigConfigAddress: swigConfigAddress as any,
                    expectedWalletAddress: solanaAddress,
                    evmSignerAddress,
                    usdcMint: solanaChain.assetAddress,
                    amount: BigInt(budgetWei),
                    feePayer: feePayer as any,
                    network: paymentNetwork,
                    rpcUrl: solanaChain.rpcUrl,
                    signMessage: async (message: Uint8Array) => {
                        return signerAccount.signMessage({ message: { raw: message } as any });
                    },
                });

                const approval = await sdk.svm.relay({
                    unsignedTransaction: unsignedApproveTxB64,
                    network: paymentNetwork,
                });
                transactions.push({
                    kind: "approval",
                    title: "Session spending approved",
                    description: `Approved $${budgetUSDC.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} USDC for this session.`,
                    transactionHash: approval.signature,
                    network: paymentNetwork,
                });
            }

            // Guarantee the SDK has the right wallet context in case the user
            // flipped chains mid-flight between the effect above and here.
            sdk.wallets.attach({
                address: userAddress,
                network: paymentNetwork,
            });

            const created = await sdk.keys.create({
                purpose: "session",
                budgetUsd: toBudgetUsdString(budgetUSDC),
                durationHours,
                network: paymentNetwork,
                name: getSessionName(),
            });

            const next: SessionState = {
                isActive: true,
                budgetLimit: toNumberSafe(created.budgetLimit, budgetWei),
                budgetUsed: toNumberSafe(created.budgetUsed),
                budgetLocked: 0,
                budgetRemaining: toNumberSafe(created.budgetRemaining, budgetWei),
                expiresAt: created.expiresAt,
                network: created.network,
                keyToken: created.token,
            };
            setSession(next);

            posthog?.capture("session_created", {
                network: paymentNetwork,
                ...(evmNetwork ? { evm_chain_id: evmChainId(evmNetwork) } : {}),
                budget_usdc: budgetUSDC,
                duration_hours: durationHours,
                path: "thirdweb",
            });

            mpTrack("Purchase", {
                revenue: budgetUSDC,
                currency: "USDC",
            });

            return { success: true, transactions };
        } catch (createError) {
            const errorMessage = createError instanceof Error
                ? createError.message
                : typeof createError === "string"
                    ? createError
                    : createError && typeof createError === "object" && "message" in createError
                        ? String((createError as { message: unknown }).message)
                        : "Failed to create session";
            posthog?.captureException(
                createError instanceof Error ? createError : new globalThis.Error(String(createError)),
                {
                    $exception_message: "session_create_failed",
                    network: paymentNetwork,
                    budget_usdc: budgetUSDC,
                },
            );
            mpError("session_create", errorMessage);
            setError(errorMessage);
            return { success: false, transactions };
        } finally {
            setIsCreating(false);
        }
    }, [
        account,
        adminWallet,
        paymentNetwork,
        posthog,
        userAddress,
        evmSignerAddress,
        solanaAddress,
        solanaActivated,
        activateSolana,
        solanaChains,
    ]);

    const endSession = useCallback(() => {
        posthog?.capture("session_ended", {
            network: session.network,
            budget_remaining: session.budgetRemaining,
            budget_used: session.budgetUsed,
        });
        sdk.keys.clearToken();
        setSession(defaultSession);
    }, [posthog, session.budgetRemaining, session.budgetUsed, session.network]);

    const hasBudget = useCallback((requiredWei: number = inferencePriceWei) => (
        session.isActive && session.budgetRemaining >= requiredWei
    ), [session.budgetRemaining, session.isActive]);

    const formatBudget = useCallback((weiAmount: number) => `$${(weiAmount / 1_000_000).toFixed(2)}`, []);

    const value: SessionContextValue = {
        session,
        isCreating,
        error,
        createSession,
        ensureKeyToken,
        resolveActiveKeyToken,
        endSession,
        hasBudget,
        formatBudget,
        budgetPresets: SESSION_BUDGET_PRESETS,
        sessionActive: session.isActive,
        budgetRemaining: session.budgetRemaining,
        budgetLimit: session.budgetLimit,
        keyToken: session.keyToken,
    };

    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession(): SessionContextValue {
    const context = useContext(SessionContext);
    if (!context) {
        throw new globalThis.Error("useSession must be used within a SessionProvider");
    }

    return context;
}
