"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectButton, useActiveAccount, useActiveWallet, useActiveWalletConnectionStatus, useAdminWallet } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions } from "thirdweb/wallets";
import { ChevronDown, LogOut, Copy, Check, ExternalLink, Wallet, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { thirdwebClient, getChainObject, getChainConfig, getUsdcAddress, getExplorerUrl, isEvmNetwork, evmChainId } from "@/lib/chains";
import { useChain } from "@/contexts/Network";
import { useTotalBalance } from "@/hooks/use-multichain";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { sdk } from "@/lib/sdk";
import { cn } from "@/lib/utils";
import { mpIdentify, mpReset } from "@/lib/mixpanel";
import { clearCachedAccount, readCachedAccount, writeCachedAccount } from "@/lib/cache";
import type { EvmNetworkId } from "@compose-market/sdk/chains";
import { DisclaimerModal } from "@/components/disclaimer";

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

const botchainAccountTriggers = new Set<string>();

interface WalletConnectorProps {
  className?: string;
  compact?: boolean;
}

export function WalletConnector({ className, compact = false }: WalletConnectorProps) {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const adminWallet = useAdminWallet();
  const connectionStatus = useActiveWalletConnectionStatus();
  const { paymentNetwork, getChainByNetworkId, evmChains, defaultNetwork } = useChain();
  const {
    userAddress,
    evmAddress,
    solanaAddress,
    isEvm,
    isResolving: userAddressResolving,
    isActivated: solanaActivated,
    requiredFundingLamports,
    currentFundingLamports,
  } = useSelectedUserAddress();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  // Mount-time snapshot of the previous session's identity. Stable for the
  // page's lifetime: once the live account resolves it takes over everywhere.
  const [cachedAccount] = useState(() => readCachedAccount());

  // Thirdweb re-derives the smart account over the network on every reload
  // (auth ×2 → chain metadata → factory eth_call). While that runs, render
  // the deterministic, permanent cached address instead of flashing CONNECT.
  const isReconnecting = !account && connectionStatus === "connecting" && cachedAccount != null;

  useEffect(() => {
    if (account?.address) {
      mpIdentify(account.address);
      writeCachedAccount(account.address, paymentNetwork, solanaAddress);
    }
  }, [account?.address, paymentNetwork, solanaAddress]);

  // Auto-connect failed for good (expired/revoked session): drop the stale
  // identity so the next reload doesn't render a ghost account.
  useEffect(() => {
    if (connectionStatus === "disconnected") {
      clearCachedAccount();
    }
  }, [connectionStatus]);

  // First time the connector lands on Botchain with a resolved identity
  // (selection change or login with Botchain already selected), ask the API
  // to deploy the deterministic smart account there. The merchant wallet
  // pays the creation transaction; the endpoint is idempotent for accounts
  // that are already deployed. Fire and forget — no UI surface. Guarded so
  // an SDK build without the botchain resource skips instead of crashing.
  useEffect(() => {
    const owner = adminWallet?.getAccount?.()?.address?.toLowerCase() ?? null;
    const accountAddress = account?.address?.toLowerCase() ?? null;
    if (paymentNetwork !== "eip155:677" || !owner || !accountAddress) return;
    if (typeof sdk.botchain?.createAccount !== "function") {
      console.warn("[botchain] SDK build does not expose botchain.createAccount; skipping smart account trigger");
      return;
    }
    if (botchainAccountTriggers.has(accountAddress)) return;
    botchainAccountTriggers.add(accountAddress);
    sdk.botchain.createAccount({ owner, account: accountAddress }).catch((error) => {
      console.warn("[botchain] smart account creation trigger failed", error);
    });
  }, [paymentNetwork, account?.address, adminWallet]);

  const fallbackEvmNetwork = useMemo((): EvmNetworkId | undefined => {
    if (isEvmNetwork(defaultNetwork)) return defaultNetwork;
    const first = evmChains.find((chain) => isEvmNetwork(chain.network));
    return first?.network as EvmNetworkId | undefined;
  }, [defaultNetwork, evmChains]);

  const thirdwebNetwork = isEvm ? paymentNetwork : fallbackEvmNetwork;
  const thirdwebChainIdValue = thirdwebNetwork && isEvmNetwork(thirdwebNetwork)
    ? evmChainId(thirdwebNetwork)
    : undefined;

  const connectChain = useMemo(() => {
    if (thirdwebChainIdValue == null) return undefined;
    return getChainObject(thirdwebChainIdValue);
  }, [thirdwebChainIdValue]);

  const chainInfo = getChainByNetworkId(paymentNetwork);
  const chainColor = chainInfo?.isTestnet ? "bg-red-400" : "bg-blue-400";

  const selectedPaymentToken = useMemo(() => {
    if (thirdwebChainIdValue == null) return undefined;
    const usdcAddress = getUsdcAddress(thirdwebChainIdValue);
    if (!usdcAddress) return undefined;
    const asset = getChainConfig(thirdwebChainIdValue)?.asset ?? "USDC";
    return {
      address: usdcAddress,
      name: asset === "USDT" ? "USDT" : "USD Coin",
      symbol: asset,
      icon: "/tokens/usdc.svg",
    };
  }, [thirdwebChainIdValue]);

  // While reconnecting, feed the balance query the cached addresses so the
  // persisted (IndexedDB) multichain-balance query hydrates instantly with
  // the exact same queryKey the previous session used.
  const displayEvmAddress = evmAddress ?? (isReconnecting ? cachedAccount?.address ?? null : null);
  const displaySolanaAddress = solanaAddress ?? (isReconnecting ? cachedAccount?.solanaAddress ?? null : null);

  const { formatted: totalBalance, isLoading: balanceLoading } = useTotalBalance({
    evmAddress: displayEvmAddress,
    solanaAddress: displaySolanaAddress,
  }, {
    enabled: !!displayEvmAddress || !!displaySolanaAddress,
    deferUntilIdle: !menuOpen,
  });

  if (!account && !isReconnecting) {
    if (!connectChain || !selectedPaymentToken) {
      return (
        <button
          type="button"
          disabled
          className={cn(
            "cm-hud-button cm-hud-wallet opacity-50 cursor-not-allowed",
            className
          )}
        >
          <Wallet className="cm-hud-icon cm-hud-wallet__icon" size={18} aria-hidden="true" />
          <span className="cm-hud-value">Loading...</span>
        </button>
      );
    }

    const dynamicAccountAbstraction: SmartWalletOptions = {
      chain: connectChain,
      sponsorGas: true,
    };

    return (
      <ConnectButton
        client={thirdwebClient}
        wallets={wallets}
        chain={connectChain}
        accountAbstraction={dynamicAccountAbstraction}
        connectButton={{
          label: "CONNECT",
          className: `
            !bg-cyan-500 !text-black
            !font-bold !tracking-wider
            !shadow-[0_0_15px_-3px_rgba(6,182,212,0.5)]
            hover:!bg-cyan-400
            !border-0 !rounded-full !min-h-[2.65rem]
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
          termsOfServiceUrl: "https://compose.market/terms/",
          privacyPolicyUrl: "https://compose.market/privacy/",
        }}
        detailsButton={{
          displayBalanceToken: {
            [thirdwebChainIdValue!]: selectedPaymentToken.address,
          },
          className: `
            !bg-cyan-500/10 !border-cyan-500/30
            !text-cyan-400 !font-mono
            hover:!bg-cyan-500/20
            !rounded-full
          `,
          style: {
            fontFamily: "var(--font-mono), Fira Code, monospace",
          },
        }}
        supportedTokens={{
          [thirdwebChainIdValue!]: [selectedPaymentToken],
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

  const displayAddress = userAddress ?? (isReconnecting
    ? (isEvm ? cachedAccount?.address ?? null : cachedAccount?.solanaAddress ?? null)
    : null);
  const shortAddress = displayAddress
    ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
    : userAddressResolving || isReconnecting ? "Resolving..." : "Unavailable";
  const accountLabel = isEvm ? "Smart account" : "Solana account";
  const requiredActivationSol = requiredFundingLamports == null
    ? null
    : (Number(requiredFundingLamports) / 1_000_000_000).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  const currentActivationSol = currentFundingLamports == null
    ? null
    : (Number(currentFundingLamports) / 1_000_000_000).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  const isActivationFunded = requiredFundingLamports != null
    && currentFundingLamports != null
    && currentFundingLamports >= requiredFundingLamports;
  const selectedExplorerUrl = (() => {
    if (!displayAddress) return null;
    const url = getExplorerUrl(paymentNetwork, "address", displayAddress);
    return url === "#" ? null : url;
  })();

  const handleCopy = async () => {
    if (!displayAddress) return;
    await navigator.clipboard.writeText(displayAddress);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 2_000);
  };

  const handleDisconnect = () => {
    clearCachedAccount();
    mpReset();
    wallet?.disconnect();
  };

  return (
    <>
      <DisclaimerModal
        forceOpen={showDisclaimer}
        onOpenChange={setShowDisclaimer}
      />

      <DropdownMenu onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Wallet ${shortAddress}`}
            data-reconnecting={isReconnecting || undefined}
            className={cn(
              "cm-hud-button cm-hud-wallet",
              isReconnecting && "opacity-80",
              className
            )}
          >
            <Wallet className="cm-hud-icon cm-hud-wallet__icon" size={18} aria-hidden="true" />
            <span className="cm-hud-value">
              {balanceLoading ? "..." : `$${totalBalance}`}
            </span>
            <span className="cm-hud-address">{shortAddress}</span>
            <ChevronDown className="cm-hud-icon" size={13} />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="cm-hud-menu w-64">
          <div className="px-3 py-3 border-b border-cyan-400/15">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn("w-2.5 h-2.5 rounded-full", chainColor)} />
              <span className="font-mono text-sm font-medium">
                {chainInfo?.name || "Unknown Chain"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-mono">Total</span>
              <span className="text-cyan-400 font-mono font-bold">
                ${balanceLoading ? "..." : totalBalance}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Aggregated across all chains
            </p>
          </div>

          <div className="px-3 py-2 border-b border-cyan-400/15">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{accountLabel}</p>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-foreground">{shortAddress}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCopy}
                  disabled={!displayAddress}
                  className="p-1 text-muted-foreground hover:text-cyan-400 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {selectedExplorerUrl ? (
                  <a
                    href={selectedExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 text-muted-foreground hover:text-cyan-400 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
            {!isEvm && !solanaActivated && requiredActivationSol ? (
              <div className="mt-2 rounded border border-amber-400/20 bg-amber-400/5 px-2 py-1.5">
                <p className="text-[10px] font-mono text-amber-300">
                  {isActivationFunded
                    ? "Ready to activate when you create a session."
                    : `Fund this address with ${requiredActivationSol} SOL or 5 USDC to activate it.`}
                </p>
                {currentActivationSol ? (
                  <p className="mt-0.5 text-[9px] font-mono text-muted-foreground">
                    Detected: {currentActivationSol} SOL
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <DropdownMenuItem
            onClick={() => setShowDisclaimer(true)}
            className="text-cyan-400 focus:text-cyan-300 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 mr-2 text-cyan-400" />
            AI Disclaimer & Terms
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleDisconnect} className="text-destructive focus:text-destructive cursor-pointer">
            <LogOut className="w-4 h-4 mr-2" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
