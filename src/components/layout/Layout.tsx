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

function Nav({ location }: { location: string }) {
  return (
    <nav className="cm-app-chrome__navdock" aria-label="Primary navigation">
      <div className="cm-app-chrome__navgroup">
        {links.map((link) => {
          const active = location === link.href || (link.href === "/market" && location === "/");
          return (
            <Link
              key={link.href}
              href={link.href}
              className="cm-app-chrome__navitem"
              data-active={active}
              aria-current={active ? "page" : undefined}
              aria-label={link.label}
              title={link.label}
            >
              <span className="cm-app-chrome__navitem-icon" aria-hidden="true">
                <link.icon size={18} />
              </span>
              <span className="cm-app-chrome__tooltip">{link.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="cm-app-chrome__navutility" aria-label="Network">
        <NetworkSelector compact showBalance className="cm-app-chrome__navselect" />
      </div>
    </nav>
  );
}

function SearchControl({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div className="cm-app-chrome__search" data-open={open}>
      <label className="cm-search cm-search--hud" aria-label="Search agents and workflows" aria-hidden={!open}>
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          className="cm-search__input"
          type="search"
          placeholder="Search agents, workflows..."
          disabled={!open}
          tabIndex={open ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onOpenChange(false);
            }
          }}
        />
      </label>

      <button
        type="button"
        className="cm-hud-button cm-hud-button--icon cm-app-chrome__search-toggle"
        aria-label="Search"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Search className="cm-hud-icon" size={17} />
      </button>
    </div>
  );
}

function OverflowControl({
  open,
  onOpenChange,
  onOpenBenchmarks,
  onOpenNotifications,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenBenchmarks: () => void;
  onOpenNotifications: () => void;
}) {
  return (
    <div className="cm-app-chrome__hud-fold">
      <button
        type="button"
        className="cm-hud-button cm-hud-button--icon cm-hud-overflow"
        aria-label="More controls"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <MoreHorizontal className="cm-hud-icon" size={18} />
      </button>

      {open ? (
        <div className="cm-app-chrome__hud-popover">
          <div className="cm-app-chrome__hud-popover-body">
            <div className="cm-app-chrome__hud-row flex items-center justify-between gap-4 py-1 border-b border-white/5">
              <span className="cm-app-chrome__hud-popover-title text-xs text-muted-foreground font-mono">Receipts</span>
              <CostReceiptIndicator />
            </div>
            <div className="cm-app-chrome__hud-row flex items-center justify-between gap-4 py-1.5">
              <span className="cm-app-chrome__hud-popover-title text-xs text-muted-foreground font-mono">Funds</span>
              <DispenserButton />
            </div>
            <button
              type="button"
              onClick={onOpenBenchmarks}
              className="cm-hud-button w-full justify-start mt-1 text-cyan-400 hover:text-cyan-300"
            >
              <BarChart3 className="cm-hud-icon" size={16} />
              <span className="cm-hud-label">Model Benchmarks</span>
            </button>
            <button
              type="button"
              onClick={onOpenNotifications}
              className="cm-hud-button w-full justify-start mt-1 text-amber-400 hover:text-amber-300"
            >
              <Bell className="cm-hud-icon" size={16} />
              <span className="cm-hud-label">Notifications</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
