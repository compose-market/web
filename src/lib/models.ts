const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

export type ModelJsonValue =
  | string
  | number
  | boolean
  | null
  | ModelJsonValue[]
  | { [key: string]: ModelJsonValue };

export interface CatalogModel {
  name: string | null;
  modelId: string;
  description: string | null;
  type: string | string[] | null;
  provider: string;
  input: ModelJsonValue;
  output: ModelJsonValue;
  contextWindow: ModelJsonValue;
  pricing: ModelJsonValue;
}

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

interface ModelsResponse {
  object: "list";
  data: CatalogModel[];
}

export const MODEL_SELECTION_STORAGE_KEY = "selectedCatalogModel";

export async function fetchAvailableModels(): Promise<CatalogModel[]> {
  const response = await fetch(`${API_BASE}/v1/models`);
  if (!response.ok) {
    throw new Error(`Failed to fetch /v1/models: ${response.status}`);
  }

  const data = await response.json() as ModelsResponse;
  if (!Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("No models returned from /v1/models");
  }

  return data.data;
}

export async function fetchModelById(modelId: string): Promise<CatalogModel> {
  const response = await fetch(`${API_BASE}/v1/models/${encodeURIComponent(modelId)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch /v1/models/${modelId}: ${response.status}`);
  }

  return await response.json() as CatalogModel;
}

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

export function matchesModelType(model: CatalogModel, expectedType: string): boolean {
  return getModelTypeValues(model).includes(expectedType);
}

export function getModelContextInputTokens(model: CatalogModel): number | null {
  if (typeof model.contextWindow === "number" && Number.isInteger(model.contextWindow) && model.contextWindow > 0) {
    return model.contextWindow;
  }

  if (!model.contextWindow || typeof model.contextWindow !== "object" || Array.isArray(model.contextWindow)) {
    return null;
  }

  const inputTokens = (model.contextWindow as { inputTokens?: unknown }).inputTokens;
  if (typeof inputTokens === "number" && Number.isInteger(inputTokens) && inputTokens > 0) {
    return inputTokens;
  }

  return null;
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
    pricing: model.pricing,
    contextWindow: model.contextWindow,
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

function formatPrimitiveValue(value: ModelJsonValue): string {
  if (value === null) {
    return "null";
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
  return JSON.stringify(value);
}

function asObjectValue(value: ModelJsonValue): Record<string, ModelJsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, ModelJsonValue>
    : null;
}

export function getModelValueList(value: ModelJsonValue): string[] {
  if (value === null) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [formatPrimitiveValue(value)];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatPrimitiveValue(entry));
  }

  return Object.entries(value).map(([key, entry]) => `${humanizeModelKey(key)}: ${formatPrimitiveValue(entry)}`);
}

export function formatModelValue(value: ModelJsonValue): string {
  const values = getModelValueList(value);
  if (values.length === 0) {
    return "null";
  }
  return values.join(" • ");
}

export function getModelContextWindowEntries(model: CatalogModel): ModelDisplayField[] {
  if (typeof model.contextWindow === "number") {
    return [{ label: "Input tokens", value: model.contextWindow.toLocaleString() }];
  }
  if (model.contextWindow === null) {
    return [];
  }

  const contextWindow = asObjectValue(model.contextWindow);
  if (!contextWindow) {
    return [];
  }

  return Object.entries(contextWindow).map(([key, value]) => ({
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
      .filter((section): section is Record<string, ModelJsonValue> => Boolean(section))
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

export function getApiKeyEnvName(provider: string): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "fireworks":
      return "FIREWORKS_API_KEY";
    case "gemini":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "hugging face":
      return "HUGGING_FACE_INFERENCE_TOKEN";
    case "cloudflare":
      return "CF_API_TOKEN";
    case "aiml":
      return "AI_ML_API_KEY";
    case "asicloud":
      return "ASI_INFERENCE_API_KEY";
    case "vertex":
      return "VERTEX_AI_API_KEY";
  }
  throw new Error(`Unsupported provider: ${provider}`);
}
