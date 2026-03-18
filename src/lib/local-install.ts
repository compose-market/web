import { fetchAgentByWalletAddress } from "@/hooks/use-onchain";

export function extractCid(agentCardUri: string): string {
  const cid = agentCardUri.replace("ipfs://", "").split("/")[0];
  if (!cid || cid.length < 32) {
    throw new Error("Invalid agentCardUri CID");
  }
  return cid;
}

export async function resolveAgentCardCid(agentWallet: string): Promise<string> {
  const agent = await fetchAgentByWalletAddress(agentWallet.toLowerCase());
  if (!agent?.agentCardUri) {
    throw new Error("Agent metadata missing agentCardUri");
  }
  return extractCid(agent.agentCardUri);
}
