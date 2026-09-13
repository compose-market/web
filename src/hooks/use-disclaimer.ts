import { useQuery } from "@tanstack/react-query";
import { useActiveAccount } from "thirdweb/react";

import { sdk } from "@/lib/sdk";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { DISCLAIMER_POLICY_VERSION, DISCLAIMER_TYPE } from "@/components/disclaimer";

export function useDisclaimerConsent() {
    const account = useActiveAccount();
    const { userAddress } = useSelectedUserAddress();
    const activeAddress = userAddress ?? account?.address ?? null;

    const query = useQuery({
        queryKey: ["user-consent", activeAddress?.toLowerCase(), DISCLAIMER_POLICY_VERSION],
        queryFn: async () => {
            if (!activeAddress) return { consented: false, record: null };
            try {
                if (typeof sdk.user?.getConsent === "function") {
                    return await sdk.user.getConsent(activeAddress, {
                        disclaimerType: DISCLAIMER_TYPE,
                        policyVersion: DISCLAIMER_POLICY_VERSION,
                    });
                }
                const res = await fetch(
                    `/api/user/consent/${encodeURIComponent(activeAddress)}?type=${encodeURIComponent(DISCLAIMER_TYPE)}&version=${encodeURIComponent(DISCLAIMER_POLICY_VERSION)}`
                );
                if (res.ok) {
                    return await res.json();
                }
                return { consented: false, record: null };
            } catch (err) {
                return { consented: false, record: null };
            }
        },
        enabled: Boolean(activeAddress),
        staleTime: 5 * 60 * 1000,
    });

    return {
        hasConsented: query.data?.consented ?? false,
        consentRecord: query.data?.record ?? null,
        isLoading: query.isLoading,
    };
}
