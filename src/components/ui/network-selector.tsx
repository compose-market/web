/**
 * Network Selector - Chain selection dropdown
 * 
 * Used in sidebar and factory forms to select deployment/payment chain.
 */
import { cn } from "@/lib/utils";
import { SUPPORTED_CHAINS, CHAIN_CONFIG } from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { useMultiChainBalance } from "@/hooks/use-multichain";
import { useActiveAccount } from "thirdweb/react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ChevronDown } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface NetworkSelectorProps {
    /** Compact mode for sidebar */
    compact?: boolean;
    /** Show USDC balance per chain */
    showBalance?: boolean;
    /** Custom className */
    className?: string;
    /** Override value (for form-controlled usage) */
    value?: number;
    /** Override onChange (for form-controlled usage) */
    onChange?: (chainId: number) => void;
}

// =============================================================================
// Component
// =============================================================================

export function NetworkSelector({
    compact = false,
    showBalance = true,
    className,
    value,
    onChange,
}: NetworkSelectorProps) {
    const account = useActiveAccount();
    const { selectedChainId, setSelectedChainId } = useChain();
    const { data: balances } = useMultiChainBalance(account?.address);

    // Use controlled value if provided, otherwise use context
    const currentChainId = value ?? selectedChainId;
    const handleChange = (chainIdStr: string) => {
        const chainId = parseInt(chainIdStr);
        if (onChange) {
            onChange(chainId);
        } else {
            setSelectedChainId(chainId);
        }
    };

    const currentChain = CHAIN_CONFIG[currentChainId];
    const colorClass = currentChain?.color === "red"
        ? "border-red-500/50 text-red-400"
        : "border-blue-500/50 text-blue-400";

    if (compact) {
        return (
            <Select value={currentChainId.toString()} onValueChange={handleChange}>
                <SelectTrigger
                    className={cn(
                        "h-8 w-full border bg-sidebar-accent/50 font-mono text-xs",
                        colorClass,
                        className
                    )}
                >
                    <div className="flex items-center gap-2 truncate">
                        <span
                            className={cn(
                                "w-2 h-2 rounded-full animate-pulse",
                                currentChain?.color === "red" ? "bg-red-400" : "bg-blue-400"
                            )}
                        />
                        <span className="truncate">{currentChain?.name || "Select"}</span>
                    </div>
                </SelectTrigger>
                <SelectContent>
                    {SUPPORTED_CHAINS.map(({ id }) => {
                        const config = CHAIN_CONFIG[id];
                        const balance = balances?.find(b => b.chainId === id);
                        return (
                            <SelectItem key={id} value={id.toString()} className="font-mono text-xs">
                                <div className="flex items-center justify-between gap-3 w-full">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={cn(
                                                "w-2 h-2 rounded-full",
                                                config?.color === "red" ? "bg-red-400" : "bg-blue-400"
                                            )}
                                        />
                                        <span>{config?.name}</span>
                                    </div>
                                    {showBalance && balance && (
                                        <span className="text-muted-foreground">${balance.formatted}</span>
                                    )}
                                </div>
                            </SelectItem>
                        );
                    })}
                </SelectContent>
            </Select>
        );
    }

    // Full-size version for forms
    return (
        <Select value={currentChainId.toString()} onValueChange={handleChange}>
            <SelectTrigger
                className={cn(
                    "w-full border bg-background/50 font-mono text-sm",
                    colorClass,
                    className
                )}
            >
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            "w-2.5 h-2.5 rounded-full animate-pulse",
                            currentChain?.color === "red" ? "bg-red-400" : "bg-blue-400"
                        )}
                    />
                    <SelectValue placeholder="Select network" />
                </div>
            </SelectTrigger>
            <SelectContent>
                {SUPPORTED_CHAINS.map(({ id }) => {
                    const config = CHAIN_CONFIG[id];
                    const balance = balances?.find(b => b.chainId === id);
                    return (
                        <SelectItem key={id} value={id.toString()} className="font-mono">
                            <div className="flex items-center justify-between gap-4 w-full min-w-[200px]">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            "w-2.5 h-2.5 rounded-full",
                                            config?.color === "red" ? "bg-red-400" : "bg-blue-400"
                                        )}
                                    />
                                    <span>{config?.name}</span>
                                </div>
                                {showBalance && balance && (
                                    <span className="text-muted-foreground text-xs">
                                        ${balance.formatted} USDC
                                    </span>
                                )}
                            </div>
                        </SelectItem>
                    );
                })}
            </SelectContent>
        </Select>
    );
}

/**
 * Simple network indicator badge (read-only display)
 */
export function NetworkBadge({ chainId, className }: { chainId: number; className?: string }) {
    const config = CHAIN_CONFIG[chainId];
    const colorClass = config?.color === "red"
        ? "border-red-500/30 text-red-400 bg-red-500/10"
        : "border-blue-500/30 text-blue-400 bg-blue-500/10";

    return (
        <div
            className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-mono",
                colorClass,
                className
            )}
        >
            <span
                className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    config?.color === "red" ? "bg-red-400" : "bg-blue-400"
                )}
            />
            <span>{config?.name || `Chain ${chainId}`}</span>
        </div>
    );
}
