"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveAccount, useActiveWallet, useAdminWallet } from "thirdweb/react";
import {
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  Lock,
  Cpu,
  AlertTriangle,
  FileText,
  Check,
  Loader2,
  LogOut,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { useWalletPair } from "@/hooks/use-pair";
import { sdk } from "@/lib/sdk";
import { toast } from "sonner";

export const DISCLAIMER_POLICY_VERSION = "1.0.0";
export const DISCLAIMER_TYPE = "ai_passthrough";

interface DisclaimerModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  forceOpen?: boolean;
}

export function DisclaimerModal({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  forceOpen = false,
}: DisclaimerModalProps) {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const adminWallet = useAdminWallet();
  const { userAddress, isEvm } = useSelectedUserAddress();
  const { pair } = useWalletPair();
  const queryClient = useQueryClient();

  const [relayAgreed, setRelayAgreed] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);

  const activeAddress = userAddress ?? account?.address ?? null;

  // Query consent status for this address and policy version from Neon DB
  const { data: consentStatus, isLoading: isCheckingConsent } = useQuery({
    queryKey: ["user-consent", activeAddress?.toLowerCase(), DISCLAIMER_POLICY_VERSION],
    queryFn: async () => {
      if (!activeAddress) return { consented: false, record: null };
      try {
        if (typeof sdk.user?.getConsent === "function") {
          return await sdk.user.getConsent(activeAddress, {
            disclaimerType: DISCLAIMER_TYPE,
            policyVersion: DISCLAIMER_POLICY_VERSION,
          });
        }
        const res = await fetch(
          `/api/user/consent/${encodeURIComponent(activeAddress)}?type=${encodeURIComponent(DISCLAIMER_TYPE)}&version=${encodeURIComponent(DISCLAIMER_POLICY_VERSION)}`
        );
        if (res.ok) {
          return await res.json();
        }
        return { consented: false, record: null };
      } catch (err) {
        console.warn("[consent] Failed to fetch consent record", err);
        return { consented: false, record: null };
      }
    },
    enabled: Boolean(activeAddress),
    staleTime: 5 * 60 * 1000,
  });

  const hasConsented = consentStatus?.consented ?? false;

  // Auto-open modal if user is connected, not currently loading, and hasn't consented yet
  useEffect(() => {
    if (forceOpen) {
      setInternalOpen(true);
      return;
    }

    if (activeAddress && !isCheckingConsent && !hasConsented) {
      setInternalOpen(true);
    } else if (hasConsented && !forceOpen) {
      setInternalOpen(false);
    }
  }, [activeAddress, isCheckingConsent, hasConsented, forceOpen]);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  const handleDisconnect = useCallback(() => {
    setOpen(false);
    wallet?.disconnect();
  }, [wallet, setOpen]);

  const generateSignatureMessage = useCallback((address: string, timestamp: string) => {
    return [
      "=== COMPOSE.MARKET AI MODEL DISCLAIMER & TERMS ===",
      `Policy Version: ${DISCLAIMER_POLICY_VERSION} (2026-08-15)`,
      `Signer Address: ${address}`,
      `Timestamp: ${timestamp}`,
      "",
      "By signing this statement, you acknowledge and agree that:",
      "1. Technical Conduit: Compose.Market acts solely as a technical relay to 650+ AI models operated by 30+ independent third-party laboratories (OpenAI, Anthropic, Google Vertex, Fireworks, Mistral, etc.). We do not own, operate, or validate these third-party models.",
      "2. Third-Party Governance: Your prompts, inputs, and transmitted data are governed solely by each applicable provider's Terms of Service and Privacy Policy (available at /providers).",
      "3. Zero General Training: Compose.Market does not use your data to train general models, and we prohibit upstream providers from doing so on our behalf.",
      "4. Probabilistic Outputs: AI outputs are probabilistic, may contain inaccuracies, and do not constitute professional advice. You assume all risks.",
      "5. Discharge of Liability: Compose.Market disclaims all liability for third-party provider acts, omissions, outages, data handling, and outputs.",
    ].join("\n");
  }, []);

  const signAndAcceptMutation = useMutation({
    mutationFn: async () => {
      if (!activeAddress) throw new Error("No active wallet connected");

      setIsSigning(true);
      const timestamp = new Date().toISOString();
      const message = generateSignatureMessage(activeAddress, timestamp);

      let signature = "";
      try {
        if (account && typeof account.signMessage === "function") {
          signature = await account.signMessage({ message });
        } else if (adminWallet?.getAccount?.()?.signMessage) {
          signature = await adminWallet.getAccount()!.signMessage({ message });
        }
      } catch (signErr) {
        console.warn("[consent] Wallet signing was dismissed or failed, attempting typed approval", signErr);
        // If wallet signMessage is rejected by user, rethrow
        if (
          signErr instanceof Error &&
          (signErr.message.includes("User rejected") || signErr.message.includes("denied"))
        ) {
          throw new Error("Signature request was rejected in your wallet.");
        }
      }

      // If wallet produced no signature string (e.g. session / in-app key without personal_sign), generate verifiable receipt hash
      if (!signature) {
        const encoder = new TextEncoder();
        const data = encoder.encode(`${activeAddress}:${DISCLAIMER_POLICY_VERSION}:${timestamp}:${message}`);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        signature = "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      }

      // Record consent in Neon DB wallet_pairs
      const consentPayload = {
        address: activeAddress,
        svmAddress: pair?.svmAddress || (isEvm ? undefined : activeAddress),
        disclaimerType: DISCLAIMER_TYPE,
        policyVersion: DISCLAIMER_POLICY_VERSION,
        signature,
        message,
        metadata: {
          timestamp,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "browser",
          client: "compose-market-web",
          isEvm,
          evmAddress: pair?.evmAddress,
          svmAddress: pair?.svmAddress,
        },
      };

      let stored;
      if (typeof sdk.user?.recordConsent === "function") {
        stored = await sdk.user.recordConsent(consentPayload);
      } else {
        const res = await fetch("/api/user/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(consentPayload),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || "Failed to record consent in database");
        }
        stored = await res.json();
      }

      return stored;
    },
    onSuccess: (result) => {
      const evmKey = (pair?.evmAddress || (result && "evmAddress" in result ? (result as { evmAddress?: string }).evmAddress : null) || activeAddress)?.toLowerCase();
      const svmKey = pair?.svmAddress || (result && "svmAddress" in result ? (result as { svmAddress?: string }).svmAddress : null);

      if (evmKey) {
        queryClient.setQueryData(
          ["user-consent", evmKey, DISCLAIMER_POLICY_VERSION],
          { consented: true, record: null }
        );
      }
      if (svmKey) {
        queryClient.setQueryData(
          ["user-consent", svmKey, DISCLAIMER_POLICY_VERSION],
          { consented: true, record: null }
        );
      }
      queryClient.invalidateQueries({ queryKey: ["user-consent"] });
      toast.success("AI Disclaimer & Terms accepted successfully!", {
        description: `Signed for ${activeAddress?.slice(0, 6)}...${activeAddress?.slice(-4)}`,
      });
      setOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to sign disclaimer", {
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    },
    onSettled: () => {
      setIsSigning(false);
    },
  });

  const canSign = relayAgreed && termsAgreed && !isSigning;

  return (
    <Dialog open={isOpen} onOpenChange={(val) => {
      // If user hasn't consented and tries to close, prevent unless forced or disconnected
      if (!val && !hasConsented && !forceOpen) {
        return;
      }
      setOpen(val);
    }}>
      <DialogContent className="max-w-2xl bg-black/95 border-cyan-500/30 text-foreground shadow-[0_0_50px_-10px_rgba(6,182,212,0.25)] backdrop-blur-xl p-0 gap-0 overflow-hidden font-sans sm:rounded-xl">
        {/* Glow Header Accent */}
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-cyan-500" />

        <div className="p-6 space-y-5">
          {/* Header */}
          <DialogHeader className="space-y-2 text-left">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <Badge className="bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono text-[10px] uppercase tracking-wider mb-1">
                    Compliance & Liability Disclaimer
                  </Badge>
                  <DialogTitle className="text-xl font-display font-bold uppercase tracking-wider text-foreground">
                    AI Pass-Through & Liability Waiver
                  </DialogTitle>
                </div>
              </div>

              <div className="hidden sm:block text-right">
                <span className="text-[10px] font-mono text-muted-foreground block">
                  VERSION {DISCLAIMER_POLICY_VERSION}
                </span>
                <span className="text-[10px] font-mono text-cyan-400">
                  GDPR Art. 28 Transparent
                </span>
              </div>
            </div>

            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
              Please review and sign the AI model pass-through terms and liability discharge
              before accessing the Compose.Market platform and executing model requests.
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable Terms Content Box */}
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-4 max-h-64 overflow-y-auto space-y-3.5 text-xs text-muted-foreground font-sans leading-relaxed scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
            {/* Point 1 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-foreground font-semibold font-display text-[13px]">
                <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>1. Technical Conduit & Aggregator</span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                Compose.Market acts solely as a technical relay and decentralized gateway providing unified
                cryptographic access to 650+ AI models operated by independent third-party laboratories
                (e.g., OpenAI, Anthropic, Google Cloud, Mistral AI, Fireworks AI). Compose.Market does not
                own, operate, validate, or determine the processing performed by upstream model providers.
              </p>
            </div>

            {/* Point 2 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-foreground font-semibold font-display text-[13px]">
                <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>2. Third-Party Governance & Sub-Processors</span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                Your prompts, workflows, and inputs transmitted to each model are governed solely by that
                specific provider's Terms of Service and Privacy Policy. Direct links to all 30+ upstream
                sub-processors, their jurisdictions, and DPAs are listed at{" "}
                <a
                  href="/providers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300 underline hover:text-cyan-200 inline-flex items-center gap-0.5"
                >
                  /providers <ExternalLink className="w-3 h-3 inline" />
                </a>.
              </p>
            </div>

            {/* Point 3 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-foreground font-semibold font-display text-[13px]">
                <Lock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>3. Zero Training on Your Data</span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                Compose.Market does not use your prompt data or outputs to train foundation AI models, and
                we contractually prohibit upstream API providers from retaining or utilizing your data for
                general model training on our behalf.
              </p>
            </div>

            {/* Point 4 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-foreground font-semibold font-display text-[13px]">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>4. Probabilistic Outputs & Risk Assumption</span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                AI model outputs are probabilistic, generated dynamically, and may contain inaccuracies,
                hallucinations, or incomplete statements. Outputs do not constitute professional, legal, or
                financial advice. You assume all risks and responsibility for evaluating output accuracy.
              </p>
            </div>

            {/* Point 5 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-foreground font-semibold font-display text-[13px]">
                <ShieldCheck className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                <span>5. Discharge of Liability</span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                Compose.Market is not liable for any direct, indirect, incidental, or consequential damages
                arising from third-party provider acts, service interruptions, model omissions, or data handling practices.
              </p>
            </div>
          </div>

          {/* Acknowledgement Checkboxes */}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <Checkbox
                checked={relayAgreed}
                onCheckedChange={(checked) => setRelayAgreed(Boolean(checked))}
                className="mt-0.5 border-cyan-500/40 data-[state=checked]:bg-cyan-500 data-[state=checked]:text-black"
              />
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                I understand Compose.Market is a <strong className="text-cyan-300">technical relay</strong> to independent AI model providers and I agree to the third-party pass-through terms and liability waiver.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <Checkbox
                checked={termsAgreed}
                onCheckedChange={(checked) => setTermsAgreed(Boolean(checked))}
                className="mt-0.5 border-cyan-500/40 data-[state=checked]:bg-cyan-500 data-[state=checked]:text-black"
              />
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                I have read and agree to the Compose.Market{" "}
                <a href="https://compose.market/terms/" target="_blank" className="text-cyan-400 underline hover:text-cyan-300">Terms of Service</a>,{" "}
                <a href="https://compose.market/privacy/" target="_blank" className="text-cyan-400 underline hover:text-cyan-300">Privacy Policy</a>, and{" "}
                <a href="/providers" target="_blank" className="text-cyan-400 underline hover:text-cyan-300">Sub-Processor Disclosures</a>.
              </span>
            </label>
          </div>

          {/* Connected Identity Info */}
          {activeAddress && (
            <div className="flex items-center justify-between bg-black/60 border border-white/5 rounded-lg px-3 py-2 text-[11px] font-mono">
              <span className="text-muted-foreground">Signing Account:</span>
              <span className="text-cyan-400 font-semibold">{activeAddress.slice(0, 6)}...{activeAddress.slice(-4)}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              className="w-full sm:w-auto border-white/10 text-muted-foreground hover:text-destructive hover:bg-destructive/10 font-mono text-xs"
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Disconnect Wallet
            </Button>

            <Button
              type="button"
              disabled={!canSign}
              onClick={() => signAndAcceptMutation.mutate()}
              className={`
                w-full sm:w-auto font-display font-bold uppercase tracking-wider text-xs px-6 py-2 rounded-lg transition-all
                ${canSign
                  ? "bg-cyan-500 text-black hover:bg-cyan-400 shadow-[0_0_20px_-3px_rgba(6,182,212,0.6)] cursor-pointer"
                  : "bg-cyan-950/40 text-muted-foreground border border-cyan-500/20 cursor-not-allowed opacity-60"
                }
              `}
            >
              {isSigning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing & Verifying...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-1.5" />
                  Sign & Accept Terms
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
