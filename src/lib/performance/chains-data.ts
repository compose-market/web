export const CHAIN_IDS = {
  avalancheFuji: 43113,
  avalanche: 43114,
  arbitrumTestnet: 421614,
  arbitrum: 42161,
  bscTestnet: 97,
  bsc: 56,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  [CHAIN_IDS.avalancheFuji]: "0x5425890298aed601595a70AB815c96711a31Bc65",
  [CHAIN_IDS.avalanche]: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  [CHAIN_IDS.arbitrumTestnet]: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  [CHAIN_IDS.arbitrum]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  [CHAIN_IDS.bscTestnet]: "0x64544969ed7ebf5f083679233325356ebe738930",
  [CHAIN_IDS.bsc]: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

export const CHAIN_CONFIG: Record<number, {
  name: string;
  isTestnet: boolean;
  explorer: string;
  color: string;
}> = {
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

export const SUPPORTED_CHAIN_IDS = [
  CHAIN_IDS.avalancheFuji,
  CHAIN_IDS.arbitrumTestnet,
] as const;
