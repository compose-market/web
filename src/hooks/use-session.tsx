import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
  ReactNode
} from "react";
import { useActiveAccount } from "thirdweb/react";
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
} from "@/lib/thirdweb";

// Session storage key
const SESSION_KEY = "manowar_session";

export interface SessionState {
  isActive: boolean;
  budgetLimit: number; // in USDC wei (6 decimals)
  budgetUsed: number;
  budgetRemaining: number;
  expiresAt: number | null;
  sessionKeyAddress: string | null;
}

interface StoredSession {
  budgetLimit: number;
  budgetUsed: number;
  expiresAt: number;
  sessionKeyAddress: string;
  userAddress: string;
}

interface SessionContextValue {
  session: SessionState;
  isCreating: boolean;
  error: string | null;
  createSession: (budgetUSDC: number, durationHours?: number) => Promise<boolean>;
  recordUsage: (amountWei?: number) => void;
  endSession: () => void;
  hasBudget: (requiredWei?: number) => boolean;
  formatBudget: (weiAmount: number) => string;
  budgetPresets: typeof SESSION_BUDGET_PRESETS;
  sessionActive: boolean;
  budgetRemaining: number;
  budgetLimit: number;
}

const defaultSession: SessionState = {
  isActive: false,
  budgetLimit: 0,
  budgetUsed: 0,
  budgetRemaining: 0,
  expiresAt: null,
  sessionKeyAddress: null,
};

// Create context with undefined default to enforce Provider usage
const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * Load session from localStorage
 */
function loadStoredSession(userAddress: string): SessionState | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;

  try {
    const data: StoredSession = JSON.parse(stored);

    // Validate session belongs to current user and hasn't expired
    if (data.userAddress === userAddress && data.expiresAt > Date.now()) {
      return {
        isActive: true,
        budgetLimit: data.budgetLimit,
        budgetUsed: data.budgetUsed,
        budgetRemaining: data.budgetLimit - data.budgetUsed,
        expiresAt: data.expiresAt,
        sessionKeyAddress: data.sessionKeyAddress,
      };
    }

    // Session expired or different user - clear it
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
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

/**
 * Session Provider Component
 * Wraps the app and provides global session state
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const account = useActiveAccount();
  const [session, setSession] = useState<SessionState>(defaultSession);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load session from storage when account changes
  useEffect(() => {
    if (!account?.address) {
      setSession(defaultSession);
      return;
    }

    const stored = loadStoredSession(account.address);
    if (stored) {
      setSession(stored);
    } else {
      setSession(defaultSession);
    }
  }, [account?.address]);

  // Listen for storage changes from other tabs/windows
  useEffect(() => {
    if (!account?.address) return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) {
        if (e.newValue) {
          const stored = loadStoredSession(account.address);
          if (stored) {
            setSession(stored);
          }
        } else {
          // Session was removed
          setSession(defaultSession);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [account?.address]);

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

        // Get the smart account contract
        const smartAccountContract = getContract({
          address: account.address,
          chain: paymentChain,
          client: thirdwebClient,
        });

        // Get USDC contract
        const usdcContract = getContract({
          address: paymentToken.address,
          chain: paymentChain,
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

        if (currentAllowance < BigInt(budgetWei)) {
          // Need to approve more spending
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

        // Step 2: Create session key for the treasury to pull payments
        // This allows the server to settle payments without user signatures
        const sessionKeyTx = addSessionKey({
          contract: smartAccountContract,
          account,
          sessionKeyAddress: TREASURY_WALLET,
          permissions: {
            approvedTargets: [paymentToken.address], // Only USDC contract
            nativeTokenLimitPerTransaction: "0", // No native token spending
            permissionStartTimestamp: new Date(Date.now()),
            permissionEndTimestamp: new Date(expiresAt),
          },
        });

        await sendTransaction({
          transaction: sessionKeyTx,
          account,
        });

        // Create new session state
        const newSession: SessionState = {
          isActive: true,
          budgetLimit: budgetWei,
          budgetUsed: 0,
          budgetRemaining: budgetWei,
          expiresAt,
          sessionKeyAddress: TREASURY_WALLET,
        };

        // Save to localStorage first
        saveSession(newSession, account.address);

        // Then update React state
        setSession(newSession);

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create session");
        return false;
      } finally {
        setIsCreating(false);
      }
    },
    [account]
  );

  /**
   * Record usage against the session budget
   * Called after each successful inference
   * @param amountWei - Amount in USDC wei (6 decimals). Defaults to inferencePriceWei ($0.005)
   */
  const recordUsage = useCallback((amountWei: number = inferencePriceWei) => {
    if (!account?.address) return;

    setSession((prev) => {
      if (!prev.isActive) return prev;

      const newUsed = prev.budgetUsed + amountWei;
      const newRemaining = Math.max(0, prev.budgetLimit - newUsed);

      const newSession: SessionState = {
        ...prev,
        budgetUsed: newUsed,
        budgetRemaining: newRemaining,
        // Deactivate if budget exhausted
        isActive: newRemaining > 0,
      };

      // Save to localStorage
      saveSession(newSession, account.address);

      return newSession;
    });
  }, [account?.address]);

  /**
   * End the current session
   */
  const endSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(defaultSession);
  }, []);

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
    recordUsage,
    endSession,
    hasBudget,
    formatBudget,
    budgetPresets: SESSION_BUDGET_PRESETS,
    // Convenience aliases for direct access
    sessionActive: session.isActive,
    budgetRemaining: session.budgetRemaining,
    budgetLimit: session.budgetLimit,
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
  const [signers, setSigners] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!account?.address) return;

    const fetchSigners = async () => {
      setLoading(true);
      try {
        const contract = getContract({
          address: account.address,
          chain: paymentChain,
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
  }, [account?.address]);

  return { signers, loading };
}
