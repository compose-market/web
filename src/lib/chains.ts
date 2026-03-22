/**
 * Chain Configuration
 * 
 * Frontend chain configuration.
 */

import { createThirdwebClient, getContract } from "thirdweb";
import { avalancheFuji, avalanche, arbitrumSepolia, arbitrum, bscTestnet, bsc } from "thirdweb/chains";
import type { SmartWalletOptions } from "thirdweb/wallets";
import {
    CHAIN_IDS,
    USDC_ADDRESSES,
    SUPPORTED_CHAIN_IDS,
} from "./performance/chains-data";

export {
    CHAIN_CONFIG,
    CHAIN_IDS,
    SUPPORTED_CHAIN_IDS,
    USDC_ADDRESSES,
} from "./performance/chains-data";

export type { ChainId } from "./performance/chains-data";

// =============================================================================
// Chain Objects Map
// =============================================================================

export const CHAIN_OBJECTS = {
    [CHAIN_IDS.avalancheFuji]: avalancheFuji,
    [CHAIN_IDS.avalanche]: avalanche,
    [CHAIN_IDS.arbitrumTestnet]: arbitrumSepolia,
    [CHAIN_IDS.arbitrum]: arbitrum,
    [CHAIN_IDS.bscTestnet]: bscTestnet,
    [CHAIN_IDS.bsc]: bsc,
} as const;

// =============================================================================
// Supported Chains (chains with deployed contracts)
// =============================================================================

export const SUPPORTED_CHAINS = [
    { id: CHAIN_IDS.avalancheFuji, chain: avalancheFuji },
    { id: CHAIN_IDS.arbitrumTestnet, chain: arbitrumSepolia },
] as const;

if (
    SUPPORTED_CHAINS.length !== SUPPORTED_CHAIN_IDS.length
    || !SUPPORTED_CHAINS.every(({ id }, index) => id === SUPPORTED_CHAIN_IDS[index])
) {
    throw new Error("SUPPORTED_CHAINS and SUPPORTED_CHAIN_IDS are out of sync");
}

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
    Workflow: import.meta.env.VITE_WORKFLOW_ADDRESS as Address,
    RFA: import.meta.env.VITE_RFA_ADDRESS as Address,
    Lease: import.meta.env.VITE_LEASE_ADDRESS as Address,
    Royalties: import.meta.env.VITE_ROYALTIES_ADDRESS as Address,
    Distributor: import.meta.env.VITE_DISTRIBUTOR_ADDRESS as Address,
    Delegation: import.meta.env.VITE_DELEGATION_ADDRESS as Address,
    AgentManager: import.meta.env.VITE_AGENT_MANAGER_ADDRESS as Address,
    Utils: import.meta.env.VITE_UTILS_ADDRESS as Address,
} as const;

export const CONTRACT_ADDRESSES = {
    [CHAIN_IDS.avalancheFuji]: { ...SHARED_COMPOSE_CONTRACTS },
    [CHAIN_IDS.arbitrumTestnet]: { ...SHARED_COMPOSE_CONTRACTS },
} as const;

type ContractName = keyof typeof CONTRACT_ADDRESSES[typeof CHAIN_IDS.avalancheFuji];

export function getContractAddress(contract: ContractName, chainId: number = CHAIN_IDS.avalancheFuji): Address {
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
    { label: "$10", value: 10_000_000 },
    { label: "$50", value: 50_000_000 },
    { label: "$100", value: 100_000_000 },
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

const defaultChainId = CHAIN_IDS.avalancheFuji;

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

export const accountAbstraction: SmartWalletOptions = {
    chain: paymentChain,
    sponsorGas: true,
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
