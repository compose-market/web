/**
 * Network Registry (Zero-Thirdweb)
 *
 * Pure chain registry state and helpers shared by ChainProvider, Market, and
 * lightweight components without pulling `thirdweb` into the initial bundle.
 */

import type {
  EvmNetworkId,
  FacilitatorChain,
  NearNetworkId,
  NetworkId,
  SolanaNetworkId,
} from "@compose-market/sdk/chains";

const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env ?? ({} as ImportMetaEnv);

export type Address = `0x${string}`;

// Deterministic Compose EVM contract deployment addresses (from env).
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

export type ContractName = keyof typeof SHARED_COMPOSE_CONTRACTS;

export type AppChain = FacilitatorChain & {
  chainId?: number;
  usdcAddress?: `0x${string}`;
  rpcUrl?: string;
  explorerQuery?: string;
};

let resolvedChains: AppChain[] = [];
const supportedChainIds: number[] = [];
const registryListeners = new Set<() => void>();

export function isEvmNetwork(network: NetworkId | string | null | undefined): network is EvmNetworkId {
  return typeof network === "string" && network.startsWith("eip155:");
}

export function isSolanaNetwork(network: NetworkId | string | null | undefined): network is SolanaNetworkId {
  return typeof network === "string" && network.startsWith("solana:");
}

export function isNearNetwork(network: NetworkId | string | null | undefined): network is NearNetworkId {
  return typeof network === "string" && network.startsWith("near:");
}

export function evmChainId(network: EvmNetworkId): number {
  const value = Number.parseInt(network.slice("eip155:".length), 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid EVM network: ${network}`);
  return value;
}

export function requireEvmNetwork(network: NetworkId | null | undefined, action = "This action"): EvmNetworkId {
  if (!network || !isEvmNetwork(network)) {
    throw new Error(`${action} is only available on EVM networks`);
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

export function setNetworkRegistry(chains: FacilitatorChain[]): void {
  resolvedChains = chains.map(normalizeChain);
  const nextIds = resolvedChains
    .filter((c) => c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:"))
    .map((c) => c.chainId!)
    .filter(Boolean);
  supportedChainIds.splice(0, supportedChainIds.length, ...nextIds);
  for (const listener of registryListeners) {
    listener();
  }
}

export function subscribeNetworkRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

export function getChains(): AppChain[] {
  return resolvedChains;
}

export function getEvmChains(): AppChain[] {
  return resolvedChains.filter((c) => c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:"));
}

export function getChainByNetwork(network: NetworkId | string | null | undefined): AppChain | undefined {
  if (!network) return undefined;
  return resolvedChains.find((c) => c.network === network);
}

export function getAssetSymbol(network: NetworkId | string | null | undefined): string {
  return getChainByNetwork(network)?.asset ?? "USDC";
}

export function networkFromChainId(chainId: number): EvmNetworkId {
  return `eip155:${chainId}` as EvmNetworkId;
}

export function getChainIds(): number[] {
  return getEvmChains().map((c) => c.chainId!).filter(Boolean);
}

export function getUsdcAddress(chainId: number): `0x${string}` | undefined {
  const chain = resolvedChains.find((c) => c.chainId === chainId);
  return chain?.usdcAddress ?? (chain?.assetAddress as `0x${string}` | undefined);
}

export function getUsdcAddressForNetwork(network: EvmNetworkId): `0x${string}` | undefined {
  return getUsdcAddress(evmChainId(network));
}

export function getChainConfig(chainId: number) {
  return resolvedChains.find((c) => c.chainId === chainId);
}

export function getChainConfigByNetwork(network: NetworkId | string | null | undefined) {
  return getChainByNetwork(network);
}

export function getContractAddress(contract: ContractName, chainId: number): Address {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Valid EVM chainId is required to resolve ${contract}`);
  }
  const address = SHARED_COMPOSE_CONTRACTS[contract];
  if (!address) {
    throw new Error(`Contract ${contract} is not configured for chain ${chainId}`);
  }
  return address;
}

export function getContractAddressForChain(contract: ContractName, chainId: number): Address {
  return getContractAddress(contract, chainId);
}