"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  getMeshDownloadGroups,
  getMeshReleaseUrl,
  MESH_RELEASES_URL,
  type MeshDownloadGroup,
  type MeshDownloadPlatform,
} from "@/lib/mesh-release";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { ComposeAppShell } from "@compose-market/theme/app";
import { ExternalLink, Monitor, Shield, ChevronRight } from "lucide-react";
import "@/styles/install-local.css";

/* ── helpers ── */
function parseQuery(): { token: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { token: params.get("token") };
}

function detectPlatform(): MeshDownloadPlatform {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "macos";
}

function openDownload(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/* ══════════════════════════════════════════════════════════════════
   PlatformCard — uses theme shell classes for brand-aligned look
   ══════════════════════════════════════════════════════════════════ */
function PlatformCard({ group, active, onClick }: { group: MeshDownloadGroup; active?: boolean; onClick?: () => void }) {
  return (
    <section
      className={cn(
        "cm-shell-panel corner-decoration cm-install-card",
        "flex flex-col",
        active && "cm-install-card--active",
      )}
      onClick={onClick}
    >
      {/* Card header */}
      <div className="cm-shell-panel__body flex flex-col gap-[0.35em]">
        <div className="flex items-center justify-between gap-[0.5em]">
          <h3 className="cm-shell-page-header__title !text-[1em]">{group.title}</h3>
          <span className="cm-badge cm-badge--primary">
            {group.options.length} option{group.options.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="cm-shell-page-header__subtitle !text-[0.82em] !max-w-none">
          {group.description}
        </p>
      </div>

      {/* Download options */}
      <div className="cm-shell-stack" style={{ padding: "0 1em 1em", gap: "0.5em" }}>
        {group.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => openDownload(option.url)}
            className={cn(
              "cm-shell-button cm-shell-button--secondary",
              "w-full justify-between !text-left !px-[0.75em] !py-[0.6em] !min-h-0",
              "group",
            )}
          >
            <div className="flex flex-col gap-[0.1em] min-w-0">
              <div className="flex flex-wrap items-center gap-[0.45em]">
                <span className="text-[0.88em] font-semibold text-foreground">{option.title}</span>
                {option.recommended ? (
                  <span className="cm-badge cm-badge--accent !text-[0.68em]">Recommended</span>
                ) : null}
              </div>
              <span className="text-[0.75em] text-muted-foreground leading-snug">{option.hint}</span>
            </div>
            <div className="flex items-center gap-[0.35em] shrink-0">
              <span className="cm-badge cm-badge--muted !text-[0.68em]">{option.format}</span>
              <ChevronRight className="w-[1em] h-[1em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MeshDownloadPanel — The full download UI
   ══════════════════════════════════════════════════════════════════ */
export interface MeshDownloadPanelProps {
  className?: string;
  error?: string | null;
  groups: MeshDownloadGroup[];
  onOpenLocal?: (() => void) | null;
  releaseUrl: string;
  token?: string | null;
}

export function MeshDownloadPanel({
  className,
  error,
  groups,
  onOpenLocal,
  releaseUrl,
  token,
}: MeshDownloadPanelProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<MeshDownloadPlatform>(detectPlatform);

  return (
    <div
      className={cn(
        "cm-install-panel",
        className,
      )}
    >
      {/* ── Page header — uses shell page-header pattern ── */}
      <div className="cm-shell-page-header" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div className="cm-shell-page-header__copy">
          <div className="cm-shell-page-header__eyebrow flex items-center gap-[0.45em]">
            <Monitor className="w-[1.1em] h-[1.1em]" />
            Compose Mesh
          </div>
          <h1 className="cm-shell-page-header__title">Download the local app</h1>
          <p className="cm-shell-page-header__subtitle">
            Pick the installer for your device. Only download the installer itself; updater archives and
            signature files are handled by the app, not by you.
          </p>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="cm-install-panel__body">
        {/* Token banner */}
        {token ? (
          <div className="cm-shell-notice cm-shell-notice--info">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-[0.45em] mb-[0.25em]">
                <Shield className="w-[1.1em] h-[1.1em] text-cyan-400 shrink-0" />
                <span className="cm-shell-page-header__eyebrow !text-[0.78em]">Install Token Ready</span>
              </div>
              <p className="text-[0.85em] text-muted-foreground leading-relaxed">
                Your desktop handoff is already prepared. Install Mesh if needed,
                then open the local app with this token.
              </p>
            </div>
            <button
              type="button"
              className="cm-shell-button cm-shell-button--primary shrink-0"
              onClick={onOpenLocal ?? (() => undefined)}
            >
              <Shield className="w-[1em] h-[1em]" />
              Open Mesh
            </button>
          </div>
        ) : null}

        {/* Error */}
        {error ? (
          <div className="cm-shell-notice cm-shell-notice--error">
            <span className="text-[0.85em]">{error}</span>
          </div>
        ) : null}

        {/* ── Platform grid — always visible, responsive ── */}
        <div className="cm-install-panel__grid">
          {groups.map((group) => (
            <PlatformCard
              key={group.id}
              group={group}
              active={selectedPlatform === group.id}
              onClick={() => setSelectedPlatform(group.id)}
            />
          ))}
        </div>

        {/* ── Footer ── */}
        <div className="cm-shell-banner cm-shell-panel cm-shell-panel--muted" style={{ flexWrap: "wrap" }}>
          <p className="cm-shell-banner__subtitle !max-w-none flex-1 min-w-0">
            Android ships as a direct APK. macOS users should download the DMG. Linux users should start
            with AppImage unless they specifically want a native package.
          </p>
          <button
            type="button"
            className="cm-shell-button cm-shell-button--secondary shrink-0"
            onClick={() => openDownload(releaseUrl)}
          >
            <ExternalLink className="w-[0.95em] h-[0.95em]" />
            All Releases
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MeshDownloadDialog — reusable dialog wrapper
   ══════════════════════════════════════════════════════════════════ */
export interface MeshDownloadDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function MeshDownloadDialog({ onOpenChange, open }: MeshDownloadDialogProps) {
  const [groups, setGroups] = useState<MeshDownloadGroup[]>([]);
  const [releaseUrl, setReleaseUrl] = useState(MESH_RELEASES_URL);

  useEffect(() => {
    let stale = false;
    getMeshDownloadGroups().then((g) => { if (!stale) setGroups(g); });
    getMeshReleaseUrl().then((u) => { if (!stale) setReleaseUrl(u); });
    return () => { stale = true; };
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cm-install-dialog border-0 bg-transparent shadow-none p-0 max-w-none">
        <MeshDownloadPanel groups={groups} releaseUrl={releaseUrl} />
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Page — standalone (no Layout wrapper)
   Uses ComposeAppShell for the cyberpunk backdrop.
   ══════════════════════════════════════════════════════════════════ */
export default function InstallLocalPage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<MeshDownloadGroup[]>([]);
  const [releaseUrl, setReleaseUrl] = useState(MESH_RELEASES_URL);

  useEffect(() => {
    let stale = false;
    getMeshDownloadGroups().then((g) => { if (!stale) setGroups(g); });
    getMeshReleaseUrl().then((u) => { if (!stale) setReleaseUrl(u); });
    return () => { stale = true; };
  }, []);

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

  return (
    <ComposeAppShell
      contentClassName="font-sans antialiased text-foreground selection:bg-fuchsia-500/30 selection:text-fuchsia-200"
    >
      <div className="cm-install-page">
        <MeshDownloadPanel
          error={error}
          groups={groups}
          onOpenLocal={openLocal}
          releaseUrl={releaseUrl}
          token={token}
        />
      </div>
    </ComposeAppShell>
  );
}
