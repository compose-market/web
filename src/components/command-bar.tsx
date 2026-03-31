/**
 * CommandBar — ⌘K Model Selection Palette
 *
 * Full-screen overlay with fuzzy search, provider grouping,
 * keyboard navigation, and inline model metadata.
 *
 * Uses useModels hook (no extra fetches), renders via portal.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useModels } from "@/hooks/use-model";
import { formatModelTypeLabel, getPrimaryModelType, getDefaultModelPricingSections, getModelTypeValues } from "@/lib/models";
import type { CatalogModel } from "@/lib/models";

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSelect: (modelId: string) => void;
  type?: string;
  provider?: string;
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

/** Map provider names to unique color pairs (background + text) */
const PROVIDER_COLORS: Record<string, { bg: string; text: string }> = {
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

function getProviderColor(provider: string): { bg: string; text: string } {
  const key = provider.toLowerCase();
  if (PROVIDER_COLORS[key]) return PROVIDER_COLORS[key];
  // Deterministic hash for unknown providers
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  return {
    bg: `hsl(${hash} 60% 50% / 0.2)`,
    text: `hsl(${hash} 60% 65%)`,
  };
}

export function CommandBar({ open, onOpenChange, value, onSelect, type, provider }: CommandBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { models } = useModels({});

  // Apply external + search filters
  const filteredModels = useMemo(() => {
    let result = models;

    if (type && type !== "all") {
      result = result.filter((m: CatalogModel) => getModelTypeValues(m).includes(type));
    }
    if (provider && provider !== "all") {
      result = result.filter((m: CatalogModel) => m.provider === provider);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m: CatalogModel) =>
          m.modelId.toLowerCase().includes(q) ||
          (m.name || "").toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q) ||
          getPrimaryModelType(m).toLowerCase().includes(q)
      );
    }
    return result;
  }, [models, type, provider, searchQuery]);

  // Group by provider
  const grouped = useMemo(() => {
    const groups = new Map<string, CatalogModel[]>();
    for (const m of filteredModels) {
      const g = groups.get(m.provider) || [];
      g.push(m);
      groups.set(m.provider, g);
    }
    // Sort groups by size descending
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filteredModels]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => grouped.flatMap(([, models]) => models), [grouped]);

  // Reset selection on filter change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, type, provider]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

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
          setSelectedIndex((i) => Math.min(i + 1, flatList.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (flatList[selectedIndex]) {
            onSelect(flatList[selectedIndex].modelId);
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
    <div
      className="cm-playground__cmd-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="cm-playground__cmd-panel" onKeyDown={handleKeyDown}>
        <div className="cm-playground__cmd-header">
          <input
            ref={inputRef}
            className="cm-playground__cmd-input"
            placeholder="Search models by name, provider, or type…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="cm-playground__cmd-list" ref={listRef}>
          {flatList.length === 0 ? (
            <div className="cm-playground__cmd-empty">No models match "{searchQuery}"</div>
          ) : (
            grouped.map(([providerName, providerModels]) => {
              const pColor = getProviderColor(providerName);
              return (
              <div key={providerName}>
                <div className="cm-playground__cmd-group" style={{ color: pColor.text }}>
                  {providerName} ({providerModels.length})
                </div>
                {providerModels.map((model) => {
                  const idx = flatList.indexOf(model);
                  const modelType = getPrimaryModelType(model);
                  const isSelected = idx === selectedIndex;
                  const isCurrent = model.modelId === value;

                  return (
                    <div
                      key={model.modelId}
                      data-cmd-item
                      className={[
                        "cm-playground__cmd-item",
                        isSelected ? "cm-playground__cmd-item--selected" : "",
                        isCurrent ? "cm-playground__cmd-item--current" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        onSelect(model.modelId);
                        onOpenChange(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="cm-playground__cmd-item-name">
                        {model.name || model.modelId}
                      </span>
                      <div className="cm-playground__cmd-item-meta">
                        <span
                          className="cm-playground__cmd-item-provider"
                          style={{ background: pColor.bg, color: pColor.text }}
                        >{model.provider}</span>
                        <span className="cm-playground__cmd-item-type">
                          {formatModelTypeLabel(modelType)}
                        </span>
                        <span className="cm-playground__cmd-item-price">{formatPrice(model)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
            })
          )}
        </div>

        <div className="cm-playground__cmd-footer">
          <span className="cm-playground__cmd-footer-count">
            {filteredModels.length} of {models.length} models
          </span>
          <div className="cm-playground__cmd-footer-hints">
            <span className="cm-playground__cmd-hint">
              <kbd>↑↓</kbd> navigate
            </span>
            <span className="cm-playground__cmd-hint">
              <kbd>↵</kbd> select
            </span>
            <span className="cm-playground__cmd-hint">
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
