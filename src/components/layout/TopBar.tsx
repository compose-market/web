import { Bell, Search, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WalletConnector, useWalletAccount } from "@/components/connector";
import { SessionIndicator } from "@/components/session";
import { FaucetButton } from "@/components/faucet";
import { cn } from "@/lib/utils";

interface TopBarProps {
  sidebarCollapsed?: boolean;
}

export function TopBar({ sidebarCollapsed = false }: TopBarProps) {
  const { isConnected } = useWalletAccount();

  return (
    <header className={cn(
      "h-16 border-b border-sidebar-border bg-background/80 backdrop-blur-md fixed top-0 right-0 left-0 z-40 flex items-center justify-between px-4 md:px-6 gap-4 transition-all duration-300",
      sidebarCollapsed ? "md:left-16" : "md:left-64"
    )}>
      {/* Search Bar - responsive width */}
      <div className="flex items-center flex-1 md:flex-none md:w-1/3 min-w-0">
        <div className="relative w-full max-w-md flex items-center bg-sidebar-accent border border-sidebar-border rounded-sm p-1">
          <Search className="w-4 h-4 text-muted-foreground ml-2 shrink-0" />
          <Input
            type="text"
            placeholder="Search agents, workflows..."
            className="bg-transparent border-none text-sm text-foreground focus:ring-0 placeholder:text-muted-foreground font-mono w-full min-w-0"
          />
        </div>
      </div>

      {/* Right Side Actions - responsive gaps */}
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-cyan-400 hover:bg-cyan-400/10 h-9 w-9 md:h-10 md:w-10">
          <Bell className="w-4 h-4 md:w-5 md:h-5" />
          <span className="absolute top-1.5 right-1.5 md:top-2 md:right-2 w-2 h-2 bg-fuchsia-500 rounded-full animate-ping" />
        </Button>

        {/* Faucet button */}
        <FaucetButton />

        {/* Session budget indicator (only when connected) */}
        {isConnected && <SessionIndicator />}

        <WalletConnector compact />
      </div>
    </header>
  );
}

