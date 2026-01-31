"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/hooks/use-session.tsx";
import { useWalletAccount } from "@/components/connector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Zap, Clock, Wallet, Shield, X, Key, Copy, Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

/**
 * Compose Key Record from backend API
 */
interface ComposeKeyRecord {
  keyId: string;
  budgetLimit: number;
  budgetUsed: number;
  budgetRemaining: number;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
  name?: string;
  lastUsedAt?: number;
}

/**
 * Format remaining time as human-readable string
 */
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

/**
 * Session Budget Setup Dialog
 * Allows users to set a spending limit for signature-free AI inference
 * Supports both controlled (open/onOpenChange) and uncontrolled modes
 */
interface SessionBudgetDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export function SessionBudgetDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
}: SessionBudgetDialogProps = {}) {
  const { isConnected } = useWalletAccount();
  const { session, isCreating, error, createSession, budgetPresets } = useSession();
  const [selectedBudget, setSelectedBudget] = useState<number>(budgetPresets[1].value);
  const [duration, setDuration] = useState(24); // Default 24 hours
  const [internalOpen, setInternalOpen] = useState(false);

  // Support both controlled and uncontrolled modes
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange || (() => { })) : setInternalOpen;

  if (!isConnected) return null;

  const handleCreate = async () => {
    const budgetUSDC = selectedBudget / 1_000_000;
    const success = await createSession(budgetUSDC, duration);
    if (success) {
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="border-cyan-500/30 bg-cyan-500/5 text-cyan-400 hover:bg-cyan-500/10 font-mono"
          >
            <Zap className="w-4 h-4 mr-2" />
            {session.isActive ? "Session Active" : "Start Session"}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="bg-card border-sidebar-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-cyan-400 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Session Budget
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Set a spending limit to skip wallet signatures for each AI call.
            One approval, unlimited inference within your budget.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Budget Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground font-mono">
              Budget Limit (USDC)
            </label>
            <div className="grid grid-cols-5 gap-2">
              {budgetPresets.map((preset) => (
                <Button
                  key={preset.value}
                  variant={selectedBudget === preset.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedBudget(preset.value)}
                  className={
                    selectedBudget === preset.value
                      ? "bg-cyan-500 text-black font-mono"
                      : "border-sidebar-border hover:border-cyan-500/50 font-mono"
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Duration Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2 font-mono">
              <Clock className="w-4 h-4" />
              Session Duration
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 6, 12, 24].map((hours) => (
                <Button
                  key={hours}
                  variant={duration === hours ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDuration(hours)}
                  className={
                    duration === hours
                      ? "bg-cyan-500 text-black font-mono"
                      : "border-sidebar-border hover:border-cyan-500/50 font-mono"
                  }
                >
                  {hours}h
                </Button>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-sidebar-accent rounded-sm p-4 space-y-2 border border-sidebar-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-mono">Max Spend</span>
              <span className="font-mono text-cyan-400">
                ${(selectedBudget / 1_000_000).toFixed(2)} USDC
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-mono">Expires After</span>
              <span className="font-mono text-foreground">{duration} hours</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-mono">Approvals Required</span>
              <span className="font-mono text-fuchsia-400">1 (now)</span>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-sm p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            onClick={handleCreate}
            disabled={isCreating}
            className="w-full bg-cyan-500 text-black hover:bg-cyan-400 font-mono font-bold"
          >
            {isCreating ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin mr-2" />
                Creating Session...
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4 mr-2" />
                Approve & Start Session
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Session Status Card
 * Shows current session budget usage and controls
 */
export function SessionStatusCard() {
  const { session, endSession } = useSession();

  if (!session.isActive) return null;

  const usagePercent = (session.budgetUsed / session.budgetLimit) * 100;
  const remainingUSDC = session.budgetRemaining / 1_000_000;
  const totalUSDC = session.budgetLimit / 1_000_000;

  const timeRemaining = session.expiresAt
    ? Math.max(0, session.expiresAt - Date.now())
    : 0;
  const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60));
  const minutesRemaining = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));

  return (
    <Card className="glass-panel border-cyan-500/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Fast Mode Active
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={endSession}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <CardDescription className="text-xs font-mono">
          No signatures needed • {hoursRemaining}h {minutesRemaining}m remaining
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-muted-foreground">Budget Used</span>
            <span>
              ${(session.budgetUsed / 1_000_000).toFixed(4)} / ${totalUSDC.toFixed(2)}
            </span>
          </div>
          <Progress value={usagePercent} className="h-2" />
        </div>
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400 font-mono">
            ${remainingUSDC.toFixed(4)} remaining
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Inline session indicator for TopBar
 */
export function SessionIndicator() {
  const { session } = useSession();
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  if (!session.isActive) {
    return <SessionBudgetDialog />;
  }

  const remainingUSDC = session.budgetRemaining / 1_000_000;
  const timeRemaining = session.expiresAt ? formatTimeRemaining(session.expiresAt) : "";

  return (
    <div className="flex items-center gap-1 md:gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="border-cyan-500/30 bg-cyan-500/5 text-cyan-400 hover:bg-cyan-500/10 font-mono h-8 px-2 md:px-3"
          >
            <Zap className="w-4 h-4 md:mr-2" />
            {/* Desktop: show "Session" text, Mobile: show budget */}
            <span className="hidden md:inline">Session</span>
            <span className="md:hidden text-xs">${remainingUSDC.toFixed(0)}</span>
            <ChevronDown className="w-3 h-3 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* Session status header - always visible */}
          <div className="px-2 py-2 border-b border-sidebar-border mb-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-mono">Budget</span>
              <span className="text-cyan-400 font-mono font-medium">${remainingUSDC.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted-foreground font-mono">Expires</span>
              <span className="text-foreground font-mono">{timeRemaining}</span>
            </div>
          </div>
          <DropdownMenuItem onClick={() => setKeyDialogOpen(true)}>
            <Key className="w-4 h-4 mr-2" />
            Generate API Key
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setManageDialogOpen(true)}>
            <Wallet className="w-4 h-4 mr-2" />
            Manage Sessions
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ComposeKeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} />
      <SessionManageDialog open={manageDialogOpen} onOpenChange={setManageDialogOpen} />
    </div>
  );
}

/**
 * Session Management Dialog
 * Shows all active sessions/keys with ability to create new or revoke
 */
interface SessionManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SessionManageDialog({ open, onOpenChange }: SessionManageDialogProps) {
  const { account } = useWalletAccount();
  const { session } = useSession();
  const [sessions, setSessions] = useState<ComposeKeyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Fetch sessions when dialog opens
  const fetchSessions = useCallback(async () => {
    if (!account?.address) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/keys`, {
        headers: {
          "x-session-user-address": account.address,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Filter out expired and revoked sessions
        const activeSessions = (data.keys || []).filter(
          (k: ComposeKeyRecord) => !k.revokedAt && k.expiresAt > Date.now()
        );
        setSessions(activeSessions);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    if (open) {
      fetchSessions();
    }
  }, [open, fetchSessions]);

  const handleRevoke = async (keyId: string) => {
    if (!account?.address) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/keys/${keyId}`, {
        method: "DELETE",
        headers: {
          "x-session-user-address": account.address,
        },
      });

      if (response.ok) {
        toast.success("Session revoked");
        fetchSessions();
      } else {
        toast.error("Failed to revoke session");
      }
    } catch (err) {
      toast.error("Failed to revoke session");
      console.error(err);
    }
  };

  const handleCopyKey = async (keyId: string) => {
    // We can only show masked key since we don't store the actual token
    const maskedKey = `compose-${keyId.slice(0, 8)}***`;
    await navigator.clipboard.writeText(maskedKey);
    setCopiedKeyId(keyId);
    toast.success("Key ID copied to clipboard");
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const handleCreateClose = (open: boolean) => {
    setCreateDialogOpen(open);
    if (!open) {
      // Refresh sessions after creating a new one
      fetchSessions();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-card border-sidebar-border max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-cyan-400 flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Manage Sessions
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              View and manage your active API sessions and keys.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current Session Info */}
            {session.isActive && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-sm p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-medium text-cyan-400 font-mono">Current Session</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Remaining</span>
                    <p className="font-mono text-foreground">${(session.budgetRemaining / 1_000_000).toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expires</span>
                    <p className="font-mono text-foreground">
                      {session.expiresAt ? formatTimeRemaining(session.expiresAt) : "Never"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Sessions/Keys List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground font-mono">API Keys</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreateDialogOpen(true)}
                  className="h-7 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New Key
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No API keys created yet.
                  <br />
                  <button
                    onClick={() => setCreateDialogOpen(true)}
                    className="text-cyan-400 hover:underline mt-1"
                  >
                    Generate your first key
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.keyId}
                      className="bg-sidebar-accent border border-sidebar-border rounded-sm p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm text-foreground truncate">
                          {s.name || "Unnamed Key"}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCopyKey(s.keyId)}
                            className="p-1 text-muted-foreground hover:text-cyan-400 transition-colors"
                            title="Copy key ID"
                          >
                            {copiedKeyId === s.keyId ? (
                              <Check className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleRevoke(s.keyId)}
                            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                            title="Revoke key"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">compose-{s.keyId.slice(0, 8)}***</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Budget</span>
                          <p className="font-mono text-cyan-400">
                            ${(s.budgetRemaining / 1_000_000).toFixed(2)} / ${(s.budgetLimit / 1_000_000).toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Expires</span>
                          <p className="font-mono text-foreground">{formatTimeRemaining(s.expiresAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Key Dialog (reusing existing) */}
      <ComposeKeyDialog open={createDialogOpen} onOpenChange={handleCreateClose} />
    </>
  );
}

/**
 * Compose Key Generation Dialog
 * Allows users to generate API keys for external tools (Cursor, VSCode)
 */
interface ComposeKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ComposeKeyDialog({ open, onOpenChange }: ComposeKeyDialogProps) {
  const { session } = useSession();
  const { account } = useWalletAccount();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState("Cursor");

  const handleGenerate = async () => {
    if (!account?.address || !session.isActive) return;

    setIsGenerating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-user-address": account.address,
          "x-session-active": "true",
          "x-session-budget-remaining": String(session.budgetRemaining),
        },
        body: JSON.stringify({
          budgetLimit: session.budgetRemaining, // Use remaining session budget
          expiresAt: session.expiresAt,
          name: keyName,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.error || "Failed to generate key");
        return;
      }

      const data = await response.json();
      setGeneratedKey(data.token);
      toast.success("API Key generated!");
    } catch (err) {
      toast.error("Failed to generate API key");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setGeneratedKey(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-sidebar-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-fuchsia-400 flex items-center gap-2">
            <Key className="w-5 h-5" />
            Generate API Key
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a key for external tools like Cursor or VSCode.
            Uses your current session budget.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!generatedKey ? (
            <>
              {/* Key Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground font-mono">
                  Key Name
                </label>
                <input
                  type="text"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="e.g., Cursor, VSCode"
                  className="w-full px-3 py-2 bg-sidebar-accent border border-sidebar-border rounded-sm font-mono text-sm focus:border-fuchsia-500 focus:outline-none"
                />
              </div>

              {/* Info Box */}
              <div className="bg-sidebar-accent rounded-sm p-4 space-y-2 border border-sidebar-border">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-mono">Budget</span>
                  <span className="font-mono text-fuchsia-400">
                    ${(session.budgetRemaining / 1_000_000).toFixed(2)} USDC
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-mono">Expires</span>
                  <span className="font-mono text-foreground">
                    {session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "Never"}
                  </span>
                </div>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full bg-fuchsia-500 text-white hover:bg-fuchsia-400 font-mono font-bold"
              >
                {isGenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4 mr-2" />
                    Generate Key
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              {/* Generated Key Display */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground font-mono">
                  Your API Key
                </label>
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={generatedKey}
                    className="w-full px-3 py-2 pr-10 bg-sidebar-accent border border-fuchsia-500/50 rounded-sm font-mono text-xs focus:outline-none"
                  />
                  <button
                    onClick={handleCopy}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-fuchsia-400 transition-colors"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-sm p-3 text-sm text-amber-400">
                ⚠️ Save this key now. You won't be able to see it again!
              </div>

              {/* Usage Instructions */}
              <div className="bg-sidebar-accent rounded-sm p-4 space-y-2 border border-sidebar-border">
                <p className="text-sm text-muted-foreground font-mono">
                  Use in Cursor/VSCode settings:
                </p>
                <code className="block text-xs bg-black/50 p-2 rounded font-mono text-fuchsia-400 break-all">
                  Authorization: Bearer {generatedKey.slice(0, 20)}...
                </code>
              </div>

              <Button
                onClick={handleCopy}
                className="w-full bg-fuchsia-500 text-white hover:bg-fuchsia-400 font-mono font-bold"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy to Clipboard
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
