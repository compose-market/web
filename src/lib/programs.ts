import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address as SolanaAddress,
  type Instruction,
} from "@solana/kit";
import {
  buildIdentityMintInstruction,
  buildMarketCreateRfaInstruction,
  buildMarketMintWorkflowInstruction,
  bytes32FromHex,
  createManowarBlockchainClient,
  decodeAgentAccount,
  decodeIdentityRegistryAccount,
  decodeMarketRegistryAccount,
  identityPdas,
  marketPdas,
  type AgentAccount,
  type Hex,
  type ManowarContractName,
  type ManowarDeploymentConfig,
  type ManowarNearDeployment,
  type ManowarSolanaDeployment,
} from "@compose-market/sdk/blockchain";
import type { FacilitatorChain, NetworkId, SolanaNetworkId } from "@compose-market/sdk/chains";

import { sdk } from "@/lib/sdk";
import { isEvmNetwork } from "@/lib/chains";
import { deriveSwigConfigAddress } from "@/lib/svm/account";
import {
  buildSwigInstructionTransaction,
  createSolanaRpcFromNetwork,
} from "@/lib/svm/swig";

const env = import.meta.env ?? {};

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const EVM_CONTRACT_ENV: Record<ManowarContractName, string | undefined> = {
  AgentFactory: env.VITE_AGENT_FACTORY_ADDRESS,
  Workflow: env.VITE_WORKFLOW_ADDRESS,
  Clone: env.VITE_CLONE_ADDRESS,
  Warp: env.VITE_WARP_ADDRESS,
  RFA: env.VITE_RFA_ADDRESS,
  Lease: env.VITE_LEASE_ADDRESS,
  Reputation: env.VITE_REPUTATION_ADDRESS,
  Validation: env.VITE_VALIDATION_ADDRESS,
  Royalties: env.VITE_ROYALTIES_ADDRESS,
  Distributor: env.VITE_DISTRIBUTOR_ADDRESS,
  Delegation: env.VITE_DELEGATION_ADDRESS,
  AgentManager: env.VITE_AGENT_MANAGER_ADDRESS,
  Utils: env.VITE_UTILS_ADDRESS,
};

function requireEnvAddress(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getManowarSolanaDeployment(): ManowarSolanaDeployment {
  return {
    identityProgramId: requireEnvAddress("VITE_SOLANA_IDENTITY_PROGRAM_ID", env.VITE_SOLANA_IDENTITY_PROGRAM_ID),
    reputationProgramId: requireEnvAddress("VITE_SOLANA_REPUTATION_PROGRAM_ID", env.VITE_SOLANA_REPUTATION_PROGRAM_ID),
    validationProgramId: requireEnvAddress("VITE_SOLANA_VALIDATION_PROGRAM_ID", env.VITE_SOLANA_VALIDATION_PROGRAM_ID),
    marketProgramId: requireEnvAddress("VITE_SOLANA_MARKET_PROGRAM_ID", env.VITE_SOLANA_MARKET_PROGRAM_ID),
  };
}

export function getManowarNearDeployment(): ManowarNearDeployment {
  return {
    factoryAddress: requireEnvAddress("VITE_NEAR_FACTORY_ADDRESS", env.VITE_NEAR_FACTORY_ADDRESS),
    reputationAddress: requireEnvAddress("VITE_NEAR_REPUTATION_ADDRESS", env.VITE_NEAR_REPUTATION_ADDRESS),
    validationAddress: requireEnvAddress("VITE_NEAR_VALIDATION_ADDRESS", env.VITE_NEAR_VALIDATION_ADDRESS),
    workflowAddress: requireEnvAddress("VITE_NEAR_WORKFLOW_ADDRESS", env.VITE_NEAR_WORKFLOW_ADDRESS),
  };
}

export function getManowarDeployment(network: NetworkId): ManowarDeploymentConfig {
  if (isEvmNetwork(network)) {
    const contracts: Partial<Record<ManowarContractName, `0x${string}`>> = {};
    for (const [name, value] of Object.entries(EVM_CONTRACT_ENV) as Array<[ManowarContractName, string | undefined]>) {
      if (value) contracts[name] = value as `0x${string}`;
    }
    return {
      network,
      evm: { contracts },
    };
  }

  if (network.startsWith("near:")) {
    return {
      network,
      near: getManowarNearDeployment(),
    };
  }

  return {
    network,
    solana: getManowarSolanaDeployment(),
  };
}

export function getManowarClient(network: NetworkId) {
  return createManowarBlockchainClient({
    network,
    deployment: getManowarDeployment(network),
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function readAccountData(
  rpc: ReturnType<typeof createSolanaRpcFromNetwork>,
  account: string,
): Promise<Uint8Array | null> {
  const info = await rpc.getAccountInfo(address(account), { encoding: "base64" }).send();
  if (!info.value) return null;
  const [base64Data] = info.value.data as [string, string];
  return decodeBase64(base64Data);
}

async function readTokenProgram(
  rpc: ReturnType<typeof createSolanaRpcFromNetwork>,
  mint: string,
): Promise<string> {
  const info = await rpc.getAccountInfo(address(mint)).send();
  const owner = info.value?.owner;
  if (owner === SPL_TOKEN_PROGRAM || owner === SPL_TOKEN_2022_PROGRAM) {
    return owner;
  }
  throw new Error(owner ? `Unsupported Solana token program: ${owner}` : `Solana mint not found: ${mint}`);
}

export async function findAssociatedTokenAddress(input: {
  owner: string;
  mint: string;
  tokenProgram: string;
}): Promise<SolanaAddress> {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [
      encoder.encode(address(input.owner)),
      encoder.encode(address(input.tokenProgram)),
      encoder.encode(address(input.mint)),
    ],
  });
  return ata;
}

export async function fetchSolanaIdentityRegistry(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
}) {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const programId = getManowarSolanaDeployment().identityProgramId;
  const registry = await identityPdas.registry(programId);
  const data = await readAccountData(rpc, registry);
  if (!data) throw new Error(`Solana identity registry not initialized: ${registry}`);
  return decodeIdentityRegistryAccount(data);
}

export async function fetchSolanaMarketRegistry(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
}) {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const programId = getManowarSolanaDeployment().marketProgramId;
  const registry = await marketPdas.registry(programId);
  const data = await readAccountData(rpc, registry);
  if (!data) throw new Error(`Solana market registry not initialized: ${registry}`);
  return decodeMarketRegistryAccount(data);
}

export async function fetchSolanaAgentAccount(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  agentId: bigint | number;
}): Promise<AgentAccount> {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const programId = getManowarSolanaDeployment().identityProgramId;
  const agent = await identityPdas.agent(programId, input.agentId);
  const data = await readAccountData(rpc, agent);
  if (!data) throw new Error(`Solana agent account not found: ${agent}`);
  return decodeAgentAccount(data);
}

export async function buildSolanaMintAgentInstruction(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  owner: string;
  dnaHash: Hex;
  licenses: bigint;
  licensePrice: bigint;
  creatorFee?: bigint | number;
  cloneable: boolean;
  agentCardUri: string;
}) {
  const registry = await fetchSolanaIdentityRegistry(input);
  const programId = getManowarSolanaDeployment().identityProgramId;
  const { feePayer } = await sdk.svm.feePayer();
  const built = await buildIdentityMintInstruction({
    programId,
    nextAgentId: registry.nextAgentId,
    owner: input.owner,
    rentPayer: feePayer,
    dnaHash: bytes32FromHex(input.dnaHash),
    licenses: input.licenses,
    licensePrice: input.licensePrice,
    creatorFee: input.creatorFee ?? 1,
    cloneable: input.cloneable,
    uri: input.agentCardUri,
  });
  return { ...built, agentId: registry.nextAgentId, rentPayer: feePayer };
}

export async function buildSolanaMintWorkflowInstruction(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  owner: string;
  title: string;
  description: string;
  banner: string;
  workflowCardUri: string;
  units: bigint;
  leaseEnabled: boolean;
  leaseDuration: bigint;
  leasePercent: number;
  hasCoordinator: boolean;
  coordinatorModel: string;
  agentIds: readonly number[];
}) {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const solana = getManowarSolanaDeployment();
  const marketRegistry = await fetchSolanaMarketRegistry(input);
  const { feePayer } = await sdk.svm.feePayer();
  const tokenProgram = await readTokenProgram(rpc, marketRegistry.paymentMint);
  const payerToken = await findAssociatedTokenAddress({
    owner: input.owner,
    mint: marketRegistry.paymentMint,
    tokenProgram,
  });
  const agents = await Promise.all(input.agentIds.map(async (agentId) => {
    const agent = await fetchSolanaAgentAccount({ ...input, agentId });
    const creatorToken = await findAssociatedTokenAddress({
      owner: agent.creator,
      mint: marketRegistry.paymentMint,
      tokenProgram,
    });
    return { agentId: BigInt(agentId), creatorToken };
  }));

  const built = await buildMarketMintWorkflowInstruction({
    marketProgramId: solana.marketProgramId,
    identityProgramId: solana.identityProgramId,
    nextWorkflowId: marketRegistry.nextWorkflowId,
    owner: input.owner,
    rentPayer: feePayer,
    tokenProgram,
    payerToken,
    treasuryToken: marketRegistry.treasuryToken,
    title: input.title,
    description: input.description,
    banner: input.banner,
    uri: input.workflowCardUri,
    units: input.units,
    leaseEnabled: input.leaseEnabled,
    leaseDuration: input.leaseDuration,
    leasePercent: input.leasePercent,
    hasCoordinator: input.hasCoordinator,
    coordinatorModel: input.coordinatorModel,
    agents,
  });
  return { ...built, workflowId: marketRegistry.nextWorkflowId, rentPayer: feePayer };
}

export async function buildSolanaCreateRfaInstruction(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  publisher: string;
  workflowId: bigint | number;
  title: string;
  description: string;
  requiredSkills: readonly Uint8Array[];
  offerAmount: bigint;
}) {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const marketRegistry = await fetchSolanaMarketRegistry(input);
  const { feePayer } = await sdk.svm.feePayer();
  const tokenProgram = await readTokenProgram(rpc, marketRegistry.paymentMint);
  const publisherToken = await findAssociatedTokenAddress({
    owner: input.publisher,
    mint: marketRegistry.paymentMint,
    tokenProgram,
  });
  const escrowToken = await findAssociatedTokenAddress({
    owner: await marketPdas.rfa(getManowarSolanaDeployment().marketProgramId, marketRegistry.nextRfaId),
    mint: marketRegistry.paymentMint,
    tokenProgram,
  });

  const built = await buildMarketCreateRfaInstruction({
    marketProgramId: getManowarSolanaDeployment().marketProgramId,
    nextRfaId: marketRegistry.nextRfaId,
    workflowId: input.workflowId,
    publisher: input.publisher,
    rentPayer: feePayer,
    tokenProgram,
    publisherToken,
    escrowToken,
    title: input.title,
    description: input.description,
    requiredSkills: input.requiredSkills,
    offerAmount: input.offerAmount,
  });
  return { ...built, rfaId: marketRegistry.nextRfaId, rentPayer: feePayer };
}

export async function relaySolanaManowarInstructions(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  selectedSolanaAddress: string;
  evmSignerAddress: string;
  feePayer?: string;
  signMessage: (message: Uint8Array) => Promise<string>;
  instructions: readonly Instruction[];
}) {
  const feePayer = input.feePayer ?? (await sdk.svm.feePayer()).feePayer;
  const swigConfigAddress = await deriveSwigConfigAddress(input.evmSignerAddress);
  const unsignedTransaction = await buildSwigInstructionTransaction({
    swigConfigAddress,
    expectedWalletAddress: input.selectedSolanaAddress,
    evmSignerAddress: input.evmSignerAddress,
    feePayer: feePayer as SolanaAddress,
    network: input.network,
    rpcUrl: input.rpcUrl,
    instructions: input.instructions,
    signMessage: input.signMessage,
  });
  return sdk.svm.relay({
    unsignedTransaction,
    network: input.network,
  });
}

export function getSolanaChainOrThrow(
  chains: readonly FacilitatorChain[],
  network: NetworkId,
): FacilitatorChain & { network: SolanaNetworkId; rpcUrl: string } {
  const chain = chains.find((candidate) => candidate.network === network);
  if (!chain || !chain.network.startsWith("solana:") || !chain.rpcUrl) {
    throw new Error(`No Solana chain configured for ${network}`);
  }
  return chain as FacilitatorChain & { network: SolanaNetworkId; rpcUrl: string };
}
