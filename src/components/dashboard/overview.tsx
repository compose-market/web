import { useId, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Activity, ChevronDown, Coins, DollarSign, Gauge, LayoutGrid, Rocket } from "lucide-react";
import type { Summary } from "@/lib/analytics";
import { formatMs, formatPct, formatTokens, numberLabel } from "@/lib/analytics";
import { atomicToUsd, formatUsd } from "@/lib/receipts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";

function successTone(rate: number | null): "emerald" | "amber" | "danger" | undefined {
  if (rate === null) return undefined;
  if (rate >= 0.99) return "emerald";
  if (rate >= 0.95) return "amber";
  return "danger";
}

/** Tiny brand-gradient sparkline — intentionally axis-less. */
function Sparkline({ values }: { values: number[] }) {
  const gradientId = useId().replace(/:/gu, "");
  const geometry = useMemo(() => {
    if (values.length === 0) return null;
    const max = Math.max(...values, 0);
    if (max <= 0) return { area: "", line: "" };
    const width = 100;
    const height = 28;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : index * step;
      const y = height - (value / max) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const line = `M ${points.join(" L ")}`;
    const firstX = values.length === 1 ? width / 2 : 0;
    const lastX = values.length === 1 ? width / 2 : width;
    return { line, area: `${line} L ${lastX} ${height} L ${firstX} ${height} Z` };
  }, [values]);

  if (!geometry || !geometry.area) {
    return <span className="cm-stat-card__spark cm-stat-card__spark--flat" aria-hidden="true" />;
  }
  return (
    <svg className="cm-stat-card__spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${gradientId}-spark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={geometry.area} fill={`url(#${gradientId}-spark)`} />
      <path d={geometry.line} fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.75" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type StatId = "spent" | "requests" | "latency" | "ttft" | "tokens";

interface StatDefinition {
  id: StatId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  value: string;
  tone?: "primary" | "accent";
  sub: ReactNode;
  spark?: number[];
}

function buildStats(summary: Summary, spendSeries: number[]): StatDefinition[] {
  const tone = successTone(summary.successRate);
  return [
    {
      id: "spent",
      label: "Total Spent",
      icon: DollarSign,
      value: formatUsd(summary.totalUsd),
      tone: "primary",
      sub: `${numberLabel(summary.requestCount)} requests settled`,
      spark: spendSeries,
    },
    {
      id: "requests",
      label: "Requests",
      icon: Activity,
      value: numberLabel(summary.requestCount),
      sub: (
        <>
          <span className="cm-stat-card__pill" data-tone={tone}>{formatPct(summary.successRate)} success</span>
          {summary.streamedShare !== null ? ` · ${formatPct(summary.streamedShare, 0)} streamed` : ""}
        </>
      ),
    },
    {
      id: "latency",
      label: "Avg Latency",
      icon: Gauge,
      value: summary.avgLatencyMs !== null ? formatMs(summary.avgLatencyMs) : "—",
      sub: summary.p95LatencyMs !== null ? `P95 ${formatMs(summary.p95LatencyMs)}` : "P95 —",
    },
    {
      id: "ttft",
      label: "Avg TTFT",
      icon: Rocket,
      value: summary.avgTtftMs !== null ? formatMs(summary.avgTtftMs) : "—",
      tone: "accent",
      sub: "time to first token",
    },
    {
      id: "tokens",
      label: "Tokens",
      icon: Coins,
      value: formatTokens(summary.tokensIn + summary.tokensOut),
      sub: (
        <>
          {formatTokens(summary.tokensIn)} in <span aria-hidden="true">→</span> {formatTokens(summary.tokensOut)} out
        </>
      ),
    },
  ];
}

function StatCard({ stat }: { stat: StatDefinition }) {
  const Icon = stat.icon;
  return (
    <div className="cm-stat-card" data-stat={stat.id}>
      <span className="cm-stat-card__label">
        <Icon className="cm-stat-card__label-icon" />
        {stat.label}
      </span>
      <span className="cm-stat-card__value" data-tone={stat.tone}>{stat.value}</span>
      <span className="cm-stat-card__sub">{stat.sub}</span>
      {stat.spark ? <Sparkline values={stat.spark} /> : null}
    </div>
  );
}

export function OverviewCards({ summary }: { summary: Summary }) {
  const [selectedStat, setSelectedStat] = useState<StatId>("spent");
  const spendSeries = useMemo(
    () => summary.timeline.map((bucket) => atomicToUsd(bucket.totals.billing.finalAmountAtomic)),
    [summary.timeline],
  );
  const stats = useMemo(() => buildStats(summary, spendSeries), [summary, spendSeries]);
  const others = stats.filter((stat) => stat.id !== selectedStat);
  const selected = stats.find((stat) => stat.id === selectedStat) ?? stats[0];

  return (
    <div className="cm-overview" data-selected-stat={selected.id}>
      <div className="cm-overview-grid">
        {stats.map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}

        {/* Narrow-container stat picker — same footprint as a stat card. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="cm-stat-card cm-stat-card--picker"
              aria-label={`More stats: ${others.map((stat) => stat.label).join(", ")}`}
              title="More stats"
            >
              <span className="cm-stat-card__label">
                <LayoutGrid className="cm-stat-card__label-icon" />
                More stats
              </span>
              <span className="cm-stat-card--picker__value">
                <span className="cm-stat-card__value">{others.length}</span>
                <ChevronDown className="cm-stat-card--picker__chevron" />
              </span>
              <span className="cm-stat-card__sub">swap this card</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="cm-control-menu">
            {others.map((stat) => {
              const Icon = stat.icon;
              return (
                <DropdownMenuItem
                  key={stat.id}
                  className="cm-control-menu__item"
                  onSelect={() => setSelectedStat(stat.id)}
                >
                  <Icon className="cm-control-menu__icon" />
                  <span className="cm-control-menu__label">{stat.label}</span>
                  <span className="cm-stat-card--picker__item-value">{stat.value}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
