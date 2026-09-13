/**
 * Network Selector - Chain selection dropdown
 *
 * Used in sidebar and factory forms to select deployment/payment chain.
 */
import { cn } from "@/lib/utils";
import { useChain } from "@/contexts/Network";
import type { NetworkId } from "@compose-market/sdk/chains";
import { useMultiChainBalance } from "@/hooks/use-multichain";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { NetworkGlyph, NetworkLogo } from "@/lib/networks";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export { NetworkGlyph, NetworkLogo };

interface NetworkSelectorProps {
    compact?: boolean;
    showBalance?: boolean;
    className?: string;
}

export function NetworkSelector({
    compact = false,
    showBalance = true,
    className,
}: NetworkSelectorProps) {
    const { evmAddress, solanaAddress } = useSelectedUserAddress();
    const { selectedNetwork, setSelectedNetwork, chains, getChainByNetworkId } = useChain();
    const { data: balances } = useMultiChainBalance({
        evmAddress,
        solanaAddress,
    }, {
        enabled: showBalance,
        deferUntilIdle: true,
    });

    const handleChange = (network: string) => setSelectedNetwork(network as NetworkId);

    const currentChain = getChainByNetworkId(selectedNetwork);
    const colorClass = currentChain?.isTestnet
        ? "border-red-500/50 text-red-400"
        : "border-blue-500/50 text-blue-400";

    if (compact) {
        return (
            <Select value={selectedNetwork} onValueChange={handleChange}>
                <SelectTrigger
                    className={cn(
                        "cm-hud-button font-mono text-xs",
                        colorClass,
                        className
                    )}
                >
                    <div className="flex min-w-0 items-center gap-2 truncate">
                        <NetworkGlyph network={selectedNetwork} name={currentChain?.name} />
                        <span className="cm-hud-value">{currentChain?.name || "Select"}</span>
                    </div>
                </SelectTrigger>
                <SelectContent className="cm-hud-menu">
                    {chains.map((network) => {
                        const balance = balances?.find(b => b.network === network.network);
                        return (
                            <SelectItem key={network.network} value={network.network} className="font-mono text-xs">
                                <div className="flex items-center justify-between gap-3 w-full">
                                    <div className="flex items-center gap-2">
                                        <NetworkGlyph network={network.network} name={network.name} />
                                        <span>{network.name}</span>
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

    return (
        <Select value={selectedNetwork} onValueChange={handleChange}>
            <SelectTrigger
                className={cn(
                    "w-full border bg-background/50 font-mono text-sm",
                    colorClass,
                    className
                )}
            >
                <div className="flex items-center gap-2">
                    <NetworkGlyph network={selectedNetwork} name={currentChain?.name} />
                    <SelectValue placeholder="Select network" />
                </div>
            </SelectTrigger>
            <SelectContent>
                {chains.map((network) => {
                    const balance = balances?.find(b => b.network === network.network);
                    return (
                        <SelectItem key={network.network} value={network.network} className="font-mono">
                            <div className="flex items-center justify-between gap-4 w-full min-w-[200px]">
                                <div className="flex items-center gap-2">
                                    <NetworkGlyph network={network.network} name={network.name} />
                                    <span>{network.name}</span>
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

export function NetworkBadge({ network, className }: { network: NetworkId; className?: string }) {
    const { getChainByNetworkId } = useChain();
    const config = getChainByNetworkId(network);
    const colorClass = config?.isTestnet
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
            <NetworkGlyph network={network} name={config?.name || network} />
            <span>{config?.name || network}</span>
        </div>
    );
}
