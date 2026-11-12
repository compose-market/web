import { useMemo } from "react";
import type { TypeEntry } from "@/lib/analytics";
import { formatMs, formatPct, formatTokens, numberLabel } from "@/lib/analytics";
import { formatUsd } from "@/lib/receipts";
import { formatModelTypeLabel } from "@/lib/models";

export type ModalityMetric = "usd" | "calls" | "tokens";

export const MODALITY_METRIC_OPTIONS: Array<{ value: ModalityMetric; label: string }> = [
  { value: "usd", label: "Spend" },
  { value: "calls", label: "Calls" },
  { value: "tokens", label: "Tokens" },
];

function metricValue(entry: TypeEntry, metric: ModalityMetric): number {
  if (metric === "usd") return entry.usd;
  if (metric === "calls") return entry.calls;
  return entry.tokens;
}

function metricLabel(value: number, metric: ModalityMetric): string {
  if (metric === "usd") return formatUsd(value);
  if (metric === "calls") return numberLabel(value);
  return formatTokens(value);
}

/**
 * ModalityBreakdown — block-less content rendered inside the Models block
 * when the "By Type" view is selected.
 */
export function ModalityBreakdown({
  modalityBreakdown,
  metric,
  focused = false,
}: {
  modalityBreakdown: TypeEntry[];
  metric: ModalityMetric;
  focused?: boolean;
}) {
  const data = useMemo(() => {
    const total = modalityBreakdown.reduce((sum, entry) => sum + metricValue(entry, metric), 0);
    const entries = modalityBreakdown.map((entry) => ({
      entry,
      value: metricValue(entry, metric),
      pct: total > 0 ? (metricValue(entry, metric) / total) * 100 : 0,
    }));
    return { entries, total };
  }, [modalityBreakdown, metric]);

  if (data.entries.length === 0) {
    return <div className="cm-block__empty">No data</div>;
  }

  return (
    <>
      <div className="cm-modality-bar">
        {data.entries.map(({ entry, value, pct }) => (
          <div
            key={entry.key}
            className="cm-modality-bar__segment"
            data-modality={entry.key}
            style={{ width: `${pct}%` }}
            title={`${formatModelTypeLabel(entry.key)}: ${metricLabel(value, metric)} (${pct.toFixed(0)}%)`}
          >
            {pct > 8 ? formatModelTypeLabel(entry.key).slice(0, 5) : ""}
          </div>
        ))}
      </div>

      {/* Compact legend (always visible) */}
      <div className="cm-modality-legend">
        {data.entries.map(({ entry, pct }) => (
          <span key={entry.key} className="cm-modality-legend__item">
            <span className="cm-modality-legend__dot" data-modality={entry.key} />
            {formatModelTypeLabel(entry.key)} · {pct.toFixed(0)}%
          </span>
        ))}
      </div>

      {/* Expanded detail (visible when focused) */}
      <div className="cm-modality-detail">
        {data.entries.map(({ entry, value }) => (
          <div key={entry.key} className="cm-modality-detail__row">
            <span className="cm-modality-detail__name">
              <span className="cm-modality-legend__dot" data-modality={entry.key} />
              {formatModelTypeLabel(entry.key)}
            </span>
            <span className="cm-modality-detail__stats">
              <span data-tone="primary">{metricLabel(value, metric)}</span>
              <span>{numberLabel(entry.calls)} calls</span>
              {entry.tokens > 0 && <span>{formatTokens(entry.tokens)} tok</span>}
              {entry.avgLatencyMs !== null && <span>avg {formatMs(entry.avgLatencyMs)}</span>}
              {entry.successRate !== null && (
                <span data-tone={entry.successRate >= 0.95 ? "emerald" : "danger"}>
                  {formatPct(entry.successRate, 0)} ok
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
