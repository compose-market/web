import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAIN_CONFIG,
  CHAIN_IDS,
  SUPPORTED_CHAIN_IDS,
  USDC_ADDRESSES,
} from "../src/lib/performance/networks";
import {
  CHAIN_OBJECTS,
  getExplorerTxUrl,
  isEvmNetwork,
  isNearNetwork,
  isSolanaNetwork,
  setChainRegistry,
} from "../src/lib/chains";
import type { FacilitatorChain } from "@compose-market/sdk/chains";

const mockChains: Array<FacilitatorChain & { explorerQuery?: string }> = [
  { name: "Avalanche C-Chain", network: "eip155:43114", namespace: "eip155", shortName: "Avalanche", isTestnet: false, explorer: "https://snowtrace.io", rpcUrl: "https://rpc.example", assetAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
  { name: "Arbitrum One", network: "eip155:42161", namespace: "eip155", shortName: "Arbitrum", isTestnet: false, explorer: "https://arbiscan.io", rpcUrl: "https://rpc.example", assetAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
  { name: "Arc", network: "eip155:5042", namespace: "eip155", shortName: "Arc", isTestnet: false, explorer: "https://arcscan.app", rpcUrl: "https://rpc.example", assetAddress: "0x3600000000000000000000000000000000000000", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
  { name: "Base Sepolia", network: "eip155:84532", namespace: "eip155", shortName: "Base Sepolia", isTestnet: true, explorer: "https://sepolia.basescan.org", rpcUrl: "https://rpc.example", assetAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
  { name: "Base", network: "eip155:8453", namespace: "eip155", shortName: "Base", isTestnet: false, explorer: "https://basescan.org", rpcUrl: "https://rpc.example", assetAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
  { name: "Sei", network: "eip155:1329", namespace: "eip155", shortName: "Sei", isTestnet: false, explorer: "https://seiscan.io", rpcUrl: "https://rpc.example", assetAddress: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
  { name: "Solana Devnet", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", namespace: "solana", shortName: "Solana Devnet", isTestnet: true, explorer: "https://explorer.solana.com", explorerQuery: "cluster=devnet", rpcUrl: "https://api.devnet.solana.com", assetAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
  { name: "NEAR", network: "near:mainnet", namespace: "near", shortName: "NEAR", isTestnet: false, explorer: "https://nearblocks.io", rpcUrl: "https://rpc.mainnet.near.org", assetAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", schemes: ["exact","upto","batch-settlement"], asset: "USDC", decimals: 6 },
];

test.before(() => {
  setChainRegistry(mockChains);
});

test("chains-data module and hardcoded default network singletons are deleted", () => {
  assert.equal(existsSync(new URL("../src/lib/performance/chains-data.ts", import.meta.url)), false);
  const networkCtx = readFileSync(new URL("../src/contexts/Network.tsx", import.meta.url), "utf8");
  const networksLib = readFileSync(new URL("../src/lib/performance/networks.ts", import.meta.url), "utf8");
  assert.doesNotMatch(networkCtx, /FIRST_TIME_DEFAULT|defaultNetwork/);
  assert.doesNotMatch(networksLib, /resolvedDefaultNetwork|getDefaultNetwork|getDefaultEvmNetwork|getDefaultChainId/);
});

test("supported frontend chains exclude cronos entirely", () => {
  const chainValues = Object.values(CHAIN_IDS) as number[];
  assert.deepEqual(
    SUPPORTED_CHAIN_IDS,
    [
      CHAIN_IDS.avalanche,
      CHAIN_IDS.arbitrum,
      CHAIN_IDS.arc,
      CHAIN_IDS.baseSepolia,
      CHAIN_IDS.base,
      CHAIN_IDS.sei,
    ],
  );
  assert.equal(chainValues.includes(338), false);
  assert.equal(chainValues.includes(25), false);
});

test("frontend chain metadata and USDC addresses stay aligned after cronos removal", () => {
  for (const chainId of SUPPORTED_CHAIN_IDS) {
    assert.ok(CHAIN_CONFIG[chainId]);
    assert.ok(USDC_ADDRESSES[chainId]);
    assert.ok(CHAIN_OBJECTS[chainId as keyof typeof CHAIN_OBJECTS]);
  }
});

test("supported Arc and Sei networks use canonical USDC contracts", () => {
  assert.equal(USDC_ADDRESSES[CHAIN_IDS.arc], "0x3600000000000000000000000000000000000000");
  assert.equal(USDC_ADDRESSES[CHAIN_IDS.sei], "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392");
});

test("Solana devnet explorer links preserve the cluster query", () => {
  assert.equal(
    getExplorerTxUrl("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "signature"),
    "https://explorer.solana.com/tx/signature?cluster=devnet",
  );
});

test("CAIP-2 namespace guards separate EVM, Solana, and NEAR networks", () => {
  assert.equal(isEvmNetwork("eip155:42161"), true);
  assert.equal(isSolanaNetwork("eip155:42161"), false);
  assert.equal(isNearNetwork("eip155:42161"), false);

  assert.equal(isEvmNetwork("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), false);
  assert.equal(isSolanaNetwork("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), true);
  assert.equal(isNearNetwork("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), false);

  assert.equal(isEvmNetwork("near:mainnet"), false);
  assert.equal(isSolanaNetwork("near:mainnet"), false);
  assert.equal(isNearNetwork("near:mainnet"), true);
});
