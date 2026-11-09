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

function WalletShellInner({
  navUtilityEl,
  hudGroupEl,
  workspaceEl,
  standaloneEl,
  isLightRoute,
  bellOpen,
  onBellOpenChange,
  backpackOpen,
  onBackpackOpenChange,
  backpackTab,
  backpackAgentWallet,
  overflowOpen,
  onOverflowOpenChange,
  onMount,
  fallback,
}: WalletRuntimeProps) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { isLoading: chainsLoading, error: chainsError } = useChain();
  const { isConnected } = useWalletAccount();
  const { userAddress: selectedUserAddress } = useSelectedUserAddress();
  const { sessionActive } = useSession();

  useLayoutEffect(() => {
    onMount();
  }, [onMount]);

  // Idle background warm-up for Notifications & Backpack once user is connected
  useEffect(() => {
    if (!selectedUserAddress) return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void loadNotificationsModule();
      void loadBackpackModule();
      prefetchNotifications(queryClient, selectedUserAddress);
      const firstAgentWallet = readAgentSnapshot(AGENTS_BASE_URL)?.items.find(
        (agent) => typeof agent.walletAddress === "string" && agent.walletAddress.length > 0,
      )?.walletAddress;
      prefetchBackpack(queryClient, selectedUserAddress, firstAgentWallet);
    };
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(warm, { timeout: 2500 });
      } else {
        warm();
      }
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [queryClient, selectedUserAddress, sessionActive]);

  const warmNotifications = () => {
    void loadNotificationsModule();
    prefetchNotifications(queryClient, selectedUserAddress);
  };

  const standalone = isStandaloneAppRoute(location);
  const needsWorkspaceRoute = !standalone && !isLightRoute && location !== "/";

  const renderGated = (content: ReactNode) => {
    if (chainsLoading) return <InitializingScreen />;
    if (chainsError) return <ChainErrorScreen message={chainsError.message} />;
    return <Suspense fallback={fallback}>{content}</Suspense>;
  };

  return (
    <>
      {navUtilityEl
        ? createPortal(
          <NetworkSelector compact showBalance className="cm-app-chrome__navselect" />,
          navUtilityEl,
        )
        : null}

      {hudGroupEl
        ? createPortal(
          <>
            <div className="cm-app-chrome__hud-item" data-priority="medium">
              <button
                type="button"
                className="cm-hud-button cm-hud-button--icon"
                aria-label="Notifications"
                aria-expanded={bellOpen}
                onPointerEnter={warmNotifications}
                onFocus={warmNotifications}
                onClick={() => onBellOpenChange(true)}
              >
                <Bell className="cm-hud-icon" />
              </button>
            </div>

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

            <div className="cm-app-chrome__hud-fold">
              <button
                type="button"
                className="cm-hud-button cm-hud-button--icon cm-hud-overflow"
                aria-label="More controls"
                aria-expanded={overflowOpen}
                onClick={() => onOverflowOpenChange(!overflowOpen)}
              >
                <MoreHorizontal className="cm-hud-icon" />
              </button>

              {overflowOpen ? (
                <div className="cm-app-chrome__hud-popover">
                  <div className="cm-app-chrome__hud-popover-body">
                    <div className="cm-app-chrome__hud-row flex items-center justify-between gap-4 py-1 border-b border-white/5">
                      <span className="cm-app-chrome__hud-popover-title text-xs text-muted-foreground font-mono">
                        Receipts
                      </span>
                      <CostReceiptIndicator />
                    </div>
                    <div className="cm-app-chrome__hud-row flex flex-col gap-1.5 pt-1.5">
                      <Suspense fallback={null}>
                        <DispenserButton inline />
                      </Suspense>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </>,
          hudGroupEl,
        )
        : null}

      {standalone && standaloneEl
        ? createPortal(
          renderGated(
            <Switch>
              <Route path="/connect-local/:rest*" component={ConnectLocal} />
              <Route path="/connect-local" component={ConnectLocal} />
              <Route component={NotFound} />
            </Switch>,
          ),
          standaloneEl,
        )
        : null}

      {needsWorkspaceRoute && workspaceEl
        ? createPortal(
          renderGated(
            <Switch>
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/keys" component={Keys} />
              <Route path="/providers" component={Providers} />
              <Route path="/create" component={Create} />
              <Route path="/playground" component={Playground} />
              <Route path="/compose" component={Compose} />
              <Route path="/agent/:id" component={AgentDetail} />
              <Route path="/profile" component={MyAssets} />
              <Route component={NotFound} />
            </Switch>,
          ),
          workspaceEl,
        )
        : null}

      {backpackOpen ? (
        <Suspense fallback={null}>
          <BackpackDialog
            open={backpackOpen}
            onOpenChange={onBackpackOpenChange}
            initialTab={backpackTab}
            userAddress={selectedUserAddress ?? undefined}
            agentWallet={backpackAgentWallet}
            showTrigger={false}
          />
        </Suspense>
      ) : null}

      {bellOpen ? (
        <Suspense fallback={null}>
          <NotificationsDialog open={bellOpen} onOpenChange={onBellOpenChange} />
        </Suspense>
      ) : null}
    </>
  );
}

export default function WalletRuntime(props: WalletRuntimeProps) {
  return (
    <ThirdwebProvider>
      <OwnerCacheBoundary>
        <IdentityProvider>
          <SessionProvider>
            <WalletShellInner {...props} />
          </SessionProvider>
        </IdentityProvider>
      </OwnerCacheBoundary>
    </ThirdwebProvider>
  );
}
