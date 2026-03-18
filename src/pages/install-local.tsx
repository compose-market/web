"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletConnector, useWalletAccount } from "@/components/connector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import {
  createSignedLocalInstallDeepLink,
  createWalletAuthorizationEnvelope,
  encodeWalletAuthorizationHeader,
  resolveAgentCardCid,
} from "@/lib/local-install";
import { useChain } from "@/contexts/ChainContext";
import { Download, ExternalLink, Loader2, Monitor, Shield } from "lucide-react";

const LOCAL_DOWNLOAD_URL = "https://compose.market";
const WALLET_AUTH_ACTION_LOCAL_LINK = "local-link-create";

interface LocalLinkTokenResponse {
  success: boolean;
  token: string;
  deepLinkUrl: string;
  error?: string;
}

function normalizeWallet(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function parseQuery(): { token: string | null; install: boolean; agentWallet: string | null } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const install = params.get("install");
  const agentWallet = normalizeWallet(params.get("agent_wallet"));
  return { token: install || token, install: Boolean(install), agentWallet };
}

export default function InstallLocalPage() {
  const { isConnected, address, account } = useWalletAccount();
  const { paymentChainId } = useChain();
  const [token, setToken] = useState<string | null>(null);
  const [isInstallPayload, setIsInstallPayload] = useState(false);
  const [agentWallet, setAgentWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const parsed = parseQuery();
    setToken(parsed.token);
    setIsInstallPayload(parsed.install);
    setAgentWallet(parsed.agentWallet);
  }, []);

  const openLocal = useCallback(() => {
    if (!token) {
      setError("No install token available.");
      return;
    }
    if (isInstallPayload) {
      window.location.href = `manowar://open?install=${encodeURIComponent(token)}`;
      return;
    }
    window.location.href = `manowar://open?token=${encodeURIComponent(token)}`;
  }, [isInstallPayload, token]);

  const remintAndOpen = useCallback(async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const signedInstallEnabled = (import.meta.env.VITE_SIGNED_DEEPLINK_INSTALL || "1") === "1";
      const linkedAgentWallet = agentWallet ? (agentWallet.toLowerCase() as `0x${string}`) : null;
      if (signedInstallEnabled && linkedAgentWallet) {
        if (!account) {
          throw new Error("Wallet signer unavailable for signed local install");
        }
        const agentCardCid = await resolveAgentCardCid(linkedAgentWallet);
        const signed = await createSignedLocalInstallDeepLink({
          account,
          signer: address.toLowerCase() as `0x${string}`,
          agentWallet: linkedAgentWallet,
          agentCardCid,
          chainId: paymentChainId,
        });
        const encoded = signed.deepLinkUrl.split("install=")[1] || "";
        setToken(encoded);
        setIsInstallPayload(true);
        window.history.replaceState({}, "", `/install-local?install=${encodeURIComponent(encoded)}${agentWallet ? `&agent_wallet=${agentWallet}` : ""}`);
        window.location.href = signed.deepLinkUrl;
        return;
      }

      if (!account) {
        throw new Error("Wallet signer unavailable for local authorization");
      }
      const walletAuthorization = await createWalletAuthorizationEnvelope({
        account,
        userAddress: address.toLowerCase() as `0x${string}`,
        action: WALLET_AUTH_ACTION_LOCAL_LINK,
        chainId: paymentChainId,
      });
      const response = await fetch(`${API_BASE_URL}/api/local/link-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-user-address": address,
          "x-chain-id": String(paymentChainId),
          "x-wallet-authorization": encodeWalletAuthorizationHeader(walletAuthorization),
        },
        body: JSON.stringify({
          userAddress: address,
          chainId: paymentChainId,
          agentWallet: agentWallet || undefined,
          agentCardCid: linkedAgentWallet ? await resolveAgentCardCid(linkedAgentWallet) : undefined,
        }),
      });
      const data: LocalLinkTokenResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to mint local install token.");
      }
      setToken(data.token);
      setIsInstallPayload(false);
      window.history.replaceState({}, "", `/install-local?token=${encodeURIComponent(data.token)}${agentWallet ? `&agent_wallet=${agentWallet}` : ""}`);
      window.location.href = data.deepLinkUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint local install token.");
    } finally {
      setBusy(false);
    }
  }, [account, address, agentWallet, paymentChainId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card border-sidebar-border">
        <CardHeader>
          <CardTitle className="font-display text-cyan-400 flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Install Compose Mesh
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Download Compose Mesh, then open your pending install deep link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isConnected ? (
            <div className="rounded-sm border border-sidebar-border p-4 bg-sidebar-accent">
              <p className="text-xs text-muted-foreground mb-3">
                Connect wallet to mint a new short-lived install token if needed.
              </p>
              <WalletConnector />
            </div>
          ) : null}

          {error ? (
            <div className="rounded-sm border border-destructive/30 p-3 text-sm text-destructive bg-destructive/10">
              {error}
            </div>
          ) : null}

          <Button
            className="w-full bg-cyan-500 text-black hover:bg-cyan-400"
            onClick={openLocal}
            disabled={!token}
          >
            <Shield className="w-4 h-4 mr-2" />
            Open Compose Mesh With Current Token
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => window.open(LOCAL_DOWNLOAD_URL, "_blank", "noopener,noreferrer")}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Compose Mesh
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
