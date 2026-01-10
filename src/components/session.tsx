"use client";

import { useState } from "react";
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
import { Zap, Clock, Wallet, Shield, X, Key, Copy, Check, ChevronDown } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

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
  const [selectedBudget, setSelectedBudget] = useState(budgetPresets[1].value); // Default $5
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
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);

  if (!session.isActive) {
    return <SessionBudgetDialog />;
  }

  const remainingUSDC = session.budgetRemaining / 1_000_000;

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        className="border-cyan-500/50 bg-cyan-500/10 text-cyan-400 font-mono text-xs"
      >
        <Zap className="w-3 h-3 mr-1" />
        ${remainingUSDC.toFixed(2)}
      </Badge>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="border-cyan-500/30 bg-cyan-500/5 text-cyan-400 hover:bg-cyan-500/10 font-mono"
          >
            <Zap className="w-4 h-4 mr-2" />
            Session
            <ChevronDown className="w-3 h-3 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setKeyDialogOpen(true)}>
            <Key className="w-4 h-4 mr-2" />
            Generate API Key
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setBudgetDialogOpen(true)}>
            <Wallet className="w-4 h-4 mr-2" />
            Manage Session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ComposeKeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} />
      <SessionBudgetDialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen} showTrigger={false} />
    </div>
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
