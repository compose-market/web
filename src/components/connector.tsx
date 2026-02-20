"use client";

import { ConnectButton, useActiveAccount, useActiveWallet, useAdminWallet } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions } from "thirdweb/wallets";
import { thirdwebClient, CHAIN_OBJECTS, USDC_ADDRESSES, CHAIN_CONFIG, paymentToken as defaultPaymentToken, CHAIN_IDS } from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { useTotalBalance } from "@/hooks/use-multichain";
import { cn } from "@/lib/utils";
import { useState, useMemo, useEffect } from "react";
import { ChevronDown, LogOut, Copy, Check, ExternalLink, AlertTriangle } from "lucide-react";
import { registerOnCronos } from "@/lib/cronos/aa";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Configure all supported authentication methods
const wallets = [
  // In-app wallet with social/email/passkey auth (creates embedded wallet)
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
  // External wallets
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

/**
 * Brand-aligned wallet connector for Compose.Market
 * Supports: Email, Google, GitHub, X, Discord, Farcaster, Passkey, Guest + External wallets
 * 
 * ARCHITECTURE:
 * - Smart Account creation uses Avalanche Fuji (bundler available at 43113.bundler.thirdweb.com)
 * - Smart Account address is universal (same on ALL EVM chains via CREATE2)
 * - Cronos Testnet is the default chain
 * - User can select a specific supported chain (from ChainContext), then used for display, contracts, and x402 payments
 * - This allows users to pay on Cronos Testnet while using a bundler-created Smart Account
 */
export function WalletConnector({ className, compact = false }: WalletConnectorProps) {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const adminWallet = useAdminWallet();
  const { paymentChainId } = useChain();
  const { formatted: totalBalance, isLoading: balanceLoading } = useTotalBalance(account?.address);
  const [copied, setCopied] = useState(false);

  // Dynamically resolve the user's selected payment chain for display/contracts
  const selectedPaymentChain = useMemo(() => {
    return CHAIN_OBJECTS[paymentChainId as keyof typeof CHAIN_OBJECTS];
  }, [paymentChainId]);

  // Smart Account chain - use user's selected payment chain
  // The Smart Account address is deterministic (CREATE2) so it's the same on ALL chains
  // But the accountAbstraction.chain must match the chain where transactions are sent
  // ThirdWeb dashboard has gas sponsorship configured for both Fuji and Cronos Testnet
  const smartAccountChain = useMemo(() => {
    return CHAIN_OBJECTS[paymentChainId as keyof typeof CHAIN_OBJECTS] ||
      CHAIN_OBJECTS[CHAIN_IDS.avalancheFuji as keyof typeof CHAIN_OBJECTS];
  }, [paymentChainId]);

  // Cronos Testnet uses different AA infrastructure than ThirdWeb's default deterministic addresses
  // v0.7 Deployed 2026-01-29 with canonical EntryPoint
  const CRONOS_TESTNET_AA_CONFIG = {
    factoryAddress: (import.meta.env.VITE_CRONOSTEST_ACCOUNT_FACTORY) as `0x${string}`,
    entrypointAddress: (import.meta.env.VITE_CRONOSTEST_ENTRYPOINT) as `0x${string}`,
  };
  // Build accountAbstraction config - use selected chain for bundler/paymaster
  // For Cronos Testnet, override with chain-specific factory and entrypoint addresses
  const dynamicAccountAbstraction = useMemo(() => {
    const config: SmartWalletOptions = {
      chain: smartAccountChain,
      sponsorGas: true,
    };

    // Override factory and entrypoint for Cronos Testnet (chain 338)
    // ThirdWeb's default deterministic addresses are NOT deployed on Cronos
    if (paymentChainId === CHAIN_IDS.cronosTestnet) {
      config.factoryAddress = CRONOS_TESTNET_AA_CONFIG.factoryAddress;
      config.overrides = {
        entrypointAddress: CRONOS_TESTNET_AA_CONFIG.entrypointAddress,
      };
    }
    return config;
  }, [smartAccountChain, paymentChainId]);

  // Get USDC token config for the selected chain
  const selectedPaymentToken = useMemo(() => {
    const usdcAddress = USDC_ADDRESSES[paymentChainId];
    return usdcAddress ? {
      address: usdcAddress,
      name: "USD Coin",
      symbol: "USDC",
      icon: "/tokens/usdc.svg",
    } : defaultPaymentToken;
  }, [paymentChainId]);

  // Get payment chain config for display
  const chainConfig = CHAIN_CONFIG[paymentChainId];
  const chainColor = chainConfig?.color === "red" ? "bg-red-400" : "bg-blue-400";

  // Not connected - show ThirdWeb connect button
  if (!account) {
    return (
      <ConnectButton
        client={thirdwebClient}
        wallets={wallets}
        chain={smartAccountChain}  // Use user's selected chain
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
            // Compose.Market brand colors - Cyan primary, Fuchsia accent
            primaryButtonBg: "hsl(188 95% 43%)", // Cyan
            primaryButtonText: "hsl(222 47% 3%)", // Dark bg
            accentButtonBg: "hsl(292 85% 55%)", // Fuchsia accent
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

  // Connected - show custom display with payment chain & aggregated balance
  const shortAddress = `${account.address.slice(0, 6)}...${account.address.slice(-4)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(account.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDisconnect = () => {
    wallet?.disconnect();
  };

  return (
    <DropdownMenu>
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
          {/* Chain indicator */}
          <span className={cn("w-2 h-2 rounded-full animate-pulse", chainColor)} />

          {/* Balance */}
          <span className="font-medium">
            {balanceLoading ? "..." : `$${totalBalance}`}
          </span>

          {/* Address */}
          <span className="text-cyan-400/60 hidden sm:inline">{shortAddress}</span>

          <ChevronDown className="w-3 h-3 text-cyan-400/60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 bg-card border-sidebar-border">
        {/* Header with chain & balance */}
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

        {/* Address */}
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

// Hook to get connected account info
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

// Re-export for convenience
export { useActiveAccount, useActiveWallet } from "thirdweb/react";
