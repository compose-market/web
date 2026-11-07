/**
 * Market Secondary Tabs (Workflows & RFAs)
 *
 * Lazy-loaded only when the user opens the Workflows or RFAs tab so the default
 * Agents marketplace tab never pulls WorkflowCard, Pinata, or Radix Avatar on boot.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Excerpt } from "@compose-market/theme/shell";
import { WorkflowCardShell, WorkflowCardSkeleton } from "@/components/workflow-card";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OnchainWorkflow, OnchainRFA } from "@/hooks/use-onchain";
import { getIpfsUrl } from "@/lib/pinata";
import {
  CHAIN_CONFIG,
  RFA_BOUNTY_LIMITS,
  getContractAddress,
} from "@/lib/performance/networks";
import { useViewNavigate } from "@/motion/snap";
import {
  Award,
  Box,
  Clock,
  DollarSign,
  ExternalLink,
  FileQuestion,
  Layers,
  Package,
  Percent,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";

const RFADetails = React.lazy(() =>
  import("@/components/RFADetails").then((module) => ({ default: module.RFADetails })),
);

export type MarketBoardTab = "agents" | "workflows" | "rfas";
export type WorkflowSort = "newest" | "price-low" | "price-high";

export type BoardStatus = {
  count: string;
  busy: boolean;
};

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

export function WorkflowsTab({
  searchQuery,
  sort,
  onStatus,
}: {
  searchQuery: string;
  sort: WorkflowSort;
  onStatus: (tab: MarketBoardTab, status: BoardStatus & { refresh?: () => void }) => void;
}) {
  const { data: workflows, isLoading, error, refetch } = useMarketWorkflows({
    onlyComplete: true,
    includeRFA: false,
  });

  const filteredWorkflows = React.useMemo(() => {
    if (!workflows) return [];
    let filtered = workflows;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((m) =>
        m.title.toLowerCase().includes(q)
        || m.description.toLowerCase().includes(q),
      );
    }
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "price-low":
          return parseFloat(a.totalPrice) - parseFloat(b.totalPrice);
        case "price-high":
          return parseFloat(b.totalPrice) - parseFloat(a.totalPrice);
        case "newest":
        default: {
          const aDate = a.metadata?.createdAt ? new Date(a.metadata.createdAt).getTime() : 0;
          const bDate = b.metadata?.createdAt ? new Date(b.metadata.createdAt).getTime() : 0;
          return bDate - aDate;
        }
      }
    });
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
  }, [filteredWorkflows.length, isLoading, onStatus, refetch, workflows]);

  return (
    <div className="cm-market-board">
      {isLoading && (
        <div className="cm-market-row-grid">
          {[...Array(6)].map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      )}

      {error && (
        <div className="cm-market-state">
          <Box className="cm-market-state__icon text-red-400/50" />
          <p className="text-red-400">{error.message}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try Again
          </Button>
        </div>
      )}

      {!isLoading && filteredWorkflows.length > 0 && (
        <div className="cm-market-row-grid">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard key={workflow.id} workflow={workflow} />
          ))}
        </div>
      )}

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

const WorkflowCard = React.memo(function WorkflowCard({ workflow }: { workflow: OnchainWorkflow }) {
  const navigate = useViewNavigate();
  const bannerUrl = workflow.image && workflow.image.startsWith("ipfs://")
    ? getIpfsUrl(workflow.image.replace("ipfs://", ""))
    : null;

  const unitsAvailable = workflow.units === 0 ? "∞" : `${workflow.units - workflow.unitsMinted}/${workflow.units}`;
  const workflowPageUrl = workflow.walletAddress
    ? `/workflow/${workflow.walletAddress}`
    : `/workflow/${workflow.id}`;

  return (
    <div
      role="link"
      tabIndex={0}
      className="block cursor-pointer"
      onClick={() => navigate(workflowPageUrl)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(workflowPageUrl);
        }
      }}
    >
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
        footer={(() => {
          const explorerUrl = workflowExplorerUrl(workflow);
          return (
            <div className="cm-market-card__footer flex gap-2">
              <Button
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-bold font-mono text-xs h-9"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(workflowPageUrl);
                }}
              >
                <Layers className="w-3.5 h-3.5 mr-1" />
                OPEN WORKFLOW
              </Button>
              {explorerUrl ? (
                <Button
                  variant="outline"
                  aria-label="View workflow on block explorer"
                  className="border-sidebar-border hover:border-cyan-500/50 h-9 w-9"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(explorerUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              ) : null}
            </div>
          );
        })()}
      />
    </div>
  );
});

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

export function RFAsTab({
  searchQuery,
  onStatus,
}: {
  searchQuery: string;
  onStatus: (tab: MarketBoardTab, status: BoardStatus & { refresh?: () => void }) => void;
}) {
  const { data: rfas, isLoading, error, refetch } = useMarketOpenRFAs();
  const [selectedRfaId, setSelectedRfaId] = React.useState<number | null>(null);
  const [selectedRfaChainId, setSelectedRfaChainId] = React.useState<number | undefined>(undefined);
  const [showDetails, setShowDetails] = React.useState(false);

  const filteredRFAs = React.useMemo(() => {
    if (!rfas) return [];
    let filtered = rfas;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((rfa) =>
        rfa.title.toLowerCase().includes(q) || rfa.description.toLowerCase().includes(q),
      );
    }
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
  }, [filteredRFAs.length, isLoading, onStatus, refetch, rfas]);

  return (
    <div className="cm-market-board">
      {isLoading && (
        <div className="cm-market-row-grid">
          {[...Array(4)].map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      )}

      {error && (
        <div className="cm-market-state">
          <FileQuestion className="cm-market-state__icon text-red-400/50" />
          <p className="text-red-400">{error.message}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try Again
          </Button>
        </div>
      )}

      {!isLoading && filteredRFAs.length > 0 && (
        <div className="cm-market-row-grid">
          {filteredRFAs.map((rfa) => (
            <RFACard
              key={`${rfa.chainId ?? "default"}:${rfa.id}`}
              rfa={rfa}
              onViewDetails={() => {
                setSelectedRfaId(rfa.id);
                setSelectedRfaChainId(rfa.chainId);
                setShowDetails(true);
              }}
            />
          ))}
        </div>
      )}

      {filteredRFAs.length === 0 && !isLoading && (
        <div className="cm-empty-state-inline">
          <FileQuestion className="cm-empty-state-inline__icon" />
          <p className="cm-empty-state-inline__text">
            {searchQuery ? "No RFAs match your search" : "No active bounties right now"}
          </p>
        </div>
      )}

      {showDetails ? (
        <React.Suspense fallback={null}>
          <RFADetails
            rfaId={selectedRfaId}
            chainId={selectedRfaChainId}
            open={showDetails}
            onOpenChange={setShowDetails}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
}

const RFACard = React.memo(function RFACard({
  rfa,
  onViewDetails,
}: {
  rfa: OnchainRFA;
  onViewDetails: () => void;
}) {
  const offerNum = parseFloat(rfa.offerAmount);
  const basicBounty = RFA_BOUNTY_LIMITS.BASIC_BOUNTY;
  const readmeBonus = Math.max(0, offerNum - basicBounty);
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
        <div className="cm-market-card__footer flex flex-row gap-2">
          <Button
            onClick={onViewDetails}
            className="flex-1 bg-fuchsia-500 hover:bg-fuchsia-600 text-white font-bold font-mono text-xs h-9 min-w-0"
          >
            <Award className="w-3.5 h-3.5 mr-1 shrink-0" />
            <span className="truncate">VIEW & SUBMIT</span>
          </Button>
        </div>
      )}
    />
  );
});
