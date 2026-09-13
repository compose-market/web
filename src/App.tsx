import { lazy, Suspense } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { ThirdwebProvider } from "thirdweb/react";
import { Layout } from "@/components/layout/Layout";
import { OwnerCacheBoundary } from "@/components/cache";
import { ChainProvider, useChain } from "@/contexts/Network";
import { SessionProvider } from "@/hooks/use-session";
import { queryClient, queryPersistenceOptions } from "@/lib/queryClient";
import { isStandaloneAppRoute } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

const Market = lazy(() => import("@/pages/market"));
const CreateAgent = lazy(() => import("@/pages/create-agent"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Keys = lazy(() => import("@/pages/keys"));
const Providers = lazy(() => import("@/pages/providers"));
// const Compose = lazy(() => import("@/pages/compose"));
// const Models = lazy(() => import("@/pages/models"));
// const Agents = lazy(() => import("@/pages/agents"));
const AgentDetail = lazy(() => import("@/pages/agent"));
// const Registry = lazy(() => import("@/pages/registry"));
const MyAssets = lazy(() => import("@/pages/my-assets"));
const Playground = lazy(() => import("@/pages/playground"));
const Benchmarks = lazy(() => import("@/pages/benchmarks"));
// const Workflow = lazy(() => import("@/pages/workflow"));
const ConnectLocal = lazy(() => import("@/pages/connect-local"));
// const InstallLocal = lazy(() => import("@/pages/install-local"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-muted-foreground">
          Loading Module
        </p>
      </div>
    </div>
  );
}

function AppRouter() {
  const [location] = useLocation();

  if (isStandaloneAppRoute(location)) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Switch>
          {<Route path="/connect-local/:rest*" component={ConnectLocal} />}
          <Route path="/connect-local" component={ConnectLocal} />
          {/* <Route path="/install-local" component={InstallLocal} /> */}
        </Switch>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/">
            <Redirect to="/playground" replace />
          </Route>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/keys" component={Keys} />
          <Route path="/providers" component={Providers} />
          <Route path="/create-agent" component={CreateAgent} />
          <Route path="/playground" component={Playground} />
          <Route path="/benchmarks" component={Benchmarks} />
          <Route path="/market" component={Market} />
          {/* <Route path="/compose" component={Compose} /> */}
          {/* <Route path="/models" component={Models} /> */}
          {/* <Route path="/agents" component={Agents} /> */}
          <Route path="/agent/:id" component={AgentDetail} />
          {/* <Route path="/registry" component={Registry} /> */}
          <Route path="/my-assets" component={MyAssets} />
          {/* <Route path="/workflow/:id" component={Workflow} /> */}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function AppInner() {
  const { isLoading, error } = useChain();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-muted-foreground">
            Initializing
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <p className="font-mono text-sm text-red-400">Failed to load chain configuration</p>
          <p className="font-mono text-xs text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <SessionProvider>
      <TooltipProvider>
        <Toaster />
        <AppRouter />
      </TooltipProvider>
    </SessionProvider>
  );
}

function App() {
  return (
    <ThirdwebProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistenceOptions}>
        <OwnerCacheBoundary>
          <ChainProvider>
            <AppInner />
          </ChainProvider>
        </OwnerCacheBoundary>
      </PersistQueryClientProvider>
    </ThirdwebProvider>
  );
}

export default App;
