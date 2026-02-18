/**
 * Chain Configuration
 * 
 * Single source of truth for all EVM chain configuration on the frontend.
 * Mirrors backend/lambda/shared/config/chains.ts structure.
 * 
 * @module lib/chains
 */

import { createThirdwebClient, getContract, defineChain } from "thirdweb";
import { avalancheFuji, avalanche, arbitrumSepolia, arbitrum, bscTestnet, bsc } from "thirdweb/chains";
import type { SmartWalletOptions } from "thirdweb/wallets";

// =============================================================================
// Chain IDs
// =============================================================================

/**
 * Supported chain IDs (numeric)
 * Cronos is the default chain for x402 payments
 */
export const CHAIN_IDS = {
    // Cronos (default for x402 payments)
    cronosTestnet: 338,
    cronos: 25,
    // Avalanche
    avalancheFuji: 43113,
    avalanche: 43114,
    // Arbitrum
    arbitrumTestnet: 421614,
    arbitrum: 42161,
    // BNB Chain
    bscTestnet: 97,
    bsc: 56,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

// =============================================================================
// Cronos Chain Definitions (not pre-exported from thirdweb/chains)
// =============================================================================

export const cronosTestnet = defineChain({
    id: 338,
    name: "Cronos Testnet",
    nativeCurrency: { name: "Test CRO", symbol: "tCRO", decimals: 18 },
    rpc: "https://evm-t3.cronos.org",
    blockExplorers: [{ name: "Cronos Explorer", url: "https://explorer.cronos.org/testnet" }],
});

export const cronos = defineChain({
    id: 25,
    name: "Cronos",
    nativeCurrency: { name: "Cronos", symbol: "CRO", decimals: 18 },
    rpc: "https://evm.cronos.org",
    blockExplorers: [{ name: "Cronos Explorer", url: "https://explorer.cronos.org" }],
});

// =============================================================================
// Chain Objects Map
// =============================================================================

export const CHAIN_OBJECTS = {
    [CHAIN_IDS.cronosTestnet]: cronosTestnet,
    [CHAIN_IDS.cronos]: cronos,
    [CHAIN_IDS.avalancheFuji]: avalancheFuji,
    [CHAIN_IDS.avalanche]: avalanche,
    [CHAIN_IDS.arbitrumTestnet]: arbitrumSepolia,
    [CHAIN_IDS.arbitrum]: arbitrum,
    [CHAIN_IDS.bscTestnet]: bscTestnet,
    [CHAIN_IDS.bsc]: bsc,
} as const;

// =============================================================================
// USDC Addresses (ERC-3009 compatible for gasless x402)
// =============================================================================

export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
    // Cronos - devUSDC.e / USDC.e
    [CHAIN_IDS.cronosTestnet]: "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0",
    [CHAIN_IDS.cronos]: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",
    // Avalanche
    [CHAIN_IDS.avalancheFuji]: "0x5425890298aed601595a70AB815c96711a31Bc65",
    [CHAIN_IDS.avalanche]: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    // Arbitrum
    [CHAIN_IDS.arbitrumTestnet]: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    [CHAIN_IDS.arbitrum]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    // BNB Chain
    [CHAIN_IDS.bscTestnet]: "0x64544969ed7ebf5f083679233325356ebe738930",
    [CHAIN_IDS.bsc]: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

// =============================================================================
// Chain UI Configuration
// =============================================================================

export const CHAIN_CONFIG: Record<number, {
    name: string;
    isTestnet: boolean;
    explorer: string;
    color: string;
}> = {
    [CHAIN_IDS.cronosTestnet]: {
        name: "Cronos Testnet",
        isTestnet: true,
        explorer: "https://explorer.cronos.org/testnet",
        color: "blue",
    },
    [CHAIN_IDS.cronos]: {
        name: "Cronos",
        isTestnet: false,
        explorer: "https://explorer.cronos.org",
        color: "blue",
    },
    [CHAIN_IDS.avalancheFuji]: {
        name: "Avalanche Fuji",
        isTestnet: true,
        explorer: "https://testnet.snowtrace.io",
        color: "red",
    },
    [CHAIN_IDS.avalanche]: {
        name: "Avalanche C-Chain",
        isTestnet: false,
        explorer: "https://snowtrace.io",
        color: "red",
    },
    [CHAIN_IDS.arbitrumTestnet]: {
        name: "Arbitrum Sepolia",
        isTestnet: true,
        explorer: "https://sepolia.arbiscan.io",
        color: "cyan",
    },
    [CHAIN_IDS.arbitrum]: {
        name: "Arbitrum One",
        isTestnet: false,
        explorer: "https://arbiscan.io",
        color: "cyan",
    },
    [CHAIN_IDS.bscTestnet]: {
        name: "BNB Smart Chain Testnet",
        isTestnet: true,
        explorer: "https://testnet.bscscan.com",
        color: "yellow",
    },
    [CHAIN_IDS.bsc]: {
        name: "BNB Smart Chain",
        isTestnet: false,
        explorer: "https://bscscan.com",
        color: "yellow",
    },
};

// =============================================================================
// x402 Facilitator Configuration
// =============================================================================

/**
 * Check if a chain uses Cronos Labs facilitator
 * Cronos chains use REST API facilitator, others use ThirdWeb on-chain contracts
 */
export function isCronosChain(chainId: number): boolean {
    return chainId === CHAIN_IDS.cronosTestnet || chainId === CHAIN_IDS.cronos;
}

/**
 * Get Cronos network identifier for facilitator API
 */
export function getCronosNetworkString(chainId: number): "cronos-testnet" | "cronos-mainnet" {
    switch (chainId) {
        case CHAIN_IDS.cronosTestnet:
            return "cronos-testnet";
        case CHAIN_IDS.cronos:
            return "cronos-mainnet";
        default:
            throw new Error(`Chain ${chainId} is not a Cronos chain`);
    }
}

// =============================================================================
// Supported Chains (chains with deployed contracts)
// =============================================================================

export const SUPPORTED_CHAINS = [
    { id: CHAIN_IDS.cronosTestnet, chain: cronosTestnet },
    { id: CHAIN_IDS.avalancheFuji, chain: avalancheFuji },
    { id: CHAIN_IDS.arbitrumTestnet, chain: arbitrumSepolia },
] as const;

// =============================================================================
// Contract Addresses (Multi-chain)
// Sourced from environment variables (VITE_ prefix for Vite/browser access)
// =============================================================================

import type { Address } from "viem";

// Deterministic Compose deployment uses the same contract addresses across supported chains.
const SHARED_COMPOSE_CONTRACTS = {
    AgentFactory: import.meta.env.VITE_AGENT_FACTORY_ADDRESS as Address,
    Clone: import.meta.env.VITE_CLONE_ADDRESS as Address,
    Warp: import.meta.env.VITE_WARP_ADDRESS as Address,
    Manowar: import.meta.env.VITE_MANOWAR_ADDRESS as Address,
    RFA: import.meta.env.VITE_RFA_ADDRESS as Address,
    Lease: import.meta.env.VITE_LEASE_ADDRESS as Address,
    Royalties: import.meta.env.VITE_ROYALTIES_ADDRESS as Address,
    Distributor: import.meta.env.VITE_DISTRIBUTOR_ADDRESS as Address,
    Delegation: import.meta.env.VITE_DELEGATION_ADDRESS as Address,
    AgentManager: import.meta.env.VITE_AGENT_MANAGER_ADDRESS as Address,
    Utils: import.meta.env.VITE_UTILS_ADDRESS as Address,
} as const;

export const CONTRACT_ADDRESSES = {
    [CHAIN_IDS.cronosTestnet]: { ...SHARED_COMPOSE_CONTRACTS },
    [CHAIN_IDS.avalancheFuji]: { ...SHARED_COMPOSE_CONTRACTS },
    [CHAIN_IDS.arbitrumTestnet]: { ...SHARED_COMPOSE_CONTRACTS },
} as const;

type ContractName = keyof typeof CONTRACT_ADDRESSES[typeof CHAIN_IDS.cronosTestnet];

export function getContractAddress(contract: ContractName, chainId: number = CHAIN_IDS.cronosTestnet): Address {
    const chainContracts = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES];
    if (!chainContracts) {
        throw new Error(`Contract addresses not configured for chain ${chainId}`);
    }
    return chainContracts[contract];
}

export function getContractAddressForChain(contract: ContractName, chainId: number): Address {
    const chainContracts = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES];
    if (!chainContracts) {
        throw new Error(`Contract addresses not configured for chain ${chainId}`);
    }
    return chainContracts[contract];
}

// =============================================================================
// Pricing Configuration
// =============================================================================

/** Fixed price per inference call in USDC wei (6 decimals) - $0.005 */
export const inferencePriceWei = 5_000;

/** Price per token in USDC wei (legacy) */
export const PRICE_PER_TOKEN_WEI = 1;

/** Maximum tokens per call */
export const MAX_TOKENS_PER_CALL = 100_000;

/** Session budget presets (in USDC wei - 6 decimals) */
export const SESSION_BUDGET_PRESETS = [
    { label: "$1", value: 1_000_000 },
    { label: "$5", value: 5_000_000 },
    { label: "$10", value: 10_000_000 },
    { label: "$25", value: 25_000_000 },
    { label: "$50", value: 50_000_000 },
] as const;

// =============================================================================
// ThirdWeb Client
// =============================================================================

const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID;

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
// Payment Configuration
// =============================================================================

const defaultChainId = CHAIN_IDS.cronosTestnet;

export const paymentChain = CHAIN_OBJECTS[defaultChainId];

export const paymentToken = {
    address: USDC_ADDRESSES[defaultChainId],
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
};

// =============================================================================
// Account Abstraction (ERC-4337)
// =============================================================================

// Cronos SimpleAccountFactory (for chains without ThirdWeb bundler support)
const cronosSimpleAccountFactory = import.meta.env.VITE_CRONOSTEST_SIMPLE_ACCOUNT_FACTORY as `0x${string}`;

export const accountAbstraction: SmartWalletOptions = {
    chain: paymentChain,
    sponsorGas: true,
    // Cronos requires explicit factory since ThirdWeb has no default bundler
    ...(cronosSimpleAccountFactory && { factoryAddress: cronosSimpleAccountFactory }),
};

// =============================================================================
// Environment Wallet Addresses
// =============================================================================

export const TREASURY_WALLET = import.meta.env.VITE_MERCHANT_WALLET_ADDRESS as `0x${string}`;
export const SERVER_WALLET = import.meta.env.VITE_THIRDWEB_SERVER_WALLET_ADDRESS as `0x${string}`;

// =============================================================================
// Helper Functions
// =============================================================================

export function getUsdcAddress(chainId: number): `0x${string}` | undefined {
    return USDC_ADDRESSES[chainId];
}

export function getChainObject(chainId: number) {
    return CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS];
}

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

export function calculateCostUSDC(tokens: number): string {
    const cost = (PRICE_PER_TOKEN_WEI * tokens) / 10 ** 6;
    return cost.toFixed(6);
}

/**
 * Get USDC contract for the default payment chain
 */
export function getPaymentTokenContract() {
    return getContract({
        address: paymentToken.address,
        chain: paymentChain,
        client: thirdwebClient,
    });
}
