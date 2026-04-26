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
import { useActiveAccount } from "thirdweb/react";
import {
    ComposeError,
    type BudgetEvent,
    type SessionActiveEvent,
    type SessionExpiredEvent,
    type SessionInvalidEvent,
} from "@compose-market/sdk";

import { useChain } from "@/contexts/ChainContext";
import { mpError, mpTrack } from "@/lib/mixpanel";
import {
    CHAIN_OBJECTS,
    SESSION_BUDGET_PRESETS,
    TREASURY_WALLET,
    USDC_ADDRESSES,
    inferencePriceWei,
    thirdwebClient,
} from "@/lib/chains";
import { sdk } from "@/lib/sdk";

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
    chainId: number | null;
    composeKeyToken: string | null;
}

interface SessionContextValue {
    session: SessionState;
    isCreating: boolean;
    error: string | null;
    createSession: (budgetUSDC: number, durationHours?: number) => Promise<boolean>;
    ensureComposeKeyToken: () => Promise<string | null>;
    endSession: () => void;
    hasBudget: (requiredWei?: number) => boolean;
    formatBudget: (weiAmount: number) => string;
    budgetPresets: typeof SESSION_BUDGET_PRESETS;
    sessionActive: boolean;
    budgetRemaining: number;
    budgetLimit: number;
    composeKeyToken: string | null;
}

const defaultSession: SessionState = {
    isActive: false,
    budgetLimit: 0,
    budgetUsed: 0,
    budgetLocked: 0,
    budgetRemaining: 0,
    expiresAt: null,
    chainId: null,
    composeKeyToken: null,
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
    const { paymentChainId } = useChain();
    const posthog = usePostHog();
    const [session, setSession] = useState<SessionState>(defaultSession);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const sessionRef = useRef<SessionState>(defaultSession);

    // Keep the SDK's wallet context aligned with the Thirdweb-connected account
    // at all times. The SDK handles token persistence via its storage adapter,
    // so whenever `wallets.attach` runs on a fresh (address, chainId) tuple it
    // automatically re-hydrates any persisted Compose Key JWT.
    useEffect(() => {
        if (account?.address) {
            sdk.wallets.attach({ address: account.address, chainId: paymentChainId });
        } else {
            sdk.wallets.clear();
            setSession(defaultSession);
        }
    }, [account?.address, paymentChainId]);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    useEffect(() => {
        if (!account?.address) return;
        posthog?.identify(account.address, { wallet_address: account.address });
    }, [account?.address, posthog]);

    const syncSessionFromBackend = useCallback(async (): Promise<SessionState | null> => {
        if (!account?.address) return null;

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
                chainId: status.chainId ?? paymentChainId,
                composeKeyToken: sdk.keys.currentToken(),
            };
            setSession(next);
            return next;
        } catch (syncError) {
            console.warn("[session] sdk.keys.getActive failed", syncError);
            return null;
        }
    }, [account?.address, paymentChainId]);

    // On wallet connect: hydrate session metadata from the server (the SDK
    // already re-attached any persisted token via its storage adapter).
    useEffect(() => {
        if (!account?.address) return;
        void syncSessionFromBackend();
    }, [account?.address, paymentChainId, syncSessionFromBackend]);

    const ensureComposeKeyToken = useCallback(async (): Promise<string | null> => {
        if (!account?.address) return null;
        const cached = sdk.keys.currentToken();
        if (cached) return cached;
        const stateToken = sessionRef.current.composeKeyToken;
        if (stateToken) {
            sdk.keys.use(stateToken);
            return stateToken;
        }
        await syncSessionFromBackend();
        const refreshed = sdk.keys.currentToken() ?? sessionRef.current.composeKeyToken;
        if (refreshed) sdk.keys.use(refreshed);
        return refreshed;
    }, [account?.address, syncSessionFromBackend]);

    // Subscribe to the SDK event bus for live budget / invalid / active /
    // expired signals. No window events — the SDK is the only emitter.
    useEffect(() => {
        if (!account?.address) return;

        const disposers: Array<() => void> = [];

        disposers.push(sdk.events.on("budget", (event: BudgetEvent) => {
            setSession((previous) => {
                if (!previous.chainId) return previous;
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
                chainId: event.chainId ?? previous.chainId,
            }));
        }));

        disposers.push(sdk.events.on("sessionExpired", (_event: SessionExpiredEvent) => {
            sdk.keys.clearToken();
            setSession(defaultSession);
        }));

        return () => {
            for (const dispose of disposers) dispose();
        };
    }, [account?.address, syncSessionFromBackend]);

    // Subscribe to the live `/api/session/events` SSE stream. The SDK drives
    // reconnection; we just own the lifetime.
    useEffect(() => {
        if (!account?.address || !session.isActive) return;

        const controller = new AbortController();
        (async () => {
            try {
                const iter = sdk.session.subscribe({ signal: controller.signal });
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
    }, [account?.address, session.isActive]);

    useEffect(() => {
        if (!account?.address || !session.isActive) return;
        const onVisible = () => {
            if (!document.hidden) void syncSessionFromBackend();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [account?.address, session.isActive, syncSessionFromBackend]);

    const createSession = useCallback(async (budgetUSDC: number, durationHours: number = 24) => {
        if (!account) {
            setError("Wallet not connected");
            return false;
        }

        setIsCreating(true);
        setError(null);

        try {
            const budgetWei = Math.floor(budgetUSDC * 1_000_000);
            const activeChain = CHAIN_OBJECTS[paymentChainId as keyof typeof CHAIN_OBJECTS];
            const usdcAddress = USDC_ADDRESSES[paymentChainId];
            if (!activeChain || !usdcAddress) {
                throw new Error(`Session payments are not configured for chain ${paymentChainId}`);
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
                throw new Error(
                    `Insufficient USDC balance. You have $${balanceUSDC.toFixed(2)} but want to budget $${budgetUSDC.toFixed(2)}`,
                );
            }

            if (currentAllowance < BigInt(budgetWei)) {
                await sendTransaction({
                    transaction: approve({
                        contract: usdcContract,
                        spender: TREASURY_WALLET,
                        amountWei: BigInt(budgetWei),
                    }),
                    account,
                });
            }

            // Guarantee the SDK has the right wallet context in case the user
            // flipped chains mid-flight between the effect above and here.
            sdk.wallets.attach({ address: account.address, chainId: paymentChainId });

            const created = await sdk.keys.create({
                purpose: "session",
                budgetUsd: budgetUSDC,
                durationHours,
                name: getSessionName(),
            });

            const next: SessionState = {
                isActive: true,
                budgetLimit: toNumberSafe(created.budgetLimit, budgetWei),
                budgetUsed: toNumberSafe(created.budgetUsed),
                budgetLocked: 0,
                budgetRemaining: toNumberSafe(created.budgetRemaining, budgetWei),
                expiresAt: created.expiresAt,
                chainId: created.chainId,
                composeKeyToken: created.token,
            };
            setSession(next);

            posthog?.capture("session_created", {
                chain_id: paymentChainId,
                budget_usdc: budgetUSDC,
                duration_hours: durationHours,
                path: "thirdweb",
            });

            mpTrack("Purchase", {
                revenue: budgetUSDC,
                currency: "USDC",
            });

            return true;
        } catch (createError) {
            const errorMessage = createError instanceof Error
                ? createError.message
                : createError instanceof ComposeError
                    ? createError.message
                    : "Failed to create session";
            posthog?.captureException(
                createError instanceof Error ? createError : new Error(String(createError)),
                {
                    $exception_message: "session_create_failed",
                    chain_id: paymentChainId,
                    budget_usdc: budgetUSDC,
                },
            );
            mpError("session_create", errorMessage);
            setError(errorMessage);
            return false;
        } finally {
            setIsCreating(false);
        }
    }, [account, paymentChainId, posthog]);

    const endSession = useCallback(() => {
        posthog?.capture("session_ended", {
            chain_id: session.chainId,
            budget_remaining: session.budgetRemaining,
            budget_used: session.budgetUsed,
        });
        sdk.keys.clearToken();
        setSession(defaultSession);
    }, [posthog, session.budgetRemaining, session.budgetUsed, session.chainId]);

    const hasBudget = useCallback((requiredWei: number = inferencePriceWei) => (
        session.isActive && session.budgetRemaining >= requiredWei
    ), [session.budgetRemaining, session.isActive]);

    const formatBudget = useCallback((weiAmount: number) => `$${(weiAmount / 1_000_000).toFixed(2)}`, []);

    const value: SessionContextValue = {
        session,
        isCreating,
        error,
        createSession,
        ensureComposeKeyToken,
        endSession,
        hasBudget,
        formatBudget,
        budgetPresets: SESSION_BUDGET_PRESETS,
        sessionActive: session.isActive,
        budgetRemaining: session.budgetRemaining,
        budgetLimit: session.budgetLimit,
        composeKeyToken: session.composeKeyToken,
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
        throw new Error("useSession must be used within a SessionProvider");
    }

    return context;
}
