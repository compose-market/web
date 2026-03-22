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
import { SESSION_BUDGET_EVENT, SESSION_INVALID_EVENT } from "@/lib/payment";
import { useWs } from "./use-sse";

const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");
const SESSION_STORAGE_PREFIX = "compose_session";

type SessionThirdwebDeps = {
    getContract: typeof import("thirdweb").getContract;
    sendTransaction: typeof import("thirdweb").sendTransaction;
    allowance: typeof import("thirdweb/extensions/erc20").allowance;
    approve: typeof import("thirdweb/extensions/erc20").approve;
    balanceOf: typeof import("thirdweb/extensions/erc20").balanceOf;
};

type NumericValue = number | string;

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

interface StoredSession {
    budgetLimit: number;
    budgetUsed: number;
    budgetLocked: number;
    budgetRemaining: number;
    expiresAt: number;
    chainId: number;
    userAddress: string;
}

interface ApiSessionResponse {
    hasSession: boolean;
    token?: string;
    budgetLimit?: NumericValue;
    budgetUsed?: NumericValue;
    budgetLocked?: NumericValue;
    budgetRemaining?: NumericValue;
    expiresAt?: number;
    chainId?: NumericValue;
}

interface SessionUpdate {
    chainId?: number;
    expiresAt?: number;
    budgetLimit?: NumericValue;
    budgetUsed?: NumericValue;
    budgetLocked?: NumericValue;
    budgetRemaining?: NumericValue;
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

function normalizeSessionUserAddress(userAddress: string): string {
    return userAddress.trim().toLowerCase();
}

function createScopedSessionStorageKey(userAddress: string, chainId: number): string {
    return `${SESSION_STORAGE_PREFIX}:${normalizeSessionUserAddress(userAddress)}:${chainId}`;
}

function parseSessionNumber(value: unknown, fieldName: string): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    throw new Error(`Invalid session field: ${fieldName}`);
}

function buildSessionState(input: {
    budgetLimit: NumericValue;
    budgetUsed: NumericValue;
    budgetLocked?: NumericValue;
    budgetRemaining: NumericValue;
    expiresAt: number | null;
    chainId: number;
    composeKeyToken: string | null;
}): SessionState {
    const budgetLimit = parseSessionNumber(input.budgetLimit, "budgetLimit");
    const budgetUsed = parseSessionNumber(input.budgetUsed, "budgetUsed");
    const budgetLocked = parseSessionNumber(input.budgetLocked ?? 0, "budgetLocked");
    const budgetRemaining = parseSessionNumber(input.budgetRemaining, "budgetRemaining");
    const expiresAt = input.expiresAt;

    return {
        isActive: (budgetRemaining > 0 || budgetLocked > 0) && (expiresAt === null || expiresAt > Date.now()),
        budgetLimit,
        budgetUsed,
        budgetLocked,
        budgetRemaining,
        expiresAt,
        chainId: input.chainId,
        composeKeyToken: input.composeKeyToken,
    };
}

function buildSessionStateFromApi(
    data: ApiSessionResponse,
    fallbackChainId: number,
    currentToken: string | null,
): SessionState {
    return buildSessionState({
        budgetLimit: data.budgetLimit ?? 0,
        budgetUsed: data.budgetUsed ?? 0,
        budgetLocked: data.budgetLocked ?? 0,
        budgetRemaining: data.budgetRemaining ?? 0,
        expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
        chainId: data.chainId ? parseSessionNumber(data.chainId, "chainId") : fallbackChainId,
        composeKeyToken: typeof data.token === "string" ? data.token : currentToken,
    });
}

function mergeSessionUpdate(previous: SessionState, update: SessionUpdate, fallbackChainId: number): SessionState {
    return buildSessionState({
        budgetLimit: update.budgetLimit ?? previous.budgetLimit,
        budgetUsed: update.budgetUsed ?? previous.budgetUsed,
        budgetLocked: update.budgetLocked ?? previous.budgetLocked,
        budgetRemaining: update.budgetRemaining ?? previous.budgetRemaining,
        expiresAt: typeof update.expiresAt === "number" ? update.expiresAt : previous.expiresAt,
        chainId: typeof update.chainId === "number" ? update.chainId : previous.chainId ?? fallbackChainId,
        composeKeyToken: previous.composeKeyToken,
    });
}

function loadStoredSession(userAddress: string, chainId: number): SessionState | null {
    const stored = localStorage.getItem(createScopedSessionStorageKey(userAddress, chainId));
    if (!stored) {
        return null;
    }

    try {
        const data = JSON.parse(stored) as StoredSession;
        if (
            normalizeSessionUserAddress(data.userAddress) !== normalizeSessionUserAddress(userAddress) ||
            data.chainId !== chainId ||
            data.expiresAt <= Date.now()
        ) {
            localStorage.removeItem(createScopedSessionStorageKey(userAddress, chainId));
            return null;
        }

        return buildSessionState({
            budgetLimit: data.budgetLimit,
            budgetUsed: data.budgetUsed,
            budgetLocked: data.budgetLocked,
            budgetRemaining: data.budgetRemaining,
            expiresAt: data.expiresAt,
            chainId: data.chainId,
            composeKeyToken: null,
        });
    } catch {
        localStorage.removeItem(createScopedSessionStorageKey(userAddress, chainId));
        return null;
    }
}

function saveStoredSession(session: SessionState, userAddress: string): void {
    if (!session.isActive || !session.chainId) {
        return;
    }

    const value: StoredSession = {
        budgetLimit: session.budgetLimit,
        budgetUsed: session.budgetUsed,
        budgetLocked: session.budgetLocked,
        budgetRemaining: session.budgetRemaining,
        expiresAt: session.expiresAt ?? 0,
        chainId: session.chainId,
        userAddress: normalizeSessionUserAddress(userAddress),
    };

    localStorage.setItem(
        createScopedSessionStorageKey(userAddress, session.chainId),
        JSON.stringify(value),
    );
}

function clearStoredSession(userAddress: string, chainId: number | null | undefined): void {
    if (!chainId) {
        return;
    }

    localStorage.removeItem(createScopedSessionStorageKey(userAddress, chainId));
}

function getSessionName(_chainId: number): string {
    return `Session ${new Date().toISOString().slice(0, 10)}`;
}

function scheduleDeferredSessionSync(callback: () => void): () => void {
    if (typeof window === "undefined") {
        callback();
        return () => undefined;
    }

    if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(callback, { timeout: 1_500 });
        return () => window.cancelIdleCallback?.(id);
    }

    const timeoutId = globalThis.setTimeout(callback, 250);
    return () => globalThis.clearTimeout(timeoutId);
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
    const accountRef = useRef<string | null>(null);
    const sessionRef = useRef<SessionState>(defaultSession);
    const syncRef = useRef<{
        account: string;
        chainId: number;
        promise: Promise<SessionState | null>;
    } | null>(null);

    useWs(session.isActive ? account?.address : undefined, session.chainId ?? paymentChainId);

    useEffect(() => {
        accountRef.current = account?.address ?? null;
    }, [account?.address]);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    useEffect(() => {
        if (!account?.address) {
            return;
        }

        posthog?.identify(account.address, {
            wallet_address: account.address,
        });
    }, [account?.address, posthog]);

    const clearSessionState = useCallback((chainId?: number | null) => {
        if (account?.address) {
            clearStoredSession(account.address, chainId ?? session.chainId ?? paymentChainId);
        }
        setSession(defaultSession);
    }, [account?.address, paymentChainId, session.chainId]);

    const syncSessionFromBackend = useCallback(async (options?: {
        chainId?: number;
        clearOnMissing?: boolean;
    }): Promise<SessionState | null> => {
        if (!account?.address) {
            return null;
        }

        const requestedAddress = account.address;
        const currentSession = sessionRef.current;
        const targetChainId = options?.chainId ?? currentSession.chainId ?? paymentChainId;
        const activeSync = syncRef.current;
        if (
            activeSync &&
            activeSync.account === requestedAddress &&
            activeSync.chainId === targetChainId
        ) {
            return activeSync.promise;
        }

        const request = (async (): Promise<SessionState | null> => {
            try {
                const headers: Record<string, string> = {
                    "x-session-user-address": requestedAddress,
                    "x-chain-id": String(targetChainId),
                };

                if (currentSession.composeKeyToken) {
                    headers.Authorization = `Bearer ${currentSession.composeKeyToken}`;
                }

                const response = await fetch(`${API_BASE}/api/session`, { headers });
                if (!response.ok) {
                    return null;
                }

                const data = await response.json() as ApiSessionResponse;
                if (!data.hasSession) {
                    if (options?.clearOnMissing !== false && accountRef.current === requestedAddress) {
                        clearStoredSession(requestedAddress, targetChainId);
                        setSession(defaultSession);
                    }
                    return null;
                }

                const nextSession = buildSessionStateFromApi(
                    data,
                    targetChainId,
                    currentSession.composeKeyToken,
                );

                if (accountRef.current === requestedAddress) {
                    saveStoredSession(nextSession, requestedAddress);
                    setSession(nextSession);
                }

                return nextSession;
            } catch (fetchError) {
                console.warn("[session] backend sync failed", fetchError);
                return null;
            }
        })();

        syncRef.current = {
            account: requestedAddress,
            chainId: targetChainId,
            promise: request,
        };

        try {
            return await request;
        } finally {
            if (syncRef.current?.promise === request) {
                syncRef.current = null;
            }
        }
    }, [account?.address, paymentChainId]);

    useEffect(() => {
        if (!account?.address) {
            setSession(defaultSession);
            return;
        }

        const storedSession = loadStoredSession(account.address, paymentChainId);
        setSession(storedSession ?? defaultSession);

        const cancelDeferredSync = scheduleDeferredSessionSync(() => {
            void syncSessionFromBackend({
                chainId: paymentChainId,
                clearOnMissing: true,
            });
        });

        return cancelDeferredSync;
    }, [account?.address, paymentChainId, syncSessionFromBackend]);

    const ensureComposeKeyToken = useCallback(async (): Promise<string | null> => {
        if (!account?.address) {
            return null;
        }

        const currentSession = sessionRef.current;
        if (currentSession.isActive && currentSession.composeKeyToken) {
            return currentSession.composeKeyToken;
        }

        const refreshedSession = await syncSessionFromBackend({
            chainId: currentSession.chainId ?? paymentChainId,
            clearOnMissing: false,
        });

        return refreshedSession?.composeKeyToken ?? null;
    }, [account?.address, paymentChainId, syncSessionFromBackend]);

    useEffect(() => {
        if (!account?.address || !session.isActive) {
            return;
        }

        function handleVisibilityChange(): void {
            if (!document.hidden) {
                void syncSessionFromBackend({
                    chainId: session.chainId ?? paymentChainId,
                    clearOnMissing: true,
                });
            }
        }

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [account?.address, paymentChainId, session.chainId, session.isActive, syncSessionFromBackend]);

    useEffect(() => {
        if (!account?.address) {
            return;
        }

        const accountAddress = account.address;

        function persistLiveSessionUpdate(update: SessionUpdate): void {
            setSession((previous) => {
                const nextSession = mergeSessionUpdate(
                    previous,
                    update,
                    update.chainId ?? previous.chainId ?? paymentChainId,
                );

                if (nextSession.isActive && nextSession.chainId) {
                    saveStoredSession(nextSession, accountAddress);
                } else {
                    clearStoredSession(accountAddress, nextSession.chainId ?? previous.chainId);
                }

                return nextSession;
            });
        }

        function handleBudgetEvent(event: Event): void {
            const detail = (event as CustomEvent<{
                budgetLimit?: number;
                budgetRemaining?: number;
                budgetUsed?: number;
                budgetLocked?: number;
            }>).detail;

            if (!detail || typeof detail.budgetRemaining !== "number") {
                return;
            }

            persistLiveSessionUpdate(detail);
        }

        function handleInvalidEvent(): void {
            void syncSessionFromBackend({
                chainId: session.chainId ?? paymentChainId,
                clearOnMissing: true,
            });
        }

        function handleSessionActive(event: Event): void {
            const detail = (event as CustomEvent<SessionUpdate>).detail;
            if (!detail) {
                return;
            }

            persistLiveSessionUpdate(detail);
        }

        function handleSessionExpired(event: Event): void {
            const detail = (event as CustomEvent<{ chainId?: number }>).detail;
            clearSessionState(detail?.chainId ?? session.chainId ?? paymentChainId);
        }

        window.addEventListener(SESSION_BUDGET_EVENT, handleBudgetEvent as EventListener);
        window.addEventListener(SESSION_INVALID_EVENT, handleInvalidEvent);
        window.addEventListener("session-active", handleSessionActive as EventListener);
        window.addEventListener("session-expired", handleSessionExpired as EventListener);

        return () => {
            window.removeEventListener(SESSION_BUDGET_EVENT, handleBudgetEvent as EventListener);
            window.removeEventListener(SESSION_INVALID_EVENT, handleInvalidEvent);
            window.removeEventListener("session-active", handleSessionActive as EventListener);
            window.removeEventListener("session-expired", handleSessionExpired as EventListener);
        };
    }, [account?.address, clearSessionState, paymentChainId, session.chainId, syncSessionFromBackend]);

    useEffect(() => {
        if (!account?.address) {
            return;
        }

        const accountAddress = account.address;
        const activeChainId = session.chainId ?? paymentChainId;
        const storageKey = createScopedSessionStorageKey(accountAddress, activeChainId);

        function handleStorageChange(event: StorageEvent): void {
            if (event.key !== storageKey) {
                return;
            }

            if (!event.newValue) {
                setSession(defaultSession);
                return;
            }

            const storedSession = loadStoredSession(accountAddress, activeChainId);
            if (!storedSession) {
                setSession(defaultSession);
                return;
            }

            setSession((previous) => ({
                ...storedSession,
                composeKeyToken: previous.composeKeyToken,
            }));
        }

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, [account?.address, paymentChainId, session.chainId]);

    const createSession = useCallback(async (budgetUSDC: number, durationHours: number = 24) => {
        if (!account) {
            setError("Wallet not connected");
            return false;
        }

        setIsCreating(true);
        setError(null);

        try {
            const budgetWei = Math.floor(budgetUSDC * 1_000_000);
            const expiresAt = Date.now() + durationHours * 60 * 60 * 1000;
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
                balanceOf({
                    contract: usdcContract,
                    address: account.address,
                }),
                allowance({
                    contract: usdcContract,
                    owner: account.address,
                    spender: TREASURY_WALLET,
                }),
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

            const response = await fetch(`${API_BASE}/api/keys`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-user-address": account.address,
                    "x-chain-id": String(paymentChainId),
                },
                body: JSON.stringify({
                    budgetLimit: budgetWei,
                    expiresAt,
                    chainId: paymentChainId,
                    purpose: "session",
                    name: getSessionName(paymentChainId),
                }),
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const nextSession = buildSessionStateFromApi(
                await response.json() as ApiSessionResponse,
                paymentChainId,
                null,
            );

            saveStoredSession(nextSession, account.address);
            setSession(nextSession);

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
            const errorMessage = createError instanceof Error ? createError.message : "Failed to create session";
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
        clearSessionState();
    }, [clearSessionState, posthog, session.budgetRemaining, session.budgetUsed, session.chainId]);

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
