"use client";

import { useState, useEffect, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { WalletConnector, useWalletAccount } from "@/components/connector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Check, Monitor, Loader2, Shield, X } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { useChain } from "@/contexts/ChainContext";

const WEB_APP_URL = "https://compose.market";
const DESKTOP_DEEP_LINK_SCHEME = "manowar://open";

interface DesktopLinkTokenResponse {
  success: boolean;
  token: string;
  expiresAt: number;
  deepLinkUrl: string;
  error?: string;
}

function isValidDeviceId(deviceId: string | null): boolean {
  if (!deviceId) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId);
}

function parseQueryParams(): { deviceId: string | null; redirect: string | null } {
  const params = new URLSearchParams(window.location.search);
  const deviceId = params.get("device_id");
  const redirect = params.get("redirect");
  return { deviceId, redirect };
}

export default function ConnectDesktopPage() {
  const account = useActiveAccount();
  const { isConnected } = useWalletAccount();
  const { paymentChainId } = useChain();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);

  useEffect(() => {
    const { deviceId: queryDeviceId } = parseQueryParams();
    if (isValidDeviceId(queryDeviceId)) {
      setDeviceId(queryDeviceId);
    } else {
      setError("Invalid or missing device_id parameter");
    }
  }, []);

  const handleAuthorize = useCallback(async () => {
    if (!account?.address || !deviceId) {
      setError("Wallet not connected or device ID missing");
      return;
    }

    setIsAuthorizing(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/desktop/link-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-user-address": account.address,
          "x-chain-id": String(paymentChainId),
        },
        body: JSON.stringify({
          deviceId,
          userAddress: account.address,
        }),
      });

      const data: DesktopLinkTokenResponse = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Failed to create authorization token");
        setIsAuthorizing(false);
        return;
      }

      setSuccess(true);
      setDeepLinkUrl(data.deepLinkUrl);

      window.location.href = data.deepLinkUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed");
      setIsAuthorizing(false);
    }
  }, [account?.address, deviceId, paymentChainId]);

  if (!deviceId && !error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-sidebar-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !deviceId) {
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
              Connect Desktop App
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Connect your wallet to authorize the Compose Desktop app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-sidebar-accent rounded-sm p-4 border border-sidebar-border">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-cyan-400 font-mono">Security Notice</span>
              </div>
              <p className="text-xs text-muted-foreground">
                You're authorizing a desktop application to access your Compose account.
                The app will be able to create sessions and interact with agents on your behalf.
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
              Redirecting to the Compose Desktop app...
            </p>
            {deepLinkUrl && (
              <div className="bg-sidebar-accent rounded-sm p-3 border border-sidebar-border">
                <p className="text-xs text-muted-foreground mb-2">
                  Not redirecting? Click below:
                </p>
                <Button
                  onClick={() => window.location.href = deepLinkUrl}
                  className="w-full bg-cyan-500 text-black hover:bg-cyan-400"
                >
                  Open Desktop App
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const shortAddress = account?.address 
    ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
    : "";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card border-sidebar-border">
        <CardHeader>
          <CardTitle className="font-display text-cyan-400 flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Authorize Desktop App
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Allow the Compose Desktop app to access your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-sidebar-accent rounded-sm p-4 border border-sidebar-border">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground font-mono">Connected Wallet</span>
              <span className="text-sm font-mono text-cyan-400">{shortAddress}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground font-mono">Device ID</span>
              <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">
                {deviceId?.slice(0, 8)}...{deviceId?.slice(-4)}
              </span>
            </div>
          </div>

          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-medium text-cyan-400 font-mono">What this allows</span>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1 ml-6 list-disc">
              <li>Create sessions with your budget</li>
              <li>Interact with agents on your behalf</li>
              <li>Access your installed agents and skills</li>
            </ul>
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
                Authorize Desktop App
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