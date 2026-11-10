import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveAccount } from "thirdweb/react";

import { purgeOwnerCaches } from "@/lib/cache";
import { persistDurableQueries } from "@/lib/queryClient";

const OWNER_QUERY_ROOTS = new Set([
  "wallet-pair",
  "inference-analytics-dashboard",
  "keys",
]);

function removeOwnerQueries(owner: string, queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.removeQueries({
    predicate: (query) => {
      const [root, queryOwner] = query.queryKey;
      return typeof root === "string"
        && OWNER_QUERY_ROOTS.has(root)
        && queryOwner === owner;
    },
  });
}

export function OwnerCacheBoundary({ children }: { children: ReactNode }) {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  const rawOwner = account?.address?.trim() ?? null;
  const owner = rawOwner
    ? (/^0x[a-f0-9]{40}$/i.test(rawOwner) ? rawOwner.toLowerCase() : rawOwner)
    : null;
  const previousOwner = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousOwner.current;
    previousOwner.current = owner;
    if (!previous || previous === owner) return;

    removeOwnerQueries(previous, queryClient);
    purgeOwnerCaches(previous);
    void persistDurableQueries(queryClient);
  }, [owner, queryClient]);

  return children;
}
