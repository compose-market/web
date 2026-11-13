/**
 * UsageChart — the dashboard's primary time-series visual.
 *
 * Loaded lazily (recharts is code-split out of the main bundle).
 * Four purpose-built tabs: Spend, Requests, Tokens, Latency — each with a
 * real time axis, unit-formatted Y axis, and a glass tooltip.
 */

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnalyticsInterval, TimelineBucket } from "@/lib/analytics";
import { formatMs, formatPct, formatTokens, numberLabel, tickTime, tooltipTime } from "@/lib/analytics";
import { atomicToUsd, formatUsd } from "@/lib/receipts";

export type ChartTab = "spend" | "requests" | "tokens" | "latency";

const CYAN = "hsl(var(--primary))";
const FUCHSIA = "hsl(var(--accent))";
const EMERALD = "hsl(160 84% 45%)";
const RED = "hsl(0 72% 51%)";
const AMBER = "hsl(38 92% 50%)";
const MUTED = "hsl(var(--muted-foreground))";

interface Row {
  t: number;
  end: number;
  spend: number;
  inference: number;
  fee: number;
  succeeded: number;
  failed: number;
  aborted: number;
  total: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  latencyCount: number;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

function toRows(timeline: TimelineBucket[]): Row[] {
  return timeline.map((bucket) => {
    const { totals } = bucket;
    const hasLatency = totals.latency.count > 0;
    return {
      t: bucket.timestamp,
      end: bucket.endTimestamp,
      spend: atomicToUsd(totals.billing.finalAmountAtomic),
      inference: atomicToUsd(totals.billing.inferenceAmountAtomic),
      fee: atomicToUsd(totals.billing.platformFeeAtomic),
      succeeded: totals.requests.succeeded,
      failed: totals.requests.failed,
      aborted: totals.requests.aborted,
      total: totals.requests.total,
      tokensIn: totals.usage.metrics.input_tokens ?? totals.usage.metrics.text_input_tokens ?? 0,
      tokensOut: totals.usage.metrics.output_tokens ?? totals.usage.metrics.text_output_tokens ?? 0,
      tokensTotal: totals.usage.metrics.total_tokens ?? 0,
      latencyCount: totals.latency.count,
      avg: hasLatency ? totals.latency.averageMs : null,
      p50: hasLatency ? totals.latency.p50Ms : null,
      p95: hasLatency ? totals.latency.p95Ms : null,
      p99: hasLatency ? totals.latency.p99Ms : null,
    };
  });
}

const AXIS_TICK = {
  fill: MUTED,
  fontSize: "var(--font-2xs)",
  fontFamily: "var(--font-mono), monospace",
} as const;

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Row;
}

function ChartTooltip({
  active,
  payload,
  interval,
  tab,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  interval: AnalyticsInterval;
  tab: ChartTab;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  let lines: Array<{ color: string; label: string; value: string; strong?: boolean }> = [];
  if (tab === "spend") {
    lines = [
      { color: CYAN, label: "Inference", value: formatUsd(row.inference) },
      { color: FUCHSIA, label: "Platform fee", value: formatUsd(row.fee) },
      { color: CYAN, label: "Total", value: formatUsd(row.spend), strong: true },
      { color: MUTED, label: "Requests", value: numberLabel(row.total) },
    ];
  } else if (tab === "requests") {
    const success = row.total > 0 ? row.succeeded / row.total : null;
    lines = [
      { color: EMERALD, label: "Succeeded", value: numberLabel(row.succeeded) },
      { color: RED, label: "Failed", value: numberLabel(row.failed) },
      { color: AMBER, label: "Aborted", value: numberLabel(row.aborted) },
      { color: CYAN, label: "Success rate", value: formatPct(success), strong: true },
    ];
  } else if (tab === "tokens") {
    const hasSplit = row.tokensIn > 0 || row.tokensOut > 0;
    lines = hasSplit
      ? [
          { color: CYAN, label: "Input", value: formatTokens(row.tokensIn) },
          { color: FUCHSIA, label: "Output", value: formatTokens(row.tokensOut) },
          { color: MUTED, label: "Total", value: formatTokens(row.tokensIn + row.tokensOut), strong: true },
        ]
      : [{ color: CYAN, label: "Tokens", value: formatTokens(row.tokensTotal), strong: true }];
  } else {
    lines = [
      { color: CYAN, label: "P50", value: row.p50 !== null ? formatMs(row.p50) : "—" },
      { color: AMBER, label: "P95", value: row.p95 !== null ? formatMs(row.p95) : "—" },
      { color: FUCHSIA, label: "P99", value: row.p99 !== null ? formatMs(row.p99) : "—" },
      { color: MUTED, label: "Average", value: row.avg !== null ? formatMs(row.avg) : "—" },
    ];
  }

  return (
    <div className="cm-chart-tooltip">
      <div className="cm-chart-tooltip__time">{tooltipTime(row.t, row.end, interval)}</div>
      {lines.map((line) => (
        <div key={line.label} className="cm-chart-tooltip__row" data-strong={line.strong ? "true" : undefined}>
          <span className="cm-chart-tooltip__label">
            <span className="cm-chart-tooltip__dot" style={{ background: line.color }} />
            {line.label}
          </span>
          <span className="cm-chart-tooltip__value">{line.value}</span>
        </div>
      ))}
    </div>
  );
}

function TimeAxis({ interval }: { interval: AnalyticsInterval }) {
  return (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={["dataMin", "dataMax"]}
      padding={{ left: 6, right: 16 }}
      tickFormatter={(value: number) => tickTime(value, interval)}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: "hsl(var(--primary) / 0.12)" }}
      minTickGap={26}
      tickMargin={5}
      height={24}
    />
  );
}

export function UsageChart({
  timeline,
  interval,
  tab,
  focused = false,
}: {
  timeline: TimelineBucket[];
  interval: AnalyticsInterval;
  tab: ChartTab;
  focused?: boolean;
}) {
  const gradientId = useId().replace(/:/gu, "");
  const rows = useMemo(() => toRows(timeline), [timeline]);
  const hasTokenSplit = rows.some((row) => row.tokensIn > 0 || row.tokensOut > 0);

  const grid = <CartesianGrid stroke="hsl(var(--primary) / 0.06)" vertical={false} />;
  const xAxis = <TimeAxis interval={interval} />;
  const tooltip = (
    <Tooltip
      content={<ChartTooltip interval={interval} tab={tab} />}
      cursor={tab === "requests" || tab === "tokens"
        ? { fill: "hsl(var(--primary) / 0.06)" }
        : { stroke: "hsl(var(--primary) / 0.3)", strokeDasharray: "3 3" }}
    />
  );

  return (
    <div className="cm-chart-frame">
      <ResponsiveContainer width="100%" height="100%">
        {tab === "spend" ? (
          <AreaChart data={rows} margin={{ top: 6, right: 14, bottom: 4, left: 2 }}>
            <defs>
              <linearGradient id={`${gradientId}-spend`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CYAN} stopOpacity="0.32" />
                <stop offset="100%" stopColor={CYAN} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {grid}
            {xAxis}
            <YAxis
              width={52}
              tickFormatter={(value: number) => (value === 0 ? "$0" : value >= 1 ? `$${numberLabel(value)}` : `$${value.toFixed(3)}`)}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
            />
            {tooltip}
            <Area
              type="monotone"
              dataKey="spend"
              stroke={CYAN}
              strokeWidth={1.6}
              fill={`url(#${gradientId}-spend)`}
              dot={false}
              activeDot={{ r: 3, fill: CYAN, stroke: "none" }}
            />
          </AreaChart>
        ) : tab === "requests" ? (
          <BarChart data={rows} margin={{ top: 6, right: 14, bottom: 4, left: 2 }}>
            {grid}
            {xAxis}
            <YAxis width={36} tickFormatter={numberLabel} tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            {tooltip}
            <Bar dataKey="succeeded" stackId="requests" fill={EMERALD} maxBarSize={26} />
            <Bar dataKey="failed" stackId="requests" fill={RED} maxBarSize={26} />
            <Bar dataKey="aborted" stackId="requests" fill={AMBER} maxBarSize={26} radius={[2, 2, 0, 0]} />
          </BarChart>
        ) : tab === "tokens" && hasTokenSplit ? (
          <BarChart data={rows} margin={{ top: 6, right: 14, bottom: 4, left: 2 }}>
            {grid}
            {xAxis}
            <YAxis width={40} tickFormatter={formatTokens} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            {tooltip}
            <Bar dataKey="tokensIn" stackId="tokens" fill={CYAN} maxBarSize={26} />
            <Bar dataKey="tokensOut" stackId="tokens" fill={FUCHSIA} maxBarSize={26} radius={[2, 2, 0, 0]} />
          </BarChart>
        ) : tab === "tokens" ? (
          <AreaChart data={rows} margin={{ top: 6, right: 14, bottom: 4, left: 2 }}>
            <defs>
              <linearGradient id={`${gradientId}-tokens`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CYAN} stopOpacity="0.28" />
                <stop offset="100%" stopColor={CYAN} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {grid}
            {xAxis}
            <YAxis width={40} tickFormatter={formatTokens} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            {tooltip}
            <Area
              type="monotone"
              dataKey="tokensTotal"
              stroke={CYAN}
              strokeWidth={1.6}
              fill={`url(#${gradientId}-tokens)`}
              dot={false}
              activeDot={{ r: 3, fill: CYAN, stroke: "none" }}
            />
          </AreaChart>
        ) : (
          <LineChart data={rows} margin={{ top: 6, right: 14, bottom: 4, left: 2 }}>
            {grid}
            {xAxis}
            <YAxis width={42} tickFormatter={(value: number) => formatMs(value)} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            {tooltip}
            <Line type="monotone" dataKey="p50" stroke={CYAN} strokeWidth={1.6} dot={false} connectNulls activeDot={{ r: 3, fill: CYAN, stroke: "none" }} />
            <Line type="monotone" dataKey="p95" stroke={AMBER} strokeWidth={1.4} dot={false} connectNulls activeDot={{ r: 3, fill: AMBER, stroke: "none" }} />
            <Line type="monotone" dataKey="p99" stroke={FUCHSIA} strokeWidth={1.4} dot={false} connectNulls activeDot={{ r: 3, fill: FUCHSIA, stroke: "none" }} />
            <Line type="monotone" dataKey="avg" stroke={MUTED} strokeWidth={1.1} strokeDasharray="4 3" dot={false} connectNulls activeDot={{ r: 3, fill: MUTED, stroke: "none" }} />
          </LineChart>
        )}
      </ResponsiveContainer>

      {focused && (tab === "requests" || tab === "tokens" || tab === "latency") ? (
        <div className="cm-chart-legend" aria-hidden="true">
          {tab === "requests" ? (
            <>
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: EMERALD }} />Succeeded</span>
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: RED }} />Failed</span>
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: AMBER }} />Aborted</span>
            </>
          ) : tab === "tokens" ? (
            hasTokenSplit ? (
              <>
                <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: CYAN }} />Input</span>
                <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: FUCHSIA }} />Output</span>
              </>
            ) : (
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: CYAN }} />Total tokens</span>
            )
          ) : (
            <>
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: CYAN }} />P50</span>
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: AMBER }} />P95</span>
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: FUCHSIA }} />P99</span>
              <span className="cm-chart-legend__item"><span className="cm-chart-legend__dot" style={{ background: MUTED }} />Avg</span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default UsageChart;
