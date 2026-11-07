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