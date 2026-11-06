"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Clock, Copy, Key, Plus, Shield, Trash2, Wallet, Zap } from "lucide-react";
import {
  ShellButton,
  ShellInput,
  ShellModal,
  ShellNotice,
  ShellPanel,
} from "@compose-market/theme/shell";
import { useSession } from "@/hooks/use-session.tsx";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { useChain } from "@/contexts/Network";
import { useWalletAccount } from "@/hooks/use-wallet";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { sdk } from "@/lib/sdk";
import { cn } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/chains";
import type { KeyRecord } from "@compose-market/sdk";

interface SessionChoice {
  label: React.ReactNode;
  active?: boolean;
  onSelect: () => void;
}

interface SessionSummaryRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

interface SessionManageKey {
  id: string;
  title: React.ReactNode;
  maskedValue: React.ReactNode;
  summaryRows: SessionSummaryRow[];
  copied?: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}

interface SessionBudgetDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  triggerClassName?: string;
}

interface SessionManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface KeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

function isActiveKey(key: KeyRecord): boolean {
  return !key.revokedAt && key.expiresAt > Date.now();
}

function formatWeiUsd(value: string | number | null | undefined): string {
  const amount = typeof value === "number" ? value : Number.parseInt(String(value ?? "0"), 10);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `$${(safeAmount / 1_000_000).toFixed(2)}`;
}

function toBudgetWeiString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("budgetWei must be positive");
  }
  return String(Math.floor(value));
}

function budgetRows(selectedBudget: number, duration: number): SessionSummaryRow[] {
  return [
    { label: "Max Spend", value: `$${(selectedBudget / 1_000_000).toFixed(2)} USDC` },
    { label: "Expires After", value: `${duration} hours` },
    { label: "Approvals Required", value: "1 (now)" },
  ];
}

function SessionChoiceGrid({ choices }: { choices: SessionChoice[] }) {
  return (
    <div className="cm-session-choice-grid">
      {choices.map((choice, index) => (
        <button
          key={index}
          type="button"
          className={cn("cm-session-choice", choice.active && "active")}
          onClick={choice.onSelect}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function SessionSummary({ rows }: { rows: SessionSummaryRow[] }) {
  return (
    <div className="cm-session-summary">
      {rows.map((row, index) => (
        <div key={index} className="cm-session-summary__row">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function SessionBudgetDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
  triggerClassName,
}: SessionBudgetDialogProps = {}) {
  const { isConnected } = useWalletAccount();
  const { session, isCreating, error, createSession, budgetPresets } = useSession();
  const [selectedBudget, setSelectedBudget] = useState<number>(budgetPresets[1].value);
  const [duration, setDuration] = useState<number>(24);
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange || (() => undefined)) : setInternalOpen;

  if (!isConnected) return null;

  const handleCreate = async () => {
    const budgetUsdc = selectedBudget / 1_000_000;
    const result = await createSession(budgetUsdc, duration);
    for (const transaction of result.transactions) {
      const explorerUrl = getExplorerTxUrl(transaction.network, transaction.transactionHash);
      toast({
        title: transaction.title,
        description: transaction.description,
        action: explorerUrl !== "#" ? (
          <ToastAction
            altText="View transaction"
            onClick={() => window.open(explorerUrl, "_blank", "noopener,noreferrer")}
          >
            View
          </ToastAction>
        ) : undefined,
      });
    }
    if (result.success) setOpen(false);
  };

  return (
    <>
      {showTrigger ? (
        <ShellButton
          tone={session.isActive ? "secondary" : "primary"}
          size="sm"
          className={cn("cm-session-trigger", triggerClassName)}
          onClick={() => setOpen(true)}
        >
          <Zap className="cm-session-icon" />
          {session.isActive ? "Session Active" : "Start Session"}
        </ShellButton>
      ) : null}

      <ShellModal
        open={open}
        title={(
          <span className="cm-session-modal__title-wrap">
            <Shield className="cm-session-icon cm-session-icon--lg" />
            Session Budget
          </span>
        )}
        subtitle="Set a spending limit to skip wallet signatures for each AI call. One approval, unlimited inference within your budget."
        onClose={() => setOpen(false)}
        className="cm-session-modal"
        contentClassName="cm-session-modal__body"
      >
        <div className="cm-session-section">
          <div className="cm-session-section__label">
            <Wallet className="cm-session-icon" />
            Budget Limit
          </div>
          <SessionChoiceGrid
            choices={budgetPresets.map((preset) => ({
              label: preset.label,
              active: selectedBudget === preset.value,
              onSelect: () => setSelectedBudget(preset.value),
            }))}
          />
        </div>

        <div className="cm-session-section">
          <div className="cm-session-section__label">
            <Clock className="cm-session-icon" />
            Session Duration
          </div>
          <SessionChoiceGrid
            choices={[1, 6, 12, 24].map((hours) => ({
              label: `${hours}h`,
              active: duration === hours,
              onSelect: () => setDuration(hours),
            }))}
          />
        </div>

        <SessionSummary rows={budgetRows(selectedBudget, duration)} />
        {error ? <ShellNotice tone="error">{error}</ShellNotice> : null}

        <div className="cm-session-modal__footer">
          <ShellButton tone="ghost" onClick={() => setOpen(false)} disabled={isCreating}>
            Cancel
          </ShellButton>
          <ShellButton tone="primary" onClick={() => void handleCreate()} disabled={isCreating}>
            {isCreating ? "Creating Session..." : "Approve & Start Session"}
          </ShellButton>
        </div>
      </ShellModal>
    </>
  );
}

export function SessionIndicator({
  className,
  triggerClassName,
}: {
  className?: string;
  triggerClassName?: string;
} = {}) {
  const { session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  if (!session.isActive) {
    return <SessionBudgetDialog triggerClassName={triggerClassName ?? className} />;
  }

  const remainingUsdc = session.budgetRemaining / 1_000_000;
  const expiresLabel = session.expiresAt ? formatTimeRemaining(session.expiresAt) : "Never";

  return (
    <>
      <div className={cn("cm-session-menu", className)} ref={rootRef}>
        <ShellButton
          tone="secondary"
          size="sm"
          className="cm-session-trigger cm-session-trigger--active"
          onClick={() => setMenuOpen((current) => !current)}
          aria-expanded={menuOpen}
        >
          <Zap className="cm-session-icon" />
          <span>Session</span>
          <span className="cm-session-trigger__mobile">${remainingUsdc.toFixed(0)}</span>
          <ChevronDown className="cm-session-icon cm-session-icon--sm" />
        </ShellButton>

        {menuOpen ? (
          <ShellPanel className="cm-session-menu__dropdown" padded={false}>
            <div className="cm-session-menu__header">
              <div className="cm-session-menu__row">
                <span>Budget</span>
                <strong>${remainingUsdc.toFixed(2)}</strong>
              </div>
              <div className="cm-session-menu__row">
                <span>Expires</span>
                <strong>{expiresLabel}</strong>
              </div>
            </div>
            <button
              type="button"
              className="cm-session-menu__item"
              onClick={() => {
                setMenuOpen(false);
                setKeyDialogOpen(true);
              }}
            >
              <Key className="cm-session-icon" />
              <span>Generate API Key</span>
            </button>
            <button
              type="button"
              className="cm-session-menu__item"
              onClick={() => {
                setMenuOpen(false);
                setManageDialogOpen(true);
              }}
            >
              <Wallet className="cm-session-icon" />
              <span>Manage Sessions</span>
            </button>
          </ShellPanel>
        ) : null}
      </div>

      <KeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} />
      <SessionManageDialog open={manageDialogOpen} onOpenChange={setManageDialogOpen} />
    </>
  );
}

function SessionManageDialog({ open, onOpenChange }: SessionManageDialogProps) {
  const { userAddress } = useSelectedUserAddress();
  const { session, ensureKeyToken } = useSession();
  const [sessions, setSessions] = useState<KeyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!userAddress) return;
    setLoading(true);
    try {
      const keyToken = await ensureKeyToken();
      if (!keyToken) throw new Error("Compose Key token unavailable");
      const keys = await sdk.keys.list({ userAddress });
      setSessions(keys.filter((key) => key.purpose === "api" && isActiveKey(key)));
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
      toast({ title: "Failed to fetch sessions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [userAddress, ensureKeyToken]);

  useEffect(() => {
    if (open) void fetchSessions();
  }, [fetchSessions, open]);

  const handleRevoke = async (keyId: string) => {
    if (!userAddress) return;
    try {
      const keyToken = await ensureKeyToken();
      if (!keyToken) throw new Error("Compose Key token unavailable");
      await sdk.keys.revoke(keyId);
      toast({ title: "Session revoked" });
      void fetchSessions();
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to revoke session", variant: "destructive" });
    }
  };

  const handleCopyKey = async (keyId: string) => {
    await navigator.clipboard.writeText(keyId);
    setCopiedKeyId(keyId);
    toast({ title: "Key ID copied to clipboard" });
    window.setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const keys: SessionManageKey[] = sessions.map((sessionKey) => ({
    id: sessionKey.keyId,
    title: sessionKey.name || "Unnamed Key",
    maskedValue: `compose-${sessionKey.keyId.slice(0, 8)}…`,
    summaryRows: [
      { label: "Budget", value: `${formatWeiUsd(sessionKey.budgetRemaining)} / ${formatWeiUsd(sessionKey.budgetLimit)}` },
      { label: "Expires", value: formatTimeRemaining(sessionKey.expiresAt) },
    ],
    copied: copiedKeyId === sessionKey.keyId,
    onCopy: () => void handleCopyKey(sessionKey.keyId),
    onRevoke: () => void handleRevoke(sessionKey.keyId),
  }));

  const currentSessionRows: SessionSummaryRow[] = session.isActive ? [
    { label: "Remaining", value: `$${(session.budgetRemaining / 1_000_000).toFixed(2)}` },
    { label: "Expires", value: session.expiresAt ? formatTimeRemaining(session.expiresAt) : "Never" },
  ] : [];

  return (
    <>
      <ShellModal
        open={open}
        title={(
          <span className="cm-session-modal__title-wrap">
            <Wallet className="cm-session-icon cm-session-icon--lg" />
            Manage Sessions
          </span>
        )}
        subtitle="View and manage your active API sessions and keys."
        onClose={() => onOpenChange(false)}
        className="cm-session-modal"
        contentClassName="cm-session-modal__body"
      >
        {currentSessionRows.length > 0 ? (
          <ShellPanel className="cm-session-current">
            <div className="cm-session-current__title">
              <Zap className="cm-session-icon" />
              Current Session
            </div>
            <div className="cm-session-current__grid">
              {currentSessionRows.map((row, index) => (
                <div key={index} className="cm-session-current__cell">
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </ShellPanel>
        ) : null}

        <div className="cm-session-manage__header">
          <span>API Keys</span>
          <ShellButton tone="ghost" size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="cm-session-icon" />
            New Key
          </ShellButton>
        </div>

        {loading ? (
          <div className="cm-session-empty">Loading sessions...</div>
        ) : keys.length === 0 ? (
          <div className="cm-session-empty">
            <div>No API keys created yet.</div>
            <button
              type="button"
              className="cm-session-empty__action"
              onClick={() => setCreateDialogOpen(true)}
            >
              Generate your first key
            </button>
          </div>
        ) : (
          <div className="cm-session-key-list">
            {keys.map((key) => (
              <ShellPanel key={key.id} className="cm-session-key">
                <div className="cm-session-key__header">
                  <strong>{key.title}</strong>
                  <div className="cm-session-key__actions">
                    <button type="button" className="cm-session-key__icon" onClick={key.onCopy} title="Copy key">
                      {key.copied ? <Check className="cm-session-icon" /> : <Copy className="cm-session-icon" />}
                    </button>
                    <button type="button" className="cm-session-key__icon danger" onClick={key.onRevoke} title="Revoke key">
                      <Trash2 className="cm-session-icon" />
                    </button>
                  </div>
                </div>
                <div className="cm-session-key__id">{key.maskedValue}</div>
                <div className="cm-session-key__grid">
                  {key.summaryRows.map((row, index) => (
                    <div key={index} className="cm-session-key__cell">
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </ShellPanel>
            ))}
          </div>
        )}
      </ShellModal>

      <KeyDialog
        open={createDialogOpen}
        onOpenChange={(nextOpen) => {
          setCreateDialogOpen(nextOpen);
          if (!nextOpen) void fetchSessions();
        }}
      />
    </>
  );
}

function KeyDialog({ open, onOpenChange }: KeyDialogProps) {
  const { session, ensureKeyToken } = useSession();
  const { userAddress } = useSelectedUserAddress();
  const { selectedChain } = useChain();
  const assetSymbol = selectedChain?.asset ?? "USDC";
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState("Cursor");

  const handleGenerate = async () => {
    if (!userAddress || !session.isActive) return;

    setIsGenerating(true);
    try {
      const keyToken = await ensureKeyToken();
      if (!keyToken) throw new Error("Compose Key token unavailable");

      const previousToken = sdk.keys.currentToken();
      const created = await sdk.keys.create({
        purpose: "api",
        budgetWei: toBudgetWeiString(session.budgetRemaining),
        expiresAt: session.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
        network: session.network ?? undefined,
        name: keyName,
      });

      if (previousToken && previousToken !== created.token) {
        sdk.keys.use(previousToken);
      }

      setGeneratedKey(created.token);
      toast({ title: "API Key generated" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate API key";
      console.error(error);
      toast({ title: "Key generation failed", description: message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setGeneratedKey(null);
      setCopied(false);
    }
    onOpenChange(nextOpen);
  };

  const summaryRows: SessionSummaryRow[] = [
    { label: "Budget", value: `$${(session.budgetRemaining / 1_000_000).toFixed(2)} ${assetSymbol}` },
    { label: "Expires", value: session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "Never" },
  ];

  return (
    <ShellModal
      open={open}
      title={(
        <span className="cm-session-modal__title-wrap">
          <Key className="cm-session-icon cm-session-icon--lg" />
          Generate API Key
        </span>
      )}
      subtitle="Create a key for external tools like Cursor or OpenClaw. Uses your current session budget."
      onClose={() => handleClose(false)}
      className="cm-session-modal"
      contentClassName="cm-session-modal__body"
    >
      {!generatedKey ? (
        <>
          <div className="cm-session-section">
            <div className="cm-session-section__label">Key Name</div>
            <ShellInput
              value={keyName}
              onChange={(event) => setKeyName(event.currentTarget.value)}
              placeholder="e.g., Cursor, OpenCode"
            />
          </div>

          <SessionSummary rows={summaryRows} />

          <div className="cm-session-modal__footer">
            <ShellButton tone="ghost" onClick={() => handleClose(false)} disabled={isGenerating}>
              Close
            </ShellButton>
            <ShellButton tone="primary" onClick={() => void handleGenerate()} disabled={isGenerating}>
              {isGenerating ? "Generating..." : "Generate Key"}
            </ShellButton>
          </div>
        </>
      ) : (
        <>
          <div className="cm-session-section">
            <div className="cm-session-section__label">Your API Key</div>
            <div className="cm-session-generated">
              <ShellInput readOnly value={generatedKey} />
              <ShellButton tone="secondary" size="sm" onClick={() => void handleCopy()}>
                {copied ? <Check className="cm-session-icon" /> : <Copy className="cm-session-icon" />}
              </ShellButton>
            </div>
          </div>

          <ShellNotice tone="warning">
            Save this key now. You won't be able to see it again.
          </ShellNotice>
          <SessionSummary rows={summaryRows} />

          <ShellPanel className="cm-session-usage">
            <div className="cm-session-summary__row">
              <span>Usage</span>
              <strong>{`Authorization: Bearer ${generatedKey.slice(0, 20)}...`}</strong>
            </div>
          </ShellPanel>

          <div className="cm-session-modal__footer">
            <ShellButton tone="ghost" onClick={() => handleClose(false)}>Close</ShellButton>
            <ShellButton tone="primary" onClick={() => void handleCopy()}>
              {copied ? <Check className="cm-session-icon" /> : <Copy className="cm-session-icon" />}
              {copied ? "Copied!" : "Copy to Clipboard"}
            </ShellButton>
          </div>
        </>
      )}
    </ShellModal>
  );
}
