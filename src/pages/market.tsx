/**
 * Market — Agents, Workflows & Bounties
 *
 * Opens directly onto a breathable, visual-first marketplace grid with
 * View Transition card-to-agent morphing. Secondary tabs (Workflows, RFAs)
 * lazy-load on click so the default Agents grid boots with zero bloat.
 */
import * as React from "react";
import { useState, useDeferredValue, useMemo, useEffect, startTransition } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { OnchainAgent } from "@/hooks/use-onchain";
import { useAgentCatalog, useSemanticAgentSearch } from "@/hooks/use-agents";
import { mergeSemanticAgentRanks, rankCatalogAgents, toOnchainAgent } from "@/lib/agents";
import { useTabs } from "@/hooks/use-tabs";
import { AgentCard as SharedAgentCard, AgentCardSkeleton as SharedAgentCardSkeleton } from "@/components/identikit";
import { Ordering, SearchFold, Switcher, type Option } from "@/components/control";
import { useViewNavigate } from "@/motion/snap";
import { useGridTilt } from "@/motion/tilt";
import Bot from "lucide-react/icons/bot";
import Clock from "lucide-react/icons/clock";
import DollarSign from "lucide-react/icons/dollar-sign";
import FileQuestion from "lucide-react/icons/file-question";
import Layers from "lucide-react/icons/layers";

const LazyWorkflowsTab = React.lazy(() =>
  import("@/components/boards").then((module) => ({ default: module.WorkflowsTab })),
);
const LazyRFAsTab = React.lazy(() =>
  import("@/components/boards").then((module) => ({ default: module.RFAsTab })),
);

type MarketTab = "agents" | "workflows" | "rfas";
type AgentSort = "newest" | "price-low" | "price-high";
type WorkflowSort = "newest" | "price-low" | "price-high";

type TabStatus = {
  count: string;
  busy: boolean;
};

const INITIAL_PAINT_CARDS = 20;

const orders: Option<AgentSort>[] = [
  { value: "newest", label: "Newest", icon: Clock },
  { value: "price-low", label: "Price: Low to High", icon: DollarSign },
  { value: "price-high", label: "Price: High to Low", icon: DollarSign },
];

export default function Market() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const deferredQuery = useDeferredValue(searchQuery);

  const [activeTab, setActiveTab] = useTabs("market", "agents");
  const tab: MarketTab = activeTab === "workflows" || activeTab === "rfas" ? activeTab : "agents";
  const [agentSort, setAgentSort] = useState<AgentSort>("newest");
  const [workflowSort, setWorkflowSort] = useState<WorkflowSort>("newest");
  const refreshers = React.useRef<Partial<Record<MarketTab, () => void>>>({});
  const [status, setStatus] = useState<Record<MarketTab, TabStatus>>({
    agents: { count: "0", busy: false },
    workflows: { count: "0", busy: false },
    rfas: { count: "0", busy: false },
  });

  const onStatus = React.useCallback((key: MarketTab, next: TabStatus & { refresh?: () => void }) => {
    refreshers.current[key] = next.refresh;
    setStatus((current) => {
      const previous = current[key];
      if (previous.count === next.count && previous.busy === next.busy) return current;
      return { ...current, [key]: { count: next.count, busy: next.busy } };
    });
  }, []);

  const marketTabs = React.useMemo<Option<MarketTab>[]>(() => [
    { value: "agents", label: "Agents", icon: Bot, count: status.agents.count },
    { value: "workflows", label: "Workflows", icon: Layers, count: status.workflows.count },
    { value: "rfas", label: "RFAs", icon: FileQuestion, count: status.rfas.count },
  ], [status.agents.count, status.workflows.count, status.rfas.count]);

  const q = deferredQuery.trim();

  return (
    <div className="cm-market-workspace">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="cm-market-tabs w-full">
        <div className="cm-control-rail cm-market-control-rail">
          <div className="cm-market-control-rail__brand">
            <h1 className="cm-page-header__title cm-market-control-rail__title" data-route-heading>
              <span className="text-fuchsia-500 mr-2">//</span>
              MARKET
            </h1>
          </div>
          <Switcher
            value={tab}
            options={marketTabs}
            label="Market section"
            onChange={setActiveTab}
            className="cm-market-control-rail__tabs"
          />
          <div className="cm-market-control-rail__actions">
            <SearchFold
              open={searchOpen}
              value={searchQuery}
              label="Search market"
              placeholder="Search market..."
              onOpenChange={setSearchOpen}
              onChange={setSearchQuery}
            />
            {tab === "agents" ? (
              <Ordering value={agentSort} options={orders} onChange={setAgentSort} disabled={Boolean(q)} />
            ) : null}
            {tab === "workflows" ? (
              <Ordering value={workflowSort} options={orders} onChange={setWorkflowSort} />
            ) : null}
          </div>
        </div>

        <TabsContent value="agents" className="cm-market-tab-panel cm-market-tab-panel--agents mt-0">
          {activeTab === "agents" ? (
            <AgentsTab searchQuery={deferredQuery} sort={agentSort} onStatus={onStatus} />
          ) : null}
        </TabsContent>

        <TabsContent value="workflows" className="cm-market-tab-panel cm-market-tab-panel--scroll mt-0">
          {activeTab === "workflows" ? (
            <React.Suspense fallback={null}>
              <LazyWorkflowsTab searchQuery={deferredQuery} sort={workflowSort} onStatus={onStatus} />
            </React.Suspense>
          ) : null}
        </TabsContent>

        <TabsContent value="rfas" className="cm-market-tab-panel cm-market-tab-panel--scroll mt-0">
          {activeTab === "rfas" ? (
            <React.Suspense fallback={null}>
              <LazyRFAsTab searchQuery={deferredQuery} onStatus={onStatus} />
            </React.Suspense>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// Agents Tab — Visual-First Marketplace Grid
// =============================================================================

function AgentsTab({
  searchQuery,
  sort,
  onStatus,
}: {
  searchQuery: string;
  sort: AgentSort;
  onStatus: (tab: MarketTab, status: TabStatus & { refresh?: () => void }) => void;
}) {
  const navigate = useViewNavigate();
  const gridRef = useGridTilt<HTMLDivElement>({ maxDeg: 2.5, enabled: true });
  const q = searchQuery.trim();
  const [hydratedAll, setHydratedAll] = useState(false);

  const handleOpenAgent = React.useCallback((triggerEl?: HTMLElement | null, targetAgent?: OnchainAgent) => {
    if (!targetAgent) return;
    const agentPageUrl = targetAgent.walletAddress
      ? `/agent/${targetAgent.walletAddress}`
      : targetAgent.id > 0 ? `/agent/${targetAgent.id}` : "/market";
    navigate(agentPageUrl, {
      element: triggerEl,
      transitionName: "agent-card-hero",
    });
  }, [navigate]);

  const {
    agents: snapshot,
    isLoading,
    isRefetching,
    error,
    forceRefresh,
    lastUpdated,
  } = useAgentCatalog();

  const { hits: semanticHits, isLoading: isSearching } = useSemanticAgentSearch(q, {
    enabled: Boolean(q),
  });

  const cards = useMemo(() => {
    if (!q) return snapshot;
    return mergeSemanticAgentRanks(snapshot, rankCatalogAgents(snapshot, q), semanticHits)
      .map((entry) => entry.agent);
  }, [q, snapshot, semanticHits]);

  const agents = useMemo(() => {
    const seen = new Set<string>();
    const out: OnchainAgent[] = [];
    for (const card of cards) {
      if (!card.walletAddress) continue;
      if (seen.has(card.walletAddress)) continue;
      seen.add(card.walletAddress);
      out.push(toOnchainAgent(card));
    }
    if (!q && (sort === "price-low" || sort === "price-high")) {
      out.sort((a, b) => {
        const left = Number.parseFloat(a.licensePrice) || 0;
        const right = Number.parseFloat(b.licensePrice) || 0;
        return sort === "price-low" ? left - right : right - left;
      });
    }
    return out;
  }, [cards, q, sort]);

  // Paint the first visible viewport batch on frame 0 so LCP lands immediately,
  // then commit the rest on the very next animation frame before scrolling starts.
  useEffect(() => {
    if (hydratedAll || agents.length <= INITIAL_PAINT_CARDS) return;
    const raf = requestAnimationFrame(() => {
      startTransition(() => {
        setHydratedAll(true);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [agents.length, hydratedAll]);

  const renderedAgents = hydratedAll || agents.length <= INITIAL_PAINT_CARDS
    ? agents
    : agents.slice(0, INITIAL_PAINT_CARDS);

  React.useEffect(() => {
    const count = isLoading ? "..." : String(agents.length);
    onStatus("agents", {
      count,
      busy: isLoading || isSearching,
      refresh: () => void forceRefresh(),
    });
  }, [agents.length, forceRefresh, isLoading, isSearching, onStatus]);

  return (
    <div className="cm-market-agents">
      <div
        className="cm-market-agent-canvas"
        aria-label="Agents marketplace"
        data-refreshing={isRefetching ? "true" : undefined}
        data-updated={lastUpdated ? lastUpdated.toISOString() : undefined}
      >
        {isLoading && (
          <div className="cm-market-agent-grid">
            {[...Array(9)].map((_, i) => (
              <SharedAgentCardSkeleton key={i} />
            ))}
          </div>
        )}

        {error && (
          <div className="cm-market-state">
            <Bot className="cm-market-state__icon text-red-400/50" />
            <p className="text-red-400">{error.message}</p>
            <Button variant="outline" onClick={() => void forceRefresh()}>
              Try Again
            </Button>
          </div>
        )}

        {!isLoading && renderedAgents.length > 0 && (
          <div ref={gridRef} className="cm-market-agent-grid">
            {renderedAgents.map((agent, index) => (
              <div
                key={agent.walletAddress || `${agent.id}-${index}`}
                className="cm-market-agent-slot"
              >
                <SharedAgentCard
                  agent={agent}
                  variant="market"
                  priority={index < 12}
                  onOpen={handleOpenAgent}
                />
              </div>
            ))}
          </div>
        )}

        {agents.length === 0 && !isLoading && (
          <div className="cm-market-state">
            <Bot className="cm-market-state__icon text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm sm:text-base">
              {searchQuery ? "No agents match your search" : "No agents available yet"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
