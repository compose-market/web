import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, useLocation } from "wouter";
import { ThirdwebProvider } from "thirdweb/react";
import { Layout } from "@/components/layout/Layout";
import { ChainProvider } from "@/contexts/ChainContext";
import { SessionProvider } from "@/hooks/use-session";
import { queryClient } from "@/lib/queryClient";
import { isStandaloneAppRoute } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

const Home = lazy(() => import("@/pages/home"));
const Market = lazy(() => import("@/pages/market"));
const CreateAgent = lazy(() => import("@/pages/create-agent"));
const Compose = lazy(() => import("@/pages/compose"));
const Models = lazy(() => import("@/pages/models"));
const Agents = lazy(() => import("@/pages/agents"));
const AgentDetail = lazy(() => import("@/pages/agent"));
const Registry = lazy(() => import("@/pages/registry"));
const MyAssets = lazy(() => import("@/pages/my-assets"));
const Playground = lazy(() => import("@/pages/playground"));
const Workflow = lazy(() => import("@/pages/workflow"));
const ConnectLocal = lazy(() => import("@/pages/connect-local"));
const InstallLocal = lazy(() => import("@/pages/install-local"));
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
          <Route path="/connect-local/:rest*" component={ConnectLocal} />
          <Route path="/connect-local" component={ConnectLocal} />
          <Route path="/install-local" component={InstallLocal} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/market" component={Market} />
          <Route path="/create-agent" component={CreateAgent} />
          <Route path="/compose" component={Compose} />
          <Route path="/models" component={Models} />
          <Route path="/agents" component={Agents} />
          <Route path="/agent/:id" component={AgentDetail} />
          <Route path="/registry" component={Registry} />
          <Route path="/my-assets" component={MyAssets} />
          <Route path="/playground" component={Playground} />
          <Route path="/workflow/:id" component={Workflow} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <ThirdwebProvider>
      <QueryClientProvider client={queryClient}>
        <ChainProvider>
          <SessionProvider>
            <TooltipProvider>
              <Toaster />
              <AppRouter />
            </TooltipProvider>
          </SessionProvider>
        </ChainProvider>
      </QueryClientProvider>
    </ThirdwebProvider>
  );
}

export default App;
