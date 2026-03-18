import {
    useState,
    useCallback,
    useEffect,
    createContext,
    useContext,
    ReactNode
} from "react";
import { usePostHog } from "@posthog/react";
import { useActiveAccount, useAdminWallet } from "thirdweb/react";
import { getContract } from "thirdweb";
import { addSessionKey, getAllActiveSigners } from "thirdweb/extensions/erc4337";
import { approve, allowance, balanceOf } from "thirdweb/extensions/erc20";
import { sendTransaction } from "thirdweb";
import {
    thirdwebClient,
    paymentChain,
    paymentToken,
    TREASURY_WALLET,
    SESSION_BUDGET_PRESETS,
    inferencePriceWei,
    CHAIN_OBJECTS,
    USDC_ADDRESSES,
    CHAIN_IDS,
    isCronosChain,
} from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { SESSION_BUDGET_EVENT, SESSION_INVALID_EVENT } from "@/lib/payment";
import { submitCronosTransaction, encodeContractCall } from "@/lib/cronos/aa";
import { useWs } from "./use-sse";
import type { Address } from "viem";

// API endpoint for Compose Keys
const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");
const SESSION_STORAGE_PREFIX = "compose_session";

type SessionSyncReason = "startup" | "token" | "manual" | "invalid" | "poll";

function normalizeSessionUserAddress(userAddress: string): string {
    return userAddress.trim().toLowerCase();
}

function createScopedSessionStorageKey(userAddress: string, chainId: number): string {
    return `${SESSION_STORAGE_PREFIX}:${normalizeSessionUserAddress(userAddress)}:${chainId}`;
}

function shouldBootstrapSessionFromBackend(
    reason: SessionSyncReason,
    hasStoredSession: boolean,
): boolean {
    if (reason === "startup") {
        return hasStoredSession;
    }

    return true;
}

export interface SessionState {
    isActive: boolean;
    budgetLimit: number; // in USDC wei (6 decimals)
    budgetUsed: number;
    budgetRemaining: number;
    expiresAt: number | null;
    sessionKeyAddress: string | null;
    chainId: number | null; // Track which chain the session was created on
    composeKeyToken: string | null; // JWT token for backend authentication (Compose Key)
}

interface StoredSession {
    budgetLimit: number;
    budgetUsed: number;
    expiresAt: number;
    sessionKeyAddress: string;
    userAddress: string;
    chainId: number;
    // NOTE: composeKeyToken only kept in memory 
    // Then fetched fresh from backend on reload
}

interface ApiSessionResponse {
    hasSession: boolean;
    keyId?: string;
    token?: string;
    budgetLimit?: string | number;
    budgetUsed?: string | number;
    budgetLocked?: string | number;
    budgetRemaining?: string | number;
    expiresAt?: number;
    chainId?: string | number;
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
    budgetRemaining: 0,
    expiresAt: null,
    sessionKeyAddress: null,
    chainId: null,
    composeKeyToken: null,
};

// Create context with undefined default to enforce Provider usage
const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * Load session from localStorage
 */
function loadStoredSession(userAddress: string, expectedChainId: number): SessionState | null {
    const storageKey = createScopedSessionStorageKey(userAddress, expectedChainId);
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;

    try {
        const data: StoredSession = JSON.parse(stored);

        // Validate session belongs to current user, correct chain, and hasn't expired
        if (
            normalizeSessionUserAddress(data.userAddress) === normalizeSessionUserAddress(userAddress) &&
            data.expiresAt > Date.now() &&
            data.chainId === expectedChainId
        ) {
            return {
                isActive: true,
                budgetLimit: data.budgetLimit,
                budgetUsed: data.budgetUsed,
                budgetRemaining: data.budgetLimit - data.budgetUsed,
                expiresAt: data.expiresAt,
                sessionKeyAddress: data.sessionKeyAddress,
                chainId: data.chainId,
                composeKeyToken: null, // Token fetched separately from backend
            };
        }

        // Session expired, different user, or different chain - clear it
        localStorage.removeItem(storageKey);
        return null;
    } catch {
        localStorage.removeItem(storageKey);
        return null;
    }
}

/**
 * Save session to localStorage
 */
function saveSession(session: SessionState, userAddress: string): void {
    if (!session.isActive || !session.chainId) {
        return;
    }

    const data: StoredSession = {
        budgetLimit: session.budgetLimit,
        budgetUsed: session.budgetUsed,
        expiresAt: session.expiresAt || 0,
        sessionKeyAddress: session.sessionKeyAddress || "",
        userAddress: normalizeSessionUserAddress(userAddress),
        chainId: session.chainId || paymentChain.id,
    };
    localStorage.setItem(createScopedSessionStorageKey(userAddress, session.chainId), JSON.stringify(data));
}

function clearStoredSession(userAddress: string, chainId: number | null | undefined): void {
    if (!chainId) return;
    localStorage.removeItem(createScopedSessionStorageKey(userAddress, chainId));
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

function buildSessionStateFromApi(data: ApiSessionResponse, fallbackChainId: number): SessionState {
    return {
        isActive: true,
        budgetLimit: parseSessionNumber(data.budgetLimit, "budgetLimit"),
        budgetUsed: parseSessionNumber(data.budgetUsed, "budgetUsed"),
        budgetRemaining: parseSessionNumber(data.budgetRemaining, "budgetRemaining"),
        expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
        sessionKeyAddress: TREASURY_WALLET,
        chainId: data.chainId ? parseSessionNumber(data.chainId, "chainId") : fallbackChainId,
        composeKeyToken: typeof data.token === "string" ? data.token : null,
    };
}

/**
 * Session Provider Component
 * Wraps the app and provides global session state
 */
export function SessionProvider({ children }: { children: ReactNode }) {
    const account = useActiveAccount();
    const adminWallet = useAdminWallet(); // EOA signer for Smart Account (needed for Cronos AA)
    const { paymentChainId } = useChain();
    const [session, setSession] = useState<SessionState>(defaultSession);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const posthog = usePostHog();

    useWs(session.isActive ? account?.address : undefined, session.chainId ?? paymentChainId, session.composeKeyToken);

    // Identify user when wallet connects
    useEffect(() => {
        if (account?.address) {
            posthog?.identify(account.address, {
                wallet_address: account.address,
            });
        }
    }, [account?.address, posthog]);

    const clearSessionState = useCallback((options?: { removePersisted?: boolean; chainId?: number | null }) => {
        if (options?.removePersisted !== false && account?.address) {
            clearStoredSession(account.address, options?.chainId ?? session.chainId ?? paymentChainId);
        }
        setSession(defaultSession);
    }, [account?.address, paymentChainId, session.chainId]);

    const syncSessionFromBackend = useCallback(
        async (
            reason: SessionSyncReason,
            options?: { clearOnMissing?: boolean; chainId?: number }
        ): Promise<SessionState | null> => {
            if (!account?.address) {
                return null;
            }

            const targetChainId = options?.chainId ?? session.chainId ?? paymentChainId;
            const hasStoredSession = Boolean(loadStoredSession(account.address, targetChainId));
            if (!shouldBootstrapSessionFromBackend(reason, hasStoredSession)) {
                return null;
            }

            const clearOnMissing = options?.clearOnMissing ?? reason !== "token";

            try {
                const headers: Record<string, string> = {
                    "x-session-user-address": account.address,
                    "x-chain-id": targetChainId.toString(),
                };
                if (session.composeKeyToken) {
                    headers.Authorization = `Bearer ${session.composeKeyToken}`;
                }

                const response = await fetch(`${API_BASE}/api/session`, {
                    headers,
                });

                if (!response.ok) {
                    if (clearOnMissing && response.status === 409) {
                        clearSessionState({ chainId: targetChainId });
                    }
                    return null;
                }

                const data = await response.json() as ApiSessionResponse;
                if (!data.hasSession) {
                    if (clearOnMissing) {
                        clearSessionState({ chainId: targetChainId });
                    }
                    return null;
                }

                const restoredSession = buildSessionStateFromApi(data, targetChainId);

                setSession(restoredSession);
                saveSession(restoredSession, account.address);
                return restoredSession;
            } catch (fetchError) {
                console.warn("[Session] Backend fetch failed");
                return null;
            }
        },
        [account, clearSessionState, paymentChainId, session.chainId, session.composeKeyToken]
    );

    // Load local session immediately, then reconcile with backend.
    useEffect(() => {
        if (!account?.address) {
            setSession(defaultSession);
            return;
        }

        const stored = loadStoredSession(account.address, paymentChainId);
        if (stored) {
            setSession((prev) => ({
                ...stored,
                composeKeyToken: prev.composeKeyToken && prev.chainId === stored.chainId ? prev.composeKeyToken : null,
            }));
        } else {
            setSession(defaultSession);
        }

        void syncSessionFromBackend("startup", {
            clearOnMissing: true,
            chainId: stored?.chainId ?? paymentChainId,
        });
    }, [account?.address, paymentChainId, syncSessionFromBackend]);

    /**
     * Ensure the active session has a Compose Key token available for bypass.
     * If the in-memory token is missing, refresh from backend session state.
     */
    const ensureComposeKeyToken = useCallback(async (): Promise<string | null> => {
        if (!account?.address) {
            return null;
        }

        if (session.isActive && session.composeKeyToken) {
            return session.composeKeyToken;
        }

        const refreshed = await syncSessionFromBackend("token", {
            clearOnMissing: false,
            chainId: session.chainId ?? paymentChainId,
        });
        return refreshed?.composeKeyToken || null;
    }, [account?.address, paymentChainId, session.isActive, session.composeKeyToken, session.chainId, syncSessionFromBackend]);

    // Keep frontend session in sync with backend expiration/budget changes.
    useEffect(() => {
        if (!account?.address || !session.isActive) return;

        const sync = () => {
            void syncSessionFromBackend("poll", {
                clearOnMissing: true,
                chainId: session.chainId ?? paymentChainId,
            });
        };

        const intervalId = window.setInterval(sync, 15000);
        const onVisibilityChange = () => {
            if (!document.hidden) sync();
        };

        window.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [account?.address, paymentChainId, session.chainId, session.isActive, syncSessionFromBackend]);

    // Update session budget immediately from backend payment response headers.
    useEffect(() => {
        if (!account?.address) return;

        const handleBudgetEvent = (event: Event) => {
            const detail = (event as CustomEvent<{
                budgetRemaining?: number;
                budgetUsed?: number;
                budgetLimit?: number;
            }>).detail;

            if (!detail || typeof detail.budgetRemaining !== "number") return;
            const budgetRemaining = detail.budgetRemaining;

            setSession((prev) => {
                if (!prev.isActive) return prev;

                const nextBudgetLimit = typeof detail.budgetLimit === "number" ? detail.budgetLimit : prev.budgetLimit;
                const nextBudgetUsed =
                    typeof detail.budgetUsed === "number"
                        ? detail.budgetUsed
                        : Math.max(0, nextBudgetLimit - budgetRemaining);
                const nextBudgetRemaining = Math.max(0, budgetRemaining);
                const stillValidByTime = prev.expiresAt ? prev.expiresAt > Date.now() : true;

                const updated: SessionState = {
                    ...prev,
                    budgetLimit: nextBudgetLimit,
                    budgetUsed: nextBudgetUsed,
                    budgetRemaining: nextBudgetRemaining,
                    isActive: nextBudgetRemaining > 0 && stillValidByTime,
                };

                saveSession(updated, account.address);
                return updated;
            });
        };

        const handleInvalidEvent = (event: Event) => {
            const detail = (event as CustomEvent<{ reason?: string }>).detail;
            if (!detail?.reason) {
                return;
            }

            void syncSessionFromBackend("invalid", {
                clearOnMissing: true,
                chainId: session.chainId ?? paymentChainId,
            });
        };

        const handleSessionActive = (event: Event) => {
            const detail = (event as CustomEvent<{
                chainId?: number;
                expiresAt?: number;
                budgetRemaining?: string | number;
            }>).detail;

            if (!detail) {
                return;
            }

            void syncSessionFromBackend("manual", {
                clearOnMissing: true,
                chainId: detail.chainId ?? session.chainId ?? paymentChainId,
            });
        };

        const handleSessionExpired = (event: Event) => {
            const detail = (event as CustomEvent<{ chainId?: number }>).detail;
            console.log("[session] Received session-expired event from session stream");
            clearSessionState({
                chainId: detail?.chainId ?? session.chainId ?? paymentChainId,
            });
        };

        window.addEventListener(SESSION_BUDGET_EVENT, handleBudgetEvent as EventListener);
        window.addEventListener(SESSION_INVALID_EVENT, handleInvalidEvent as EventListener);
        window.addEventListener("session-active", handleSessionActive as EventListener);
        window.addEventListener("session-expired", handleSessionExpired as EventListener);

        return () => {
            window.removeEventListener(SESSION_BUDGET_EVENT, handleBudgetEvent as EventListener);
            window.removeEventListener(SESSION_INVALID_EVENT, handleInvalidEvent as EventListener);
            window.removeEventListener("session-active", handleSessionActive as EventListener);
            window.removeEventListener("session-expired", handleSessionExpired as EventListener);
        };
    }, [account?.address, clearSessionState, paymentChainId, session.chainId, syncSessionFromBackend]);

    // Listen for storage changes from other tabs/windows
    useEffect(() => {
        if (!account?.address) return;

        const handleStorageChange = (e: StorageEvent) => {
            const activeStorageKey = createScopedSessionStorageKey(account.address, session.chainId ?? paymentChainId);
            const currentChainKey = createScopedSessionStorageKey(account.address, paymentChainId);
            if (e.key === activeStorageKey || e.key === currentChainKey) {
                if (e.newValue) {
                    const stored = loadStoredSession(account.address, session.chainId ?? paymentChainId);
                    if (stored) {
                        setSession((prev) => ({
                            ...stored,
                            composeKeyToken: prev.composeKeyToken && prev.chainId === stored.chainId ? prev.composeKeyToken : null,
                        }));
                    }
                } else {
                    // Session was removed
                    setSession(defaultSession);
                }
            }
        };

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, [account?.address, paymentChainId, session.chainId]);

    /**
     * Create a new session with a budget limit
     * This requires ONE signature to approve spending
     */
    const createSession = useCallback(
        async (budgetUSDC: number, durationHours: number = 24) => {
            if (!account) {
                setError("Wallet not connected");
                return false;
            }

            setIsCreating(true);
            setError(null);

            try {
                const budgetWei = Math.floor(budgetUSDC * 1_000_000); // Convert to 6 decimals
                const expiresAt = Date.now() + durationHours * 60 * 60 * 1000;

                // Use the payment chain from context
                const activeChain = CHAIN_OBJECTS[paymentChainId as keyof typeof CHAIN_OBJECTS] || paymentChain;
                const usdcAddress = USDC_ADDRESSES[paymentChainId] || paymentToken.address;

                // Get the smart account contract
                const smartAccountContract = getContract({
                    address: account.address,
                    chain: activeChain,
                    client: thirdwebClient,
                });

                // Get USDC contract
                const usdcContract = getContract({
                    address: usdcAddress,
                    chain: activeChain,
                    client: thirdwebClient,
                });

                // Check actual USDC balance before creating session
                const balance = await balanceOf({
                    contract: usdcContract,
                    address: account.address,
                });

                if (balance < BigInt(budgetWei)) {
                    const balanceUSDC = Number(balance) / 1_000_000;
                    throw new Error(
                        `Insufficient USDC balance. You have $${balanceUSDC.toFixed(2)} but want to budget $${budgetUSDC.toFixed(2)}`
                    );
                }

                // Step 1: Approve USDC spending for the treasury (one-time per session)
                const currentAllowance = await allowance({
                    contract: usdcContract,
                    owner: account.address,
                    spender: TREASURY_WALLET,
                });

                // Check if this is a Cronos chain (no ThirdWeb bundler)
                const useCronosAA = isCronosChain(paymentChainId);

                if (useCronosAA) {
                    // ===========================================================
                    // CRONOS PATH: Use API AA endpoints (no bundler)
                    // ===========================================================
                    console.log("[Session] Using Cronos AA for session creation");

                    // Step 1: Approve USDC spending via Cronos AA
                    if (currentAllowance < BigInt(budgetWei)) {
                        // ERC20 approve function signature
                        const approveData = encodeContractCall({
                            abi: [{
                                name: "approve",
                                type: "function",
                                inputs: [
                                    { name: "spender", type: "address" },
                                    { name: "amount", type: "uint256" },
                                ],
                                outputs: [{ type: "bool" }],
                            }] as const,
                            functionName: "approve",
                            args: [TREASURY_WALLET, BigInt(budgetWei)],
                        });

                        // Get EOA signer for Cronos AA (Smart Accounts need raw ECDSA)
                        const adminAddress = adminWallet?.getAccount()?.address as Address | undefined;
                        const adminAccount = adminWallet?.getAccount();

                        const approveResult = await submitCronosTransaction({
                            account,
                            to: usdcAddress as Address,
                            data: approveData,
                            chainId: paymentChainId,
                            adminAddress,
                            adminWallet: adminAccount,
                        });

                        if (!approveResult.success) {
                            throw new Error(`Failed to approve USDC: ${approveResult.error}`);
                        }
                        console.log("[Session] USDC approval tx:", approveResult.txHash);
                    }

                    // Cronos x402 uses EIP-3009 TransferWithAuthorization for USDC payments.
                    // Session key is tracked locally - USDC transfer is authorized via EIP-712
                    // signature in facilitator.ts at payment time. No on-chain session key needed.
                    console.log("[Session] Cronos session ready - USDC approval complete");

                    // Register session with backend to create Compose Key for on-chain settlement
                    console.log("[Session] Creating Compose Key for on-chain settlement...");
                    const keysResponse = await fetch(`${API_BASE}/api/keys`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-session-user-address": account.address,
                            "x-chain-id": String(paymentChainId),
                            "x-session-active": "true",
                        },
                        body: JSON.stringify({
                            budgetLimit: budgetWei,
                            expiresAt,
                            chainId: paymentChainId,
                            purpose: "session",
                            name: `Cronos Session ${new Date().toISOString().slice(0, 10)}`,
                        }),
                    });

                    if (!keysResponse.ok) {
                        const errorBody = await keysResponse.text();
                        throw new Error(`Failed to create Compose Key: ${errorBody}`);
                    }

                    const keyResult = await keysResponse.json();

                    // Create new session state with Compose Key token
                    const newSession: SessionState = {
                        isActive: true,
                        budgetLimit: budgetWei,
                        budgetUsed: 0,
                        budgetRemaining: budgetWei,
                        expiresAt,
                        sessionKeyAddress: TREASURY_WALLET,
                        chainId: paymentChainId,
                        composeKeyToken: keyResult.token,
                    };

                    // Save to localStorage first
                    saveSession(newSession, account.address);

                    // Then update React state
                    setSession(newSession);

                    posthog?.capture("session_created", {
                        chain_id: paymentChainId,
                        budget_usdc: budgetUSDC,
                        duration_hours: durationHours,
                        path: "cronos",
                    });

                    return true;
                } else {
                    // ===========================================================
                    // THIRDWEB PATH: Use bundler (Avalanche, etc.)
                    // ===========================================================
                    if (currentAllowance < BigInt(budgetWei)) {
                        const approveTx = approve({
                            contract: usdcContract,
                            spender: TREASURY_WALLET,
                            amountWei: BigInt(budgetWei),
                        });

                        await sendTransaction({
                            transaction: approveTx,
                            account,
                        });
                    }

                    // Create session key for the treasury to pull payments
                    const sessionKeyTx = addSessionKey({
                        contract: smartAccountContract,
                        account,
                        sessionKeyAddress: TREASURY_WALLET,
                        permissions: {
                            approvedTargets: [usdcAddress],
                            nativeTokenLimitPerTransaction: "0",
                            permissionStartTimestamp: new Date(Date.now()),
                            permissionEndTimestamp: new Date(expiresAt),
                        },
                    });

                    await sendTransaction({
                        transaction: sessionKeyTx,
                        account,
                    });

                    // Register session with backend to create Compose Key for session bypass
                    // This enables <100ms latency by skipping x402 payment flow
                    console.log("[Session] Creating Compose Key for session bypass...");
                    const keysResponse = await fetch(`${API_BASE}/api/keys`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-session-user-address": account.address,
                            "x-chain-id": String(paymentChainId),
                            "x-session-active": "true",
                        },
                        body: JSON.stringify({
                            budgetLimit: budgetWei,
                            expiresAt,
                            chainId: paymentChainId,
                            purpose: "session",
                            name: `Session ${new Date().toISOString().slice(0, 10)}`,
                        }),
                    });

                    if (!keysResponse.ok) {
                        const errorBody = await keysResponse.text();
                        throw new Error(`Failed to create Compose Key: ${errorBody}`);
                    }

                    const keyResult = await keysResponse.json();
                    const composeKeyToken: string = keyResult.token;

                    // Create new session state with Compose Key token
                    const newSession: SessionState = {
                        isActive: true,
                        budgetLimit: budgetWei,
                        budgetUsed: 0,
                        budgetRemaining: budgetWei,
                        expiresAt,
                        sessionKeyAddress: TREASURY_WALLET,
                        chainId: paymentChainId,
                        composeKeyToken,
                    };

                    // Save to localStorage first
                    saveSession(newSession, account.address);

                    // Then update React state
                    setSession(newSession);

                    posthog?.capture("session_created", {
                        chain_id: paymentChainId,
                        budget_usdc: budgetUSDC,
                        duration_hours: durationHours,
                        path: "thirdweb",
                    });

                    return true;
                }
            } catch (err) {
                console.error("[Session] Failed to create session:", err);
                posthog?.captureException(err instanceof Error ? err : new Error(String(err)), {
                    $exception_message: "session_create_failed",
                    chain_id: paymentChainId,
                    budget_usdc: budgetUSDC,
                });
                setError(err instanceof Error ? err.message : "Failed to create session");
                return false;
            } finally {
                setIsCreating(false);
            }
        },
        [account, adminWallet, paymentChainId, posthog]
    );

    /**
     * End the current session
     */
    const endSession = useCallback(() => {
        posthog?.capture("session_ended", {
            chain_id: session.chainId,
            budget_remaining: session.budgetRemaining,
            budget_used: session.budgetUsed,
        });
        clearSessionState();
    }, [clearSessionState, posthog, session.chainId, session.budgetRemaining, session.budgetUsed]);

    /**
     * Check if session has enough budget for an operation
     * @param requiredWei - Required amount. Defaults to inferencePriceWei
     */
    const hasBudget = useCallback(
        (requiredWei: number = inferencePriceWei) => {
            return session.isActive && session.budgetRemaining >= requiredWei;
        },
        [session]
    );

    /**
     * Format budget display ($X.XX)
     */
    const formatBudget = useCallback((weiAmount: number) => {
        return `$${(weiAmount / 1_000_000).toFixed(2)}`;
    }, []);

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
        // Convenience aliases for direct access
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

/**
 * Hook for accessing session state and actions
 * Must be used within a SessionProvider
 */
export function useSession(): SessionContextValue {
    const context = useContext(SessionContext);
    if (context === undefined) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}

/**
 * Get active session keys for the current account
 */
export function useActiveSessionKeys() {
    const account = useActiveAccount();
    const { paymentChainId } = useChain();
    const [signers, setSigners] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!account?.address) return;

        const fetchSigners = async () => {
            setLoading(true);
            try {
                const activeChain = CHAIN_OBJECTS[paymentChainId as keyof typeof CHAIN_OBJECTS] || paymentChain;

                const contract = getContract({
                    address: account.address,
                    chain: activeChain,
                    client: thirdwebClient,
                });

                const activeSigners = await getAllActiveSigners({ contract });
                setSigners(activeSigners.map((s) => s.signer));
            } catch (err) {
                console.error("Failed to fetch session keys:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchSigners();
    }, [account?.address, paymentChainId]);

    return { signers, loading };
}
