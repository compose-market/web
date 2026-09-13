/**
 * Chain Configuration
 *
 * Frontend chain configuration. Chain objects are built dynamically
 * from data fetched via GET /api/x402/facilitator/chains.
 *
 * The ChainConfigProvider populates the registry on app startup.
 * All functions below read from the registry at call time.
 */

import { createThirdwebClient, defineChain, getContract } from "thirdweb";
import { arcTestnet, avalancheFuji, avalanche, arbitrumSepolia, arbitrum } from "thirdweb/chains";
import type { Chain } from "thirdweb/chains";
import type { SmartWalletOptions } from "thirdweb/wallets";
import type { EvmNetworkId, FacilitatorChain, NetworkId } from "@compose-market/sdk/chains";
import { CONTRACT_ADDRESSES, getContractAddress, getContractAddressForChain, type ContractName } from "./performance/chains-data";

const THIRDWEB_PRESETS: Record<number, Chain> = {
    5042002: arcTestnet,
};

export { CONTRACT_ADDRESSES, getContractAddress, getContractAddressForChain } from "./performance/chains-data";
export { formatUsdcPrice, RFA_BOUNTY_LIMITS, weiToUsdc } from "./performance/chains-data";
export type { ContractName } from "./performance/chains-data";

const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env ?? {} as ImportMetaEnv;

// =============================================================================
// Dynamic Chain Registry (populated by ChainConfigProvider)
// =============================================================================

type AppChain = FacilitatorChain & {
    chainId?: number;
    usdcAddress?: `0x${string}`;
    rpcUrl?: string;
    explorerQuery?: string;
};

let resolvedChains: AppChain[] = [];
let resolvedChainObjects: Map<number, Chain> = new Map();
let resolvedDefaultNetwork: NetworkId = "eip155:43113";

export function isEvmNetwork(network: NetworkId | string | null | undefined): network is EvmNetworkId {
    return typeof network === "string" && network.startsWith("eip155:");
}

export function evmChainId(network: EvmNetworkId): number {
    const value = Number.parseInt(network.slice("eip155:".length), 10);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid EVM network: ${network}`);
    return value;
}

export function requireEvmNetwork(network: NetworkId, action = "This action"): EvmNetworkId {
    if (!isEvmNetwork(network)) {
        throw new Error(`${action} is only available on EVM networks in this pass`);
    }
    return network;
}

function normalizeChain(chain: FacilitatorChain): AppChain {
    const chainId = isEvmNetwork(chain.network) ? evmChainId(chain.network) : undefined;
    return {
        ...chain,
        ...(chainId ? { chainId } : {}),
        usdcAddress: chain.assetAddress as `0x${string}`,
    };
}

export function setChainRegistry(chains: FacilitatorChain[], defaultNetwork: NetworkId): void {
    resolvedChains = chains.map(normalizeChain);
    resolvedDefaultNetwork = defaultNetwork;
    resolvedChainObjects = new Map();
    for (const c of resolvedChains) {
        if (c.chainId == null) continue;
        const isEvm = c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:");
        if (!isEvm) continue;
        const preset = THIRDWEB_PRESETS[c.chainId];
        if (preset && !c.rpcUrl) {
            resolvedChainObjects.set(c.chainId, preset);
        } else {
            resolvedChainObjects.set(c.chainId, defineChain({
                id: c.chainId,
                rpc: c.rpcUrl,
                name: c.name,
                nativeCurrency: { decimals: 18, name: c.asset, symbol: c.asset },
                ...(c.isTestnet ? { testnet: true as const } : {}),
                blockExplorers: [{ name: "Explorer", url: c.explorer }],
            }));
        }
    }
}

export function getChains(): AppChain[] {
    return resolvedChains;
}

export function getEvmChains(): AppChain[] {
    return resolvedChains.filter((c) => c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:"));
}

export function getDefaultNetwork(): NetworkId {
    return resolvedDefaultNetwork;
}

export function getDefaultEvmNetwork(): EvmNetworkId {
    return requireEvmNetwork(resolvedDefaultNetwork, "Default EVM network");
}

export function getDefaultChainId(): number {
    return evmChainId(getDefaultEvmNetwork());
}

export function getChainByNetwork(network: NetworkId | string): AppChain | undefined {
    return resolvedChains.find((c) => c.network === network);
}

export function networkFromChainId(chainId: number): EvmNetworkId {
    return `eip155:${chainId}` as EvmNetworkId;
}

// Backward-compatible exports (computed from registry)
export function getChainIds(): number[] {
    return getEvmChains().map((c) => c.chainId!).filter(Boolean);
}

export function getUsdcAddress(chainId: number): `0x${string}` | undefined {
    const chain = resolvedChains.find((c) => c.chainId === chainId);
    return chain?.usdcAddress ?? (chain?.assetAddress as `0x${string}` | undefined);
}

export function getChainConfig(chainId: number) {
    return resolvedChains.find((c) => c.chainId === chainId);
}

// Backward-compatible CHAIN_OBJECTS (dynamic proxy)
export const CHAIN_OBJECTS = new Proxy({} as Record<number, Chain>, {
    get(_target, prop: string) {
        const id = Number(prop);
        return resolvedChainObjects.get(id);
    },
    ownKeys() {
        return Array.from(resolvedChainObjects.keys()).map(String);
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});

export function getChainObject(chainId: number): Chain | undefined {
    return resolvedChainObjects.get(chainId);
}

export function getEvmChainObject(network: EvmNetworkId): Chain | undefined {
    return getChainObject(evmChainId(network));
}

export function getChainConfigByNetwork(network: NetworkId | string) {
    return getChainByNetwork(network);
}

// Backward-compatible SUPPORTED_CHAINS (computed from registry)
export function getSupportedChains(): Array<{ id: number; chain: Chain }> {
    return getEvmChains()
        .filter((c) => c.chainId != null)
        .map((c) => ({ id: c.chainId!, chain: resolvedChainObjects.get(c.chainId!)! }))
        .filter((entry) => entry.chain);
}

// Lazy proxy for SUPPORTED_CHAINS - allows array indexing and iteration
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

// Backward-compatible CHAIN_CONFIG (dynamic proxy)
export const CHAIN_CONFIG = new Proxy({} as Record<number, {
    name: string;
    isTestnet: boolean;
    explorer: string;
    color: string;
}>, {
    get(_target, prop: string) {
        const id = Number(prop);
        const chain = resolvedChains.find((c) => c.chainId === id);
        if (!chain) return undefined;
        return {
            name: chain.name,
            isTestnet: chain.isTestnet,
            explorer: chain.explorer,
            color: chain.isTestnet ? "red" : "cyan",
        };
    },
    ownKeys() {
        return getEvmChains().map((c) => String(c.chainId));
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});

// Backward-compatible USDC_ADDRESSES (dynamic proxy)
export const USDC_ADDRESSES = new Proxy({} as Record<number, `0x${string}`>, {
    get(_target, prop: string) {
        const id = Number(prop);
        return getUsdcAddress(id);
    },
    ownKeys() {
        return getEvmChains().map((c) => String(c.chainId));
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});

// Backward-compatible CHAIN_IDS (derived from registry)
export const CHAIN_IDS = new Proxy({} as Record<string, number>, {
    get(_target, prop: string) {
        const chain = getEvmChains().find((c) => c.shortName?.replace(/-/g, "") === prop || c.name.replace(/\s/g, "") === prop);
        return chain?.chainId;
    },
    ownKeys() {
        return getEvmChains().map((c) => c.shortName ?? c.name);
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});

export type ChainId = number;
export const SUPPORTED_CHAIN_IDS = new Proxy([] as readonly number[], {
    get(_target, prop) {
        const arr = getEvmChains().map((c) => c.chainId!).filter(Boolean);
        if (prop === "length") return arr.length;
        if (prop === "includes") return arr.includes.bind(arr);
        if (prop === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
        if (prop === "indexOf") return arr.indexOf.bind(arr);
        if (typeof prop === "string" && /^\d+$/.test(prop)) return arr[Number(prop)];
        return undefined;
    },
});

// =============================================================================
// Pricing Configuration
// =============================================================================

export const inferencePriceWei = 5_000;
export const PRICE_PER_TOKEN_WEI = 1;
export const MAX_TOKENS_PER_CALL = 100_000;

export const SESSION_BUDGET_PRESETS = [
    { label: "$1", value: 1_000_000 },
    { label: "$10", value: 10_000_000 },
    { label: "$50", value: 50_000_000 },
    { label: "$100", value: 100_000_000 },
] as const;

// =============================================================================
// ThirdWeb Client
// =============================================================================

const clientId = env.VITE_THIRDWEB_CLIENT_ID;

if (!clientId) {
    console.error(`
╔══════════════════════════════════════════════════════════════════════╗
║  THIRDWEB CLIENT ID MISSING                                          ║
╠══════════════════════════════════════════════════════════════════════╣
║  Create a .env file with:                                            ║
║                                                                      ║
║  VITE_THIRDWEB_CLIENT_ID=your_client_id_here                         ║
║  VITE_MERCHANT_WALLET_ADDRESS=0xYourWalletAddress                    ║
║  VITE_USE_MAINNET=false                                              ║
║                                                                      ║
║  Get your client ID at: https://thirdweb.com/create-api-key          ║
╚══════════════════════════════════════════════════════════════════════╝
`);
}

export const thirdwebClient = createThirdwebClient({
    clientId: clientId || "placeholder",
});

// =============================================================================
// Payment Configuration (resolved from registry)
// =============================================================================

export function getPaymentChain(): Chain {
    const chain = resolvedChainObjects.get(getDefaultChainId());
    if (!chain) throw new Error("Chains not loaded yet — ensure ChainConfigProvider has resolved");
    return chain;
}

export function getPaymentToken() {
    const usdcAddress = getUsdcAddress(getDefaultChainId());
    if (!usdcAddress) throw new Error("USDC address not available for default chain");
    return {
        address: usdcAddress,
        symbol: "USDC",
        decimals: 6,
        name: "USD Coin",
    };
}

export const accountAbstraction: SmartWalletOptions = {
    get chain() {
        return getPaymentChain();
    },
    sponsorGas: true,
} as SmartWalletOptions;

// Backward-compatible static exports (proxied)
export const paymentChain = new Proxy({} as Chain, {
    get() {
        return getPaymentChain();
    },
});

export const paymentToken = new Proxy({} as { address: `0x${string}`; symbol: string; decimals: number; name: string }, {
    get(_target, prop: string) {
        const token = getPaymentToken();
        return (token as Record<string, unknown>)[prop];
    },
});

// =============================================================================
// Environment Wallet Addresses
// =============================================================================

export const TREASURY_WALLET = env.VITE_MERCHANT_WALLET_ADDRESS as `0x${string}`;
export const SERVER_WALLET = env.VITE_THIRDWEB_SERVER_WALLET_ADDRESS as `0x${string}`;

// =============================================================================
// Helper Functions
// =============================================================================

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

export function getUsdcAddressForNetwork(network: EvmNetworkId): `0x${string}` | undefined {
    return getUsdcAddress(evmChainId(network));
}

export function getUsdcContractForNetwork(network: EvmNetworkId) {
    return getUsdcContractForChain(evmChainId(network));
}

export type ExplorerItemType = "tx" | "address" | "block" | "token";

export function getExplorerUrl(network: NetworkId, type: ExplorerItemType, value: string): string {
    const chain = getChainByNetwork(network);
    if (!chain?.explorer) return "#";
    const baseUrl = chain.explorer.replace(/\/$/, "");
    const fallbackQuery = network === "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
        ? "cluster=devnet"
        : undefined;
    const query = chain.explorerQuery ?? fallbackQuery;
    return `${baseUrl}/${type}/${value}${query ? `?${query}` : ""}`;
}

export function getExplorerTxUrl(network: NetworkId, txHash: string): string {
    return getExplorerUrl(network, "tx", txHash);
}

export function calculateCostUSDC(tokens: number): string {
    const cost = (PRICE_PER_TOKEN_WEI * tokens) / 10 ** 6;
    return cost.toFixed(6);
}

export function getPaymentTokenContract() {
    const token = getPaymentToken();
    return getContract({
        address: token.address,
        chain: getPaymentChain(),
        client: thirdwebClient,
    });
}

void CONTRACT_ADDRESSES;
void getContractAddress;
void getContractAddressForChain;
