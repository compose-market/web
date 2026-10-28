/**
 * Thirdweb Chain & Contract Helpers
 *
 * Re-exports the pure network registry (`@/lib/performance/networks`) and adds
 * Thirdweb `Chain` / `getContract` bindings built lazily from the live registry
 * without statically importing `thirdweb/chains` preset tables or binding any
 * single-chain default.
 */

import { createThirdwebClient, defineChain, getContract } from "thirdweb";
import type { Chain } from "thirdweb/chains";
import type { EvmNetworkId, FacilitatorChain } from "@compose-market/sdk/chains";
import {
    evmChainId,
    getChainConfig,
    getEvmChains,
    getUsdcAddress,
    setNetworkRegistry,
    subscribeNetworkRegistry,
} from "./performance/networks";

export * from "./performance/networks";

const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env ?? ({} as ImportMetaEnv);

let resolvedChainObjects: Map<number, Chain> = new Map();

subscribeNetworkRegistry(() => {
    resolvedChainObjects = new Map();
});

export function setChainRegistry(chains: FacilitatorChain[]): void {
    setNetworkRegistry(chains);
}

function buildChainObject(chainId: number): Chain | undefined {
    const existing = resolvedChainObjects.get(chainId);
    if (existing) return existing;
    const config = getChainConfig(chainId);
    if (!config) return undefined;
    const isEvm = config.namespace === "eip155" || (config.network ?? "").startsWith("eip155:");
    if (!isEvm) return undefined;
    const built = defineChain({
        id: chainId,
        rpc: config.rpcUrl,
        name: config.name,
        nativeCurrency: { decimals: 18, name: config.asset, symbol: config.asset },
        ...(config.isTestnet ? { testnet: true as const } : {}),
        blockExplorers: [{ name: "Explorer", url: config.explorer }],
    });
    resolvedChainObjects.set(chainId, built);
    return built;
}

export function getChainObject(chainId: number): Chain | undefined {
    return buildChainObject(chainId);
}

export function getEvmChainObject(network: EvmNetworkId): Chain | undefined {
    return getChainObject(evmChainId(network));
}

export const CHAIN_OBJECTS = new Proxy({} as Record<number, Chain>, {
    get(_target, prop: string) {
        return getChainObject(Number(prop));
    },
    ownKeys() {
        return getEvmChains().map((c) => String(c.chainId));
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});

export function getSupportedChains(): Array<{ id: number; chain: Chain }> {
    return getEvmChains()
        .filter((c) => c.chainId != null)
        .map((c) => ({ id: c.chainId!, chain: getChainObject(c.chainId!)! }))
        .filter((entry) => Boolean(entry.chain));
}

export const SUPPORTED_CHAINS = new Proxy([] as Array<{ id: number; chain: Chain }>, {
    get(_target, prop) {
        const arr = getSupportedChains();
        if (prop === "length") return arr.length;
        if (prop === "map") return arr.map.bind(arr);
        if (prop === "filter") return arr.filter.bind(arr);
        if (prop === "forEach") return arr.forEach.bind(arr);
        if (prop === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
        if (prop === "find") return arr.find.bind(arr);
        if (prop === "some") return arr.some.bind(arr);
        if (prop === "every") return arr.every.bind(arr);
        if (typeof prop === "string" && /^\d+$/.test(prop)) return arr[Number(prop)];
        return undefined;
    },
});

const clientId = env.VITE_THIRDWEB_CLIENT_ID;

if (!clientId) {
    console.error("THIRDWEB CLIENT ID MISSING — set VITE_THIRDWEB_CLIENT_ID in web/.env");
}

export const thirdwebClient = createThirdwebClient({
    clientId: clientId || "placeholder",
});

export function getUsdcContractForChain(chainId: number) {
    const chain = getChainObject(chainId);
    const address = getUsdcAddress(chainId);

    if (!chain || !address) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    return getContract({
        address,
        chain,
        client: thirdwebClient,
    });
}

export function getUsdcContractForNetwork(network: EvmNetworkId) {
    return getUsdcContractForChain(evmChainId(network));
}
