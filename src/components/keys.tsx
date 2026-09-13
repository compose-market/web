/**
 * API Keys — key management UI for the /keys page.
 *
 * Split layout: the key list on the left, the "Connect your tools"
 * quickstart panel on the right (stacked on narrow containers).
 * Lists all keys (session + API), supports creating new API keys
 * with custom name/budget/duration, and revoking keys (with confirmation).
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Check, Copy, Key, Plus, RefreshCw, Terminal, Trash2, Zap, Clock } from "lucide-react";
import { useKeys, type KeyRecord, type UseKeysReturn } from "@/hooks/use-keys";
import { useWalletAccount } from "@/hooks/use-wallet";
import { NetworkBadge } from "@/components/network-selector";
import { useChain } from "@/contexts/Network";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatWeiUsd, timeAgo } from "@/lib/receipts";
import { QuickstartPanel, type QuickstartSegment } from "@/components/keys/quickstart";
import { SessionBudgetDialog } from "@/components/session";
import { useSession } from "@/hooks/use-session";

function formatTimeRemaining(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "Expired";
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Remaining share of the budget, 0..100 — the bar drains as the key spends. */
function budgetRemainingPercent(key: KeyRecord): number {
  const limit = Number(key.budgetLimit || "0");
  if (limit <= 0) return 0;
  const remaining = Number(key.budgetRemaining || "0");
  return Math.min(100, Math.round((remaining / limit) * 100));
}

function budgetTone(key: KeyRecord): "ok" | "low" | "depleted" {
  const remaining = Number(key.budgetRemaining || "0");
  const limit = Number(key.budgetLimit || "1");
  const pct = remaining / limit;
  if (pct <= 0) return "depleted";
  if (pct < 0.15) return "low";
  return "ok";
}

function keyStatus(key: KeyRecord): "active" | "expired" | "revoked" {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt <= Date.now()) return "expired";
  return "active";
}

type PurposeFilter = "all" | "api" | "session";

export function ApiKeysPanel() {
  const keysState = useKeys();
  const { owner, keys, activeKeys, isLoading, isRefetching, error, forceRefresh, revokeKey, isRevoking } = keysState;
  const { isConnected } = useWalletAccount();
  const { sessionActive } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilter>("all");
  const [revokeTarget, setRevokeTarget] = useState<KeyRecord | null>(null);
  const [segment, setSegment] = useState<QuickstartSegment>("integrate");
  const [highlight, setHighlight] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const highlightTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (highlightTimeoutRef.current !== null) window.clearTimeout(highlightTimeoutRef.current);
  }, []);

  const filteredKeys = useMemo(
    () => (purposeFilter === "all" ? keys : keys.filter((key) => key.purpose === purposeFilter)),
    [keys, purposeFilter],
  );

  const purposeCounts = useMemo(() => ({
    all: keys.length,
    api: keys.filter((key) => key.purpose === "api").length,
    session: keys.filter((key) => key.purpose === "session").length,
  }), [keys]);

  const handleCopy = useCallback(async (keyId: string) => {
    await navigator.clipboard.writeText(keyId);
    setCopiedKeyId(keyId);
    toast.success("Key ID copied");
    setTimeout(() => setCopiedKeyId(null), 2000);
  }, []);

  const confirmRevoke = useCallback(async () => {
    if (!revokeTarget || !isConnected) return;
    try {
      await revokeKey(revokeTarget.keyId);
      toast.success("Key revoked");
    } catch {
      toast.error("Failed to revoke key");
    } finally {
      setRevokeTarget(null);
    }
  }, [isConnected, revokeKey, revokeTarget]);

  const openQuickstart = useCallback(() => {
    setSegment("ide");
    setHighlight(true);
    if (highlightTimeoutRef.current !== null) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlight(false), 1800);
    // Below the cm-split breakpoint the side panel is hidden — open the sheet.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 58rem)").matches) {
      setGuideOpen(true);
    }
  }, []);

  const openCreate = useCallback(() => {
    if (isConnected) setCreateOpen(true);
  }, [isConnected]);

  const openSession = useCallback(() => {
    if (!isConnected) return;
    setGuideOpen(false);
    setSessionOpen(true);
  }, [isConnected]);

  // The quickstart is static guidance — it renders instantly in every
  // state, without waiting for the wallet, session, or keys query.
  const mainContent = !owner ? (
    <div className="cm-dashboard__empty">
      <Key className="cm-dashboard__empty-icon" />
      <span className="cm-dashboard__empty-title">Connect your wallet</span>
      <span className="cm-dashboard__empty-text">
        Connect your wallet to manage your API keys for external tools.
        The setup guide works without a wallet — have a look while you decide.
      </span>
    </div>
  ) : isLoading && keys.length === 0 ? (
    <div className="cm-dashboard__empty">
      <Key className="cm-dashboard__empty-icon animate-pulse" />
      <span className="cm-dashboard__empty-text">Loading keys…</span>
    </div>
  ) : error && keys.length === 0 ? (
    <div className="cm-dashboard__empty">
      <Key className="cm-dashboard__empty-icon" />
      <span className="cm-dashboard__empty-title">Unable to load keys</span>
      <span className="cm-dashboard__empty-text">{error.message}</span>
    </div>
  ) : null;

  return (
    <div className="cm-keys-page">
      <KeysHeader
        onRefresh={() => void forceRefresh()}
        isRefetching={isRefetching}
        canRefresh={Boolean(owner)}
        onCreate={openCreate}
        canCreate={isConnected}
        onOpenGuide={() => setGuideOpen(true)}
        activeCount={activeKeys.length}
      />

      <div className="cm-split">
        <div className="cm-split__main">
          <div className="cm-keys-main">
            {mainContent ?? (
              <>
                {error ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                    Unable to update keys: {error.message}
                  </div>
                ) : null}
                {keys.length === 0 ? (
                  <div className="cm-dashboard__empty">
                    <Key className="cm-dashboard__empty-icon" />
                    <span className="cm-dashboard__empty-title">No API keys yet</span>
                    <span className="cm-dashboard__empty-text">
                      Two steps to any client: create a Compose Key, paste it into your tool.
                      The guide on the right has the exact config for your setup.
                    </span>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
                      <Button onClick={openCreate} disabled={!isConnected} className="cm-shell-button cm-shell-button--primary">
                        <Plus className="w-4 h-4" />
                        Create Key
                      </Button>
                      <Button
                        onClick={() => setGuideOpen(true)}
                        className="cm-shell-button cm-shell-button--secondary cm-keys-quickstart-trigger"
                      >
                        <Terminal className="w-4 h-4" />
                        Setup Guide
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="cm-keys-toolbar">
                      <div className="cm-time-range">
                        {(["all", "api", "session"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className="cm-time-range__option"
                            data-active={purposeFilter === option}
                            onClick={() => setPurposeFilter(option)}
                          >
                            {option === "all" ? "All" : option === "api" ? "API" : "Session"} · {purposeCounts[option]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {filteredKeys.length === 0 ? (
                      <div className="cm-dashboard__empty">
                        <Key className="cm-dashboard__empty-icon" />
                        <span className="cm-dashboard__empty-text">No {purposeFilter} keys.</span>
                      </div>
                    ) : (
                      <div className="cm-keys-list">
                        {filteredKeys.map((key) => {
                          const status = keyStatus(key);
                          const tone = budgetTone(key);
                          const pct = budgetRemainingPercent(key);
                          return (
                            <div key={key.keyId} className="cm-key-card" data-status={status}>
                              <div className="cm-key-card__icon" data-purpose={key.purpose}>
                                {key.purpose === "session" ? <Zap className="w-4 h-4" /> : <Key className="w-4 h-4" />}
                              </div>
                              <div className="cm-key-card__body">
                                <div className="cm-key-card__top">
                                  <span className="cm-key-card__name">{key.name || "Unnamed Key"}</span>
                                  <span className="cm-key-card__purpose" data-purpose={key.purpose}>
                                    {key.purpose}
                                  </span>
                                  <NetworkBadge network={key.network} />
                                  <span className="cm-key-card__id">inference-{key.keyId.slice(0, 8)}***</span>
                                </div>
                                <div className="cm-key-card__meta">
                                  <span className="cm-key-card__budget">
                                    {formatWeiUsd(key.budgetRemaining)} left of {formatWeiUsd(key.budgetLimit)}
                                    <span className="cm-key-card__budget-bar">
                                      <span
                                        className="cm-key-card__budget-fill"
                                        data-tone={tone === "ok" ? undefined : tone}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </span>
                                  </span>
                                  <span className="cm-key-card__status" data-status={status}>
                                    {status === "active" && (
                                      <>
                                        <Clock className="w-2.5 h-2.5" />
                                        {formatTimeRemaining(key.expiresAt)}
                                      </>
                                    )}
                                    {status === "expired" && "Expired"}
                                    {status === "revoked" && "Revoked"}
                                  </span>
                                  <span>Created {timeAgo(key.createdAt)}</span>
                                  {key.lastUsedAt && <span>Last used {timeAgo(key.lastUsedAt)}</span>}
                                </div>
                              </div>
                              <div className="cm-key-card__actions">
                                <button
                                  className="cm-key-card__action"
                                  onClick={() => void handleCopy(key.keyId)}
                                  title="Copy key ID"
                                  aria-label="Copy key ID"
                                >
                                  {copiedKeyId === key.keyId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                                {status === "active" && (
                                  <button
                                    className="cm-key-card__action"
                                    data-action="revoke"
                                    onClick={() => setRevokeTarget(key)}
                                    disabled={isRevoking || !isConnected}
                                    title="Revoke key"
                                    aria-label="Revoke key"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="cm-split__side">
          <QuickstartPanel
            segment={segment}
            onSegmentChange={setSegment}
            highlight={highlight}
            sessionActive={sessionActive}
            onCreateSession={openSession}
            onCreateKey={openCreate}
          />
        </div>
      </div>

      <Sheet open={guideOpen} onOpenChange={setGuideOpen}>
        <SheetContent side="right" className="cm-shell-panel cm-sheet-panel cm-sheet-panel--inspect p-0">
          <SheetHeader className="border-b border-primary/15 p-4">
            <SheetTitle className="font-display text-cyan-300 flex items-center gap-2 text-base">
              <Terminal className="h-5 w-5" />
              Connect your tools
            </SheetTitle>
          </SheetHeader>
          <div className="cm-sheet-body cm-sheet-body--inspect">
            <QuickstartPanel
              segment={segment}
              onSegmentChange={setSegment}
              highlight={false}
              sessionActive={sessionActive}
              onCreateSession={openSession}
              onCreateKey={() => {
                setGuideOpen(false);
                openCreate();
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        keysState={keysState}
        onOpenQuickstart={openQuickstart}
      />

      <SessionBudgetDialog
        open={sessionOpen}
        onOpenChange={setSessionOpen}
        showTrigger={false}
      />

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <AlertDialogContent className="cm-dialog-panel border-red-500/30 bg-background/95">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-base">Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{revokeTarget?.name || "Unnamed Key"}</strong> will stop working
              immediately. Any client using it will start failing — this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cm-shell-button cm-shell-button--ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmRevoke()}
              disabled={isRevoking || !isConnected}
              className="cm-shell-button cm-shell-button--danger"
            >
              {isRevoking ? "Revoking…" : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KeysHeader({
  onRefresh,
  isRefetching,
  canRefresh,
  onCreate,
  canCreate,
  onOpenGuide,
  activeCount,
}: {
  onRefresh: () => void;
  isRefetching: boolean;
  canRefresh: boolean;
  onCreate: () => void;
  canCreate: boolean;
  onOpenGuide: () => void;
  activeCount?: number;
}) {
  return (
    <div className="cm-keys-header">
      <div className="cm-keys-header__brand">
        <h1 className="cm-page-header__title cm-keys-header__title">
          <span className="text-fuchsia-500 mr-2">//</span>
          API KEYS
        </h1>
        {activeCount !== undefined && activeCount > 0 && (
          <span className="cm-keys-header__count">
            {activeCount} active
          </span>
        )}
      </div>
      <div className="cm-keys-header__actions">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenGuide}
          className="cm-shell-button cm-shell-button--ghost cm-shell-button--icon cm-keys-quickstart-trigger"
          title="Connect your tools"
          aria-label="Open the setup guide"
        >
          <Terminal className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={!canRefresh || isRefetching}
          className="cm-shell-button cm-shell-button--ghost cm-shell-button--icon"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
        <Button onClick={onCreate} disabled={!canCreate} className="cm-shell-button cm-shell-button--primary" size="sm">
          <Plus className="w-4 h-4" />
          New Key
        </Button>
      </div>
    </div>
  );
}

const BUDGET_PRESETS = [
  { label: "$1", value: "1" },
  { label: "$10", value: "10" },
  { label: "$50", value: "50" },
  { label: "$100", value: "100" },
];

const DURATION_PRESETS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

const NAME_SUGGESTIONS = ["OpenCode", "OpenClaw", "Hermes", "Cursor", "Production"];

function isValidBudget(value: string): boolean {
  return /^\d+(\.\d{1,6})?$/u.test(value) && Number(value) > 0;
}

function CreateKeyDialog({
  open,
  onOpenChange,
  keysState,
  onOpenQuickstart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keysState: UseKeysReturn;
  onOpenQuickstart: () => void;
}) {
  const { createKey, isCreating, createdToken, clearCreatedToken, createError } = keysState;
  const { paymentNetwork, getChainByNetworkId } = useChain();
  const currentChain = getChainByNetworkId(paymentNetwork);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("10");
  const [customBudget, setCustomBudget] = useState("");
  const [duration, setDuration] = useState(24);
  const [copied, setCopied] = useState(false);

  const effectiveBudget = customBudget.trim() !== "" ? customBudget.trim() : budget;
  const budgetValid = isValidBudget(effectiveBudget);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !budgetValid) return;
    await createKey({
      name: name.trim(),
      budgetUsd: effectiveBudget,
      durationHours: duration,
      network: paymentNetwork,
    });
  }, [createKey, name, effectiveBudget, budgetValid, duration, paymentNetwork]);

  const handleCopyToken = useCallback(async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    toast.success("API key copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  }, [createdToken]);

  const handleClose = useCallback((next: boolean) => {
    onOpenChange(next);
    if (!next) {
      clearCreatedToken();
      setName("");
      setCopied(false);
      setCustomBudget("");
    }
  }, [onOpenChange, clearCreatedToken]);

  const budgetSummary = budgetValid ? `$${Number(effectiveBudget).toFixed(2)} USDC` : "—";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="cm-dialog-panel max-w-md border-violet-500/30 bg-background/95 p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-violet-300 flex items-center gap-2 text-base">
            <Key className="h-5 w-5" />
            {createdToken ? "Key Created" : "Create API Key"}
          </DialogTitle>
        </DialogHeader>

        {createdToken ? (
          <div className="cm-created-token">
            <span className="cm-created-token__warning">
              Save this key now. You won't be able to see it again.
            </span>
            <code className="cm-created-token__value">{createdToken}</code>
            <div className="cm-created-token__usage">
              Usage: <code>Authorization: Bearer {createdToken.slice(0, 20)}...</code>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.3rem" }}>
              <Button onClick={() => void handleCopyToken()} className="cm-shell-button cm-shell-button--primary" size="sm" style={{ flex: 1 }}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy Key"}
              </Button>
            </div>
            <div className="cm-created-token__next">
              <span className="cm-created-token__next-label">Next — configure your client</span>
              <span className="cm-created-token__next-copy">
                Base URL, model catalog, and per-client recipes (OpenCode, OpenClaw, Hermes) are one click away.
              </span>
              <Button
                onClick={() => {
                  handleClose(false);
                  onOpenQuickstart();
                }}
                className="cm-shell-button cm-shell-button--secondary"
                size="sm"
              >
                Open quickstart
              </Button>
            </div>
            <Button onClick={() => handleClose(false)} className="cm-shell-button cm-shell-button--ghost" size="sm">
              Done
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div className="cm-create-key__field">
              <label className="cm-create-key__label">Key Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Cursor, OpenCode, Production"
                className="cm-shell-input"
              />
              <div className="cm-create-key__choices">
                {NAME_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="cm-create-key__choice"
                    data-active={name === suggestion}
                    onClick={() => setName(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            <div className="cm-create-key__field">
              <label className="cm-create-key__label">Budget (USDC)</label>
              <div className="cm-create-key__choices">
                {BUDGET_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    className="cm-create-key__choice"
                    data-active={customBudget === "" && budget === preset.value}
                    onClick={() => {
                      setBudget(preset.value);
                      setCustomBudget("");
                    }}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
                <Input
                  value={customBudget}
                  onChange={(e) => setCustomBudget(e.target.value)}
                  placeholder="Custom"
                  inputMode="decimal"
                  className="cm-shell-input cm-create-key__custom"
                  data-invalid={customBudget.trim() !== "" && !budgetValid ? "true" : undefined}
                  aria-label="Custom budget in USDC"
                />
              </div>
            </div>

            <div className="cm-create-key__field">
              <label className="cm-create-key__label">Duration</label>
              <div className="cm-create-key__choices">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.hours}
                    className="cm-create-key__choice"
                    data-active={duration === preset.hours}
                    onClick={() => setDuration(preset.hours)}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cm-create-key__summary">
              <div className="cm-create-key__summary-row">
                <span>Max Spend</span>
                <strong>{budgetSummary}</strong>
              </div>
              <div className="cm-create-key__summary-row">
                <span>Expires After</span>
                <strong>{duration >= 24 ? `${Math.floor(duration / 24)}d` : `${duration}h`}</strong>
              </div>
              <div className="cm-create-key__summary-row">
                <span>Chain</span>
                <strong>{currentChain?.name || paymentNetwork}</strong>
              </div>
            </div>

            {createError && (
              <div className="cm-create-key__summary" style={{ borderColor: "hsl(0 72% 51% / 0.3)", background: "hsl(0 72% 51% / 0.05)" }}>
                <span style={{ color: "hsl(0 72% 55%)", fontSize: "0.66rem" }}>{createError}</span>
              </div>
            )}

            <Button
              onClick={() => void handleCreate()}
              disabled={isCreating || !name.trim() || !budgetValid}
              className="cm-shell-button cm-shell-button--primary"
              style={{ width: "100%" }}
            >
              {isCreating ? "Creating..." : "Create Key"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
