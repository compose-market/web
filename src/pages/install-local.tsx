"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletConnector, useWalletAccount } from "@/components/connector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MESH_MAC_DOWNLOADS, MESH_RELEASES_URL } from "@/lib/mesh-release";
import { Download, Monitor, Shield } from "lucide-react";

function parseQuery(): { token: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { token: params.get("token") };
}

export default function InstallLocalPage() {
  const { isConnected } = useWalletAccount();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const parsed = parseQuery();
    setToken(parsed.token);
  }, []);

  const openLocal = useCallback(() => {
    if (!token) {
      setError("No install token available.");
      return;
    }
    window.location.href = `manowar://open?token=${encodeURIComponent(token)}`;
  }, [token]);

  const openDownload = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

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
            className="w-full bg-cyan-500 text-black hover:bg-cyan-400"
            onClick={() => openDownload(MESH_MAC_DOWNLOADS.appleSilicon.dmgUrl)}
          >
            <Download className="w-4 h-4 mr-2" />
            Download for Apple Silicon
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => openDownload(MESH_MAC_DOWNLOADS.intel.dmgUrl)}
          >
            <Download className="w-4 h-4 mr-2" />
            Download for Intel Mac
          </Button>

          <div className="rounded-sm border border-sidebar-border p-3 bg-sidebar-accent text-xs text-muted-foreground space-y-1">
            <p>{MESH_MAC_DOWNLOADS.appleSilicon.label}: {MESH_MAC_DOWNLOADS.appleSilicon.hint}</p>
            <p>{MESH_MAC_DOWNLOADS.intel.label}: {MESH_MAC_DOWNLOADS.intel.hint}</p>
            <a
              href={MESH_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-cyan-400 hover:text-cyan-300"
            >
              View all Compose Mesh releases
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
