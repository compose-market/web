import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Redirect, useLocation } from "wouter";
import {
  Layout,
  OPEN_BACKPACK_EVENT,
  type BackpackTab,
  type OpenBackpackDetail,
} from "@/components/layout/Layout";
import { ChainProvider } from "@/contexts/Network";
import { queryClient, queryPersistenceOptions } from "@/lib/queryClient";
import { isStandaloneAppRoute } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import Market from "@/pages/market";

const Benchmarks = lazy(() => import("@/pages/benchmarks"));
const WalletRuntime = lazy(() => import("@/components/wallet"));

function isLightAppRoute(location: string): boolean {
  return location === "/market" || location === "/benchmarks";
}

function PageFallback() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
      <div className="space-y-3 text-center">
        <div className="mx-auto size-10 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Loading
        </p>
      </div>
    </div>
  );
}

function AppShellRouter() {
  const [location] = useLocation();
  const standalone = isStandaloneAppRoute(location);
  const lightRoute = !standalone && isLightAppRoute(location);

  const [walletRequested, setWalletRequested] = useState(() => !lightRoute && location !== "/");
  const [walletMounted, setWalletMounted] = useState(false);

  const [navUtilityEl, setNavUtilityEl] = useState<HTMLDivElement | null>(null);
  const [hudGroupEl, setHudGroupEl] = useState<HTMLDivElement | null>(null);
  const [workspaceEl, setWorkspaceEl] = useState<HTMLDivElement | null>(null);
  const [standaloneEl, setStandaloneEl] = useState<HTMLDivElement | null>(null);

  const [overflowOpen, setOverflowOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [backpackTab, setBackpackTab] = useState<BackpackTab | undefined>(undefined);
  const [backpackAgentOverride, setBackpackAgentOverride] = useState<string | undefined>(undefined);

  const routeAgentWallet = useMemo(() => {
    const match = location.match(/^\/agent\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  }, [location]);

  const activateWallet = useCallback(() => {
    setWalletRequested(true);
  }, []);

  const handleWalletMount = useCallback(() => {
    setWalletMounted(true);
  }, []);

  // Wallet-interactive routes require the wallet runtime immediately.
  useEffect(() => {
    if (!lightRoute && location !== "/") {
      setWalletRequested(true);
    }
  }, [lightRoute, location]);

  // On light routes (/market, /benchmarks), let frame 0 + avatars finish painting
  // completely before warming the wallet/session runtime in the background so
  // thirdweb never competes with First Paint, LCP, or initial scroll. Clicking any
  // HUD control or navigating to a wallet route still activates it immediately.
  useEffect(() => {
    if (walletRequested) return;
    let cancelled = false;
    let idleId = 0;
    let timeoutId = 0;

    const trigger = () => {
      if (!cancelled) setWalletRequested(true);
    };

    const scheduleIdle = () => {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(trigger, { timeout: 900 });
      } else {
        timeoutId = window.setTimeout(trigger, 450);
      }
    };

    const raf1 = requestAnimationFrame(() => {
      timeoutId = window.setTimeout(scheduleIdle, 350);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [walletRequested]);

  useEffect(() => {
    setOverflowOpen(false);
    setBackpackAgentOverride(undefined);
  }, [location]);

  useEffect(() => {
    const handleOpenBackpack = (event: Event) => {
      const detail = (event as CustomEvent<OpenBackpackDetail>).detail;
      setWalletRequested(true);
      setBackpackTab(detail?.tab);
      setBackpackAgentOverride(detail?.agentWallet);
      setBackpackOpen(true);
    };
    window.addEventListener(OPEN_BACKPACK_EVENT, handleOpenBackpack);
    return () => window.removeEventListener(OPEN_BACKPACK_EVENT, handleOpenBackpack);
  }, []);

  const openBackpackFromShell = useCallback(() => {
    setWalletRequested(true);
    setBackpackTab(undefined);
    setBackpackAgentOverride(undefined);
    setBackpackOpen(true);
  }, []);

  let workspaceContent = null;
  if (!standalone) {
    if (location === "/") {
      workspaceContent = <Redirect to="/market" replace />;
    } else if (location === "/market") {
      workspaceContent = <Market />;
    } else if (location === "/benchmarks") {
      workspaceContent = (
        <Suspense fallback={<PageFallback />}>
          <Benchmarks />
        </Suspense>
      );
    } else if (!walletMounted) {
      workspaceContent = <PageFallback />;
    }
  }

  return (
    <>
      {standalone ? (
        <div ref={setStandaloneEl} className="contents">
          {!walletMounted ? <PageFallback /> : null}
        </div>
      ) : (
        <Layout
          walletMounted={walletMounted}
          onActivateWallet={activateWallet}
          bellOpen={bellOpen}
          onBellOpenChange={setBellOpen}
          backpackOpen={backpackOpen}
          onOpenBackpack={openBackpackFromShell}
          overflowOpen={overflowOpen}
          onOverflowOpenChange={setOverflowOpen}
          onNavUtilityRef={setNavUtilityEl}
          onHudGroupRef={setHudGroupEl}
          onWorkspaceRef={setWorkspaceEl}
        >
          {workspaceContent}
        </Layout>
      )}

      {walletRequested ? (
        <Suspense fallback={null}>
          <WalletRuntime
            navUtilityEl={standalone ? null : navUtilityEl}
            hudGroupEl={standalone ? null : hudGroupEl}
            workspaceEl={standalone ? null : workspaceEl}
            standaloneEl={standalone ? standaloneEl : null}
            isLightRoute={lightRoute}
            bellOpen={bellOpen}
            onBellOpenChange={setBellOpen}
            backpackOpen={backpackOpen}
            onBackpackOpenChange={setBackpackOpen}
            backpackTab={backpackTab}
            backpackAgentWallet={backpackAgentOverride ?? routeAgentWallet}
            overflowOpen={overflowOpen}
            onOverflowOpenChange={setOverflowOpen}
            onMount={handleWalletMount}
            fallback={<PageFallback />}
          />
        </Suspense>
      ) : null}
    </>
  );
}

function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistenceOptions}>
      <ChainProvider>
        <TooltipProvider>
          <Toaster />
          <AppShellRouter />
        </TooltipProvider>
      </ChainProvider>
    </PersistQueryClientProvider>
  );
}

export default App;
