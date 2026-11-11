/**
 * CommandBar — ⌘K Model Selection Palette
 *
 * Full-screen overlay with fuzzy search, provider grouping,
 * keyboard navigation, and inline model metadata.
 *
 * Uses useModels hook (no extra fetches), renders via portal.
 */
import { memo, useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
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
import { typeIcon } from "@/lib/modalities";

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