/**
 * Dispenser UI for newcomers to claim 1 USDC across supported chains.
 *
 * @module components/dispenser
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  useDispenserStatus,
  useDispenserCheck,
  useDispenserClaim,
} from "@/hooks/use-dispenser";
import type { NetworkId } from "@compose-market/sdk/chains";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Droplets,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Coins,
  ChevronDown,
} from "lucide-react";

export interface DispenserButtonProps {
  inline?: boolean;
}

export function DispenserButton({ inline = false }: DispenserButtonProps) {
  const account = useActiveAccount();
  const address = account?.address;

  const { data: checkResult, isLoading } = useDispenserCheck(address);
  const claimMutation = useDispenserClaim();
  const { data: dispenserStatus } = useDispenserStatus();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedChain, setSelectedChain] = useState<NetworkId | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inline || !isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [inline, isOpen]);

  const handleClaim = async (network: NetworkId) => {
    if (!address) {
      toast({
        title: "Wallet required",
        description: "Connect your account before claiming USDC.",
        variant: "destructive",
      });
      return;
    }

    setSelectedChain(network);
    try {
      const result = await claimMutation.mutateAsync({ address, network });
      if (result.success) {
        toast({
          title: "Claimed 1 USDC",
          description: "Dispenser transfer confirmed.",
        });
        setIsOpen(false);
      } else if (result.alreadyClaimed) {
        toast({
          title: "Already claimed",
          description: "Each address can claim once across all chains.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Claim failed",
          description: result.error || "Unable to complete dispenser claim.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Claim failed",
        description: error instanceof Error ? error.message : "Unable to complete dispenser claim.",
        variant: "destructive",
      });
    } finally {
      setSelectedChain(null);
    }
  };

  const hasClaimed = checkResult?.hasClaimed;
  const availableDispensers = dispenserStatus?.dispensers.filter((dispenser) =>
    BigInt(dispenser.dispenserBalance || "0") > 0n &&
    dispenser.remainingClaims > 0 &&
    !dispenser.isPaused &&
    dispenser.isConfigured,
  ) || [];
  const allConfigured = dispenserStatus?.dispensers?.filter((dispenser) => dispenser.isConfigured) || [];
  const needsFunding = allConfigured.length > 0 && availableDispensers.length === 0;

  const content = (
    <div className="space-y-1">
      {!address ? (
        <div className="p-2 text-center text-xs text-muted-foreground">
          <Coins className="w-6 h-6 mx-auto mb-1.5 text-cyan-400/60" />
          Connect your account to claim 1 USDC.
        </div>
      ) : isLoading ? (
        <div className="p-2 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
        </div>
      ) : hasClaimed ? (
        <div className="p-2 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-cyan-400" />
          <span>Claimed on {checkResult?.claimedOnNetworkName || "supported chain"}</span>
        </div>
      ) : needsFunding ? (
        <div className="p-2 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>Dispensers are refilling.</span>
        </div>
      ) : availableDispensers.length === 0 ? (
        <div className="p-2 text-xs text-muted-foreground">
          No dispensers available
        </div>
      ) : (
        availableDispensers.map((dispenser) => (
          <Button
            key={dispenser.network}
            variant="ghost"
            size="sm"
            onClick={() => void handleClaim(dispenser.network)}
            disabled={claimMutation.isPending || selectedChain !== null}
            className="w-full justify-start gap-2 hover:bg-cyan-500/10"
          >
            {selectedChain === dispenser.network ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Droplets className="w-4 h-4 text-cyan-400" />
            )}
            <span className="flex-1 text-left">{dispenser.networkName}</span>
            <span className="text-xs text-muted-foreground">
              {dispenser.remainingClaims} left
            </span>
          </Button>
        ))
      )}
    </div>
  );

  if (inline) {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center justify-between gap-3 w-full py-1 text-left text-xs font-mono text-foreground hover:text-cyan-300 transition-colors"
          aria-expanded={isOpen}
        >
          <span className="inline-flex items-center gap-2">
            <Droplets className="w-3.5 h-3.5 text-cyan-400" />
            <span>{hasClaimed ? "USDC Claimed" : "Claim 1 USDC"}</span>
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen ? (
          <div className="rounded-md border border-primary/15 bg-background/50 p-1.5">
            {content}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cm-app-chrome__hud-fold" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="cm-hud-button"
        aria-label={hasClaimed ? "USDC claimed" : "Claim 1 USDC"}
        aria-expanded={isOpen}
      >
        <Droplets className="cm-hud-icon" size={16} />
        {!hasClaimed && availableDispensers.length > 0 ? (
          <span className="cm-hud-value">1 USDC</span>
        ) : null}
        {hasClaimed ? <span className="cm-hud-status" data-state="muted" aria-hidden="true" /> : null}
      </button>

      {isOpen ? (
        <div className="cm-app-chrome__hud-popover">
          <div className="p-3 border-b border-cyan-400/15">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Droplets className="w-4 h-4 text-cyan-400" />
              Claim 1 USDC
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              {!address
                ? "Connect account to claim"
                : "One claim per address across all chains"}
            </p>
          </div>

          <div className="p-2">
            {content}
          </div>
        </div>
      ) : null}
    </div>
  );
}
