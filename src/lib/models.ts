/**
 * Catalog model display helpers.
 *
 * HTTP fetches against `/v1/models` and `/v1/models/:id` live on
 * `@compose-market/sdk` (`sdk.models.list()` / `sdk.models.get(id)`). This
 * file owns the pure UI-side derivations (pricing sections, context-window
 * formatting, type filtering, sessionStorage persistence for the
 * "selected model" across agent-creation hops).
 *
 * `CatalogModel` is re-exported as an alias of the SDK's `Model` type; both
 * the SDK and the web app consume the flat Compose-native shape that
 * `api.compose.market` serves.
 */

import type { Model } from "@compose-market/sdk";

export type CatalogModel = Model;

export type ModelJsonValue =
  | string
  | number
  | boolean
  | null
  | ModelJsonValue[]
  | { [key: string]: ModelJsonValue };

export interface ModelCategory {
  id: string;
  label: string;
  count: number;
}

export interface ModelDisplayField {
  label: string;
  value: string;
}

export interface ModelPricingSection {
  header: string;
  unit: string;
  entries: ModelDisplayField[];
  default: boolean;
}

export interface SelectedCatalogModel {
  modelId: string;
  name: string | null;
  provider: string;
  pricing: ModelJsonValue;
  contextWindow: ModelJsonValue;
}

export const MODEL_SELECTION_STORAGE_KEY = "selectedCatalogModel";

export function getModelTypeValues(model: CatalogModel): string[] {
  if (typeof model.type === "string") {
    return [model.type];
  }
  if (Array.isArray(model.type) && model.type.every((value) => typeof value === "string")) {
    return model.type;
  }
  throw new Error(`type is required for model ${model.modelId}`);
}

export function getPrimaryModelType(model: CatalogModel): string {
  const values = getModelTypeValues(model);
  if (values.length === 0) {
    throw new Error(`type is required for model ${model.modelId}`);
  }
  return values[0];
}

export function formatModelTypeLabel(type: string): string {
  return type.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function buildTypeCategories(models: CatalogModel[]): ModelCategory[] {
  const counts = new Map<string, number>();

  for (const model of models) {
    for (const modelType of getModelTypeValues(model)) {
      counts.set(modelType, (counts.get(modelType) || 0) + 1);
    }
  }

  return [
    { id: "all", label: "All Models", count: models.length },
    ...Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: formatModelTypeLabel(id), count })),
  ];
}

export function buildProviderCategories(models: CatalogModel[]): ModelCategory[] {
  const counts = new Map<string, number>();

  for (const model of models) {
    counts.set(model.provider, (counts.get(model.provider) || 0) + 1);
  }

  return [
    { id: "all", label: "All Providers", count: models.length },
    ...Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: id, count })),
  ];
}

export function getModelOutputType(model: CatalogModel | null | undefined): "text" | "image" | "video" | "audio" | "embedding" {
  if (!model) {
    return "text";
  }

  const typeValues = getModelTypeValues(model).map((value) => value.toLowerCase());
  if (typeValues.some((value) => value.includes("video"))) {
    return "video";
  }
  if (typeValues.some((value) => value.includes("image"))) {
    return "image";
  }
  if (typeValues.some((value) => value.includes("audio") || value.includes("speech") || value.includes("transcription"))) {
    return "audio";
  }
  if (typeValues.some((value) => value.includes("embedding") || value.includes("feature-extraction"))) {
    return "embedding";
  }
  return "text";
}

export function isGoogleModel(model: CatalogModel | null | undefined): boolean {
  return model?.provider === "gemini";
}

export function toSelectedCatalogModel(model: CatalogModel): SelectedCatalogModel {
  return {
    modelId: model.modelId,
    name: model.name,
    provider: model.provider,
    pricing: model.pricing as ModelJsonValue,
    contextWindow: model.contextWindow as ModelJsonValue,
  };
}

export function saveSelectedCatalogModel(model: CatalogModel): void {
  sessionStorage.setItem(MODEL_SELECTION_STORAGE_KEY, JSON.stringify(toSelectedCatalogModel(model)));
}

export function loadSelectedCatalogModel(): SelectedCatalogModel | null {
  const raw = sessionStorage.getItem(MODEL_SELECTION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as SelectedCatalogModel;
}

export function clearSelectedCatalogModel(): void {
  sessionStorage.removeItem(MODEL_SELECTION_STORAGE_KEY);
}

function humanizeModelKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPrimitiveValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }

  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

function asObjectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function getModelValueList(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [formatPrimitiveValue(value)];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatPrimitiveValue(entry));
  }

  const objectValue = asObjectValue(value);
  if (!objectValue) {
    return [formatPrimitiveValue(value)];
  }

  return Object.entries(objectValue).map(([key, entry]) => `${humanizeModelKey(key)}: ${formatPrimitiveValue(entry)}`);
}

export function formatModelValue(value: ModelJsonValue): string {
  const values = getModelValueList(value);
  if (values.length === 0) {
    return "null";
  }
  return values.join(" • ");
}

export function getModelContextWindowEntries(model: CatalogModel): ModelDisplayField[] {
  const contextWindow = model.contextWindow;
  if (typeof contextWindow === "number") {
    return [{ label: "Input tokens", value: contextWindow.toLocaleString() }];
  }
  if (contextWindow === null || contextWindow === undefined) {
    return [];
  }

  const asObject = asObjectValue(contextWindow);
  if (!asObject) {
    return [];
  }

  return Object.entries(asObject).map(([key, value]) => ({
    label: humanizeModelKey(key),
    value: formatPrimitiveValue(value),
  }));
}

export function formatModelContextWindow(model: CatalogModel): string {
  const entries = getModelContextWindowEntries(model);
  if (entries.length === 0) {
    return "null";
  }
  return entries.map((entry) => `${entry.label}: ${entry.value}`).join(" • ");
}

export function getModelPricingSections(model: CatalogModel): ModelPricingSection[] {
  const pricing = asObjectValue(model.pricing);
  if (!pricing) {
    return [];
  }

  const sectionValues = Array.isArray(pricing.sections) ? pricing.sections : null;
  if (sectionValues) {
    return sectionValues
      .map((section) => asObjectValue(section))
      .filter((section): section is Record<string, unknown> => Boolean(section))
      .map((section) => {
        const entries = asObjectValue(section.entries);
        if (!entries) {
          return null;
        }
        return {
          header: typeof section.header === "string" ? section.header : "Pricing",
          unit: typeof section.unit === "string" ? section.unit : typeof section.unitKey === "string" ? section.unitKey : "",
          default: section.default === true,
          entries: Object.entries(entries).map(([key, value]) => ({
            label: humanizeModelKey(key),
            value: formatPrimitiveValue(value),
          })),
        } satisfies ModelPricingSection;
      })
      .filter((section): section is ModelPricingSection => Boolean(section));
  }

  const unit = typeof pricing.unit === "string" ? pricing.unit : "";
  const entries = Object.entries(pricing)
    .filter(([key]) => key !== "unit" && key !== "notes")
    .map(([key, value]) => ({
      label: humanizeModelKey(key),
      value: formatPrimitiveValue(value),
    }));

  return entries.length > 0 ? [{ header: "Pricing", unit, entries, default: true }] : [];
}

function parseDisplayPrice(section: ModelPricingSection): number | null {
  for (const entry of section.entries) {
    const normalized = entry.label.toLowerCase();
    if (!["cost", "generation", "image", "second", "minute", "request", "call"].includes(normalized)) {
      continue;
    }
    const numeric = Number.parseFloat(entry.value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function normalizePricingSections(sections: ModelPricingSection[]): ModelPricingSection[] {
  if (sections.length <= 1) {
    return sections.map((section) => ({ ...section, default: true }));
  }

  const normalized = sections.map((section) => ({ ...section }));
  const groups = new Map<string, ModelPricingSection[]>();

  for (const section of normalized) {
    const key = `${section.header}\u0000${section.unit}`;
    const group = groups.get(key) || [];
    group.push(section);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      group[0].default = true;
      continue;
    }

    const explicitDefaults = group.filter((section) => section.default);
    if (explicitDefaults.length === 1) {
      continue;
    }

    const ranked = group
      .map((section, index) => {
        const price = parseDisplayPrice(section);
        return price === null ? null : { section, index, price };
      })
      .filter((entry): entry is { section: ModelPricingSection; index: number; price: number } => Boolean(entry))
      .sort((left, right) => left.price - right.price || left.index - right.index);

    if (ranked.length === 0) {
      group[0].default = true;
      for (const section of group.slice(1)) {
        section.default = false;
      }
      continue;
    }

    ranked[0].section.default = true;
    for (const section of group) {
      if (section !== ranked[0].section) {
        section.default = false;
      }
    }
  }

  return normalized;
}

export function getDefaultModelPricingSections(model: CatalogModel): ModelPricingSection[] {
  return normalizePricingSections(getModelPricingSections(model)).filter((section) => section.default);
}

export function getOptionalModelPricingSections(model: CatalogModel): ModelPricingSection[] {
  return normalizePricingSections(getModelPricingSections(model)).filter((section) => !section.default);
}

export function formatModelPricing(model: CatalogModel): string {
  const sections = getDefaultModelPricingSections(model);
  if (sections.length === 0) {
    return "null";
  }
  return sections
    .map((section) => {
      const details = section.entries.map((entry) => `${entry.label}: ${entry.value}`).join(", ");
      return section.unit ? `${section.header} (${section.unit}): ${details}` : `${section.header}: ${details}`;
    })
    .join(" • ");
}
