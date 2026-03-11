import type { Account } from "thirdweb/wallets";
import { API_BASE_URL } from "@/lib/api";

const INSTALL_DOMAIN_NAME = "ComposeDesktopInstall";
const INSTALL_DOMAIN_VERSION = "1";
const INSTALL_VERIFIER = "0x0000000000000000000000000000000000000000" as const;

export interface SignedDesktopInstallPayload {
  agentWallet: `0x${string}`;
  agentCardCid: string;
  chainId: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  composeKey?: string;
}

export interface SignedDesktopInstallEnvelope {
  payload: SignedDesktopInstallPayload;
  signature: `0x${string}`;
  signer: `0x${string}`;
}

const INSTALL_TYPES = {
  DesktopInstall: [
    { name: "agentWallet", type: "address" },
    { name: "agentCardCid", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "string" },
    { name: "composeKey", type: "string" },
  ],
} as const;

export function extractCid(agentCardUri: string): string {
  const cid = agentCardUri.replace("ipfs://", "").split("/")[0];
  if (!cid || cid.length < 32) {
    throw new Error("Invalid agentCardUri CID");
  }
  return cid;
}

export async function resolveAgentCardCid(agentWallet: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/agent/${agentWallet.toLowerCase()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch agent metadata (${response.status})`);
  }
  const data = await response.json() as { agentCardUri?: string };
  if (!data.agentCardUri) {
    throw new Error("Agent metadata missing agentCardUri");
  }
  return extractCid(data.agentCardUri);
}

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createSignedDesktopInstallEnvelope(input: {
  account: Account;
  signer: `0x${string}`;
  payload: SignedDesktopInstallPayload;
}): Promise<SignedDesktopInstallEnvelope> {
  const signature = await input.account.signTypedData({
    domain: {
      name: INSTALL_DOMAIN_NAME,
      version: INSTALL_DOMAIN_VERSION,
      chainId: input.payload.chainId,
      verifyingContract: INSTALL_VERIFIER,
    },
    types: INSTALL_TYPES,
    primaryType: "DesktopInstall",
    message: {
      agentWallet: input.payload.agentWallet,
      agentCardCid: input.payload.agentCardCid,
      chainId: BigInt(input.payload.chainId),
      issuedAt: BigInt(input.payload.issuedAt),
      expiresAt: BigInt(input.payload.expiresAt),
      nonce: input.payload.nonce,
      composeKey: input.payload.composeKey || "",
    },
  });

  return {
    payload: input.payload,
    signature: signature as `0x${string}`,
    signer: input.signer,
  };
}

export async function createSignedDesktopInstallDeepLink(input: {
  account: Account;
  signer: `0x${string}`;
  agentWallet: `0x${string}`;
  agentCardCid: string;
  chainId: number;
  composeKey?: string;
  ttlMs?: number;
}): Promise<{ deepLinkUrl: string; envelope: SignedDesktopInstallEnvelope }> {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + Math.max(30_000, Math.min(input.ttlMs ?? 5 * 60_000, 30 * 60_000));

  const envelope = await createSignedDesktopInstallEnvelope({
    account: input.account,
    signer: input.signer,
    payload: {
      agentWallet: input.agentWallet,
      agentCardCid: input.agentCardCid,
      chainId: input.chainId,
      issuedAt,
      expiresAt,
      nonce: crypto.randomUUID(),
      composeKey: input.composeKey,
    },
  });

  const encoded = toBase64Url(JSON.stringify(envelope));
  return {
    deepLinkUrl: `manowar://open?install=${encodeURIComponent(encoded)}`,
    envelope,
  };
}
