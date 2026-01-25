import { createThirdwebClient, getContract, defineChain } from "thirdweb";
import { avalancheFuji, avalanche, bscTestnet, bsc } from "thirdweb/chains";
import type { SmartWalletOptions } from "thirdweb/wallets";

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
// Chain Configuration (Centralized - add new chains here)
// =============================================================================

export const CHAIN_IDS = {
  // Cronos
  cronosTestnet: 338,
  cronos: 25,
  // Avalanche (legacy)
  avalancheFuji: 43113,
  avalanche: 43114,
  // BNB Chain (future support)
  bscTestnet: 97,
  bsc: 56,
} as const;

// USDC addresses per chain (supports ERC-3009 for x402)
export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  // Cronos - devUSDC.e
  [CHAIN_IDS.cronosTestnet]: "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0",
  [CHAIN_IDS.cronos]: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",
  // Avalanche
  [CHAIN_IDS.avalancheFuji]: "0x5425890298aed601595a70AB815c96711a31Bc65",
  [CHAIN_IDS.avalanche]: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  // BNB Chain
  [CHAIN_IDS.bscTestnet]: "0x64544969ed7EBf5f083679233325356EbE738930",
  [CHAIN_IDS.bsc]: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

// Map chain IDs to thirdweb chain objects
export const CHAIN_OBJECTS = {
  [CHAIN_IDS.cronosTestnet]: cronosTestnet,
  [CHAIN_IDS.cronos]: cronos,
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
  color: string; // Badge color
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

// x402 Facilitator URLs per chain
// - Cronos chains: Cronos Labs facilitator (https://facilitator.cronoslabs.org)
// - Avalanche/other chains: ThirdWeb facilitator (uses thirdweb SDK default)
export const FACILITATOR_URLS: Record<number, string | null> = {
  // Cronos - use Cronos Labs facilitator
  [CHAIN_IDS.cronosTestnet]: "https://facilitator.cronoslabs.org",
  [CHAIN_IDS.cronos]: "https://facilitator.cronoslabs.org",
  // Avalanche - use ThirdWeb facilitator (null = SDK default)
  [CHAIN_IDS.avalancheFuji]: null,
  [CHAIN_IDS.avalanche]: null,
  // BNB - use ThirdWeb facilitator (null = SDK default)
  [CHAIN_IDS.bscTestnet]: null,
  [CHAIN_IDS.bsc]: null,
};

// Cronos network identifiers for facilitator API
export const CRONOS_NETWORK_MAP: Record<number, string> = {
  [CHAIN_IDS.cronosTestnet]: "cronos-testnet",
  [CHAIN_IDS.cronos]: "cronos-mainnet",
};

// Chains with deployed contracts (for multi-chain fetching)
// Order matters: first chain is default for factory pages
export const SUPPORTED_CHAINS = [
  { id: CHAIN_IDS.cronosTestnet, chain: cronosTestnet },
  { id: CHAIN_IDS.avalancheFuji, chain: avalancheFuji },
] as const;


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

// Payment chain - DEFAULT chain, components should use ChainContext.paymentChainId for user selection
// This is set to Cronos Testnet to match ChainContext's default
const defaultChainId = CHAIN_IDS.cronosTestnet;
export const paymentChain = CHAIN_OBJECTS[defaultChainId as keyof typeof CHAIN_OBJECTS];

// Payment token configuration - DEFAULT, use USDC_ADDRESSES[paymentChainId] for user selection
export const paymentToken = {
  address: USDC_ADDRESSES[defaultChainId],
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

// =============================================================================
// Account Abstraction (ERC-4337) Configuration
// =============================================================================
// Smart Account uses the active payment chain (Cronos Testnet by default)
// =============================================================================

export const accountAbstraction: SmartWalletOptions = {
  chain: paymentChain, // Uses the active payment chain
  sponsorGas: true,
};

// Treasury wallet that receives payments
export const TREASURY_WALLET = import.meta.env.VITE_MERCHANT_WALLET_ADDRESS as `0x${string}`;

// Server wallet address (facilitator)
export const SERVER_WALLET = import.meta.env.VITE_THIRDWEB_SERVER_WALLET_ADDRESS as `0x${string}`;
