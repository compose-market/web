"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletConnector, useWalletAccount } from "@/components/connector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import { useChain } from "@/contexts/ChainContext";
import { Download, ExternalLink, Loader2, Monitor, Shield } from "lucide-react";

const DESKTOP_DOWNLOAD_URL = "https://compose.market";

interface DesktopLinkTokenResponse {
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

function parseQuery(): { token: string | null; agentWallet: string | null } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const agentWallet = normalizeWallet(params.get("agent_wallet"));
  return { token, agentWallet };
}

export default function InstallDesktopPage() {
  const { isConnected, address } = useWalletAccount();
  const { paymentChainId } = useChain();
  const [token, setToken] = useState<string | null>(null);
  const [agentWallet, setAgentWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const parsed = parseQuery();
    setToken(parsed.token);
    setAgentWallet(parsed.agentWallet);
  }, []);

  const openDesktop = useCallback(() => {
    if (!token) {
      setError("No install token available.");
      return;
    }
    window.location.href = `manowar://open?token=${encodeURIComponent(token)}`;
  }, [token]);

  const remintAndOpen = useCallback(async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/desktop/link-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-user-address": address,
          "x-chain-id": String(paymentChainId),
        },
        body: JSON.stringify({
          userAddress: address,
          chainId: paymentChainId,
          agentWallet: agentWallet || undefined,
        }),
      });
      const data: DesktopLinkTokenResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to mint desktop install token.");
      }
      setToken(data.token);
      window.history.replaceState({}, "", `/install-desktop?token=${encodeURIComponent(data.token)}${agentWallet ? `&agent_wallet=${agentWallet}` : ""}`);
      window.location.href = data.deepLinkUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint desktop install token.");
    } finally {
      setBusy(false);
    }
  }, [address, agentWallet, paymentChainId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card border-sidebar-border">
        <CardHeader>
          <CardTitle className="font-display text-cyan-400 flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Install Compose Desktop
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Download Desktop, then open your pending install deep link.
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
            onClick={openDesktop}
            disabled={!token}
          >
            <Shield className="w-4 h-4 mr-2" />
            Open Desktop With Current Token
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener,noreferrer")}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Desktop
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => void remintAndOpen()}
            disabled={busy || !isConnected}
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-2" />}
            Mint New Token And Open Desktop
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
