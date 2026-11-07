import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import Activity from "lucide-react/icons/activity";
import Backpack from "lucide-react/icons/backpack";
import BarChart3 from "lucide-react/icons/bar-chart-3";
import Bell from "lucide-react/icons/bell";
import Box from "lucide-react/icons/box";
import ChevronDown from "lucide-react/icons/chevron-down";
import Key from "lucide-react/icons/key";
import MoreHorizontal from "lucide-react/icons/more-horizontal";
import PlusCircle from "lucide-react/icons/plus-circle";
import Scale from "lucide-react/icons/scale";
import Sparkles from "lucide-react/icons/sparkles";
import Wallet from "lucide-react/icons/wallet";
import { AppShell } from "@compose-market/theme/app";
import { useViewNavigate } from "@/motion/snap";
import { refreshAgentCatalog } from "@/hooks/use-agents";
import { NetworkGlyph, useChain } from "@/contexts/Network";
import { readCachedAccount } from "@/lib/cache";
import { isEvmNetwork } from "@/lib/performance/networks";
import { cn } from "@/lib/utils";

export type BackpackTab = "accounts" | "connectors" | "permissions" | "channels";
export const OPEN_BACKPACK_EVENT = "compose:open-backpack";

export interface OpenBackpackDetail {
  tab?: BackpackTab;
  agentWallet?: string;
}

export interface LayoutProps {
  children: ReactNode;
  walletMounted?: boolean;
  onActivateWallet?: () => void;
  bellOpen: boolean;
  onBellOpenChange: (open: boolean) => void;
  backpackOpen: boolean;
  onOpenBackpack: () => void;
  overflowOpen: boolean;
  onOverflowOpenChange: (open: boolean) => void;
  onNavUtilityRef?: (el: HTMLDivElement | null) => void;
  onHudGroupRef?: (el: HTMLDivElement | null) => void;
  onWorkspaceRef?: (el: HTMLDivElement | null) => void;
}

const links = [
  { href: "/market", icon: Box, label: "Market" },
  // { href: "/compose", icon: Layers, label: "Compose" },
  { href: "/dashboard", icon: BarChart3, label: "Dashboard" },
  { href: "/keys", icon: Key, label: "API Keys" },
  { href: "/create", icon: PlusCircle, label: "Create Agent" },
  { href: "/playground", icon: Sparkles, label: "Playground" },
  { href: "/benchmarks", icon: Scale, label: "Benchmarks" },
  { href: "/profile", icon: Activity, label: "Profile" },
];

export function Layout({
  children,
  walletMounted = false,
  onActivateWallet,
  bellOpen,
  onBellOpenChange,
  backpackOpen,
  onOpenBackpack,
  overflowOpen,
  onOverflowOpenChange,
  onNavUtilityRef,
  onHudGroupRef,
  onWorkspaceRef,
}: LayoutProps) {
  const [location] = useLocation();
  const hudRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!overflowOpen) {
      return;
    }

    function close(event: MouseEvent): void {
      if (hudRef.current?.contains(event.target as Node)) {
        return;
      }
      onOverflowOpenChange(false);
    }

    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [overflowOpen, onOverflowOpenChange]);

  return (
    <AppShell
      className="cm-app-shell--luminescent"
      contentClassName="h-dvh min-h-0 text-foreground font-sans selection:bg-fuchsia-500/30 selection:text-fuchsia-200 overflow-hidden"
    >
      <div className="cm-app-chrome">
        <Nav
          location={location}
          backpackOpen={backpackOpen}
          onOpenBackpack={onOpenBackpack}
          walletMounted={walletMounted}
          onActivateWallet={onActivateWallet}
          onNavUtilityRef={onNavUtilityRef}
        />

        <div className="cm-app-chrome__hud" ref={hudRef} aria-label="Workspace controls">
          <div className="cm-app-chrome__hud-group" ref={onHudGroupRef}>
            {!walletMounted ? (
              <HudPlaceholder
                bellOpen={bellOpen}
                onOpenBell={() => {
                  onActivateWallet?.();
                  onBellOpenChange(true);
                }}
                overflowOpen={overflowOpen}
                onToggleOverflow={() => {
                  onActivateWallet?.();
                  onOverflowOpenChange(!overflowOpen);
                }}
                onActivateWallet={onActivateWallet}
              />
            ) : null}
          </div>
        </div>

        <main className="cm-app-chrome__main cm-web-main">
          <div
            ref={onWorkspaceRef}
            className="cm-shell-page cm-web-workspace"
          >
            {children}
          </div>
        </main>
      </div>
    </AppShell>
  );
}

function NavNetworkPlaceholder({ onActivateWallet }: { onActivateWallet?: () => void }) {
  const { selectedNetwork, getChainByNetworkId } = useChain();
  const currentChain = getChainByNetworkId(selectedNetwork);
  const colorClass = currentChain?.isTestnet
    ? "border-amber-500/40 text-amber-300"
    : "border-primary/35 text-foreground";

  return (
    <button
      type="button"
      onClick={onActivateWallet}
      aria-label="Network"
      className={cn(
        "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm cm-hud-button font-mono text-xs",
        colorClass,
        "cm-app-chrome__navselect",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 truncate">
        <NetworkGlyph network={selectedNetwork} name={currentChain?.name} />
        <span className="cm-hud-value">{currentChain?.name || "Select"}</span>
      </div>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </button>
  );
}

function HudPlaceholder({
  bellOpen,
  onOpenBell,
  overflowOpen,
  onToggleOverflow,
  onActivateWallet,
}: {
  bellOpen: boolean;
  onOpenBell: () => void;
  overflowOpen: boolean;
  onToggleOverflow: () => void;
  onActivateWallet?: () => void;
}) {
  const { paymentNetwork } = useChain();
  const [cachedAccount] = useState(() => readCachedAccount());
  const isEvm = isEvmNetwork(paymentNetwork);
  const displayAddress = cachedAccount
    ? (isEvm ? cachedAccount.address : cachedAccount.solanaAddress ?? cachedAccount.address)
    : null;
  const shortAddress = displayAddress
    ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
    : null;

  return (
    <>
      <div className="cm-app-chrome__hud-item" data-priority="medium">
        <button
          type="button"
          className="cm-hud-button cm-hud-button--icon"
          aria-label="Notifications"
          aria-expanded={bellOpen}
          onClick={onOpenBell}
        >
          <Bell className="cm-hud-icon" />
        </button>
      </div>

      <div className="cm-app-chrome__hud-item" data-priority="low" />

      <div className="cm-app-chrome__hud-item" data-priority="medium">
        {shortAddress ? (
          <button
            type="button"
            onClick={onActivateWallet}
            aria-label={`Wallet ${shortAddress}`}
            data-reconnecting="true"
            className="cm-hud-button cm-hud-wallet opacity-80"
          >
            <Wallet className="cm-hud-icon cm-hud-wallet__icon" size={18} aria-hidden="true" />
            <span className="cm-hud-value">...</span>
            <span className="cm-hud-address">{shortAddress}</span>
            <ChevronDown className="cm-hud-icon" size={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onActivateWallet}
            className="cm-hud-button cm-hud-connect"
          >
            LOGIN
          </button>
        )}
      </div>

      <div className="cm-app-chrome__hud-fold">
        <button
          type="button"
          className="cm-hud-button cm-hud-button--icon cm-hud-overflow"
          aria-label="More controls"
          aria-expanded={overflowOpen}
          onClick={onToggleOverflow}
        >
          <MoreHorizontal className="cm-hud-icon" />
        </button>
      </div>
    </>
  );
}

function Nav({
  location,
  backpackOpen,
  onOpenBackpack,
  walletMounted,
  onActivateWallet,
  onNavUtilityRef,
}: {
  location: string;
  backpackOpen: boolean;
  onOpenBackpack: () => void;
  walletMounted: boolean;
  onActivateWallet?: () => void;
  onNavUtilityRef?: (el: HTMLDivElement | null) => void;
}) {
  const navigate = useViewNavigate();

  const warmedMarketRef = useRef(false);
  const warmMarket = () => {
    if (warmedMarketRef.current) return;
    warmedMarketRef.current = true;
    void refreshAgentCatalog();
  };

  const warmedBackpackRef = useRef(false);
  const warmBackpack = () => {
    if (warmedBackpackRef.current) return;
    warmedBackpackRef.current = true;
    void import("@/components/backpack");
  };

  return (
    <nav className="cm-app-chrome__navdock" aria-label="Primary navigation">
      <div className="cm-app-chrome__navgroup">
        {links.map((link) => {
          const active = location === link.href || (link.href === "/market" && location === "/");
          return (
            <a
              key={link.href}
              href={link.href}
              onPointerEnter={link.href === "/market" ? warmMarket : undefined}
              onFocus={link.href === "/market" ? warmMarket : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                navigate(link.href);
              }}
              className="cm-app-chrome__navitem"
              data-active={active}
              aria-current={active ? "page" : undefined}
              aria-label={link.label}
              title={link.label}
            >
              <span className="cm-app-chrome__navitem-icon" aria-hidden="true">
                <link.icon />
              </span>
              <span className="cm-app-chrome__tooltip">{link.label}</span>
            </a>
          );
        })}
        <button
          type="button"
          onPointerEnter={warmBackpack}
          onFocus={warmBackpack}
          onClick={onOpenBackpack}
          className="cm-app-chrome__navitem"
          data-active={backpackOpen}
          aria-expanded={backpackOpen}
          aria-label="Backpack"
          title="Backpack"
        >
          <span className="cm-app-chrome__navitem-icon" aria-hidden="true">
            <Backpack />
          </span>
          <span className="cm-app-chrome__tooltip">Backpack</span>
        </button>
      </div>
      <div className="cm-app-chrome__navutility" aria-label="Network" ref={onNavUtilityRef}>
        {!walletMounted ? <NavNetworkPlaceholder onActivateWallet={onActivateWallet} /> : null}
      </div>
    </nav>
  );
}
