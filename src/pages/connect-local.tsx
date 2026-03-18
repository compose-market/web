"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { WalletConnector, useWalletAccount } from "@/components/connector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Check, Monitor, Loader2, Shield, X, Download } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import {
  createSignedLocalInstallDeepLink,
  createWalletAuthorizationEnvelope,
  encodeWalletAuthorizationHeader,
  resolveAgentCardCid,
} from "@/lib/local-install";
import { useChain } from "@/contexts/ChainContext";

const WEB_APP_URL = "https://compose.market";
const FALLBACK_INSTALL_PATH = "/install-local";
const WALLET_AUTH_ACTION_LOCAL_LINK = "local-link-create";

interface LocalLinkTokenResponse {
  success: boolean;
  token: string;
  mode?: "local-first" | "web-first";
  expiresAt: number;
  deepLinkUrl: string;
  error?: string;
}

type ConnectMode = "local-first" | "web-first";

function isValidDeviceId(deviceId: string | null): boolean {
  if (!deviceId) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId);
}

function normalizeWallet(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function parseQueryParams(): {
  deviceId: string | null;
  redirect: string | null;
  agentWallet: string | null;
  mode: ConnectMode;
} {
  const params = new URLSearchParams(window.location.search);
  const deviceId = params.get("device_id");
  const redirect = params.get("redirect");
  const agentWallet = normalizeWallet(params.get("agent_wallet"));
  if (!deviceId) {
    return { deviceId: null, redirect, agentWallet, mode: "web-first" };
  }
  return { deviceId, redirect, agentWallet, mode: "local-first" };
}

export default function ConnectLocalPage() {
  const { isConnected, address, account } = useWalletAccount();
  const { paymentChainId } = useChain();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [mode, setMode] = useState<ConnectMode>("web-first");
  const [agentWallet, setAgentWallet] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  useEffect(() => {
    const query = parseQueryParams();
    setMode(query.mode);
    setAgentWallet(query.agentWallet);
    if (query.mode === "local-first") {
      if (!isValidDeviceId(query.deviceId)) {
        setError("Invalid device_id parameter");
        return;
      }
      setDeviceId(query.deviceId);
      setError(null);
      return;
    }
    setDeviceId(null);
    setError(null);
  }, []);

  const handleAuthorize = useCallback(async () => {
    if (!address) {
      setError("Wallet is not connected");
      return;
    }

    if (mode === "local-first" && !deviceId) {
      setError("Local-first flow requires a device_id");
      return;
    }

    setIsAuthorizing(true);
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

        setSuccess(true);
        setDeepLinkUrl(signed.deepLinkUrl);
        window.location.href = signed.deepLinkUrl;

        if (mode === "web-first") {
          window.setTimeout(() => {
            const params = new URLSearchParams();
            params.set("install", signed.deepLinkUrl.split("install=")[1] || "");
            if (agentWallet) params.set("agent_wallet", agentWallet);
            window.location.href = `${FALLBACK_INSTALL_PATH}?${params.toString()}`;
          }, 1800);
        }
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
        deviceId: mode === "local-first" ? deviceId || undefined : undefined,
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
          deviceId: mode === "local-first" ? deviceId : undefined,
          agentWallet: agentWallet || undefined,
          agentCardCid: linkedAgentWallet ? await resolveAgentCardCid(linkedAgentWallet) : undefined,
          userAddress: address,
          chainId: paymentChainId,
        }),
      });

      const data: LocalLinkTokenResponse = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Failed to create authorization token");
        setIsAuthorizing(false);
        return;
      }

      setSuccess(true);
      setIssuedToken(data.token);
      setDeepLinkUrl(data.deepLinkUrl);
      window.location.href = data.deepLinkUrl;

      if (mode === "web-first") {
        window.setTimeout(() => {
          const params = new URLSearchParams();
          params.set("token", data.token);
          if (agentWallet) params.set("agent_wallet", agentWallet);
          window.location.href = `${FALLBACK_INSTALL_PATH}?${params.toString()}`;
        }, 1800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed");
      setIsAuthorizing(false);
    }
  }, [account, address, agentWallet, deviceId, mode, paymentChainId]);

  const shortAddress = useMemo(() => (
    address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""
  ), [address]);

  const subtitle = mode === "local-first"
    ? "Authorize this already-running local app."
    : "Create a local install intent and open the local app via deep link.";

  if (error && mode === "local-first" && !deviceId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-sidebar-border">
          <CardHeader>
            <CardTitle className="font-display text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Invalid Request
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button
              variant="outline"
              onClick={() => window.location.href = WEB_APP_URL}
              className="w-full"
            >
              Go to Compose.Market
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-sidebar-border">
          <CardHeader>
            <CardTitle className="font-display text-cyan-400 flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Connect Mesh App
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Connect your wallet to authorize the Compose Mesh app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-sidebar-accent rounded-sm p-4 border border-sidebar-border">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-cyan-400 font-mono">Security Notice</span>
              </div>
              <p className="text-xs text-muted-foreground">
                You are authorizing a local runtime linked to your Compose account.
              </p>
            </div>

            <div className="flex items-center justify-center py-4">
              <WalletConnector />
            </div>

            <Button
              variant="ghost"
              onClick={() => window.location.href = WEB_APP_URL}
              className="w-full text-muted-foreground"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-sidebar-border">
          <CardHeader>
            <CardTitle className="font-display text-green-400 flex items-center gap-2">
              <Check className="w-5 h-5" />
              Authorized
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Opening Compose Mesh...
            </p>
            {deepLinkUrl && (
              <div className="bg-sidebar-accent rounded-sm p-3 border border-sidebar-border space-y-2">
                <Button
                  onClick={() => window.location.href = deepLinkUrl}
                  className="w-full bg-cyan-500 text-black hover:bg-cyan-400"
                >
                  Open Mesh App
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const params = new URLSearchParams();
                    if (issuedToken) params.set("token", issuedToken);
                    if (agentWallet) params.set("agent_wallet", agentWallet);
                    window.location.href = `${FALLBACK_INSTALL_PATH}?${params.toString()}`;
                  }}
                  className="w-full"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Mesh not installed?
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card border-sidebar-border">
        <CardHeader>
          <CardTitle className="font-display text-cyan-400 flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Authorize Mesh App
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {subtitle}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-sidebar-accent rounded-sm p-4 border border-sidebar-border">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground font-mono">Connected Wallet</span>
              <span className="text-sm font-mono text-cyan-400">{shortAddress}</span>
            </div>
            {mode === "local-first" && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground font-mono">Device ID</span>
                <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">
                  {deviceId?.slice(0, 8)}...{deviceId?.slice(-4)}
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-sm p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            onClick={handleAuthorize}
            disabled={isAuthorizing}
            className="w-full bg-cyan-500 text-black hover:bg-cyan-400 font-mono font-bold"
          >
            {isAuthorizing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Authorizing...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 mr-2" />
                Authorize Mesh App
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={() => window.location.href = WEB_APP_URL}
            className="w-full text-muted-foreground"
            disabled={isAuthorizing}
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
