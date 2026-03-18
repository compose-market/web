import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThirdwebProvider } from "thirdweb/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/hooks/use-session.tsx";
import { ChainProvider } from "@/contexts/ChainContext";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout/Layout";

// Pages
import Home from "@/pages/home";
import Market from "@/pages/market";
import CreateAgent from "@/pages/create-agent";
import Compose from "@/pages/compose";
import Models from "@/pages/models";
import Agents from "@/pages/agents";
import AgentDetail from "@/pages/agent";
import Registry from "@/pages/registry";
import MyAssets from "@/pages/my-assets";
import Playground from "@/pages/playground";
import Workflow from "@/pages/workflow";
import ConnectLocal from "@/pages/connect-local";
import InstallLocal from "@/pages/install-local";

function normalizeStandalonePathname(value: string): string {
  const withoutQuery = value.split("?")[0]?.split("#")[0] || "/";
  const normalized = withoutQuery.replace(/\/+$/, "");
  return normalized || "/";
}

function isStandaloneAppRoute(pathname: string): boolean {
  const normalized = normalizeStandalonePathname(pathname);
  return (
    normalized === "/connect-local"
    || normalized.startsWith("/connect-local/")
    || normalized === "/install-local"
  );
}

function Router() {
  const [location] = useLocation();

  if (isStandaloneAppRoute(location)) {
    return (
      <Switch>
        <Route path="/connect-local/:rest*" component={ConnectLocal} />
        <Route path="/connect-local" component={ConnectLocal} />
        <Route path="/install-local" component={InstallLocal} />
      </Switch>
    );
  }

  const routes = (
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
  );

  return (
    <Layout>
      {routes}
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
              <Router />
            </TooltipProvider>
          </SessionProvider>
        </ChainProvider>
      </QueryClientProvider>
    </ThirdwebProvider>
  );
}

export default App;
