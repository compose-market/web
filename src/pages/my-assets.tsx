import { useState, useEffect, useMemo, useRef, useDeferredValue } from "react";
import { Link, useLocation } from "wouter";
import { usePostHog } from "@posthog/react";
import { Excerpt } from "@compose-market/theme/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Bot,
  Layers,
  Sparkles,
  ExternalLink,
  Zap,
  DollarSign,
  Copy,
  Plus,
  Activity,
  Clock,
  Shield,
  Award,
  Target,
  XCircle,
  CheckCircle,
  FileSearch,
  Loader2,
  RefreshCw,
  Percent,
  Package,
  Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { prepareContractCall } from "thirdweb";
import { useWorkflowsByCreator, useRFAsByPublisher, type OnchainAgent, type OnchainWorkflow, type OnchainRFA } from "@/hooks/use-onchain";
import { useAgentCatalog } from "@/hooks/use-agents";
import { agentKey, toOnchainAgent } from "@/lib/agents";
import { getIpfsUrl } from "@/lib/pinata";
import { evmChainId, getChainByNetwork, isEvmNetwork } from "@/lib/chains";
import { formatUsdcPrice, getContractAddress, getRFAContract, weiToUsdc } from "@/lib/contracts";
import { useTabs } from "@/hooks/use-tabs";
import { RFADetails } from "@/components/RFADetails";
import { ShareSuccessDialog } from "@/components/share";
import { getMintSuccessForShare, clearMintSuccessShare, type MintShareData } from "@/lib/share";
import { AgentCard as SharedAgentCard, AgentCardSkeleton as SharedAgentCardSkeleton } from "@/components/agent-card";
import { Ordering, SearchFold, Switcher, type Option } from "@/components/control";
import { WorkflowCard as WorkflowCardShell, WorkflowCardSkeleton } from "@compose-market/theme/workflows";

type AgentSort = "newest" | "price-low" | "price-high";
type WorkflowSort = "newest" | "price-low" | "price-high";
type AssetTab = "agents" | "workflows" | "rfas";

type TabStatus = {
  count: string;
  busy: boolean;
};

const tabs: Option<AssetTab>[] = [
  { value: "agents", label: "Agents", icon: Bot },
  { value: "workflows", label: "Workflows", icon: Layers },
  { value: "rfas", label: "RFAs", icon: Award },
];

const orders: Option<AgentSort>[] = [
  { value: "newest", label: "Newest", icon: Clock },
  { value: "price-low", label: "Price: Low to High", icon: DollarSign },
  { value: "price-high", label: "Price: High to Low", icon: DollarSign },
];

export default function MyAssetsPage() {
  const { toast } = useToast();
  const account = useActiveAccount();
  const [activeTab, setActiveTab] = useTabs("my-assets", "agents");
  const tab: AssetTab = activeTab === "workflows" || activeTab === "rfas" ? activeTab : "agents";
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const deferredQuery = useDeferredValue(searchQuery);
  const [sort, setSort] = useState<AgentSort>("newest");
  const [workflowSort, setWorkflowSort] = useState<WorkflowSort>("newest");
  const refreshers = useRef<Partial<Record<AssetTab, () => void>>>({});
  const [status, setStatus] = useState<Record<AssetTab, TabStatus>>({
    agents: { count: "0", busy: false },
    workflows: { count: "0", busy: false },
    rfas: { count: "0", busy: false },
  });
  const owner = account?.address;
  const q = deferredQuery.trim();

  const onStatus = useMemo(() => {
    return (key: AssetTab, next: TabStatus & { refresh?: () => void }) => {
      refreshers.current[key] = next.refresh;
      setStatus((current) => {
        const previous = current[key];
        if (previous.count === next.count && previous.busy === next.busy) return current;
        return { ...current, [key]: { count: next.count, busy: next.busy } };
      });
    };
  }, []);

  // Cached catalog snapshot (agents-worker /index, models-worker parity);
  // creator + search + sort filtering happen client-side.
  const {
    agents: snapshot,
    isLoading: isLoadingAgents,
    error: agentError,
    refreshError: agentRefreshError,
    forceRefresh: refreshAgents,
  } = useAgentCatalog({ enabled: Boolean(owner) });

  const agents = useMemo(() => {
    if (!owner) return [] as OnchainAgent[];
    const ownerKey = agentKey(owner);
    let cards = snapshot.filter(
      (card) => typeof card.creator === "string" && agentKey(card.creator) === ownerKey,
    );
    if (q) {
      const needle = q.toLowerCase();
      cards = cards.filter((card) =>
        (card.name || "").toLowerCase().includes(needle)
        || (card.description || "").toLowerCase().includes(needle)
        || (card.skills || []).join(" ").toLowerCase().includes(needle)
        || (card.model || "").toLowerCase().includes(needle)
      );
    }
    const out = cards.map(toOnchainAgent);
    if (!q && (sort === "price-low" || sort === "price-high")) {
      out.sort((a, b) => {
        const left = Number.parseFloat(a.licensePrice) || 0;
        const right = Number.parseFloat(b.licensePrice) || 0;
        return sort === "price-low" ? left - right : right - left;
      });
    }
    return out;
  }, [snapshot, owner, q, sort]);

  const agentCount = agents.length;
  const assetTabs = useMemo<Option<AssetTab>[]>(() => [
    { value: "agents", label: "Agents", icon: Bot, count: status.agents.count },
    { value: "workflows", label: "Workflows", icon: Layers, count: status.workflows.count },
    { value: "rfas", label: "RFAs", icon: Award, count: status.rfas.count },
  ], [status.agents.count, status.workflows.count, status.rfas.count]);

  // RFA detail dialog state
  const [selectedRfaId, setSelectedRfaId] = useState<number | null>(null);
  const [showRFADetails, setShowRFADetails] = useState(false);

  // Share success dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareData, setShareData] = useState<MintShareData | null>(null);

  useEffect(() => {
    const data = getMintSuccessForShare();
    if (data) {
      setShareData(data);
      setShowShareDialog(true);
    }
  }, []);

  useEffect(() => {
    refreshers.current = {};
    setStatus({
      agents: { count: "0", busy: false },
      workflows: { count: "0", busy: false },
      rfas: { count: "0", busy: false },
    });
  }, [owner]);

  const handleCloseShareDialog = (open: boolean) => {
    setShowShareDialog(open);
    if (!open) {
      clearMintSuccessShare();
      setShareData(null);
    }
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast({ title: "Address copied!" });
  };

  const handleRefresh = () => {
    refreshers.current[tab]?.();
  };

  if (!account) {
    return (
      <div className="cm-web-page">
        <div className="cm-web-page__canvas cm-workspace-canvas--fade">
          <div className="cm-web-page__body cm-web-page__body--narrow">
            <div className="cm-shell-page-header px-0">
              <div className="cm-shell-page-header__copy">
                <h1 className="cm-shell-page-header__title">
                  <span className="text-cyan-500 mr-2">//</span>
                  MY ASSETS
                </h1>
                <p className="cm-shell-page-header__subtitle">
                  View and manage your on-chain agents and workflows.
                </p>
              </div>
            </div>

            <Card className="glass-panel border-primary/20">
              <CardContent className="p-6 sm:p-8 text-center space-y-3">
                <Shield className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
                <h2 className="text-lg sm:text-xl font-display text-foreground">Sign In Required</h2>
                <p className="text-muted-foreground font-mono text-xs sm:text-sm max-w-md mx-auto">
                  Connect with email, social, or wallet to view your on-chain assets.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cm-market-workspace">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="cm-market-tabs w-full">
        <div className="cm-control-rail cm-market-control-rail">
          <div className="cm-market-control-rail__brand">
            <h1 className="cm-page-header__title cm-market-control-rail__title">
              <span className="text-cyan-500 mr-2">//</span>
              MY ASSETS
            </h1>
          </div>

          <Switcher
            value={tab}
            options={assetTabs}
            label="Asset section"
            onChange={setActiveTab}
            className="cm-market-control-rail__tabs"
          />

          <div className="cm-market-control-rail__actions">
            <SearchFold
              open={searchOpen}
              value={searchQuery}
              label="Search assets"
              placeholder="Search assets..."
              onOpenChange={setSearchOpen}
              onChange={setSearchQuery}
            />
            {tab === "agents" ? (
              <Ordering value={sort} options={orders} onChange={setSort} disabled={Boolean(q)} />
            ) : null}
            {tab === "workflows" ? (
              <Ordering value={workflowSort} options={orders} onChange={setWorkflowSort} />
            ) : null}
            <Link href="/create-agent">
              <Button size="sm" className="bg-cyan-500 text-black hover:bg-cyan-400 font-bold font-mono text-xs h-9 px-2 sm:px-3">
                <Plus className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">CREATE</span>
              </Button>
            </Link>
          </div>
        </div>

        <TabsContent value="agents" className="cm-market-tab-panel cm-market-tab-panel--agents mt-0">
          {activeTab === "agents" ? (
            <AssetAgentsTab
              agents={agents}
              total={agentCount}
              sort={sort}
              isLoading={isLoadingAgents}
              error={(agentError ?? agentRefreshError) instanceof Error ? (agentError ?? agentRefreshError) : null}
              refetch={() => void refreshAgents()}
              searchQuery={deferredQuery}
              onStatus={onStatus}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="workflows" className="cm-market-tab-panel cm-market-tab-panel--scroll mt-0">
          {activeTab === "workflows" ? (
            <WorkflowsTab
              creator={account.address}
              searchQuery={deferredQuery}
              sort={workflowSort}
              onStatus={onStatus}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="rfas" className="cm-market-tab-panel cm-market-tab-panel--scroll mt-0">
          {activeTab === "rfas" ? (
            <RFAsTab
              publisher={account.address}
              searchQuery={deferredQuery}
              onStatus={onStatus}
              onView={(id) => {
                setSelectedRfaId(id);
                setShowRFADetails(true);
              }}
            />
          ) : null}
        </TabsContent>
      </Tabs>

      <ShareSuccessDialog
        open={showShareDialog}
        onOpenChange={handleCloseShareDialog}
        data={shareData}
      />

      <RFADetails
        rfaId={selectedRfaId}
        open={showRFADetails}
        onOpenChange={setShowRFADetails}
      />
    </div>
  );
}

function AssetAgentsTab({
  agents,
  total,
  sort,
  isLoading,
  error,
  refetch,
  searchQuery,
  onStatus,
}: {
  agents: OnchainAgent[];
  total: number;
  sort: AgentSort;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  searchQuery: string;
  onStatus: (tab: AssetTab, status: TabStatus & { refresh?: () => void }) => void;
}) {
  const [shown, setShown] = useState(120);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const visibleAgents = agents.length > 120 ? agents.slice(0, shown) : agents;
  const canReveal = visibleAgents.length < agents.length;

  useEffect(() => {
    setShown(120);
  }, [sort]);

  useEffect(() => {
    const query = searchQuery.trim();
    onStatus("agents", {
      count: query ? String(agents.length) : String(total),
      busy: isLoading,
      refresh: refetch,
    });
  }, [agents.length, isLoading, onStatus, refetch, searchQuery, total]);

  useEffect(() => {
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
      {isLoading && (
        <div className="cm-market-agent-canvas cm-market-agent-canvas--loading">
          <div className="cm-market-agent-grid">
            {Array.from({ length: 9 }).map((_, i) => (
              <SharedAgentCardSkeleton key={i} />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="text-center py-10 sm:py-12">
          <Bot className="w-12 h-12 mx-auto text-red-400/50 mb-4" />
          <p className="text-red-400">{error.message}</p>
          <Button variant="outline" className="mt-4" onClick={refetch}>
            Try Again
          </Button>
        </div>
      )}

      {!isLoading && visibleAgents.length > 0 && (
        <div className="cm-market-agent-canvas" ref={canvasRef} aria-label="My agents">
          <div className="cm-market-agent-grid">
            {visibleAgents.map((agent) => (
              <div
                key={agent.walletAddress || `agent-${agent.id}`}
                className="cm-market-agent-slot [content-visibility:auto] [contain-intrinsic-size:360px]"
              >
                <AgentAssetCard agent={agent} />
              </div>
            ))}
            {canReveal ? (
              <div ref={moreRef} className="cm-market-agent-more">
                <Button
                  variant="outline"
                  onClick={() => setShown((value) => Math.min(value + 48, agents.length))}
                  className="border-sidebar-border h-9 text-xs"
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {agents.length === 0 && !isLoading && !error && (
        <div className="text-center py-8 sm:py-10">
          <Bot className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-sm sm:text-base">
            No agents minted by this account yet
          </p>
          <Link href="/create-agent">
            <Button className="mt-4 bg-cyan-500 text-black hover:bg-cyan-400 font-bold font-mono text-sm">
              <Plus className="w-4 h-4 mr-2" />
              CREATE AGENT
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function WorkflowsTab({
  creator,
  searchQuery,
  sort,
  onStatus,
}: {
  creator: string;
  searchQuery: string;
  sort: WorkflowSort;
  onStatus: (tab: AssetTab, status: TabStatus & { refresh?: () => void }) => void;
}) {
  const { data: workflows, isLoading: isLoadingWorkflows, refetch } = useWorkflowsByCreator(creator);
  const filteredWorkflows = useMemo(() => {
    let filtered = workflows || [];
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((workflow) =>
        workflow.title.toLowerCase().includes(query) ||
        workflow.description.toLowerCase().includes(query)
      );
    }
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "price-low":
          return parseFloat(a.totalPrice) - parseFloat(b.totalPrice);
        case "price-high":
          return parseFloat(b.totalPrice) - parseFloat(a.totalPrice);
        case "newest":
        default:
          return (b.metadata?.createdAt ? new Date(b.metadata.createdAt).getTime() : 0) -
            (a.metadata?.createdAt ? new Date(a.metadata.createdAt).getTime() : 0);
      }
    });
  }, [searchQuery, sort, workflows]);

  useEffect(() => {
    onStatus("workflows", {
      count: String(filteredWorkflows.length),
      busy: isLoadingWorkflows,
      refresh: () => void refetch(),
    });
  }, [filteredWorkflows.length, isLoadingWorkflows, onStatus, refetch, searchQuery]);

  if (isLoadingWorkflows) {
    return (
      <div className="cm-market-board">
        <div className="cm-market-row-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (filteredWorkflows.length > 0) {
    return (
      <div className="cm-market-board">
        <div className="cm-market-row-grid">
          {filteredWorkflows.map((workflow) => (
            <WorkflowAssetCard key={workflow.id} workflow={workflow} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="cm-surface-card">
      <CardContent className="p-6 sm:p-8 text-center space-y-3">
        <Layers className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
        <h3 className="text-base sm:text-lg font-display text-foreground">No Workflows Yet</h3>
        <p className="text-muted-foreground font-mono text-xs sm:text-sm max-w-md mx-auto">
          {searchQuery ? "No workflows match your search." : "Compose your first Workflow by combining multiple agents."}
        </p>
        <Link href="/compose">
          <Button className="bg-fuchsia-500 text-white hover:bg-fuchsia-400 font-bold font-mono text-sm">
            <Layers className="w-4 h-4 mr-2" />
            START COMPOSING
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function RFAsTab({
  publisher,
  searchQuery,
  onStatus,
  onView,
}: {
  publisher: string;
  searchQuery: string;
  onStatus: (tab: AssetTab, status: TabStatus & { refresh?: () => void }) => void;
  onView: (id: number) => void;
}) {
  const { data: rfas, isLoading: isLoadingRFAs, refetch: refetchRFAs } = useRFAsByPublisher(publisher);
  const filteredRFAs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const source = rfas || [];
    if (!query) return source;
    return source.filter((rfa) =>
      rfa.title.toLowerCase().includes(query) ||
      rfa.description.toLowerCase().includes(query)
    );
  }, [rfas, searchQuery]);

  useEffect(() => {
    onStatus("rfas", {
      count: String(filteredRFAs.length),
      busy: isLoadingRFAs,
      refresh: () => void refetchRFAs(),
    });
  }, [filteredRFAs.length, isLoadingRFAs, onStatus, refetchRFAs, searchQuery]);

  if (isLoadingRFAs) {
    return (
      <div className="cm-market-board">
        <div className="cm-market-row-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (filteredRFAs.length > 0) {
    return (
      <div className="cm-market-board">
        <div className="cm-market-row-grid">
          {filteredRFAs.map((rfa) => (
            <RFAAssetCard
              key={rfa.id}
              rfa={rfa}
              onViewDetails={() => onView(rfa.id)}
              onRefresh={refetchRFAs}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="cm-surface-card">
      <CardContent className="p-6 sm:p-8 text-center space-y-3">
        <FileSearch className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
        <h3 className="text-base sm:text-lg font-display text-foreground">No RFAs Published</h3>
        <p className="text-muted-foreground font-mono text-xs sm:text-sm max-w-md mx-auto">
          {searchQuery ? "No RFAs match your search." : "You haven't published any Request-For-Agent bounties yet. Create one from the Compose page."}
        </p>
        <Link href="/compose">
          <Button className="bg-amber-500 text-black hover:bg-amber-400 font-bold font-mono text-sm">
            <Award className="w-4 h-4 mr-2" />
            GO TO COMPOSE
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function AgentAssetCard({ agent }: { agent: OnchainAgent }) {
  const [, setLocation] = useLocation();

  // Agent page URL using wallet address (primary) or ID (fallback)
  const agentPageUrl = agent.walletAddress
    ? `/agent/${agent.walletAddress}`
    : agent.id > 0 ? `/agent/${agent.id}` : "/agents";

  return (
    <SharedAgentCard
      agent={agent}
      variant="market"
      onOpen={() => setLocation(agentPageUrl)}
    />
  );
}

function WorkflowAssetCard({ workflow }: { workflow: OnchainWorkflow }) {
  let bannerUrl: string | null = null;
  if (workflow.image && workflow.image.startsWith("ipfs://")) {
    bannerUrl = getIpfsUrl(workflow.image.replace("ipfs://", ""));
  }

  const workflowNetwork = workflow.network ?? workflow.metadata?.network;
  const workflowChain = workflowNetwork ? getChainByNetwork(workflowNetwork) : undefined;
  const explorerUrl = workflowNetwork && workflowChain?.explorer && isEvmNetwork(workflowNetwork)
    ? `${workflowChain.explorer}/token/${getContractAddress("Workflow", evmChainId(workflowNetwork))}?a=${workflow.id}`
    : null;

  // Use wallet address for navigation (primary), fallback to numeric ID
  const workflowPageUrl = workflow.walletAddress
    ? `/workflow/${workflow.walletAddress}`
    : `/workflow/${workflow.id}`;

  const unitsAvailable = workflow.units === 0 ? "∞" : `${workflow.units - workflow.unitsMinted}/${workflow.units}`;

  return (
    <Link href={workflowPageUrl} className="block">
      <WorkflowCardShell
        interactive
        className="hover:border-fuchsia-500/50"
        bannerSrc={bannerUrl}
        title={workflow.title || `Workflow #${workflow.id}`}
        titleIcon={<Layers />}
        description={(
          workflow.description && (
            <Excerpt title={workflow.title || `Workflow #${workflow.id}`} text={workflow.description} lines={2}>
              {workflow.description}
            </Excerpt>
          )
        )}
        badges={(
          <>
            <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10 px-1 sm:px-1.5 py-0">
              <Sparkles className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
              nestable NFT
            </Badge>
            {workflow.leaseEnabled && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-green-500/30 text-green-400 bg-green-500/10 px-1 sm:px-1.5 py-0">
                <Clock className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
                leasable ({workflow.leasePercent}%)
              </Badge>
            )}
            {workflow.hasActiveRfa && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-yellow-500/30 text-yellow-400 bg-yellow-500/10 px-1 sm:px-1.5 py-0">
                active RFA
              </Badge>
            )}
            {workflow.coordinatorModel && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-purple-500/30 text-purple-400 bg-purple-500/10 px-1 sm:px-1.5 py-0">
                + coordinator
              </Badge>
            )}
          </>
        )}
        stats={[
          { value: `$${workflow.totalPrice}`, icon: <DollarSign />, tone: "green", tooltip: "total price" },
          { value: String(workflow.agentIds?.length || 0), icon: <Layers />, tone: "cyan", tooltip: "agents" },
          { value: unitsAvailable, icon: <Zap />, tone: "fuchsia", tooltip: "available supply" },
        ]}
      />
    </Link>
  );
}

// RFA Asset Card Component
function RFAAssetCard({
  rfa,
  onViewDetails,
  onRefresh,
}: {
  rfa: OnchainRFA;
  onViewDetails: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const posthog = usePostHog();
  const { mutateAsync: sendTransaction, isPending } = useSendTransaction();
  const [isCancelling, setIsCancelling] = useState(false);

  // Format dates
  const createdDate = new Date(rfa.createdAt * 1000);

  // Handle cancel
  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      setIsCancelling(true);

      const contract = getRFAContract();
      const tx = prepareContractCall({
        contract,
        method: "function cancelRFA(uint256 rfaId)",
        params: [BigInt(rfa.id)],
      });

      await sendTransaction(tx);

      posthog?.capture("rfa_cancelled", {
        rfa_id: rfa.id,
        rfa_title: rfa.title,
        offer_amount: rfa.offerAmount,
        workflow_id: rfa.workflowId,
      });

      onRefresh();
    } catch (error) {
      console.error("Cancel error:", error);
      toast({
        title: "Failed to Cancel",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const statusColor = {
    Open: "border-green-500/30 text-green-400 bg-green-500/10",
    Fulfilled: "border-cyan-500/30 text-cyan-400 bg-cyan-500/10",
    Cancelled: "border-red-500/30 text-red-400 bg-red-500/10",
    None: "border-gray-500/30 text-gray-400 bg-gray-500/10",
  }[rfa.status];

  return (
    <div onClick={onViewDetails} className="cursor-pointer block">
      <WorkflowCardShell
        interactive
        className="hover:border-amber-500/50"
        title={rfa.title}
        titleIcon={<Target className="text-amber-400" />}
        description={rfa.description}
        badges={(
          <>
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px]">
              RFA #{rfa.id}
            </Badge>
            <Badge variant="outline" className={`text-[9px] ${statusColor}`}>
              {rfa.status === 'Open' && <Clock className="w-2 h-2 mr-1" />}
              {rfa.status === 'Fulfilled' && <CheckCircle className="w-2 h-2 mr-1" />}
              {rfa.status === 'Cancelled' && <XCircle className="w-2 h-2 mr-1" />}
              {rfa.status}
            </Badge>
          </>
        )}
        stats={[
          { value: rfa.offerAmountFormatted, icon: <DollarSign />, tone: "warning", tooltip: "Bounty" },
          { value: `Workflow #${rfa.workflowId}`, icon: <Layers />, tone: "cyan", tooltip: "Target Workflow" },
          { value: createdDate.toLocaleDateString(), icon: <Clock />, tooltip: "Created date" },
        ]}
        footer={(
          <>
            {rfa.status === 'Open' && (
              <div className="flex items-center gap-2 w-full mt-2 pt-2 border-t border-primary/15">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
                  className="flex-1 text-xs h-8"
                >
                  <Bot className="w-3 h-3 mr-1" />
                  View Submissions
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  disabled={isCancelling || isPending}
                  className="text-xs h-8 border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  {isCancelling ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 mr-1" />
                      Cancel
                    </>
                  )}
                </Button>
              </div>
            )}

            {rfa.status === 'Fulfilled' && (
              <div className="flex items-center gap-2 p-2 rounded-sm bg-cyan-500/5 border border-cyan-500/20 text-[10px] w-full mt-2">
                <CheckCircle className="w-3 h-3 text-cyan-400" />
                <span className="text-cyan-400">Fulfilled by Agent #{rfa.fulfilledByAgentId}</span>
              </div>
            )}
          </>
        )}
      />
    </div>
  );
}
