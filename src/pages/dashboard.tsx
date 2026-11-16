import { useMemo, useState } from "react";
import { Calendar, CalendarDays, CalendarRange, Clock, RefreshCw, Wallet } from "lucide-react";
import type { InferenceAnalytics } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";

import { useAnalytics } from "@/hooks/use-analytics";
import { useFocus } from "@/hooks/use-focus";
import { useChain } from "@/contexts/Network";
import { OverviewCards } from "@/components/dashboard/overview";
import { SpendingChart } from "@/components/dashboard/spending";
import { ModelUsageTable } from "@/components/dashboard/models";
import { ReceiptFeed } from "@/components/dashboard/receipts";
import { NetworkFilter } from "@/components/dashboard/networks";
import { Pockets, Switcher, type Option } from "@/components/control";

const RANGES = [
  { label: "24h", ms: 86_400_000, interval: "hour" },
  { label: "7d", ms: 7 * 86_400_000, interval: "hour" },
  { label: "30d", ms: 30 * 86_400_000, interval: "day" },
  { label: "180d", ms: 180 * 86_400_000, interval: "day" },
] as const;

const RANGE_OPTIONS: Option<string>[] = [
  { value: "24h", label: "24h", icon: Clock },
  { value: "7d", label: "7d", icon: CalendarRange },
  { value: "30d", label: "30d", icon: Calendar },
  { value: "180d", label: "180d", icon: CalendarDays },
];

type RangeId = (typeof RANGES)[number]["label"];

type StableFilters = Omit<
  InferenceAnalytics.InferenceAnalyticsFilters,
  "from" | "to" | "networks"
>;

export default function DashboardPage() {
  const { chains } = useChain();
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[2]);
  const [selectedNetworks, setSelectedNetworks] = useState<NetworkId[]>([]);
  const [pocket, setPocket] = useState<"overview" | "models" | "activity">("overview");
  const { containerRef, focused, toggleFocus } = useFocus();

  const supportedNetworks = useMemo(
    () => [...chains]
      .filter((chain): chain is typeof chain & { network: NetworkId } => Boolean(chain.network))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [chains],
  );
  const filters = useMemo<StableFilters>(() => ({
    interval: range.interval,
    limit: 100,
  }), [range.interval]);
  const {
    owner,
    summary,
    requests,
    activity,
    hasMoreRequests,
    hasMoreSettlements,
    isLoadingMore,
    loadMore,
    isLoading,
    isRefetching,
    error,
    forceRefresh,
  } = useAnalytics({
    rangeId: range.label,
    rangeMs: range.ms,
    networks: selectedNetworks,
    filters,
  });

  const header = (
    <div className="cm-control-rail cm-dashboard-control-rail">
      <div className="cm-dashboard-control-rail__brand">
        <h1 className="cm-page-header__title cm-dashboard-control-rail__title" data-route-heading>
          <span className="text-fuchsia-500 mr-2">//</span>
          DASHBOARD
        </h1>
        {isRefetching ? (
          <span className="cm-dashboard__updating" title="Updating analytics">Updating…</span>
        ) : null}
      </div>
      <div className="cm-dashboard-control-rail__actions">
        <NetworkFilter
          chains={supportedNetworks}
          selected={selectedNetworks}
          onChange={setSelectedNetworks}
        />
        <Switcher
          value={range.label}
          options={RANGE_OPTIONS}
          label="Time range"
          onChange={(value) => {
            const next = RANGES.find((option) => option.label === (value as RangeId));
            if (next) setRange(next);
          }}
        />
        <button
          type="button"
          onClick={() => void forceRefresh()}
          disabled={!owner || isRefetching || isLoading}
          className="cm-control-icon-button"
          title="Refresh analytics"
          aria-label="Refresh analytics"
        >
          <RefreshCw className={`cm-control-icon-button__icon ${isRefetching ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );

  const mobilePockets = (
    <Pockets
      value={pocket}
      label="Dashboard view"
      className="cm-pocket-bar--dashboard"
      onChange={setPocket}
      options={[
        { value: "overview", label: "Overview" },
        { value: "models", label: "Models" },
        { value: "activity", label: "Activity" },
      ]}
    />
  );

  const empty = (title: string, text: string, loading = false) => (
    <div className="cm-dashboard" ref={containerRef} data-focus={focused ?? undefined} data-pocket={pocket}>
      {header}
      <div className="cm-dashboard__empty">
        {loading
          ? <RefreshCw className="cm-dashboard__empty-icon animate-spin" />
          : <Wallet className="cm-dashboard__empty-icon" />}
        <span className="cm-dashboard__empty-title">{title}</span>
        <span className="cm-dashboard__empty-text">{text}</span>
      </div>
    </div>
  );

  if (!owner) return empty("Connect your wallet", "Connect your wallet to view your inference usage and spending analytics.");
  if (error && !summary) return empty("Unable to load usage data", error.message);
  if (isLoading && !summary) return empty("Loading usage data", "Reading your inference telemetry.", true);
  if (!summary || summary.requestCount === 0) return empty("No usage yet", "Head to the Playground to make your first inference call.");

  return (
    <div className="cm-dashboard" ref={containerRef} data-focus={focused ?? undefined} data-pocket={pocket}>
      {header}
      {mobilePockets}
      {error ? (
        <div className="cm-dashboard__banner" role="alert">
          Unable to update usage data: {error.message}
        </div>
      ) : null}
      <OverviewCards summary={summary} />
      <SpendingChart
        timeline={summary.timeline}
        interval={summary.interval}
        focused={focused === "chart"}
        dataBlock="chart"
        onClick={() => toggleFocus("chart")}
      />
      <ModelUsageTable
        models={summary.modelUsage}
        modalityBreakdown={summary.typeBreakdown}
        focused={focused === "models"}
        dataBlock="models"
        onClick={() => toggleFocus("models")}
      />
      <ReceiptFeed
        receipts={activity}
        requests={requests}
        hasMoreSettlements={hasMoreSettlements}
        hasMoreRequests={hasMoreRequests}
        isLoadingMore={isLoadingMore}
        onLoadMore={(kind) => void loadMore(kind)}
        focused={focused === "feed"}
        dataBlock="feed"
        onClick={() => toggleFocus("feed")}
      />
    </div>
  );
}
