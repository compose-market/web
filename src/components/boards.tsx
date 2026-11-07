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