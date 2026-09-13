/**
 * CommandBar — ⌘K Model Selection Palette
 *
 * Full-screen overlay with fuzzy search, provider grouping,
 * keyboard navigation, and inline model metadata.
 *
 * Uses useModels hook (no extra fetches), renders via portal.
 */
import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { ShellCommandItem, ShellCommandOverlay, ShellCommandPanel } from "@compose-market/theme/shell";
import { useModels, useSemanticModelSearch } from "@/hooks/use-model";
import {
  formatModelTypeLabel,
  getPrimaryModelType,
  getDefaultModelPricingSections,
  getModelTypeValues,
  getModelTypeClass,
  getModelTypeVisualId,
  getFamilyLogoUrl,
  mergeSemanticModelRanks,
  normalizeModelSearchText,
  rankCatalogModels,
} from "@/lib/models";
import type { CatalogModel } from "@/lib/models";
import { typeIcon } from "@compose-market/theme/icons/react";

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSelect: (modelId: string) => void;
  type?: string;
  family?: string;
}

function formatPrice(model: CatalogModel): string {
  const sections = getDefaultModelPricingSections(model);
  if (sections.length === 0) return "—";

  for (const section of sections) {
    for (const entry of section.entries) {
      const label = entry.label.toLowerCase();
      if (label.includes("input") || label.includes("prompt") || label.includes("cost") || label.includes("generation") || label.includes("megapixel") || label.includes("second")) {
        const val = parseFloat(entry.value);
        if (val === 0) return "FREE";
        if (Number.isFinite(val)) {
          if (val < 0.001) return `$${val.toFixed(6)}`;
          if (val < 1) return `$${val.toFixed(4)}`;
          return `$${val.toFixed(2)}`;
        }
      }
    }
  }
  return "—";
}

/** Map family names to unique color pairs (background + text) */
const FAMILY_COLORS: Record<string, { bg: string; text: string }> = {
  google: { bg: "hsl(205 85% 50% / 0.2)", text: "hsl(205 85% 65%)" },
  openai: { bg: "hsl(160 70% 42% / 0.2)", text: "hsl(160 70% 58%)" },
  anthropic: { bg: "hsl(25 90% 55% / 0.2)", text: "hsl(25 90% 68%)" },
  meta: { bg: "hsl(215 90% 55% / 0.2)", text: "hsl(215 90% 68%)" },
  mistral: { bg: "hsl(340 75% 55% / 0.2)", text: "hsl(340 75% 70%)" },
  cohere: { bg: "hsl(270 75% 58% / 0.2)", text: "hsl(270 75% 72%)" },
  perplexity: { bg: "hsl(175 70% 45% / 0.2)", text: "hsl(175 70% 60%)" },
  deepseek: { bg: "hsl(195 80% 48% / 0.2)", text: "hsl(195 80% 62%)" },
  stability: { bg: "hsl(280 65% 55% / 0.2)", text: "hsl(280 65% 70%)" },
  "black-forest-labs": { bg: "hsl(45 80% 48% / 0.2)", text: "hsl(45 80% 62%)" },
  together: { bg: "hsl(310 70% 55% / 0.2)", text: "hsl(310 70% 70%)" },
  replicate: { bg: "hsl(10 80% 55% / 0.2)", text: "hsl(10 80% 68%)" },
  huggingface: { bg: "hsl(42 85% 50% / 0.2)", text: "hsl(42 85% 65%)" },
  groq: { bg: "hsl(138 65% 48% / 0.2)", text: "hsl(138 65% 62%)" },
  xai: { bg: "hsl(230 70% 58% / 0.2)", text: "hsl(230 70% 72%)" },
};

function getFamilyColor(family: string): { bg: string; text: string } {
  const key = family.toLowerCase();
  if (FAMILY_COLORS[key]) return FAMILY_COLORS[key];
  // Deterministic hash for unknown families
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  return {
    bg: `hsl(${hash} 60% 50% / 0.2)`,
    text: `hsl(${hash} 60% 65%)`,
  };
}

function selectionKey(model: CatalogModel): string {
  return `${model.provider.toLowerCase()}:${model.modelId.toLowerCase()}`;
}

const FRONTIER_TYPE_ORDER = ["text", "image", "video", "music"] as const;
type FrontierType = typeof FRONTIER_TYPE_ORDER[number];

function frontierType(model: CatalogModel): FrontierType {
  const types = getModelTypeValues(model);
  const outputs = Array.isArray(model.output)
    ? model.output.filter((value): value is string => typeof value === "string")
    : typeof model.output === "string" ? [model.output] : [];
  if (types.includes("image generation") || outputs.includes("image")) return "image";
  if (types.includes("video generation") || outputs.includes("video")) return "video";
  if (types.includes("music generation") || outputs.includes("audio")) return "music";
  return "text";
}

function displayKey(group: string, model: CatalogModel): string {
  return `${group}:${selectionKey(model)}`;
}

export function CommandBar({ open, onOpenChange, value, onSelect, type, family }: CommandBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedKeyRef = useRef<string | null>(null);

  const { models, frontiers, refreshError } = useModels({ enabled: open });
  const deferredQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSemanticQuery("");
      return;
    }
    const timer = window.setTimeout(() => setSemanticQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const { hits: semanticHits, isLoading: semanticLoading } = useSemanticModelSearch(semanticQuery, {
    enabled: open,
    limit: 20,
  });

  // External filters apply before either local or semantic ranking.
  const eligibleModels = useMemo(() => {
    if (!open) return [];
    let result = models;

    if (type && type !== "all") {
      result = result.filter((m: CatalogModel) => getModelTypeValues(m).includes(type));
    }
    if (family && family !== "all") {
      result = result.filter((m: CatalogModel) => (m.family || m.provider) === family);
    }
    return result;
  }, [family, models, open, type]);

  const searchActive = Boolean(deferredQuery.trim());
  const localRanks = useMemo(
    () => searchActive ? rankCatalogModels(eligibleModels, deferredQuery, 50) : [],
    [deferredQuery, eligibleModels, searchActive],
  );
  const activeSemanticHits = useMemo(() => (
    normalizeModelSearchText(semanticQuery) === normalizeModelSearchText(deferredQuery)
      ? semanticHits
      : []
  ), [deferredQuery, semanticHits, semanticQuery]);
  const filteredModels = useMemo(() => {
    if (!searchActive) return eligibleModels;
    return mergeSemanticModelRanks(eligibleModels, localRanks, activeSemanticHits, 50)
      .map((entry) => entry.model);
  }, [activeSemanticHits, eligibleModels, localRanks, searchActive]);

  const frontierKeys = useMemo(
    () => new Set(frontiers.filter((item) => item.isFrontier).flatMap((item) => [
      `${item.provider.toLowerCase()}:${item.modelId.toLowerCase()}`,
      `*:${item.modelId.toLowerCase()}`,
    ])),
    [frontiers],
  );

  // Group by family
  const grouped = useMemo(() => {
    if (searchActive) {
      return [["Best matches", filteredModels] as [string, CatalogModel[]]];
    }
    const byKey = new Map(filteredModels.map((model) => [selectionKey(model), model]));
    const byId = new Map(filteredModels.map((model) => [model.modelId.toLowerCase(), model]));
    const promoted = frontiers.flatMap((item) => {
      const modelId = item.modelId.toLowerCase();
      const model = byKey.get(`${item.provider.toLowerCase()}:${modelId}`) ?? byId.get(modelId);
      return model ? [{ model, isFrontier: item.isFrontier, isLatest: item.isLatest }] : [];
    });
    const byType = (left: CatalogModel, right: CatalogModel) => (
      FRONTIER_TYPE_ORDER.indexOf(frontierType(left)) - FRONTIER_TYPE_ORDER.indexOf(frontierType(right))
    );
    const latestModels = promoted.filter((item) => item.isLatest).map((item) => item.model).sort(byType);
    const frontierModels = promoted.filter((item) => item.isFrontier).map((item) => item.model).sort(byType);
    const frontierGroups = [
      ...(frontierModels.length > 0 ? [["Frontier", frontierModels] as [string, CatalogModel[]]] : []),
      ...(latestModels.length > 0 ? [["Latest", latestModels] as [string, CatalogModel[]]] : []),
    ];
    const groups = new Map<string, CatalogModel[]>();
    for (const m of filteredModels) {
      const fam = m.family || m.provider;
      const g = groups.get(fam) || [];
      g.push(m);
      groups.set(fam, g);
    }
    // Sort groups by size descending
    const familyGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
    return [...frontierGroups, ...familyGroups];
  }, [filteredModels, frontiers, searchActive]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => grouped.flatMap(([group, models]) => models.map((model) => ({
    rowKey: displayKey(group, model),
    model,
  }))), [grouped]);
  const flatIndexByKey = useMemo(
    () => new Map(flatList.map((row, index) => [row.rowKey, index])),
    [flatList],
  );

  // Reset selection on filter change
  useEffect(() => {
    selectedKeyRef.current = null;
    setSelectedIndex(0);
  }, [searchQuery, type, family]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSemanticQuery("");
      selectedKeyRef.current = null;
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Semantic results can arrive later. If the user already moved selection,
  // preserve that model rather than silently moving the keyboard target.
  useEffect(() => {
    const selectedKey = selectedKeyRef.current;
    if (!selectedKey) {
      setSelectedIndex((index) => Math.min(index, Math.max(0, flatList.length - 1)));
      return;
    }
    const nextIndex = flatList.findIndex((row) => row.rowKey === selectedKey);
    if (nextIndex >= 0) setSelectedIndex(nextIndex);
  }, [flatList]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-cmd-item]");
    const item = items[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((index) => {
            const next = Math.min(index + 1, Math.max(0, flatList.length - 1));
            selectedKeyRef.current = flatList[next]?.rowKey ?? null;
            return next;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((index) => {
            const next = Math.max(index - 1, 0);
            selectedKeyRef.current = flatList[next]?.rowKey ?? null;
            return next;
          });
          break;
        case "Enter":
          e.preventDefault();
          if (flatList[selectedIndex]) {
            onSelect(flatList[selectedIndex].model.modelId);
            onOpenChange(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [flatList, selectedIndex, onSelect, onOpenChange]
  );

  if (!open) return null;

  return createPortal(
    <ShellCommandOverlay open={open} onClose={() => onOpenChange(false)}>
      <ShellCommandPanel onKeyDown={handleKeyDown}>
        <div className="cm-command-header">
          <input
            ref={inputRef}
            className="cm-command-input"
            placeholder="Search models by name, family, or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="cm-command-list" ref={listRef}>
          {flatList.length === 0 ? (
            <div className="cm-command-empty">
              {semanticLoading ? `Searching catalog for "${searchQuery}"…` : `No models match "${searchQuery}"`}
            </div>
          ) : (
            grouped.map(([familyName, familyModels]) => {
              const fColor = getFamilyColor(familyName);
              return (
                <div key={familyName}>
                  <div className="cm-command-group" style={{ color: fColor.text, display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    {(() => {
                      const logoUrl = getFamilyLogoUrl(familyName);
                      if (logoUrl) {
                        return <img src={logoUrl} alt={familyName} className="cm-family-icon" style={{ width: "0.85rem", height: "0.85rem", borderRadius: "2px" }} />;
                      }
                      return null;
                    })()}
                    <span>{familyName} ({familyModels.length})</span>
                  </div>
                  {familyModels.map((model) => {
                    const rowKey = displayKey(familyName, model);
                    const idx = flatIndexByKey.get(rowKey) ?? -1;
                    const modelType = getPrimaryModelType(model);
                    const modelColor = getFamilyColor(model.family || model.provider);
                    const isSelected = idx === selectedIndex;
                    const isCurrent = model.modelId === value;
                    const isFrontier = frontierKeys.has(selectionKey(model))
                      || frontierKeys.has(`*:${model.modelId.toLowerCase()}`);
                    const isFrontierGroup = familyName === "Frontier";
                    const isFamilyGroup = !isFrontierGroup
                      && familyName !== "Latest"
                      && familyName !== "Best matches";

                    return (
                      <ShellCommandItem
                        key={rowKey}
                        data-cmd-item
                        selected={isSelected}
                        current={isCurrent}
                        onClick={() => {
                          onSelect(model.modelId);
                          onOpenChange(false);
                        }}
                        onMouseEnter={() => {
                          selectedKeyRef.current = rowKey;
                          setSelectedIndex(idx);
                        }}
                        className={`flex items-center justify-between gap-2${isFrontierGroup ? ` cm-command-item--frontier ${getModelTypeClass(modelType)}` : ""}`}
                      >
                        <div className="flex-1 min-w-0 flex items-center justify-between">
                          <span className="cm-command-item__name truncate mr-2 inline-flex items-center gap-2">
                            {model.name || model.modelId}
                            {isFrontier && isFamilyGroup && (
                              <span className="shrink-0 rounded-full border border-cyan-300/70 bg-cyan-300/15 px-1.5 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-[0.14em] text-cyan-200 shadow-[0_0_12px_rgba(103,232,249,0.45)]">
                                Frontier
                              </span>
                            )}
                          </span>
                          <span className="inline-flex sm:hidden text-cyan-400 shrink-0 select-none scale-90">
                            {typeIcon(getModelTypeVisualId(modelType))}
                          </span>
                        </div>
                        <div className="cm-command-item__meta cm-model-command-meta hidden sm:flex">
                          <span
                            className="cm-command-item__family"
                            style={{ background: modelColor.bg, color: modelColor.text }}
                          >{model.provider}</span>
                          <span className={`cm-command-item__type ${getModelTypeClass(modelType)}`}>
                            {typeIcon(modelType)}
                            {formatModelTypeLabel(modelType)}
                          </span>
                          <span className="cm-command-item__price">{formatPrice(model)}</span>
                        </div>
                      </ShellCommandItem>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="cm-command-footer">
          <span>
            {filteredModels.length} of {models.length} models
            {semanticLoading && searchActive ? " · semantic search…" : ""}
            {refreshError ? (
              <span className="text-amber-400"> · catalog refresh failed — showing cached</span>
            ) : null}
          </span>
          <div className="cm-command-footer__hints">
            <span className="cm-command-hint">
              <kbd>↑↓</kbd> navigate
            </span>
            <span className="cm-command-hint">
              <kbd>↵</kbd> select
            </span>
            <span className="cm-command-hint">
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </ShellCommandPanel>
    </ShellCommandOverlay>,
    document.body
  );
}
