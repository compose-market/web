import { lazy, Suspense, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Route, Switch, useLocation } from "wouter";
import { ThirdwebProvider } from "thirdweb/react";
import { Bell, MoreHorizontal } from "lucide-react";
import { OwnerCacheBoundary } from "@/components/cache";
import { IdentityProvider, useSelectedUserAddress } from "@/hooks/use-address";
import { SessionProvider, useSession } from "@/hooks/use-session";
import { useWalletAccount } from "@/hooks/use-wallet";
import { useChain } from "@/contexts/Network";
import { WalletConnector } from "@/components/connector";
import { SessionIndicator } from "@/components/session";
import { NetworkSelector } from "@/components/network-selector";
import { CostReceiptIndicator } from "@/components/receipts";
import { prefetchBackpack, prefetchNotifications } from "@/lib/backpack";
import { readAgentSnapshot } from "@/lib/cache";
import { AGENTS_BASE_URL } from "@/lib/sdk";
import { isStandaloneAppRoute } from "@/lib/utils";
import type { BackpackTab } from "@/components/layout/Layout";

const DispenserButton = lazy(() =>
  import("@/components/dispenser").then((module) => ({ default: module.DispenserButton })),
);
const loadNotificationsModule = () => import("@/components/notifications");
const loadBackpackModule = () => import("@/components/backpack");
const NotificationsDialog = lazy(() =>
  loadNotificationsModule().then((module) => ({ default: module.NotificationsDialog })),
);
const BackpackDialog = lazy(() =>
  loadBackpackModule().then((module) => ({ default: module.BackpackDialog })),
);

const Create = lazy(() => import("@/pages/create"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Keys = lazy(() => import("@/pages/keys"));
const Providers = lazy(() => import("@/pages/providers"));
const Compose = lazy(() => import("@/pages/compose"));
const AgentDetail = lazy(() => import("@/pages/agent"));
const MyAssets = lazy(() => import("@/pages/profile"));
const Playground = lazy(() => import("@/pages/playground"));
const ConnectLocal = lazy(() => import("@/components/local/connect"));
const NotFound = lazy(() => import("@/pages/404"));

export interface WalletRuntimeProps {
  navUtilityEl: HTMLElement | null;
  hudGroupEl: HTMLElement | null;
  workspaceEl: HTMLElement | null;
  standaloneEl: HTMLElement | null;
  isLightRoute: boolean;
  bellOpen: boolean;
  onBellOpenChange: (open: boolean) => void;
  backpackOpen: boolean;
  onBackpackOpenChange: (open: boolean) => void;
  backpackTab?: BackpackTab;
  backpackAgentWallet?: string;
  overflowOpen: boolean;
  onOverflowOpenChange: (open: boolean) => void;
  onMount: () => void;
  fallback: ReactNode;
}

function InitializingScreen() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background">
      <div className="space-y-3 text-center">
        <div className="mx-auto size-10 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Initializing
        </p>
      </div>
    </div>
  );
}

function ChainErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="space-y-3 text-center">
        <p className="font-mono text-sm text-red-400">Failed to load chain configuration</p>
        <p className="font-mono text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}