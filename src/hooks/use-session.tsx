import {
    useState,
    useCallback,
    useEffect,
    createContext,
    useContext,
    ReactNode
} from "react";
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
import { useWs } from "./use-websocket";
import type { Address } from "viem";

// Session storage key
const SESSION_KEY = "manowar_session";

// API endpoint for Compose Keys
const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

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
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;

    try {
        const data: StoredSession = JSON.parse(stored);

        // Validate session belongs to current user, correct chain, and hasn't expired
        if (
            data.userAddress === userAddress &&
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
        localStorage.removeItem(SESSION_KEY);
        return null;
    } catch {
        localStorage.removeItem(SESSION_KEY);
        return null;
    }
}

/**
 * Save session to localStorage
 */
function saveSession(session: SessionState, userAddress: string): void {
    if (!session.isActive) {
        localStorage.removeItem(SESSION_KEY);
        return;
    }

    const data: StoredSession = {
        budgetLimit: session.budgetLimit,
        budgetUsed: session.budgetUsed,
        expiresAt: session.expiresAt || 0,
        sessionKeyAddress: session.sessionKeyAddress || "",
        userAddress,
        chainId: session.chainId || paymentChain.id,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
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

    useWs(session.isActive ? account?.address : undefined, paymentChainId);

    const clearSessionState = useCallback(() => {
        localStorage.removeItem(SESSION_KEY);
        setSession(defaultSession);
    }, []);

    const syncSessionFromBackend = useCallback(
        async (options?: { clearOnMissing?: boolean }): Promise<SessionState | null> => {
            if (!account?.address) {
                return null;
            }

            const clearOnMissing = options?.clearOnMissing ?? true;

            try {
                const response = await fetch(`${API_BASE}/api/session`, {
                    headers: {
                        "x-session-user-address": account.address,
                        "x-chain-id": paymentChainId.toString(),
                    },
                });

                if (!response.ok) {
                    if (clearOnMissing && (response.status === 404 || response.status === 401)) {
                        clearSessionState();
                    }
                    return null;
                }

                const data = await response.json();
                if (!data.hasSession) {
                    if (clearOnMissing) {
                        clearSessionState();
                    }
                    return null;
                }

                const restoredSession: SessionState = {
                    isActive: true,
                    budgetLimit: data.budgetLimit,
                    budgetUsed: data.budgetUsed,
                    budgetRemaining: data.budgetRemaining,
                    expiresAt: data.expiresAt,
                    sessionKeyAddress: TREASURY_WALLET,
                    chainId: data.chainId || paymentChainId,
                    composeKeyToken: data.token || null,
                };

                setSession(restoredSession);
                saveSession(restoredSession, account.address);
                return restoredSession;
            } catch (fetchError) {
                console.warn("[Session] Backend fetch failed");
                return null;
            }
        },
        [account?.address, paymentChainId, clearSessionState]
    );

    // Load local session immediately, then reconcile with backend.
    useEffect(() => {
        if (!account?.address) {
            clearSessionState();
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

        void syncSessionFromBackend({ clearOnMissing: true });
    }, [account?.address, paymentChainId, clearSessionState, syncSessionFromBackend]);

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

        const refreshed = await syncSessionFromBackend({ clearOnMissing: false });
        return refreshed?.composeKeyToken || null;
    }, [account?.address, session.isActive, session.composeKeyToken, syncSessionFromBackend]);

    // If a session exists without an in-memory token, proactively refresh it.
    useEffect(() => {
        if (!account?.address) return;
        if (!session.isActive || session.composeKeyToken) return;
        void ensureComposeKeyToken();
    }, [account?.address, session.isActive, session.composeKeyToken, ensureComposeKeyToken]);

    // Keep frontend session in sync with backend expiration/budget changes.
    useEffect(() => {
        if (!account?.address || !session.isActive) return;

        const sync = () => {
            void syncSessionFromBackend({ clearOnMissing: true });
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
    }, [account?.address, session.isActive, syncSessionFromBackend]);

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

        const handleInvalidEvent = () => {
            void syncSessionFromBackend({ clearOnMissing: true });
        };

        const handleSessionExpired = () => {
            console.log("[session] Received session-expired event from WebSocket");
            clearSessionState();
        };

        window.addEventListener(SESSION_BUDGET_EVENT, handleBudgetEvent as EventListener);
        window.addEventListener(SESSION_INVALID_EVENT, handleInvalidEvent as EventListener);
        window.addEventListener("session-expired", handleSessionExpired as EventListener);

        return () => {
            window.removeEventListener(SESSION_BUDGET_EVENT, handleBudgetEvent as EventListener);
            window.removeEventListener(SESSION_INVALID_EVENT, handleInvalidEvent as EventListener);
            window.removeEventListener("session-expired", handleSessionExpired as EventListener);
        };
    }, [account?.address, syncSessionFromBackend, clearSessionState]);

    // Listen for storage changes from other tabs/windows
    useEffect(() => {
        if (!account?.address) return;

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === SESSION_KEY) {
                if (e.newValue) {
                    const stored = loadStoredSession(account.address, paymentChainId);
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
    }, [account?.address, paymentChainId]);

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
                    // CRONOS PATH: Use Lambda AA endpoints (no bundler)
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
                            "x-session-active": "true",
                        },
                        body: JSON.stringify({
                            budgetLimit: budgetWei,
                            expiresAt,
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
                            "x-session-active": "true",
                        },
                        body: JSON.stringify({
                            budgetLimit: budgetWei,
                            expiresAt,
                            chainId: paymentChainId,
                            name: `Session ${new Date().toISOString().slice(0, 10)}`,
                        }),
                    });

                    let composeKeyToken: string | null = null;
                    if (keysResponse.ok) {
                        const keyResult = await keysResponse.json();
                        composeKeyToken = keyResult.token;
                    } else {
                        // Compose Key creation failed - session still works but with slower x402 flow
                        console.warn("[Session] Compose Key creation failed, falling back to x402 flow");
                    }

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

                    return true;
                }
            } catch (err) {
                console.error("[Session] Failed to create session:", err);
                setError(err instanceof Error ? err.message : "Failed to create session");
                return false;
            } finally {
                setIsCreating(false);
            }
        },
        [account, paymentChainId, adminWallet]
    );

    /**
     * End the current session
     */
    const endSession = useCallback(() => {
        clearSessionState();
    }, [clearSessionState]);

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
