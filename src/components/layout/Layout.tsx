import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  BarChart3,
  Bell,
  Box,
  Key,
  Layers,
  MoreHorizontal,
  PlusCircle,
  Scale,
  Search,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@compose-market/theme/app";
import { WalletConnector } from "@/components/connector";
import { useWalletAccount } from "@/hooks/use-wallet";
import { SessionIndicator } from "@/components/session";
import { useSession } from "@/hooks/use-session";
import { DispenserButton } from "@/components/dispenser";
import { NetworkSelector } from "@/components/network-selector";
import { CostReceiptIndicator } from "@/components/receipt-indicator";

interface LayoutProps {
  children: ReactNode;
}

const links = [
  // { href: "/market", icon: Box, label: "Market" },
  // { href: "/compose", icon: Layers, label: "Compose" },
  { href: "/dashboard", icon: BarChart3, label: "Dashboard" },
  { href: "/keys", icon: Key, label: "API Keys" },
  { href: "/create-agent", icon: PlusCircle, label: "Create Agent" },
  { href: "/playground", icon: Sparkles, label: "Playground" },
  { href: "/benchmarks", icon: Scale, label: "Benchmarks" },
  // { href: "/my-assets", icon: Activity, label: "My Assets" },
];

export function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const { isConnected } = useWalletAccount();
  const { sessionActive } = useSession();

  useEffect(() => {
    setSearchOpen(false);
    setOverflowOpen(false);
  }, [location]);

  useEffect(() => {
    if (!searchOpen && !overflowOpen) {
      return;
    }

    function close(event: MouseEvent): void {
      if (hudRef.current?.contains(event.target as Node)) {
        return;
      }
      setSearchOpen(false);
      setOverflowOpen(false);
    }

    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [overflowOpen, searchOpen]);

  return (
    <AppShell
      className="cm-app-shell--luminescent"
      contentClassName="h-dvh min-h-0 text-foreground font-sans selection:bg-fuchsia-500/30 selection:text-fuchsia-200 overflow-hidden"
    >
      <div className="cm-app-chrome">
        <Nav location={location} />

        <div className="cm-app-chrome__hud" ref={hudRef} aria-label="Workspace controls">
          <div className="cm-app-chrome__hud-group" data-search-open={searchOpen}>
            <SearchControl
              open={searchOpen}
              onOpenChange={(open) => {
                setSearchOpen(open);
                if (open) {
                  setOverflowOpen(false);
                }
              }}
            />

            <div className="cm-app-chrome__hud-item" data-priority="low">
              <CostReceiptIndicator />
            </div>

            {isConnected || sessionActive ? (
              <div className="cm-app-chrome__hud-item" data-priority="medium">
                <SessionIndicator />
              </div>
            ) : null}

            <div className="cm-app-chrome__hud-item" data-priority="medium">
              <WalletConnector compact className="cm-hud-button" />
            </div>

            <OverflowControl
              open={overflowOpen}
              onOpenChange={(open) => {
                setOverflowOpen(open);
                if (open) {
                  setSearchOpen(false);
                }
              }}
              onOpenBenchmarks={() => {
                setOverflowOpen(false);
                setLocation("/benchmarks");
              }}
            />
          </div>
        </div>

        <main className="cm-app-chrome__main cm-web-main">
          <div className="cm-shell-page cm-web-workspace animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </main>
      </div>
    </AppShell>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenBenchmarks: () => void;
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
            <button type="button" className="cm-hud-button w-full justify-start mt-1">
              <Bell className="cm-hud-icon" size={16} />
              <span className="cm-hud-label">Alerts</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
