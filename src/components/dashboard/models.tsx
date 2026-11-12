import { useState, useMemo, useCallback } from "react";
import { Box, Search } from "lucide-react";
import type { ModelUsage, TypeEntry } from "@/lib/analytics";
import { formatMs, formatPct, formatTokens } from "@/lib/analytics";
import { formatUsd } from "@/lib/receipts";
import { getFamilyLogoUrl, formatModelTypeLabel } from "@/lib/models";
import { BlockDropdown } from "./dropdown";
import { ModalityBreakdown, MODALITY_METRIC_OPTIONS, type ModalityMetric } from "./modalities";

type SortKey = "totalUsd" | "calls" | "lastUsed" | "totalTokens" | "type" | "p95Ms" | "successRate";
type SortDir = "asc" | "desc";
type ModelsView = "models" | "type";

const SORT_OPTIONS = [
  { value: "totalUsd", label: "Cost" },
  { value: "calls", label: "Calls" },
  { value: "totalTokens", label: "Tokens" },
  { value: "p95Ms", label: "Latency" },
  { value: "successRate", label: "Success" },
  { value: "lastUsed", label: "Recent" },
  { value: "type", label: "Type" },
] as const;

const VIEW_OPTIONS = [
  { value: "models", label: "Models" },
  { value: "type", label: "By Type" },
] as const;

function successTone(rate: number | null): "emerald" | "amber" | "danger" | undefined {
  if (rate === null) return undefined;
  if (rate >= 0.99) return "emerald";
  if (rate >= 0.95) return "amber";
  return "danger";
}

export function ModelUsageTable({
  models,
  modalityBreakdown,
  focused = false,
  dataBlock,
  onClick,
}: {
  models: ModelUsage[];
  modalityBreakdown: TypeEntry[];
  focused?: boolean;
  dataBlock?: string;
  onClick?: () => void;
}) {
  const [view, setView] = useState<ModelsView>("models");
  const [metric, setMetric] = useState<ModalityMetric>("usd");
  const [sortKey, setSortKey] = useState<SortKey>("totalUsd");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");

  const handleSortChange = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? models.filter((model) =>
        model.modelId.toLowerCase().includes(needle) || model.family.toLowerCase().includes(needle))
      : models;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "calls":
          cmp = a.calls - b.calls;
          break;
        case "lastUsed":
          cmp = a.lastUsed - b.lastUsed;
          break;
        case "totalTokens":
          cmp = a.totalTokens - b.totalTokens;
          break;
        case "p95Ms":
          cmp = (a.p95Ms ?? -1) - (b.p95Ms ?? -1);
          break;
        case "successRate":
          cmp = (a.successRate ?? -1) - (b.successRate ?? -1);
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        default:
          cmp = a.totalUsd - b.totalUsd;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [models, sortKey, sortDir, query]);

  const visible = focused ? sorted : sorted.slice(0, 5);

  return (
    <div className="cm-block" data-block={dataBlock} data-focused={focused} onClick={onClick}>
      <div className="cm-block__header">
        <div className="cm-block__header-side" onClick={(event) => event.stopPropagation()}>
          <BlockDropdown
            value={view}
            options={[...VIEW_OPTIONS]}
            label="View"
            onChange={setView}
            align="start"
          />
        </div>
        <div className="cm-block__header-side" onClick={(e) => e.stopPropagation()}>
          {view === "models" ? (
            <>
              {focused && (
                <label className="cm-usage-search">
                  <Search className="cm-usage-search__icon" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter models…"
                    className="cm-usage-search__input"
                    aria-label="Filter models"
                  />
                </label>
              )}
              <BlockDropdown
                value={sortKey}
                options={[...SORT_OPTIONS]}
                label="Sort"
                onChange={handleSortChange}
                chevron={false}
              />
            </>
          ) : (
            <BlockDropdown
              value={metric}
              options={[...MODALITY_METRIC_OPTIONS]}
              label="Metric"
              onChange={setMetric}
            />
          )}
        </div>
      </div>

      {view === "type" ? (
        <ModalityBreakdown modalityBreakdown={modalityBreakdown} metric={metric} focused={focused} />
      ) : models.length === 0 ? (
        <div className="cm-block__empty">No model usage recorded yet</div>
      ) : visible.length === 0 ? (
        <div className="cm-block__empty">No models match “{query}”</div>
      ) : (
        <div className="cm-block__body">
          <table className="cm-usage-table">
            <thead>
              <tr>
                <th>Model</th>
                <th data-align="right">Cost</th>
                <th data-align="right">Calls</th>
                {focused && <th data-align="right">Tokens</th>}
                {focused && <th data-align="right">P95</th>}
                {focused && <th data-align="right">Success</th>}
                {focused && <th>Type</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((model) => {
                const logoUrl = getFamilyLogoUrl(model.family);
                return (
                  <tr key={model.subject}>
                    <td>
                      <span className="cm-usage-model">
                        {logoUrl ? (
                          <img
                            src={logoUrl}
                            alt={model.family}
                            className="cm-usage-model__icon"
                          />
                        ) : (
                          <span className="cm-usage-model__icon cm-usage-model__icon--fallback" aria-hidden="true">
                            <Box className="cm-usage-model__icon-glyph" />
                          </span>
                        )}
                        <span className="cm-usage-model__name">
                          <span className="cm-usage-model__id">{model.modelId}</span>
                          <span className="cm-usage-model__provider">{model.family}</span>
                        </span>
                      </span>
                    </td>
                    <td data-align="right" className="cm-usage-cost">
                      {formatUsd(model.totalUsd)}
                    </td>
                    <td data-align="right">{model.calls}</td>
                    {focused && <td data-align="right">{model.totalTokens > 0 ? formatTokens(model.totalTokens) : "—"}</td>}
                    {focused && <td data-align="right">{model.p95Ms !== null ? formatMs(model.p95Ms) : "—"}</td>}
                    {focused && (
                      <td data-align="right">
                        <span className="cm-usage-success" data-tone={successTone(model.successRate)}>
                          {formatPct(model.successRate, 0)}
                        </span>
                      </td>
                    )}
                    {focused && (
                      <td>
                        <span className="cm-usage-modality" data-tone={model.type}>
                          {formatModelTypeLabel(model.type)}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
