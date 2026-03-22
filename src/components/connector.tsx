"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectButton, useActiveAccount, useActiveWallet } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions } from "thirdweb/wallets";
import { ChevronDown, LogOut, Copy, Check, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { thirdwebClient, CHAIN_OBJECTS, USDC_ADDRESSES, CHAIN_CONFIG } from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { useTotalBalance } from "@/hooks/use-multichain";
import { cn } from "@/lib/utils";
import { mpIdentify, mpReset } from "@/lib/mixpanel";

const wallets = [
  inAppWallet({
    auth: {
      options: [
        "email",
        "google",
        "github",
        "discord",
        "x",
        "farcaster",
        "passkey",
        "guest",
      ],
    },
  }),
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("walletConnect"),
  createWallet("io.rabby"),
  createWallet("me.rainbow"),
];

interface WalletConnectorProps {
  className?: string;
  compact?: boolean;
}

export function WalletConnector({ className, compact = false }: WalletConnectorProps) {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const { paymentChainId } = useChain();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (account?.address) {
      mpIdentify(account.address);
    }
  }, [account?.address]);

  const smartAccountChain = useMemo(() => {
    return CHAIN_OBJECTS[paymentChainId as keyof typeof CHAIN_OBJECTS];
  }, [paymentChainId]);

  if (!smartAccountChain) {
    throw new Error(`Unsupported payment chain: ${paymentChainId}`);
  }

  const dynamicAccountAbstraction = useMemo(() => {
    return {
      chain: smartAccountChain,
      sponsorGas: true,
    } satisfies SmartWalletOptions;
  }, [smartAccountChain]);

  const selectedPaymentToken = useMemo(() => {
    const usdcAddress = USDC_ADDRESSES[paymentChainId];
    if (!usdcAddress) {
      throw new Error(`USDC is not configured for chain: ${paymentChainId}`);
    }

    return {
      address: usdcAddress,
      name: "USD Coin",
      symbol: "USDC",
      icon: "/tokens/usdc.svg",
    };
  }, [paymentChainId]);

  const { formatted: totalBalance, isLoading: balanceLoading } = useTotalBalance(account?.address, {
    enabled: !!account,
    deferUntilIdle: !menuOpen,
  });

  const chainConfig = CHAIN_CONFIG[paymentChainId];
  const chainColor = chainConfig?.color === "red" ? "bg-red-400" : "bg-blue-400";

  if (!account) {
    return (
      <ConnectButton
        client={thirdwebClient}
        wallets={wallets}
        chain={smartAccountChain}
        accountAbstraction={dynamicAccountAbstraction}
        connectButton={{
          label: "CONNECT",
          className: `
            !bg-cyan-500 !text-black
            !font-bold !tracking-wider
            !shadow-[0_0_15px_-3px_rgba(6,182,212,0.5)]
            hover:!bg-cyan-400
            !border-0 !rounded-sm
            ${className || ""}
          `,
          style: {
            fontFamily: "var(--font-display), Orbitron, sans-serif",
            textTransform: "uppercase",
          },
        }}
        connectModal={{
          size: compact ? "compact" : "wide",
          title: "Access Compose.Market",
          showThirdwebBranding: false,
          welcomeScreen: {
            title: "Welcome to Compose.Market",
            subtitle: "Connect to access the AI Agent marketplace",
          },
          termsOfServiceUrl: "/terms",
          privacyPolicyUrl: "/privacy",
        }}
        detailsButton={{
          displayBalanceToken: {
            [paymentChainId]: selectedPaymentToken.address,
          },
          className: `
            !bg-cyan-500/10 !border-cyan-500/30
            !text-cyan-400 !font-mono
            hover:!bg-cyan-500/20
            !rounded-sm
          `,
          style: {
            fontFamily: "var(--font-mono), Fira Code, monospace",
          },
        }}
        supportedTokens={{
          [paymentChainId]: [selectedPaymentToken],
        }}
        theme={{
          type: "dark",
          colors: {
            primaryButtonBg: "hsl(188 95% 43%)",
            primaryButtonText: "hsl(222 47% 3%)",
            accentButtonBg: "hsl(292 85% 55%)",
            accentButtonText: "hsl(0 0% 100%)",
            accentText: "hsl(188 95% 43%)",
            borderColor: "hsl(217 33% 15%)",
            separatorLine: "hsl(217 33% 15%)",
            modalBg: "hsl(222 40% 5%)",
            modalOverlayBg: "hsl(222 47% 3% / 0.8)",
            inputAutofillBg: "hsl(222 40% 6%)",
            secondaryButtonBg: "hsl(270 60% 20%)",
            secondaryButtonHoverBg: "hsl(270 60% 25%)",
            secondaryButtonText: "hsl(270 80% 90%)",
            connectedButtonBg: "hsl(222 40% 8%)",
            connectedButtonBgHover: "hsl(222 40% 12%)",
            secondaryText: "hsl(215 16% 47%)",
            primaryText: "hsl(210 40% 80%)",
            danger: "hsl(0 90% 50%)",
            success: "hsl(188 95% 43%)",
            selectedTextBg: "hsl(188 95% 43% / 0.2)",
            selectedTextColor: "hsl(188 95% 43%)",
            skeletonBg: "hsl(217 33% 15%)",
            tertiaryBg: "hsl(222 40% 6%)",
            tooltipBg: "hsl(222 40% 10%)",
            tooltipText: "hsl(210 40% 80%)",
            scrollbarBg: "hsl(217 33% 15%)",
            secondaryIconColor: "hsl(215 16% 47%)",
            secondaryIconHoverBg: "hsl(222 40% 12%)",
            secondaryIconHoverColor: "hsl(188 95% 43%)",
          },
          fontFamily: "var(--font-sans), Rajdhani, sans-serif",
        }}
      />
    );
  }

  const shortAddress = `${account.address.slice(0, 6)}...${account.address.slice(-4)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(account.address);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 2_000);
  };

  const handleDisconnect = () => {
    mpReset();
    wallet?.disconnect();
  };

  return (
    <DropdownMenu onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-sm border transition-all",
            "bg-cyan-500/10 border-cyan-500/30 text-cyan-400",
            "hover:bg-cyan-500/20 hover:border-cyan-500/50",
            "font-mono text-sm",
            className
          )}
        >
          <span className={cn("w-2 h-2 rounded-full animate-pulse", chainColor)} />
          <span className="font-medium">
            {balanceLoading ? "..." : `$${totalBalance}`}
          </span>
          <span className="text-cyan-400/60 hidden sm:inline">{shortAddress}</span>
          <ChevronDown className="w-3 h-3 text-cyan-400/60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 bg-card border-sidebar-border">
        <div className="px-3 py-3 border-b border-sidebar-border">
          <div className="flex items-center gap-2 mb-2">
            <span className={cn("w-2.5 h-2.5 rounded-full", chainColor)} />
            <span className="font-mono text-sm font-medium">
              {chainConfig?.name || "Unknown Chain"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-mono">Total USDC</span>
            <span className="text-cyan-400 font-mono font-bold">
              ${balanceLoading ? "..." : totalBalance}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Aggregated across all chains
          </p>
        </div>

        <div className="px-3 py-2 border-b border-sidebar-border">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-foreground">{shortAddress}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="p-1 text-muted-foreground hover:text-cyan-400 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={`${chainConfig?.explorer}/address/${account.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-muted-foreground hover:text-cyan-400 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        <DropdownMenuItem onClick={handleDisconnect} className="text-destructive focus:text-destructive">
          <LogOut className="w-4 h-4 mr-2" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function useWalletAccount() {
  const account = useActiveAccount();
  const wallet = useActiveWallet();

  return {
    isConnected: !!account,
    address: account?.address,
    account,
    wallet,
  };
}

export { useActiveAccount, useActiveWallet } from "thirdweb/react";
