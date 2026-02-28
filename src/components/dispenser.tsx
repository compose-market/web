/**
 * Dispenser Component
 *
 * Dispenser UI for newcomers to claim 1 USDC.
 * Features:
 * - Multi-chain support (Avalanche, Cronos, Arbitrum)
 * - Global claim tracking (one claim per address across all chains)
 * - Real-time status updates
 * - Transaction confirmation display
 *
 * @module components/dispenser
 */

"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
    useDispenserStatus,
    useDispenserCheck,
    useDispenserClaim,
    getExplorerTxUrl,
    getChainColor,
} from "@/hooks/use-dispenser";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
    Droplets,
    CheckCircle2,
    XCircle,
    ExternalLink,
    AlertCircle,
    Loader2,
    Coins,
} from "lucide-react";

// =============================================================================
// Dispenser Card Component
// =============================================================================

export function DispenserCard() {
    const account = useActiveAccount();
    const address = account?.address;

    const { data: dispenserStatus, isLoading: statusLoading, error: statusError } = useDispenserStatus();
    const { data: checkResult, isLoading: checkLoading } = useDispenserCheck(address);
    const claimMutation = useDispenserClaim();

    const [selectedChain, setSelectedChain] = useState<number | null>(null);

    const handleClaim = async (chainId: number) => {
        if (!address) {
            toast.error("Please connect first");
            return;
        }

        setSelectedChain(chainId);

        try {
            const result = await claimMutation.mutateAsync({ address, chainId });

            if (result.success) {
                toast.success("Successfully claimed 1 USDC!", {
                    description: `Transaction: ${result.txHash?.slice(0, 10)}...${result.txHash?.slice(-8)}`,
                    action: result.txHash
                        ? {
                            label: "View",
                            onClick: () => window.open(getExplorerTxUrl(result.txHash!, chainId), "_blank"),
                        }
                        : undefined,
                });
            } else if (result.alreadyClaimed) {
                toast.error("Already claimed", {
                    description: `You already claimed on ${result.globalClaimStatus?.claimedOnChainName || "another chain"}`,
                });
            } else {
                toast.error("Failed to claim", {
                    description: result.error || "Unknown error occurred",
                });
            }
        } catch (error) {
            toast.error("Failed to claim", {
                description: error instanceof Error ? error.message : "Unknown error",
            });
        } finally {
            setSelectedChain(null);
        }
    };

    const isConnected = !!address;
    const hasClaimed = checkResult?.hasClaimed;

    const sortedDispensers = useMemo(() => {
        if (!dispenserStatus?.dispensers) return [];
        return [...dispenserStatus.dispensers].sort((a, b) => {
            if (a.remainingClaims > 0 && b.remainingClaims === 0) return -1;
            if (a.remainingClaims === 0 && b.remainingClaims > 0) return 1;
            return b.remainingClaims - a.remainingClaims;
        });
    }, [dispenserStatus?.dispensers]);

    if (statusLoading) {
        return (
            <Card className="border-cyan-500/20 bg-sidebar/50 backdrop-blur-sm">
                <CardContent className="flex items-center justify-center py-12">
                    <Spinner className="size-8 text-cyan-400" />
                </CardContent>
            </Card>
        );
    }

    if (statusError) {
        return (
            <Card className="border-red-500/20 bg-sidebar/50 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-400">
                        <AlertCircle className="w-5 h-5" />
                        Dispenser Error
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Failed to load dispenser status. Please try again later.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-cyan-500/20 bg-sidebar/50 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-cyan-400">
                    <Droplets className="w-5 h-5" />
                    Newcomer Dispenser
                </CardTitle>
                <CardDescription>
                    {isConnected
                        ? hasClaimed
                            ? "You have already claimed your USDC"
                            : "Claim 1 USDC on your preferred chain. One claim per address across all chains."
                        : "Connect your wallet to claim 1 USDC on your preferred chain"}
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
                {!isConnected ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Coins className="w-12 h-12 text-cyan-400/50 mb-4" />
                        <p className="text-muted-foreground">
                            Connect your wallet to claim
                        </p>
                    </div>
                ) : checkLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Spinner className="text-cyan-400" />
                    </div>
                ) : hasClaimed ? (
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-sm p-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="w-5 h-5 text-cyan-400 mt-0.5" />
                            <div>
                                <p className="font-medium text-cyan-400">Already Claimed</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    You claimed 1 USDC on{" "}
                                    <span className="text-foreground font-medium">
                                        {checkResult?.claimedOnChainName || `chain ${checkResult?.claimedOnChain}`}
                                    </span>
                                </p>
                                {checkResult?.claimedAt && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Claimed on {new Date(checkResult.claimedAt).toLocaleDateString()}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="text-sm text-muted-foreground mb-3">
                            Select a chain to claim your 1 USDC:
                        </div>
                        <div className="space-y-2">
                            {sortedDispensers.map((dispenser) => {
                                const isAvailable = dispenser.remainingClaims > 0 && !dispenser.isPaused && dispenser.isConfigured;
                                const isClaiming = selectedChain === dispenser.chainId;
                                const chainColor = getChainColor(dispenser.chainId);

                                return (
                                    <div
                                        key={dispenser.chainId}
                                        className="flex items-center justify-between p-3 bg-sidebar-accent/50 rounded-sm border border-sidebar-border hover:border-cyan-500/30 transition-colors"
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-medium ${chainColor}`}>
                                                    {dispenser.chainName}
                                                </span>
                                                {dispenser.isPaused && (
                                                    <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/30">
                                                        Paused
                                                    </Badge>
                                                )}
                                                {!dispenser.isConfigured && (
                                                    <Badge variant="outline" className="text-xs text-orange-500 border-orange-500/30">
                                                        Not Configured
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                                <span>
                                                    {dispenser.remainingClaims.toLocaleString()} / {dispenser.maxClaims.toLocaleString()} remaining
                                                </span>
                                                <span>•</span>
                                                <span>
                                                    Balance: {dispenser.dispenserBalanceFormatted}
                                                </span>
                                            </div>
                                        </div>

                                        <Button
                                            size="sm"
                                            onClick={() => handleClaim(dispenser.chainId)}
                                            disabled={!isAvailable || claimMutation.isPending || selectedChain !== null}
                                            className="min-w-[100px] bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-50"
                                        >
                                            {isClaiming ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span>Claiming...</span>
                                                </>
                                            ) : !isAvailable ? (
                                                "Unavailable"
                                            ) : (
                                                "Claim 1 USDC"
                                            )}
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {claimMutation.data?.txHash && claimMutation.data.success && (
                    <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-sm">
                        <div className="flex items-center gap-2 text-green-400 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Transaction confirmed!</span>
                        </div>
                        <a
                            href={getExplorerTxUrl(claimMutation.data.txHash, selectedChain || 338)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-cyan-400 hover:underline flex items-center gap-1 mt-1"
                        >
                            View on explorer <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>
                )}

                <div className="mt-4 pt-4 border-t border-sidebar-border">
                    <p className="text-xs text-muted-foreground text-center">
                        Each address can claim only once across all supported chains.
                        <br />
                        Maximum 1,000 claims per chain.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}

// =============================================================================
// Compact Dispenser Button (for sidebar/header)
// =============================================================================

export function DispenserButton() {
    const account = useActiveAccount();
    const address = account?.address;

    const { data: checkResult, isLoading } = useDispenserCheck(address);
    const claimMutation = useDispenserClaim();
    const { data: dispenserStatus } = useDispenserStatus();

    const [isOpen, setIsOpen] = useState(false);
    const [selectedChain, setSelectedChain] = useState<number | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    const handleClaim = async (chainId: number) => {
        if (!address) {
            toast.error("Please connect your wallet first");
            return;
        }

        setSelectedChain(chainId);
        try {
            const result = await claimMutation.mutateAsync({ address, chainId });
            if (result.success) {
                toast.success("Claimed 1 USDC!");
                setIsOpen(false);
            } else if (result.alreadyClaimed) {
                toast.error("Already claimed");
            } else {
                toast.error(result.error || "Failed to claim");
            }
        } finally {
            setSelectedChain(null);
        }
    };

    const hasClaimed = checkResult?.hasClaimed;
    // Available dispensers: have balance, not paused, configured
    const availableDispensers = dispenserStatus?.dispensers.filter(f =>
        BigInt(f.dispenserBalance || "0") > 0n &&
        f.remainingClaims > 0 &&
        !f.isPaused &&
        f.isConfigured
    ) || [];
    // Only show funding warning if NO dispensers are available
    const allConfigured = dispenserStatus?.dispensers?.filter(f => f.isConfigured) || [];
    const needsFunding = allConfigured.length > 0 && availableDispensers.length === 0;

    return (
        <div className="relative" ref={dropdownRef}>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(!isOpen)}
                className="gap-2 border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/10"
            >
                <Droplets className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">{hasClaimed ? "Claimed" : "Dispenser"}</span>
                {!hasClaimed && availableDispensers.length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs px-1.5 bg-cyan-500/20 text-cyan-400">
                        1 USDC
                    </Badge>
                )}
            </Button>

            {isOpen && (
                <div className="absolute top-full mt-2 right-0 w-72 bg-sidebar border border-sidebar-border rounded-sm shadow-lg z-50">
                    <div className="p-3 border-b border-sidebar-border">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                            <Droplets className="w-4 h-4 text-cyan-400" />
                            Claim 1 USDC
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1">
                            {!address
                                ? "Connect account to claim"
                                : "One claim per address across all chains"
                            }
                        </p>
                    </div>

                    <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
                        {!address ? (
                            <div className="p-3 text-center text-sm">
                                <Coins className="w-8 h-8 mx-auto mb-2 text-cyan-400/50" />
                                <p className="text-muted-foreground mb-2">
                                    Connect account to claim
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Use email, Google, GitHub, or social login
                                </p>
                            </div>
                        ) : isLoading ? (
                            <div className="p-3 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                            </div>
                        ) : hasClaimed ? (
                            <div className="p-3 text-center text-sm text-muted-foreground">
                                <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-cyan-400" />
                                Already claimed on {checkResult?.claimedOnChainName}
                            </div>
                        ) : needsFunding ? (
                            <div className="p-3 text-center text-sm">
                                <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-400" />
                                <p className="text-amber-400 font-medium">Dispensers need funding</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Contracts deployed but need USDC. Contact admin.
                                </p>
                            </div>
                        ) : availableDispensers.length === 0 ? (
                            <div className="p-3 text-center text-sm text-muted-foreground">
                                No dispensers available
                            </div>
                        ) : (
                            availableDispensers.map((dispenser) => (
                                <Button
                                    key={dispenser.chainId}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleClaim(dispenser.chainId)}
                                    disabled={claimMutation.isPending || selectedChain !== null}
                                    className="w-full justify-start gap-2 hover:bg-cyan-500/10"
                                >
                                    {selectedChain === dispenser.chainId ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Droplets className="w-4 h-4 text-cyan-400" />
                                    )}
                                    <span className="flex-1 text-left">{dispenser.chainName}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {dispenser.remainingClaims} left
                                    </span>
                                </Button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}