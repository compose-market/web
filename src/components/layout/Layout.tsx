import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Menu, X, Home, Box, Layers, PlusCircle, Sparkles, Activity, Vault } from "lucide-react";
import { ComposeLogo } from "@/components/brand/Logo";
import { WalletConnector, useWalletAccount } from "@/components/connector";
import { BackpackDialog } from "@/components/backpack";
import { SessionIndicator } from "@/components/session";
import { DispenserButton } from "@/components/dispenser";
import { NetworkSelector } from "@/components/ui/network-selector";
import { cn } from "@/lib/utils";
import { ComposeAppShell } from "@compose-market/theme/app";

interface LayoutProps {
  children: React.ReactNode;
}

const moduleLinks = [
  { href: "/", icon: Home, label: "HOME" },
  { href: "/market", icon: Box, label: "MARKET" },
  { href: "/compose", icon: Layers, label: "COMPOSE" },
  { href: "/create-agent", icon: PlusCircle, label: "CREATE AGENT" },
  { href: "/playground", icon: Sparkles, label: "PLAYGROUND" },
];

const networkLinks = [
  { href: "/my-assets", icon: Activity, label: "MY ASSETS" },
];

export function Layout({ children }: LayoutProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [location] = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileVaultOpen, setMobileVaultOpen] = useState(false);
  const { isConnected } = useWalletAccount();

  useEffect(() => {
    const checkCollapsed = () => {
      setSidebarCollapsed(localStorage.getItem("sidebar_collapsed") === "true");
    };

    checkCollapsed();
    window.addEventListener("sidebarCollapsedChange", checkCollapsed);
    window.addEventListener("storage", checkCollapsed);

    return () => {
      window.removeEventListener("sidebarCollapsedChange", checkCollapsed);
      window.removeEventListener("storage", checkCollapsed);
    };
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location]);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  return (
    <ComposeAppShell
      contentClassName="min-h-screen text-foreground font-sans selection:bg-fuchsia-500/30 selection:text-fuchsia-200 overflow-x-hidden"
    >
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300",
          isMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsMenuOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed md:hidden w-[280px] max-w-[85vw] h-full bg-background/98 border-r border-sidebar-border flex flex-col backdrop-blur-md transition-transform duration-300 ease-out z-50",
          isMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-5 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ComposeLogo className="w-9 h-9 text-cyan-400 drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]" />
            <div>
              <h1 className="font-display font-black text-lg tracking-tighter text-foreground leading-none">
                COMPOSE<br />
                <span className="text-cyan-400">.MARKET</span>
              </h1>
              <p className="font-mono text-[7px] text-fuchsia-500 tracking-widest mt-0.5">POWERED BY MANOWAR</p>
            </div>
          </div>
          <button
            onClick={() => setIsMenuOpen(false)}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="px-4 mb-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Modules</div>
          {moduleLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium transition-all border-l-2 group active:bg-cyan-950/40",
                location === link.href
                  ? "border-cyan-400 bg-cyan-950/30 text-cyan-400"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
              )}
            >
              <link.icon className={cn(
                "w-5 h-5",
                location === link.href
                  ? "text-cyan-400 drop-shadow-[0_0_10px_cyan]"
                  : "group-hover:text-cyan-400"
              )} />
              <span className="font-mono tracking-wider">{link.label}</span>
              {location === link.href ? (
                <div className="ml-auto w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
              ) : null}
            </Link>
          ))}

          <div className="px-4 mt-5 mb-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Network</div>
          {networkLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium transition-all border-l-2 group active:bg-cyan-950/40",
                location === link.href
                  ? "border-cyan-400 bg-cyan-950/30 text-cyan-400"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
              )}
            >
              <link.icon className={cn(
                "w-5 h-5",
                location === link.href
                  ? "text-cyan-400 drop-shadow-[0_0_10px_cyan]"
                  : "group-hover:text-cyan-400"
              )} />
              <span className="font-mono tracking-wider">{link.label}</span>
              {location === link.href ? (
                <div className="ml-auto w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
              ) : null}
            </Link>
          ))}

          <button
            onClick={() => setMobileVaultOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium transition-all border-l-2 group active:bg-cyan-950/40 border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
          >
            <Vault className="w-5 h-5 group-hover:text-cyan-400" />
            <span className="font-mono tracking-wider">VAULT</span>
          </button>
          <BackpackDialog open={mobileVaultOpen} onOpenChange={setMobileVaultOpen} showTrigger={false} />
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground font-mono">NETWORK</span>
            <NetworkSelector compact showBalance />
          </div>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-background/95 backdrop-blur-md border-b border-sidebar-border flex items-center justify-between px-3 z-30 safe-area-top">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 text-muted-foreground border border-sidebar-border rounded-sm hover:border-cyan-500/50 active:bg-cyan-500/10 transition-colors touch-manipulation shrink-0"
            aria-label="Toggle menu"
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <ComposeLogo className="w-6 h-6 text-cyan-400 shrink-0" />
          <span className="font-display font-bold text-white tracking-tight text-xs truncate hidden xs:block">COMPOSE.MARKET</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <DispenserButton />
          {isConnected ? <SessionIndicator /> : null}
          <WalletConnector compact />
        </div>
      </div>

      <div className="hidden md:block">
        <TopBar sidebarCollapsed={sidebarCollapsed} />
      </div>

      <main className={cn(
        "pl-0 pt-14 md:pt-16 min-h-screen relative overflow-hidden transition-all duration-300",
        sidebarCollapsed ? "md:pl-16" : "md:pl-64"
      )}>
        <div className="relative z-10 p-4 md:p-6 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
          {children}
        </div>
      </main>
    </ComposeAppShell>
  );
}
