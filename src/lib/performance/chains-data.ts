export const CHAIN_IDS = {
  // avalancheFuji: 43113,
  avalanche: 43114,
  // arbitrumTestnet: 421614,
  arbitrum: 42161,
  arc: 5042,
  // arcTestnet: 5042002,
  baseSepolia: 84532,
  base: 8453,
  // seiTestnet: 1328,
  sei: 1329,
  tempoModerato: 42431,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  // [CHAIN_IDS.avalancheFuji]: "0x5425890298aed601595a70AB815c96711a31Bc65",
  [CHAIN_IDS.avalanche]: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  // [CHAIN_IDS.arbitrumTestnet]: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  [CHAIN_IDS.arbitrum]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  // [CHAIN_IDS.arcTestnet]: "0x3600000000000000000000000000000000000000",
  [CHAIN_IDS.arc]: "0x3600000000000000000000000000000000000000",
  [CHAIN_IDS.baseSepolia]: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  [CHAIN_IDS.base]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  // [CHAIN_IDS.seiTestnet]: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
  [CHAIN_IDS.sei]: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
  [CHAIN_IDS.tempoModerato]: "0x20c0000000000000000000006a37DA5C996874BE",
};

export const CHAIN_CONFIG: Record<number, {
  name: string;
  isTestnet: boolean;
  explorer: string;
  color: string;
}> = {
  // [CHAIN_IDS.avalancheFuji]: { name: "Avalanche Fuji", isTestnet: true, explorer: "https://testnet.snowtrace.io", color: "red", },
  [CHAIN_IDS.avalanche]: {
    name: "Avalanche C-Chain",
    isTestnet: false,
    explorer: "https://snowtrace.io",
    color: "red",
  },
  // [CHAIN_IDS.arbitrumTestnet]: { name: "Arbitrum Sepolia", isTestnet: true, explorer: "https://sepolia.arbiscan.io", color: "cyan", },
  [CHAIN_IDS.arbitrum]: {
    name: "Arbitrum One",
    isTestnet: false,
    explorer: "https://arbiscan.io",
    color: "cyan",
  },
  // [CHAIN_IDS.arcTestnet]: {    name: "Arc Testnet",    isTestnet: true,    explorer: "https://testnet.arcscan.app",    color: "cyan",  },
  [CHAIN_IDS.arc]: {
    name: "Arc",
    isTestnet: false,
    explorer: "https://arcscan.app",
    color: "cyan",
  },
  [CHAIN_IDS.baseSepolia]: {
    name: "Base Sepolia",
    isTestnet: true,
    explorer: "https://sepolia.basescan.org",
    color: "blue",
  },
  [CHAIN_IDS.base]: {
    name: "Base",
    isTestnet: false,
    explorer: "https://basescan.org",
    color: "blue",
  },
  // [CHAIN_IDS.seiTestnet]: { name: "Sei Testnet", isTestnet: true, explorer: "https://testnet.seistream.app", color: "red", },
  [CHAIN_IDS.sei]: {
    name: "Sei",
    isTestnet: false,
    explorer: "https://seistream.app",
    color: "red",
  },
  [CHAIN_IDS.tempoModerato]: {
    name: "Tempo Moderato",
    isTestnet: true,
    explorer: "https://explore.testnet.tempo.xyz",
    color: "black",
  },
};

export const SUPPORTED_CHAIN_IDS = [
  // CHAIN_IDS.avalancheFuji,
  CHAIN_IDS.avalanche,
  // CHAIN_IDS.arbitrumTestnet,
  CHAIN_IDS.arbitrum,
  // CHAIN_IDS.arcTestnet,
  CHAIN_IDS.arc,
  CHAIN_IDS.baseSepolia,
  CHAIN_IDS.base,
  // CHAIN_IDS.seiTestnet,
  CHAIN_IDS.sei,
] as const;

export type Address = `0x${string}`;

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};

// Deterministic Compose deployment uses the same contract addresses across supported chains.
const SHARED_COMPOSE_CONTRACTS = {
  AgentFactory: env.VITE_AGENT_FACTORY_ADDRESS as Address,
  Clone: env.VITE_CLONE_ADDRESS as Address,
  Warp: env.VITE_WARP_ADDRESS as Address,
  Workflow: env.VITE_WORKFLOW_ADDRESS as Address,
  RFA: env.VITE_RFA_ADDRESS as Address,
  Lease: env.VITE_LEASE_ADDRESS as Address,
  Royalties: env.VITE_ROYALTIES_ADDRESS as Address,
  Distributor: env.VITE_DISTRIBUTOR_ADDRESS as Address,
  Delegation: env.VITE_DELEGATION_ADDRESS as Address,
  AgentManager: env.VITE_AGENT_MANAGER_ADDRESS as Address,
  Utils: env.VITE_UTILS_ADDRESS as Address,
} as const;

export const CONTRACT_ADDRESSES = {
  // [CHAIN_IDS.avalancheFuji]: { ...SHARED_COMPOSE_CONTRACTS },
  [CHAIN_IDS.avalanche]: { ...SHARED_COMPOSE_CONTRACTS },
  // [CHAIN_IDS.arbitrumTestnet]: { ...SHARED_COMPOSE_CONTRACTS },
  [CHAIN_IDS.arbitrum]: { ...SHARED_COMPOSE_CONTRACTS },
  // [CHAIN_IDS.arcTestnet]: { ...SHARED_COMPOSE_CONTRACTS },
  [CHAIN_IDS.arc]: { ...SHARED_COMPOSE_CONTRACTS },
  [CHAIN_IDS.baseSepolia]: { ...SHARED_COMPOSE_CONTRACTS },
  [CHAIN_IDS.base]: { ...SHARED_COMPOSE_CONTRACTS },
  // [CHAIN_IDS.seiTestnet]: { ...SHARED_COMPOSE_CONTRACTS },
  [CHAIN_IDS.sei]: { ...SHARED_COMPOSE_CONTRACTS },
  [CHAIN_IDS.tempoModerato]: { ...SHARED_COMPOSE_CONTRACTS },
} as const;

export type ContractName = keyof typeof SHARED_COMPOSE_CONTRACTS;

export function getContractAddress(
  contract: ContractName,
  chainId: number = CHAIN_IDS.arc,
): Address {
  const chainContracts = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES];
  if (!chainContracts) {
    throw new Error(`Contract addresses not configured for chain ${chainId}`);
  }
  return chainContracts[contract];
}

export function getContractAddressForChain(contract: ContractName, chainId: number): Address {
  return getContractAddress(contract, chainId);
}

/**
 * Convert USDC wei to display amount.
 */
export function weiToUsdc(wei: bigint): string {
  return (Number(wei) / 1_000_000).toFixed(6);
}

/**
 * Format USDC wei for compact display.
 */
export function formatUsdcPrice(wei: bigint): string {
  const usdc = Number(wei) / 1_000_000;
  return usdc < 0.01 ? `$${usdc.toFixed(4)}` : `$${usdc.toFixed(2)}`;
}

/**
 * RFA bounty constraints.
 */
export const RFA_BOUNTY_LIMITS = {
  MIN_BOUNTY: 0.10,
  MAX_BOUNTY: 1.00,
  DEFAULT_BOUNTY: 0.50,
  BASIC_BOUNTY: 0.10,
  README_BONUS_MAX: 0.90,
} as const;
