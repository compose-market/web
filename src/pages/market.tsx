/**
 * Market - Agents, Workflows & RFA Bounties
 * 
 * Browse and purchase ERC7401 workflow NFTs and submit agents for RFA bounties.
 */
import { useState, useDeferredValue } from "react";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { usePostHog } from "@posthog/react";
import { Excerpt } from "@compose-market/theme/shell";
import { WorkflowCard as WorkflowCardShell, WorkflowCardSkeleton } from "@compose-market/theme/workflows";
import { mpTrack } from "@/lib/mixpanel";
import { Link, useLocation } from "wouter";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OnchainAgent, OnchainWorkflow, OnchainRFA } from "@/hooks/use-onchain";
import { useAgentCatalog, useSemanticAgentSearch } from "@/hooks/use-agents";
import { mergeSemanticAgentRanks, rankCatalogAgents, toOnchainAgent } from "@/lib/agents";
import { useTabs } from "@/hooks/use-tabs";
import { getIpfsUrl } from "@/lib/pinata";
import {
  CHAIN_CONFIG,
  RFA_BOUNTY_LIMITS,
  getContractAddress,
} from "@/lib/performance/chains-data";
import { AgentCard as SharedAgentCard, AgentCardSkeleton as SharedAgentCardSkeleton } from "@/components/agent-card";
import { Ordering, SearchFold, Switcher, type Option } from "@/components/control";
import {
  Box,
  Layers,
  Sparkles,
  RefreshCw,
  DollarSign,
  Clock,
  Users,
  Zap,
  FileQuestion,
  Award,
  Package,
  Percent,
  Target,
  ExternalLink,
  Bot,
} from "lucide-react";

const RFADetails = React.lazy(() =>
  import("@/components/RFADetails").then((module) => ({ default: module.RFADetails })),
);

function evmChainIdFromNetwork(network: string | undefined): number | null {
  if (!network?.startsWith("eip155:")) return null;
  const chainId = Number.parseInt(network.slice("eip155:".length), 10);
  return Number.isInteger(chainId) && chainId > 0 ? chainId : null;
}

function networkLabel(network: string | undefined): string | null {
  if (!network) return null;
  const chainId = evmChainIdFromNetwork(network);
  return chainId ? CHAIN_CONFIG[chainId]?.name ?? network : network;
}

function workflowExplorerUrl(workflow: OnchainWorkflow): string | null {
  const network = workflow.network ?? workflow.metadata?.network;
  const chainId = evmChainIdFromNetwork(network);
  if (!chainId || !CHAIN_CONFIG[chainId]) return null;
  return `${CHAIN_CONFIG[chainId].explorer}/token/${getContractAddress("Workflow", chainId)}?a=${workflow.id}`;
}

type MarketTab = "agents" | "workflows" | "rfas";
type AgentSort = "newest" | "price-low" | "price-high";
type WorkflowSort = "newest" | "price-low" | "price-high";

type TabStatus = {
  count: string;
  busy: boolean;
};

const tabs: Option<MarketTab>[] = [
  { value: "agents", label: "Agents", icon: Bot },
  { value: "workflows", label: "Workflows", icon: Layers },
  { value: "rfas", label: "RFAs", icon: FileQuestion },
];

const orders: Option<AgentSort>[] = [
  { value: "newest", label: "Newest", icon: Clock },
  { value: "price-low", label: "Price: Low to High", icon: DollarSign },
  { value: "price-high", label: "Price: High to Low", icon: DollarSign },
];

export default function Market() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Defer search filtering so typing stays responsive (Fix 8)
  const deferredQuery = useDeferredValue(searchQuery);

  // Persisted tab state - survives browser back/forward navigation
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

  const handleRefresh = React.useCallback(() => {
    refreshers.current[tab]?.();
  }, [tab]);

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
            <h1 className="cm-page-header__title cm-market-control-rail__title">
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
              onChange={(value) => {
                setSearchQuery(value);
                if (value.trim()) {
                  mpTrack("Search", { "Search Query": value.trim() });
                }
              }}
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
            <WorkflowsTab searchQuery={deferredQuery} sort={workflowSort} onStatus={onStatus} />
          ) : null}
        </TabsContent>

        <TabsContent value="rfas" className="cm-market-tab-panel cm-market-tab-panel--scroll mt-0">
          {activeTab === "rfas" ? <RFAsTab searchQuery={deferredQuery} onStatus={onStatus} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// Workflows Tab - Complete ERC7401 Workflows
// =============================================================================

function useMarketWorkflows(options: { includeRFA?: boolean; onlyComplete?: boolean }) {
  const { includeRFA = false, onlyComplete = true } = options;

  return useQuery({
    queryKey: ["onchain-workflows", "all-chains", includeRFA, onlyComplete],
    queryFn: async () => {
      const { fetchOnchainWorkflows } = await import("@/hooks/use-onchain");
      return fetchOnchainWorkflows({ includeRFA, onlyComplete });
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });
}

function WorkflowsTab({
  searchQuery,
  sort,
  onStatus,
}: {
  searchQuery: string;
  sort: WorkflowSort;
  onStatus: (tab: MarketTab, status: TabStatus & { refresh?: () => void }) => void;
}) {
  const { data: workflows, isLoading, error, refetch } = useMarketWorkflows({
    onlyComplete: true,
    includeRFA: false
  });

  // Filter and sort
  const filteredWorkflows = React.useMemo(() => {
    if (!workflows) return [];

    let filtered = workflows;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      switch (sort) {
        case "price-low":
          return parseFloat(a.totalPrice) - parseFloat(b.totalPrice);
        case "price-high":
          return parseFloat(b.totalPrice) - parseFloat(a.totalPrice);
        case "newest":
        default:
          // Sort by minting date (from IPFS metadata), newest first
          const aDate = a.metadata?.createdAt ? new Date(a.metadata.createdAt).getTime() : 0;
          const bDate = b.metadata?.createdAt ? new Date(b.metadata.createdAt).getTime() : 0;
          return bDate - aDate;
      }
    });

    return filtered;
  }, [workflows, searchQuery, sort]);

  React.useEffect(() => {
    const count = workflows
      ? String(filteredWorkflows.length)
      : isLoading
        ? "..."
        : "0";
    onStatus("workflows", {
      count,
      busy: isLoading,
      refresh: () => void refetch(),
    });
  }, [filteredWorkflows.length, isLoading, onStatus, refetch, searchQuery, workflows]);

  return (
    <div className="cm-market-board">
      {/* Loading State */}
      {isLoading && (
        <div className="cm-market-row-grid">
          {[...Array(6)].map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-10 sm:py-12">
          <Box className="w-12 h-12 mx-auto text-red-400/50 mb-4" />
          <p className="text-red-400">{error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => refetch()}
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Workflows Grid */}
      {!isLoading && filteredWorkflows.length > 0 && (
        <div className="cm-market-row-grid">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard key={workflow.id} workflow={workflow} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {filteredWorkflows.length === 0 && !isLoading && (
        <div className="cm-empty-state-inline">
          <Layers className="cm-empty-state-inline__icon" />
          <p className="cm-empty-state-inline__text">
            {searchQuery ? "No workflows match your search" : "No workflows available yet"}
          </p>
          <Link href="/compose">
            <Button className="mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-bold text-sm">
              CREATE FIRST WORKFLOW
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// Memoized card component to avoid re-renders when list changes (Fix 9)
const WorkflowCard = React.memo(function WorkflowCard({ workflow }: { workflow: OnchainWorkflow }) {
  const posthog = usePostHog();
  const bannerUrl = workflow.image && workflow.image.startsWith("ipfs://")
    ? getIpfsUrl(workflow.image.replace("ipfs://", ""))
    : null;

  const unitsAvailable = workflow.units === 0 ? "∞" : `${workflow.units - workflow.unitsMinted}/${workflow.units}`;

  // Use wallet address for navigation (primary), fallback to numeric ID
  const workflowPageUrl = workflow.walletAddress
    ? `/workflow/${workflow.walletAddress}`
    : `/workflow/${workflow.id}`;

  return (
    <Link href={workflowPageUrl} className="block">
      <WorkflowCardShell
        interactive
        className="cm-market-card"
        bannerSrc={bannerUrl}
        title={workflow.title || `Workflow #${workflow.id}`}
        titleIcon={<Layers />}
        description={(
          <Excerpt title={workflow.title || `Workflow #${workflow.id}`} text={workflow.description || "No description"} lines={2}>
            {workflow.description || "No description"}
          </Excerpt>
        )}
        badges={(
          <>
            {(workflow.network ?? workflow.metadata?.network) && (() => {
              const network = (workflow.network ?? workflow.metadata?.network)!;
              return (
                <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-xs">
                  {networkLabel(network)}
                </Badge>
              );
            })()}
            <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
              <Sparkles className="w-3 h-3 mr-1" />
              ERC-7401
            </Badge>
            {workflow.leaseEnabled ? (
              <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                <Percent className="w-3 h-3 mr-1" />
                Leaseable
              </Badge>
            ) : null}
          </>
        )}
        stats={[
          { value: `${workflow.totalPrice} USDC`, icon: <DollarSign />, tone: "green", tooltip: "Total Price" },
          { value: String(workflow.agentIds?.length || "?"), icon: <Zap />, tone: "cyan", tooltip: "Agents" },
          { value: unitsAvailable, icon: <Package />, tone: "cyan", tooltip: "Supply" },
          ...(workflow.coordinatorModel ? [{ value: workflow.coordinatorModel, icon: <Users />, tone: "warning" as const, tooltip: "Coordinator" }] : []),
        ]}
        footer={(
          <div className="cm-market-card__footer flex gap-2">
            <Button
              className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-bold font-mono text-xs h-8 sm:h-9"
              onClick={(e) => {
                e.stopPropagation();
                posthog?.capture("market_workflow_purchase_clicked", {
                  workflow_id: workflow.id,
                  workflow_title: workflow.title,
                  total_price: workflow.totalPrice,
                  workflow_wallet: workflow.walletAddress,
                });
                mpTrack("Purchase", {
                  transaction_id: `market_${workflow.id}`,
                  revenue: Number(workflow.totalPrice) || 0,
                  currency: "USDC",
                });
                /* TODO: Purchase */
              }}
            >
              <DollarSign className="w-3 h-3 mr-1" />
              PURCHASE
            </Button>
            <Button
              variant="outline"
              className="border-sidebar-border hover:border-cyan-500/50 h-8 sm:h-9 w-8 sm:w-9"
              onClick={(e) => {
                e.stopPropagation();
                const explorerUrl = workflowExplorerUrl(workflow);
                if (explorerUrl) window.open(explorerUrl, "_blank");
              }}
            >
              <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </Button>
          </div>
        )}
      />
    </Link>
  );
});

// =============================================================================
// RFAs Tab - Request-For-Agent Bounties
// =============================================================================

function useMarketOpenRFAs() {
  return useQuery({
    queryKey: ["rfa", "open"],
    queryFn: async () => {
      const { fetchOpenRFAs } = await import("@/hooks/use-onchain");
      return fetchOpenRFAs();
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });
}

function RFAsTab({
  searchQuery,
  onStatus,
}: {
  searchQuery: string;
  onStatus: (tab: MarketTab, status: TabStatus & { refresh?: () => void }) => void;
}) {
  // Use real RFA data from the contract
  const { data: rfas, isLoading, error, refetch } = useMarketOpenRFAs();

  // State for RFA detail dialog
  const [selectedRfaId, setSelectedRfaId] = React.useState<number | null>(null);
  const [showDetails, setShowDetails] = React.useState(false);

  // Filter and sort by newest
  const filteredRFAs = React.useMemo(() => {
    if (!rfas) return [];

    let filtered = rfas;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(rfa =>
        rfa.title.toLowerCase().includes(q) ||
        rfa.description.toLowerCase().includes(q)
      );
    }

    // Sort by createdAt (newest first)
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }, [rfas, searchQuery]);

  React.useEffect(() => {
    const count = rfas
      ? String(filteredRFAs.length)
      : isLoading
        ? "..."
        : "0";
    onStatus("rfas", {
      count,
      busy: isLoading,
      refresh: () => void refetch(),
    });
  }, [filteredRFAs.length, isLoading, onStatus, refetch, rfas, searchQuery]);

  return (
    <div className="cm-market-board">
      {/* Loading State */}
      {isLoading && (
        <div className="cm-market-row-grid">
          {[...Array(4)].map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-10 sm:py-12">
          <FileQuestion className="w-12 h-12 mx-auto text-red-400/50 mb-4" />
          <p className="text-red-400">{error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => refetch()}
          >
            Try Again
          </Button>
        </div>
      )}

      {/* RFAs Grid */}
      {!isLoading && filteredRFAs.length > 0 && (
        <div className="cm-market-row-grid">
          {filteredRFAs.map((rfa) => (
            <RFACard
              key={rfa.id}
              rfa={rfa}
              onViewDetails={() => {
                setSelectedRfaId(rfa.id);
                setShowDetails(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {filteredRFAs.length === 0 && !isLoading && (
        <div className="text-center py-8 sm:py-10 border border-dashed border-sidebar-border rounded-lg">
          <FileQuestion className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-sm sm:text-base">
            {searchQuery ? "No RFAs match your search" : "No active bounties right now"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-2 px-4">
            Create a workflow with missing agents to post an RFA
          </p>
        </div>
      )}

      {/* RFA Details Dialog */}
      {showDetails ? (
        <React.Suspense fallback={null}>
          <RFADetails
            rfaId={selectedRfaId}
            open={showDetails}
            onOpenChange={setShowDetails}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
}

// Memoized RFA card component
const RFACard = React.memo(function RFACard({
  rfa,
  onViewDetails
}: {
  rfa: OnchainRFA;
  onViewDetails: () => void;
}) {
  const posthog = usePostHog();

  // Calculate bounty breakdown
  const offerNum = parseFloat(rfa.offerAmount);
  const basicBounty = RFA_BOUNTY_LIMITS.BASIC_BOUNTY;
  const readmeBonus = Math.max(0, offerNum - basicBounty);

  // Format creation date
  const createdDate = new Date(rfa.createdAt * 1000);

  return (
    <WorkflowCardShell
      interactive
      className="cm-market-card"
      title={rfa.title}
      titleIcon={<Target />}
      description={(
        <Excerpt title={rfa.title} text={rfa.description} lines={2}>
          {rfa.description}
        </Excerpt>
      )}
      badges={(
        <>
          <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
            <Target className="w-3 h-3 mr-1" />
            RFA #{rfa.id}
          </Badge>
          <Badge variant="outline" className="text-xs border-green-500/30 text-green-400">
            <Clock className="w-3 h-3 mr-1" />
            {rfa.status}
          </Badge>
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
            Secured
          </Badge>
        </>
      )}
      stats={[
        { value: rfa.offerAmountFormatted, icon: <Award />, tone: "fuchsia", tooltip: "Bounty Reward" },
        { value: `$${basicBounty.toFixed(2)}`, icon: <DollarSign />, tone: "green", tooltip: "Basic" },
        { value: `$${readmeBonus.toFixed(2)}`, icon: <Sparkles />, tone: "cyan", tooltip: "README bonus" },
        { value: `Workflow #${rfa.workflowId}`, icon: <Layers />, tone: "warning", tooltip: createdDate.toLocaleDateString() },
      ]}
      footer={(
        <div className="cm-market-card__footer flex flex-row gap-1.5 sm:gap-2">
          <Button
            onClick={() => {
              posthog?.capture("market_rfa_details_viewed", {
                rfa_id: rfa.id,
                rfa_title: rfa.title,
                offer_amount: rfa.offerAmount,
                workflow_id: rfa.workflowId,
              });
              onViewDetails();
            }}
            className="flex-1 bg-fuchsia-500 hover:bg-fuchsia-600 text-white font-bold font-mono text-xs h-8 sm:h-9 px-2 sm:px-3 min-w-0"
          >
            <Award className="w-3 h-3 mr-0.5 sm:mr-1 shrink-0" />
            <span className="truncate">VIEW & SUBMIT</span>
          </Button>
          <Button
            variant="outline"
            className="border-sidebar-border hover:border-fuchsia-500/50 h-8 sm:h-9 text-xs px-2 sm:px-3 shrink-0"
            onClick={onViewDetails}
          >
            <span className="truncate">Details</span>
          </Button>
        </div>
      )}
    />
  );
});

// =============================================================================
// Agents Tab — cached catalog snapshot (models-worker parity) + semantic search
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
  const [shown, setShown] = useState(120);
  const [, setLocation] = useLocation();
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const moreRef = React.useRef<HTMLDivElement | null>(null);
  const q = searchQuery.trim();

  // Instant snapshot: version-keyed immutable index, retained across mounts,
  // persisted to IndexedDB, swapped in the background when the version flips.
  const {
    agents: snapshot,
    isLoading,
    isRefetching,
    error,
    forceRefresh,
    lastUpdated,
  } = useAgentCatalog();

  // Semantic ranking hints from the agents worker; resolved back to the
  // canonical snapshot so worker-owned objects are never rendered.
  const { hits: semanticHits, isLoading: isSearching } = useSemanticAgentSearch(q, {
    enabled: Boolean(q),
  });

  const cards = React.useMemo(() => {
    if (!q) return snapshot;
    return mergeSemanticAgentRanks(snapshot, rankCatalogAgents(snapshot, q), semanticHits)
      .map((entry) => entry.agent);
  }, [q, snapshot, semanticHits]);

  const agents = React.useMemo(() => {
    const seen = new Set<string>();
    const out: OnchainAgent[] = [];
    for (const card of cards) {
      if (!card.walletAddress) continue;
      if (seen.has(card.walletAddress)) continue;
      seen.add(card.walletAddress);
      out.push(toOnchainAgent(card));
    }
    if (!q && (sort === "price-low" || sort === "price-high")) {
      // Snapshot arrives newest-first; price sorts are client-side.
      out.sort((a, b) => {
        const left = Number.parseFloat(a.licensePrice) || 0;
        const right = Number.parseFloat(b.licensePrice) || 0;
        return sort === "price-low" ? left - right : right - left;
      });
    }
    return out;
  }, [cards, q, sort]);

  const visibleAgents = agents.length > 120 ? agents.slice(0, shown) : agents;
  const canReveal = visibleAgents.length < agents.length;

  React.useEffect(() => {
    setShown(120);
  }, [q, sort]);

  React.useEffect(() => {
    const count = isLoading
      ? "..."
      : String(agents.length);
    onStatus("agents", {
      count,
      busy: isLoading || isSearching,
      refresh: () => void forceRefresh(),
    });
  }, [agents.length, forceRefresh, isLoading, isSearching, onStatus]);

  React.useEffect(() => {
    const root = canvasRef.current;
    const node = moreRef.current;
    if (!root || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (canReveal) {
        setShown((value) => Math.min(value + 48, agents.length));
      }
    }, { root, rootMargin: "640px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [agents.length, canReveal]);

  return (
    <div className="cm-market-agents">
      {/* Loading State — only when no cached snapshot exists at all */}
      {isLoading && (
        <div className="cm-market-agent-canvas cm-market-agent-canvas--loading">
          <div className="cm-market-agent-grid">
            {[...Array(9)].map((_, i) => (
              <SharedAgentCardSkeleton key={i} />
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-10 sm:py-12">
          <Bot className="w-12 h-12 mx-auto text-red-400/50 mb-4" />
          <p className="text-red-400">{error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => forceRefresh()}
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Agents Grid */}
      {!isLoading && visibleAgents.length > 0 && (
        <div className="cm-market-agent-canvas" ref={canvasRef} aria-label="Agents" data-refreshing={isRefetching ? "true" : undefined} data-updated={lastUpdated ? lastUpdated.toISOString() : undefined}>
          <div className="cm-market-agent-grid">
            {visibleAgents.map((agent) => {
              const agentPageUrl = agent.walletAddress
                ? `/agent/${agent.walletAddress}`
                : agent.id > 0 ? `/agent/${agent.id}` : "/agents";

              return (
                <div
                  key={agent.walletAddress || `agent-${agent.id}`}
                  className="cm-market-agent-slot [content-visibility:auto] [contain-intrinsic-size:320px]"
                >
                  <SharedAgentCard
                    agent={agent}
                    variant="market"
                    onOpen={() => setLocation(agentPageUrl)}
                  />
                </div>
              );
            })}
            {canReveal ? (
              <div ref={moreRef} className="cm-market-agent-more">
                <Button
                  variant="outline"
                  onClick={() => setShown((value) => Math.min(value + 48, agents.length))}
                  disabled={isSearching}
                  className="border-sidebar-border h-9 text-xs"
                >
                  {isSearching ? "Searching..." : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Empty State */}
      {agents.length === 0 && !isLoading && (
        <div className="text-center py-8 sm:py-10">
          <Bot className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-sm sm:text-base">
            {searchQuery ? "No agents match your search" : "No agents available yet"}
          </p>
        </div>
      )}
    </div>
  );
}
