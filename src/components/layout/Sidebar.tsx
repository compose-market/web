import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Home, PlusCircle, Layers, Box, Activity, Sparkles, ChevronLeft, ChevronRight, Vault } from "lucide-react";
import { ComposeLogo } from "@/components/brand/Logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BackpackDialog } from "@/components/backpack";
import { NetworkSelector } from "@/components/ui/network-selector";
import { useChain } from "@/contexts/ChainContext";
import { CHAIN_CONFIG } from "@/lib/performance/chains-data";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

export function Sidebar() {
  const [location] = useLocation();
  const [vaultOpen, setVaultOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
    window.dispatchEvent(new Event("sidebarCollapsedChange"));
  }, [isCollapsed]);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);

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

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "h-screen border-r border-sidebar-border bg-sidebar/90 backdrop-blur-md flex flex-col fixed left-0 top-0 z-50 transition-all duration-300 ease-in-out",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        <div className={cn(
          "border-b border-sidebar-border flex items-center relative",
          isCollapsed ? "p-3 justify-center" : "p-6 gap-3"
        )}>
          <ComposeLogo className={cn(
            "text-cyan-400 drop-shadow-[0_0_15px_rgba(6,182,212,0.5)] transition-all duration-300",
            isCollapsed ? "w-8 h-8" : "w-10 h-10"
          )} />
          <div className={cn(
            "transition-all duration-300 overflow-hidden",
            isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}>
            <h1 className="font-display font-black text-xl tracking-tighter text-foreground leading-none whitespace-nowrap">
              COMPOSE<br />
              <span className="text-cyan-400">.MARKET</span>
            </h1>
            <p className="font-mono text-[8px] text-fuchsia-500 tracking-widest mt-1 whitespace-nowrap">POWERED BY MANOWAR</p>
          </div>

          <button
            onClick={toggleCollapse}
            className={cn(
              "absolute flex items-center justify-center w-6 h-6 rounded-full bg-sidebar-border hover:bg-cyan-950 border border-sidebar-border hover:border-cyan-400 text-muted-foreground hover:text-cyan-400 transition-all duration-200 shadow-lg",
              "-right-3"
            )}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        <nav className="flex-1 py-6 space-y-1 overflow-y-auto overflow-x-hidden">
          <div className={cn(
            "mb-2 text-xs font-mono text-muted-foreground uppercase tracking-widest transition-all duration-300",
            isCollapsed ? "px-2 text-center text-[10px]" : "px-4"
          )}>
            {isCollapsed ? "..." : "Modules"}
          </div>
          {moduleLinks.map((link) => (
            <Tooltip key={link.href}>
              <TooltipTrigger asChild>
                <Link
                  href={link.href}
                  className={cn(
                    "w-full flex items-center text-sm font-medium transition-all border-l-2 group",
                    isCollapsed ? "px-0 py-3 justify-center" : "gap-3 px-4 py-3",
                    location === link.href
                      ? "border-cyan-400 bg-cyan-950/30 text-cyan-400"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <link.icon className={cn(
                    "w-4 h-4 shrink-0",
                    location === link.href
                      ? "text-cyan-400 drop-shadow-[0_0_10px_cyan]"
                      : "group-hover:text-cyan-400"
                  )} />
                  <span className={cn(
                    "font-mono tracking-wider whitespace-nowrap transition-all duration-300",
                    isCollapsed ? "w-0 opacity-0 hidden" : "w-auto opacity-100"
                  )}>{link.label}</span>
                  {location === link.href && !isCollapsed && (
                    <div className="ml-auto w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
                  )}
                </Link>
              </TooltipTrigger>
              {isCollapsed ? (
                <TooltipContent side="right" className="font-mono text-xs">
                  {link.label}
                </TooltipContent>
              ) : null}
            </Tooltip>
          ))}

          <div className={cn(
            "mt-6 mb-2 text-xs font-mono text-muted-foreground uppercase tracking-widest transition-all duration-300",
            isCollapsed ? "px-2 text-center text-[10px]" : "px-4"
          )}>
            {isCollapsed ? "..." : "Network"}
          </div>
          {networkLinks.map((link) => (
            <Tooltip key={link.href}>
              <TooltipTrigger asChild>
                <Link
                  href={link.href}
                  className={cn(
                    "w-full flex items-center text-sm font-medium transition-all border-l-2 group",
                    isCollapsed ? "px-0 py-3 justify-center" : "gap-3 px-4 py-3",
                    location === link.href
                      ? "border-cyan-400 bg-cyan-950/30 text-cyan-400"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <link.icon className={cn(
                    "w-4 h-4 shrink-0",
                    location === link.href
                      ? "text-cyan-400 drop-shadow-[0_0_10px_cyan]"
                      : "group-hover:text-cyan-400"
                  )} />
                  <span className={cn(
                    "font-mono tracking-wider whitespace-nowrap transition-all duration-300",
                    isCollapsed ? "w-0 opacity-0 hidden" : "w-auto opacity-100"
                  )}>{link.label}</span>
                  {location === link.href && !isCollapsed && (
                    <div className="ml-auto w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
                  )}
                </Link>
              </TooltipTrigger>
              {isCollapsed ? (
                <TooltipContent side="right" className="font-mono text-xs">
                  {link.label}
                </TooltipContent>
              ) : null}
            </Tooltip>
          ))}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setVaultOpen(true)}
                className={cn(
                  "w-full flex items-center text-sm font-medium transition-all border-l-2 group",
                  isCollapsed ? "px-0 py-3 justify-center" : "gap-3 px-4 py-3",
                  "border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                )}
              >
                <Vault className="w-4 h-4 shrink-0 group-hover:text-cyan-400" />
                <span className={cn(
                  "font-mono tracking-wider whitespace-nowrap transition-all duration-300",
                  isCollapsed ? "w-0 opacity-0 hidden" : "w-auto opacity-100"
                )}>VAULT</span>
              </button>
            </TooltipTrigger>
            {isCollapsed ? (
              <TooltipContent side="right" className="font-mono text-xs">
                VAULT
              </TooltipContent>
            ) : null}
          </Tooltip>
          <BackpackDialog open={vaultOpen} onOpenChange={setVaultOpen} showTrigger={false} />
        </nav>

        <div className={cn(
          "border-t border-sidebar-border transition-all duration-300",
          isCollapsed ? "p-2" : "p-4"
        )}>
          <NetworkSelectorFooter isCollapsed={isCollapsed} />
        </div>
      </div>
    </TooltipProvider>
  );
}

function NetworkSelectorFooter({ isCollapsed }: { isCollapsed: boolean }) {
  const { selectedChainId } = useChain();
  const chainConfig = CHAIN_CONFIG[selectedChainId];
  const colorClass = chainConfig?.color === "red" ? "bg-red-400" : "bg-blue-400";

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex justify-center">
            <span className={cn("w-2.5 h-2.5 rounded-full animate-pulse cursor-default", colorClass)} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-mono text-xs">
          <span className="flex items-center gap-2">
            <span className={cn("w-2 h-2 rounded-full animate-pulse", colorClass)} />
            {chainConfig?.name || "Unknown"}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="space-y-2">
      <span className="text-xs text-muted-foreground font-mono">NETWORK</span>
      <NetworkSelector compact showBalance />
    </div>
  );
}
