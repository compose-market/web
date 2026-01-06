import { createThirdwebClient, getContract } from "thirdweb";
import { avalancheFuji, avalanche, bscTestnet, bsc } from "thirdweb/chains";
import type { SmartWalletOptions } from "thirdweb/wallets";

// =============================================================================
// Chain Configuration (Centralized - add new chains here)
// =============================================================================

export const CHAIN_IDS = {
  // Avalanche (primary for Compose Market)
  avalancheFuji: 43113,
  avalanche: 43114,
  // BNB Chain (future support)
  bscTestnet: 97,
  bsc: 56,
} as const;

// USDC addresses per chain (supports ERC-3009 for x402)
export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  // Avalanche
  [CHAIN_IDS.avalancheFuji]: "0x5425890298aed601595a70AB815c96711a31Bc65",
  [CHAIN_IDS.avalanche]: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  // BNB Chain
  [CHAIN_IDS.bscTestnet]: "0x64544969ed7EBf5f083679233325356EbE738930",
  [CHAIN_IDS.bsc]: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

// Map chain IDs to thirdweb chain objects
export const CHAIN_OBJECTS = {
  [CHAIN_IDS.avalancheFuji]: avalancheFuji,
  [CHAIN_IDS.avalanche]: avalanche,
  [CHAIN_IDS.bscTestnet]: bscTestnet,
  [CHAIN_IDS.bsc]: bsc,
} as const;

// Chain metadata for UI
export const CHAIN_CONFIG: Record<number, {
  name: string;
  isTestnet: boolean;
  explorer: string;
}> = {
  [CHAIN_IDS.avalancheFuji]: {
    name: "Avalanche Fuji",
    isTestnet: true,
    explorer: "https://testnet.snowtrace.io",
  },
  [CHAIN_IDS.avalanche]: {
    name: "Avalanche C-Chain",
    isTestnet: false,
    explorer: "https://snowtrace.io",
  },
  [CHAIN_IDS.bscTestnet]: {
    name: "BNB Smart Chain Testnet",
    isTestnet: true,
    explorer: "https://testnet.bscscan.com",
  },
  [CHAIN_IDS.bsc]: {
    name: "BNB Smart Chain",
    isTestnet: false,
    explorer: "https://bscscan.com",
  },
};

// =============================================================================
// Pricing Configuration
// =============================================================================

// Fixed price per inference call (in USDC wei - 6 decimals)
// $0.005 USDC = 5000 wei (USDC has 6 decimals)
export const inferencePriceWei = 5_000;

export const PRICE_PER_TOKEN_WEI = 1; // 0.000001 USDC per inference token (legacy)
export const MAX_TOKENS_PER_CALL = 100000; // 100k tokens max per call

// Session budget presets (in USDC wei - 6 decimals)
export const SESSION_BUDGET_PRESETS = [
  { label: "$1", value: 1_000_000 },
  { label: "$5", value: 5_000_000 },
  { label: "$10", value: 10_000_000 },
  { label: "$25", value: 25_000_000 },
  { label: "$50", value: 50_000_000 },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate cost in human-readable USDC format
 */
export function calculateCostUSDC(tokens: number): string {
  const cost = (PRICE_PER_TOKEN_WEI * tokens) / 10 ** 6;
  return cost.toFixed(6);
}

/**
 * Get USDC address for a given chain ID
 */
export function getUsdcAddress(chainId: number): `0x${string}` | undefined {
  return USDC_ADDRESSES[chainId];
}

/**
 * Get the active chain ID based on environment
 */
export function getActiveChainId(): number {
  return import.meta.env.VITE_USE_MAINNET === "true"
    ? CHAIN_IDS.avalanche
    : CHAIN_IDS.avalancheFuji;
}

// =============================================================================
// Client Initialization
// =============================================================================

// Validate clientId at startup
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

// Client-side thirdweb client
export const thirdwebClient = createThirdwebClient({
  clientId: clientId || "placeholder",
});

// =============================================================================
// Payment Chain Configuration
// =============================================================================

// Active chain ID (from env)
const activeChainId = getActiveChainId();

// Payment chain - uses centralized chain config
export const paymentChain = CHAIN_OBJECTS[activeChainId as keyof typeof CHAIN_OBJECTS] || avalancheFuji;

// Payment token configuration
export const paymentToken = {
  address: USDC_ADDRESSES[activeChainId] || USDC_ADDRESSES[CHAIN_IDS.avalancheFuji],
  symbol: "USDC",
  decimals: 6,
  name: "USD Coin",
};

/**
 * Get USDC contract instance for the active chain
 */
export function getPaymentTokenContract() {
  return getContract({
    address: paymentToken.address,
    chain: paymentChain,
    client: thirdwebClient,
  });
}

/**
 * Get USDC contract for a specific chain
 */
export function getUsdcContractForChain(chainId: number) {
  const chain = CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS];
  const address = USDC_ADDRESSES[chainId];

  if (!chain || !address) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  return getContract({
    address,
    chain,
    client: thirdwebClient,
  });
}

// Account abstraction config for gas sponsorship (ERC-4337)
export const accountAbstraction: SmartWalletOptions = {
  chain: paymentChain,
  sponsorGas: true,
};

// Treasury wallet that receives payments
export const TREASURY_WALLET = import.meta.env.VITE_MERCHANT_WALLET_ADDRESS as `0x${string}`;

// Server wallet address (facilitator)
export const SERVER_WALLET = import.meta.env.VITE_THIRDWEB_SERVER_WALLET_ADDRESS as `0x${string}`;
