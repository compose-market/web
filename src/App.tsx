import { Switch, Route } from "wouter";
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
import Manowar from "@/pages/manowar";

function Router() {
  return (
    <Layout>
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
        <Route path="/manowar/:id" component={Manowar} />
        <Route component={NotFound} />
      </Switch>
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
