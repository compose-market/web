/**
 * Chain Context - Global chain state management
 * 
 * Manages selected chain for deployments and payments across the app.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { CHAIN_IDS, SUPPORTED_CHAINS } from "@/lib/chains";

// =============================================================================
// Types
// =============================================================================

interface ChainContextValue {
    /** Selected chain for deployments (create-agent, compose, warp) */
    selectedChainId: number;
    setSelectedChainId: (chainId: number) => void;

    /** Payment chain for x402 (can be different if selected chain has no balance) */
    paymentChainId: number;
    setPaymentChainId: (chainId: number) => void;

    /** Whether payment chain was auto-selected due to liquidity */
    isPaymentChainAutoSelected: boolean;
    setIsPaymentChainAutoSelected: (auto: boolean) => void;
}

// =============================================================================
// Context
// =============================================================================

const ChainContext = createContext<ChainContextValue | null>(null);

const STORAGE_KEY = "compose_selected_chain";

// =============================================================================
// Provider
// =============================================================================

export function ChainProvider({ children }: { children: ReactNode }) {
    // Default to Avalanche Fuji
    const [selectedChainId, setSelectedChainIdState] = useState<number>(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = parseInt(stored);
                // Validate it's a supported chain
                if (SUPPORTED_CHAINS.some(c => c.id === parsed)) {
                    return parsed;
                }
            }
        }
        return CHAIN_IDS.avalancheFuji; // Default
    });

    const [paymentChainId, setPaymentChainId] = useState<number>(selectedChainId);
    const [isPaymentChainAutoSelected, setIsPaymentChainAutoSelected] = useState(false);

    // Persist selected chain
    const setSelectedChainId = (chainId: number) => {
        setSelectedChainIdState(chainId);
        if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEY, chainId.toString());
        }
        // Reset payment chain to match when user changes selection
        setPaymentChainId(chainId);
        setIsPaymentChainAutoSelected(false);
    };

    // Sync payment chain with selected chain initially
    useEffect(() => {
        setPaymentChainId(selectedChainId);
    }, []);

    return (
        <ChainContext.Provider
            value={{
                selectedChainId,
                setSelectedChainId,
                paymentChainId,
                setPaymentChainId,
                isPaymentChainAutoSelected,
                setIsPaymentChainAutoSelected,
            }}
        >
            {children}
        </ChainContext.Provider>
    );
}

// =============================================================================
// Hook
// =============================================================================

export function useChain() {
    const context = useContext(ChainContext);
    if (!context) {
        throw new Error("useChain must be used within a ChainProvider");
    }
    return context;
}

/**
 * Get chain info by ID
 */
export function getChainInfo(chainId: number) {
    return SUPPORTED_CHAINS.find(c => c.id === chainId);
}
