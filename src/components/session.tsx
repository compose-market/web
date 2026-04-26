"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Clock, Copy, Key, Plus, Shield, Trash2, Wallet, Zap } from "lucide-react";
import {
  ComposeKeyDialogShell,
  SessionBudgetDialogShell,
  SessionIndicatorShell,
  SessionManageDialogShell,
  type SessionManageKey,
  type SessionSummaryRow,
} from "@compose-market/theme/session";
import { ShellButton } from "@compose-market/theme/shell";
import { useSession } from "@/hooks/use-session.tsx";
import { useWalletAccount } from "@/components/connector";
import { toast } from "sonner";
import { sdk } from "@/lib/sdk";
import type { ComposeKeyRecord } from "@compose-market/sdk";

interface SessionBudgetDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

interface SessionManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ComposeKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTimeRemaining(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    return "Expired";
  }

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function isActiveKey(key: ComposeKeyRecord): boolean {
  return !key.revokedAt && key.expiresAt > Date.now();
}

function budgetRows(selectedBudget: number, duration: number): SessionSummaryRow[] {
  return [
    {
      label: "Max Spend",
      value: `$${(selectedBudget / 1_000_000).toFixed(2)} USDC`,
    },
    {
      label: "Expires After",
      value: `${duration} hours`,
    },
    {
      label: "Approvals Required",
      value: "1 (now)",
    },
  ];
}

export function SessionBudgetDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
}: SessionBudgetDialogProps = {}) {
  const { isConnected } = useWalletAccount();
  const { session, isCreating, error, createSession, budgetPresets } = useSession();
  const [selectedBudget, setSelectedBudget] = useState<number>(budgetPresets[1].value);
  const [duration, setDuration] = useState<number>(24);
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange || (() => undefined)) : setInternalOpen;

  if (!isConnected) {
    return null;
  }

  const handleCreate = async () => {
    const budgetUsdc = selectedBudget / 1_000_000;
    const success = await createSession(budgetUsdc, duration);
    if (success) {
      setOpen(false);
    }
  };

  return (
    <>
      {showTrigger ? (
        <ShellButton
          tone={session.isActive ? "secondary" : "primary"}
          size="sm"
          onClick={() => setOpen(true)}
        >
          <Zap size={14} />
          {session.isActive ? "Session Active" : "Start Session"}
        </ShellButton>
      ) : null}
      <SessionBudgetDialogShell
        open={open}
        title="Session Budget"
        subtitle="Set a spending limit to skip wallet signatures for each AI call. One approval, unlimited inference within your budget."
        titleIcon={<Shield size={18} />}
        budgetLabel="Budget Limit (USDC)"
        durationLabel="Session Duration"
        durationIcon={<Clock size={14} />}
        budgetChoices={budgetPresets.map((preset) => ({
          label: preset.label,
          active: selectedBudget === preset.value,
          onSelect: () => setSelectedBudget(preset.value),
        }))}
        durationChoices={[1, 6, 12, 24].map((hours) => ({
          label: `${hours}h`,
          active: duration === hours,
          onSelect: () => setDuration(hours),
        }))}
        summaryRows={budgetRows(selectedBudget, duration)}
        error={error || undefined}
        onClose={() => setOpen(false)}
        onSubmit={() => void handleCreate()}
        submitting={isCreating}
        submitLabel="Approve & Start Session"
        submittingLabel="Creating Session..."
      />
    </>
  );
}

export function SessionIndicator() {
  const { session } = useSession();
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  if (!session.isActive) {
    return <SessionBudgetDialog />;
  }

  const remainingUsdc = session.budgetRemaining / 1_000_000;

  return (
    <>
      <SessionIndicatorShell
        active
        budgetLabel={`$${remainingUsdc.toFixed(2)}`}
        expiresLabel={session.expiresAt ? formatTimeRemaining(session.expiresAt) : "Never"}
        mobileBudgetLabel={`$${remainingUsdc.toFixed(0)}`}
        activeLabel="Session"
        leadingIcon={<Zap size={14} />}
        trailingIcon={<ChevronDown size={12} />}
        keyIcon={<Key size={14} />}
        manageIcon={<Wallet size={14} />}
        onStart={() => undefined}
        onOpenKey={() => setKeyDialogOpen(true)}
        onOpenManage={() => setManageDialogOpen(true)}
      />

      <ComposeKeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} />
      <SessionManageDialog open={manageDialogOpen} onOpenChange={setManageDialogOpen} />
    </>
  );
}

function SessionManageDialog({ open, onOpenChange }: SessionManageDialogProps) {
  const { account } = useWalletAccount();
  const { session, ensureComposeKeyToken } = useSession();
  const [sessions, setSessions] = useState<ComposeKeyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!account?.address) {
      return;
    }

    setLoading(true);
    try {
      const composeKeyToken = await ensureComposeKeyToken();
      if (!composeKeyToken) {
        throw new Error("Compose Key token unavailable");
      }
      const keys = await sdk.keys.list();
      setSessions(keys.filter((key) => key.purpose === "api" && isActiveKey(key)));
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
      toast.error("Failed to fetch sessions");
    } finally {
      setLoading(false);
    }
  }, [account?.address, ensureComposeKeyToken]);

  useEffect(() => {
    if (open) {
      void fetchSessions();
    }
  }, [fetchSessions, open]);

  const handleRevoke = async (keyId: string) => {
    if (!account?.address) {
      return;
    }

    try {
      const composeKeyToken = await ensureComposeKeyToken();
      if (!composeKeyToken) {
        throw new Error("Compose Key token unavailable");
      }
      await sdk.keys.revoke(keyId);
      toast.success("Session revoked");
      void fetchSessions();
    } catch (error) {
      console.error(error);
      toast.error("Failed to revoke session");
    }
  };

  const handleCopyKey = async (keyId: string) => {
    await navigator.clipboard.writeText(`compose-${keyId.slice(0, 8)}***`);
    setCopiedKeyId(keyId);
    toast.success("Key ID copied to clipboard");
    window.setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const keys: SessionManageKey[] = sessions.map((sessionKey) => ({
    id: sessionKey.keyId,
    title: sessionKey.name || "Unnamed Key",
    maskedValue: `compose-${sessionKey.keyId.slice(0, 8)}***`,
    summaryRows: [
      {
        label: "Budget",
        value: `$${(sessionKey.budgetRemaining / 1_000_000).toFixed(2)} / $${(sessionKey.budgetLimit / 1_000_000).toFixed(2)}`,
      },
      {
        label: "Expires",
        value: formatTimeRemaining(sessionKey.expiresAt),
      },
    ],
    copyIcon: <Copy size={14} />,
    copiedIcon: <Check size={14} />,
    revokeIcon: <Trash2 size={14} />,
    copied: copiedKeyId === sessionKey.keyId,
    onCopy: () => void handleCopyKey(sessionKey.keyId),
    onRevoke: () => void handleRevoke(sessionKey.keyId),
  }));

  return (
    <>
      <SessionManageDialogShell
        open={open}
        title="Manage Sessions"
        subtitle="View and manage your active API sessions and keys."
        titleIcon={<Wallet size={18} />}
        currentSessionTitle="Current Session"
        currentSessionIcon={<Zap size={14} />}
        currentSessionRows={session.isActive ? [
          {
            label: "Remaining",
            value: `$${(session.budgetRemaining / 1_000_000).toFixed(2)}`,
          },
          {
            label: "Expires",
            value: session.expiresAt ? formatTimeRemaining(session.expiresAt) : "Never",
          },
        ] : []}
        sectionLabel="API Keys"
        newKeyLabel="New Key"
        newKeyIcon={<Plus size={14} />}
        loading={loading}
        keys={keys}
        emptyState={{
          title: "No API keys created yet.",
          actionLabel: "Generate your first key",
          onAction: () => setCreateDialogOpen(true),
        }}
        onClose={() => onOpenChange(false)}
        onCreateKey={() => setCreateDialogOpen(true)}
      />
      <ComposeKeyDialog
        open={createDialogOpen}
        onOpenChange={(nextOpen) => {
          setCreateDialogOpen(nextOpen);
          if (!nextOpen) {
            void fetchSessions();
          }
        }}
      />
    </>
  );
}

function ComposeKeyDialog({ open, onOpenChange }: ComposeKeyDialogProps) {
  const { session, ensureComposeKeyToken } = useSession();
  const { account } = useWalletAccount();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState("Cursor");

  const handleGenerate = async () => {
    if (!account?.address || !session.isActive) {
      return;
    }

    setIsGenerating(true);
    try {
      const composeKeyToken = await ensureComposeKeyToken();
      if (!composeKeyToken) {
        throw new Error("Compose Key token unavailable");
      }

      // Preserve the caller's session token: sdk.keys.create stores the newly
      // minted API-key token as the SDK's "current" token, which would
      // silently swap the active session for an API key. Re-assert the
      // session token after creation so downstream calls keep using it.
      const previousToken = sdk.keys.currentToken();

      const created = await sdk.keys.create({
        purpose: "api",
        budgetWei: session.budgetRemaining,
        expiresAt: session.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
        chainId: session.chainId ?? undefined,
        name: keyName,
      });

      if (previousToken && previousToken !== created.token) {
        sdk.keys.use(previousToken);
      }

      setGeneratedKey(created.token);
      toast.success("API Key generated!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate API key";
      console.error(error);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) {
      return;
    }

    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    toast.success("Copied to clipboard!");
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setGeneratedKey(null);
      setCopied(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <ComposeKeyDialogShell
      open={open}
      title="Generate API Key"
      subtitle="Create a key for external tools like Cursor or OpenClaw. Uses your current session budget."
      titleIcon={<Key size={18} />}
      keyName={keyName}
      keyNameLabel="Key Name"
      keyNamePlaceholder="e.g., Cursor, OpenCode"
      onKeyNameChange={setKeyName}
      summaryRows={[
        {
          label: "Budget",
          value: `$${(session.budgetRemaining / 1_000_000).toFixed(2)} USDC`,
        },
        {
          label: "Expires",
          value: session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "Never",
        },
      ]}
      generatedKey={generatedKey}
      warning="Save this key now. You won't be able to see it again."
      usageLabel="Usage"
      usageValue={generatedKey ? `Authorization: Bearer ${generatedKey.slice(0, 20)}...` : undefined}
      onClose={() => handleClose(false)}
      onGenerate={() => void handleGenerate()}
      generating={isGenerating}
      generateLabel="Generate Key"
      generatingLabel="Generating..."
      onCopy={() => void handleCopy()}
      copied={copied}
      copyLabel="Copy to Clipboard"
      copiedLabel="Copied!"
      copyIcon={<Copy size={14} />}
      copiedIcon={<Check size={14} />}
    />
  );
}
