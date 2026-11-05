import { useMemo, useState } from "react";
import { Check, ChevronDown, MessageSquare, Plus, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { sdk } from "@/lib/sdk";
import type { ConnectorRequest, Message, Plan } from "@/hooks/use-chat";

const RUNTIME_BASE_URL = (import.meta.env.VITE_RUNTIME_URL || "https://runtime.compose.market").replace(/\/+$/, "");
const ACTIONABLE_PLAN_STATES = new Set(["awaiting_approval", "clarify", "proposed", "pending"]);

export type ThreadStatus = "running" | "input_required" | "connector_required" | "succeeded" | "failed";

export interface ThreadSummary {
  threadId: string;
  title: string;
  prompt?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  status: ThreadStatus;
  rootRunId?: string;
  runId?: string;
  planState?: string;
}

export interface HydratedThread {
  threadId: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number }>;
  plan?: Record<string, unknown>;
  rootRunId?: string;
  runId?: string;
  connectorRequests?: Array<Record<string, unknown>>;
}

function statusLabel(status: ThreadStatus, planState?: string): string {
  if (planState === "cancelled") return "STOPPED";
  switch (status) {
    case "running":
      return "RUNNING";
    case "input_required":
      return "NEEDS INPUT";
    case "connector_required":
      return "NEEDS AUTH";
    case "succeeded":
      return "DONE";
    case "failed":
      return "FAILED";
  }
}

export async function listAgentThreads(
  agentWallet: string,
  userAddress: string,
  options?: { signal?: AbortSignal; limit?: number },
): Promise<ThreadSummary[]> {
  if (!agentWallet || !userAddress) return [];
  const url = new URL(`${RUNTIME_BASE_URL}/agent/${encodeURIComponent(agentWallet)}/threads`);
  url.searchParams.set("userAddress", userAddress);
  if (options?.limit) url.searchParams.set("limit", String(options.limit));
  const response = await sdk.fetch(url.toString(), {
    signal: options?.signal,
    userAddress,
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { threads?: ThreadSummary[] };
  return Array.isArray(body.threads) ? body.threads : [];
}