import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchChains, isTestnet, type FacilitatorChain, type FacilitatorChainsResponse, type NetworkId } from "@compose-market/sdk/chains";
import Globe from "lucide-react/icons/globe";
import { evmChainId, getChainByNetwork, isEvmNetwork, isNearNetwork, isSolanaNetwork, setNetworkRegistry } from "@/lib/performance/networks";
import { readBootChains, readBootChainsPromise } from "@/lib/performance/avatars";

export const NETWORK_LOGOS: Record<string, string> = {
  "eip155:43113": "/networks/avalancheFuji.jpeg",
  "eip155:43114": "/networks/avalanche.jpeg",
  "eip155:421614": "/networks/arbitrumSepolia.png",
  "eip155:42161": "/networks/arbitrum.png",
  "eip155:5042002": "/networks/arcTestnet.jpeg",
  "eip155:5042": "/networks/arc.jpeg",
  "eip155:84532": "/networks/baseSepolia.png",
  "eip155:8453": "/networks/base.png",
  "eip155:677": "/networks/botchain.jpg",
  "eip155:1328": "/networks/seiTestnet.jpeg",
  "eip155:1329": "/networks/sei.jpeg",
  "eip155:4217": "/networks/tempo.png",
  "eip155:42431": "/networks/tempoModerato.png",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "/networks/solanaDevnet.jpeg",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "/networks/solana.jpeg",
};
import { cn } from "@/lib/utils";

/** Logo URL for a CAIP-2 network id, if we have an asset for it. */
export function networkLogo(network: string | undefined | null): string | undefined {
  if (!network) return undefined;
  return NETWORK_LOGOS[network];
}

/** Standardized network visual identity glyph (logo with Globe fallback). */
export function NetworkGlyph({
  network,
  name,
  className,
}: {
  network: string | null | undefined;
  name?: string;
  className?: string;
}): React.ReactElement {
  const logo = network ? networkLogo(network) : undefined;
  if (logo) {
    return React.createElement("img", {
      src: logo,
      alt: "",
      className: cn("cm-network-filter__logo", className),
      loading: "lazy",
      decoding: "async",
    });
  }
  return React.createElement(Globe, {
    className: cn("cm-control-switcher__icon", className),
    "aria-label": name,
  });
}

export { NetworkGlyph as NetworkLogo };

interface NetworkValue {
  selectedNetwork: NetworkId | null;
  setSelectedNetwork: (network: NetworkId) => void;
  paymentNetwork: NetworkId | null;
  selectedChain: FacilitatorChain | undefined;
  chains: FacilitatorChain[];
  evmChains: FacilitatorChain[];
  solanaChains: FacilitatorChain[];
  nearChains: FacilitatorChain[];
  isLoading: boolean;
  error: Error | null;
  getChainById: (chainId: number) => FacilitatorChain | undefined;
  getChainByNetworkId: (network: string | null | undefined) => FacilitatorChain | undefined;
}

const Network = createContext<NetworkValue | null>(null);
const STORAGE_KEY = "selected_network";
const REGISTRY_CACHE_KEY = "chain_registry";
const FETCH_CHAINS_TIMEOUT_MS = 8_000;

function isSupportedWalletNamespace(network: string): boolean {
  return isEvmNetwork(network) || isSolanaNetwork(network);
}

const FIRST_TIME_DEFAULT: NetworkId = "eip155:5042";

function isAppAllowedChain(c: FacilitatorChain): boolean {
  if (!isSupportedWalletNamespace(c.network)) return false;
  return !isTestnet(c) || c.network === "eip155:84532";
}

function isBlockedAppNetwork(network: string): boolean {
  if (!isSupportedWalletNamespace(network)) return true;
  if (network === "eip155:84532") return false;
  return isTestnet(network);
}

interface CachedChainRegistry {
  chains: FacilitatorChain[];
  fetchedAt: number;
}

function readCachedRegistry(): CachedChainRegistry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedChainRegistry;
    if (!Array.isArray(parsed?.chains) || parsed.chains.length === 0) return null;
    const filteredChains = parsed.chains.filter(isAppAllowedChain);
    if (filteredChains.length === 0) return null;
    return {
      chains: filteredChains,
      fetchedAt: parsed.fetchedAt,
    };
  } catch {
    return null;
  }
}

function writeCachedRegistry(chains: FacilitatorChain[]): void {
  try {
    localStorage.setItem(
      REGISTRY_CACHE_KEY,
      JSON.stringify({ chains, fetchedAt: Date.now() } satisfies CachedChainRegistry),
    );
  } catch {
    // Quota / private-mode failures are non-fatal: next reload just refetches.
  }
}

function readStoredNetwork(): NetworkId | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && !isBlockedAppNetwork(stored)) return stored as NetworkId;
  } catch {
    // Private-mode / blocked storage is non-fatal.
  }
  return null;
}

function resolveInitialNetwork(chains: readonly FacilitatorChain[]): NetworkId | null {
  const stored = readStoredNetwork();
  if (stored && (chains.length === 0 || chains.some((c) => c.network === stored))) {
    return stored;
  }
  return chains[0]?.network ?? null;
}

function initialNetwork(_defaultNetwork: NetworkId): NetworkId {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && !isBlockedAppNetwork(stored)) return stored as NetworkId;
  }
  return FIRST_TIME_DEFAULT;
}

export function ChainProvider({ children }: { children: ReactNode }) {
  // Synchronously hydrate from the cached registry so the module-level chain
  // registry (lib/chains.ts) and all dependent UI work on first render.
  // setChainRegistry is idempotent, so a double-invoked initializer is safe.
  const [cachedRegistry] = useState<CachedChainRegistry | null>(() => {
    const cached = readCachedRegistry();
    if (cached) setChainRegistry(cached.chains, cached.defaultNetwork);
    return cached;
  });
  const [chains, setChains] = useState<FacilitatorChain[]>(cachedRegistry?.chains ?? []);
  const [defaultNetwork, setDefaultNetwork] = useState<NetworkId>(
    cachedRegistry?.defaultNetwork ?? "eip155:5042",
  );
  const [isLoading, setIsLoading] = useState(!cachedRegistry);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_CHAINS_TIMEOUT_MS);
    fetchChains({ signal: controller.signal }).then(
      (result) => {
        if (!current) return;
        const appChains = result.chains.filter(isAppAllowedChain);
        const appDefaultNetwork = appChains.some((c) => c.network === result.defaultNetwork)
          ? result.defaultNetwork
          : (appChains[0]?.network ?? FIRST_TIME_DEFAULT);
        setChainRegistry(appChains, appDefaultNetwork);
        writeCachedRegistry(appChains, appDefaultNetwork);
        setChains(appChains);
        setDefaultNetwork(appDefaultNetwork);
        setIsLoading(false);
      },
      (err: unknown) => {
        if (!current) return;
        if (cachedRegistry) {
          // A stale registry beats an error screen — keep it and warn.
          console.warn("[chains] revalidation failed, using cached registry", err);
          setIsLoading(false);
          return;
        }
        setError(err instanceof Error ? err : new Error("Failed to fetch chains"));
        setIsLoading(false);
      },
    );
    return () => {
      current = false;
      globalThis.clearTimeout(timeout);
      controller.abort();
    };
    // cachedRegistry is the constant mount-time snapshot; revalidation runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const evmChains = chains.filter((c) => c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:"));
  const solanaChains = chains.filter((c) => c.namespace === "solana" || (c.network ?? "").startsWith("solana:"));

  const getChainById = (chainId: number) =>
    evmChains.find((c) => isEvmNetwork(c.network) && evmChainId(c.network) === chainId);

  const getChainByNetworkId = (network: string) =>
    getChainByNetwork(network) ?? chains.find((c) => c.network === network);

  const [selectedNetwork, setSelectedNetworkState] = useState<NetworkId>(
    () => initialNetwork("eip155:5042"),
  );

  useEffect(() => {
    if (!isLoading && chains.length > 0) {
      setSelectedNetworkState((prev) => {
        if (isBlockedAppNetwork(prev)) return defaultNetwork;
        const chain = getChainByNetworkId(prev);
        if (chain) return prev;
        return defaultNetwork;
      });
    }
  }, [isLoading, chains.length, defaultNetwork]);

  const setSelectedNetwork = (network: NetworkId) => {
    setSelectedNetworkState(network);
    localStorage.setItem(STORAGE_KEY, network);
  };

  return (
    <Network.Provider
      value={{
        selectedNetwork,
        setSelectedNetwork,
        paymentNetwork: selectedNetwork,
        chains,
        evmChains,
        solanaChains,
        defaultNetwork,
        isLoading,
        error,
        getChainById,
        getChainByNetworkId,
      }}
    >
      {children}
    </Network.Provider>
  );
}

export function useChain(): NetworkValue {
  const context = useContext(Network);
  if (!context) throw new Error("useChain must be used within a ChainProvider");
  return context;
}
