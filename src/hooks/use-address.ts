import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useChain } from "@/contexts/Network";
import { isEvmNetwork, isNearNetwork, isSolanaNetwork } from "@/lib/performance/networks";
import { useSolanaSmartAccount } from "@/hooks/use-svm";

type SelectedUserAddressValue = {
    userAddress: string | null;
    evmAddress: string | null;
    solanaAddress: string | null;
    evmSignerAddress: string | null;
    isActivated: boolean;
    isActivating: boolean;
    activate: ReturnType<typeof useSolanaSmartAccount>["create"];
    requiredFundingLamports: bigint | null;
    currentFundingLamports: bigint | null;
    paymentNetwork: ReturnType<typeof useChain>["paymentNetwork"];
    isEvm: boolean;
    isSolana: boolean;
    isNear: boolean;
    isResolving: boolean;
    error: string | null;
};

const IdentityContext = createContext<SelectedUserAddressValue | null>(null);

function useSelectedUserAddressInternal(): SelectedUserAddressValue {
    const account = useActiveAccount();
    const { paymentNetwork } = useChain();
    const {
        swigAddress,
        evmSignerAddress,
        isActivated,
        isCreating,
        requiredFundingLamports,
        currentFundingLamports,
        error,
        create,
    } = useSolanaSmartAccount();
    const isEvm = isEvmNetwork(paymentNetwork);
    const isSolana = isSolanaNetwork(paymentNetwork);
    const isNear = isNearNetwork(paymentNetwork);
    const evmAddress = account?.address ?? null;
    const solanaAddress = swigAddress ?? null;
    const userAddress = isEvm ? evmAddress : isSolana ? solanaAddress : null;
    const isResolving = Boolean(evmAddress) && isSolana && (!solanaAddress || !isActivated || isCreating);

    return useMemo(() => ({
        userAddress,
        evmAddress,
        solanaAddress,
        evmSignerAddress,
        isActivated,
        isActivating: isCreating,
        activate: create,
        requiredFundingLamports,
        currentFundingLamports,
        paymentNetwork,
        isEvm,
        isSolana,
        isNear,
        isResolving,
        error,
    }), [
        create,
        currentFundingLamports,
        error,
        evmAddress,
        evmSignerAddress,
        isActivated,
        isCreating,
        isEvm,
        isNear,
        isResolving,
        isSolana,
        paymentNetwork,
        requiredFundingLamports,
        solanaAddress,
        userAddress,
    ]);
}

/**
 * Single shared Solana Swig + EVM identity provider so HUD, SessionProvider,
 * NetworkSelector, and dialogs share one derivation & status check instead of
 * duplicating Solana RPC pollers per mounted component.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
    const value = useSelectedUserAddressInternal();
    return createElement(IdentityContext.Provider, { value }, children);
}

export function useSelectedUserAddress(): SelectedUserAddressValue {
    const shared = useContext(IdentityContext);
    if (!shared) {
        throw new Error("useSelectedUserAddress must be used inside IdentityProvider");
    }
    return shared;
}
