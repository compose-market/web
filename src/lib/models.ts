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
import { typeClass } from "@compose-market/theme/icons/react";

export type CatalogModel = Model & {
  operations?: unknown[];
  params?: Record<string, unknown>;
  family?: string;
  requiresImageInput?: boolean;
  isFrontier?: boolean;
  isLatest?: boolean;
};

export interface ModelCatalogHealth {
  models: number;
  version: string;
  lastUpdated: string | null;
}

export interface ModelCatalogIndex {
  data: CatalogModel[];
  total: number;
  version: string;
  lastUpdated: string | null;
}

export function modelsOrigin(value: string): string {
  return new URL(value).origin;
}

export async function fetchModelCatalogHealth(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelCatalogHealth> {
  const response = await fetcher(`${origin}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Failed to load model catalog version: ${response.status}`);
  const body = await response.json() as Partial<ModelCatalogHealth>;
  if (typeof body.version !== "string" || !body.version || typeof body.models !== "number") {
    throw new Error("Invalid model catalog health response");
  }
  return {
    models: body.models,
    version: body.version,
    lastUpdated: typeof body.lastUpdated === "string" ? body.lastUpdated : null,
  };
}

export async function fetchModelCatalogIndex(
  origin: string,
  version: string,
  fetcher: typeof fetch = fetch,
): Promise<CatalogModel[]> {
  const target = new URL(`${origin}/index`);
  target.searchParams.set("version", version);
  const response = await fetcher(target, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "force-cache",
  });
  if (!response.ok) throw new Error(`Failed to load model catalog index: ${response.status}`);
  const body = await response.json() as Partial<ModelCatalogIndex>;
  if (body.version !== version || !Array.isArray(body.data) || body.data.length === 0) {
    throw new Error("Invalid model catalog index response");
  }
  if (body.total !== body.data.length) {
    throw new Error(`Incomplete model catalog index: expected ${body.total}, received ${body.data.length}`);
  }
  return body.data;
}

export const IMAGE_ATTACHMENT_REQUIRED_MESSAGE = "Upload an image to use this model.";

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value.trim().toLowerCase()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().toLowerCase()] : []);
}

function producesImage(operation: string): boolean {
  return operation.endsWith("to-image")
    || operation === "image-generation"
    || operation === "image-edit"
    || operation === "inpainting"
    || operation === "outpainting";
}

function requiresImage(operation: string): boolean {
  return operation.startsWith("image-to-")
    || operation === "image-edit"
    || operation === "inpainting"
    || operation === "outpainting";
}

function imageOperation(value: unknown): { operation: string; input: string[]; output: string[] } | null {
  if (typeof value === "string") {
    const operation = value.trim().toLowerCase();
    return operation && producesImage(operation)
      ? { operation, input: requiresImage(operation) ? ["image"] : ["text"], output: ["image"] }
      : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const operation = typeof record.operation === "string" ? record.operation.trim().toLowerCase() : "";
  const input = stringValues(record.input);
  const output = stringValues(record.output);
  return output.includes("image") || producesImage(operation) ? { operation, input, output } : null;
}

/** True when catalog I/O and operations expose no image-producing path without an image input. */
export function modelRequiresImageAttachment(model: Pick<CatalogModel, "input" | "operations" | "params" | "capabilities" | "requiresImageInput">): boolean {
  if (model.requiresImageInput === true) return true;
  if (model.capabilities && typeof model.capabilities === "object") {
    const capabilities = model.capabilities as Record<string, unknown>;
    if (capabilities.requires_image_input === true || capabilities.requiresImageInput === true) return true;
  }

  const requiredImageParam = Object.entries(model.params || {}).some(([key, value]) => {
    if (!value || typeof value !== "object") return false;
    const definition = value as Record<string, unknown>;
    const imageField = definition.is_image === true || /(?:^|_)(?:image|images)(?:_|$)/i.test(key);
    return imageField && definition.required === true && definition.minItems !== 0;
  });
  if (requiredImageParam) return true;

  const imageOperations = Array.isArray(model.operations)
    ? model.operations.map(imageOperation).filter((operation): operation is NonNullable<typeof operation> => operation !== null)
    : [];
  return stringValues(model.input).includes("image")
    && imageOperations.length > 0
    && imageOperations.every((operation) => operation.input.includes("image"));
}

export function submissionHasImageAttachment(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(submissionHasImageAttachment);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  if (type === "input_image" && typeof record.image_url === "string" && record.image_url.length > 0) return true;
  if (type === "image" && typeof record.url === "string" && record.url.length > 0) return true;
  return Object.values(record).some(submissionHasImageAttachment);
}

export const FAMILY_LOGOS: Record<string, string> = {
  acestep: "acestep.webp",
  alibaba: "alibabacloud-color.svg",
  asicloud: "asicloud.webp",
  anthropic: "anthropic.png",
  baai: "baai.svg",
  bria: "bria.webp",
  blackforestlabs: "black-forest-labs.svg",
  bytedance: "bytedance.png",
  cartesia: "cartesia.avif",
  clarityai: "clarityai.png",
  cohere: "cohere-color.svg",
  daily: "daily.svg",
  deepgram: "deepgram.png",
  deepseek: "deepseek-color.svg",
  elevenlabs: "elevenlabs.svg",
  google: "gemini-color.svg",
  huggingface: "huggingface-color.png",
  ibm: "ibm.svg",
  inworld: "inworld.avif",
  leonardo: "leonardo.png",
  lykon: "lykon.jpg",
  meta: "meta-color.svg",
  microsoft: "microsoft.webp",
  minimax: "minimax-color.svg",
  mistral: "mistral-color.svg",
  moonshot: "moonshot-color.svg",
  nousresearch: "nousresearch.png",
  nvidia: "nvidia-color.svg",
  openai: "openai.png",
  pixverse: "pixverse.png",
  prunaai: "prunaai.png",
  resemble: "resemble.png",
  roboflow: "roboflow.png",
  stabilityai: "stability-color.svg",
  tencent: "tencent.png",
  thinkingmachines: "thinkingmachines.png",
  xai: "xai-grok.svg",
  zai: "zai.svg",
};

export function getFamilyLogoUrl(family: string): string | null {
  const file = FAMILY_LOGOS[family.toLowerCase()];
  return file ? `/families/${file}` : null;
}

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
  family: string;
  pricing: ModelJsonValue;
  contextWindow: ModelJsonValue;
}

export interface RankedCatalogModel {
  model: CatalogModel;
  score: number;
  source: "local" | "semantic" | "hybrid";
}

export interface SemanticModelHit {
  key?: string;
  modelId: string;
  provider: string;
  family?: string;
  name?: string | null;
  score: number;
}

interface SearchProfile {
  folded: string;
  joined: string;
  words: string;
  compact: string;
  tokens: string[];
}

function searchProfile(value: string): SearchProfile {
  const folded = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, " ");
  const joined = folded.replace(/\s+/gu, "");
  const words = folded
    .replace(/([a-z])([0-9])/gu, "$1 $2")
    .replace(/([0-9])([a-z])/gu, "$1 $2")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  return {
    folded,
    joined,
    words,
    compact: words.replace(/\s+/gu, ""),
    tokens: words ? words.split(" ") : [],
  };
}

/**
 * Public normalization used by tests and remote-query cache keys.
 * Separators and letter/number boundaries become spaces:
 * `Qwen3.8-Max` -> `qwen 3 8 max`.
 */
export function normalizeModelSearchText(value: string): string {
  return searchProfile(value).words;
}

function damerauLevenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0]![column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      );
      if (
        row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        matrix[row]![column] = Math.min(
          matrix[row]![column]!,
          matrix[row - 2]![column - 2]! + cost,
        );
      }
    }
  }
  return matrix[left.length]![right.length]!;
}

function fuzzyDistance(query: string, candidate: string): number | null {
  if (query.length < 3 || !candidate) return null;
  const comparable = candidate.slice(0, Math.min(candidate.length, query.length));
  const distance = damerauLevenshtein(query, comparable);
  const allowed = query.length <= 4 ? 1 : query.length <= 8 ? 2 : Math.min(3, Math.floor(query.length * 0.25));
  return distance <= allowed ? distance : null;
}

function scoreProfile(query: SearchProfile, candidate: SearchProfile, weight: number, fuzzy: boolean): number {
  if (!query.compact || !candidate.compact) return 0;

  if (candidate.folded === query.folded) return 1_200 * weight;
  if (candidate.joined === query.joined) return 1_175 * weight;
  if (candidate.compact === query.compact) return 1_150 * weight;

  if (candidate.folded.startsWith(query.folded)) return (1_075 - Math.min(60, candidate.folded.length - query.folded.length)) * weight;
  if (candidate.joined.startsWith(query.joined)) return (1_050 - Math.min(60, candidate.joined.length - query.joined.length)) * weight;
  if (candidate.compact.startsWith(query.compact)) return (1_025 - Math.min(60, candidate.compact.length - query.compact.length)) * weight;

  // One-character queries may match exact prefixes (for example xAI), but
  // must not match arbitrary letters buried in every name or description.
  if (query.compact.length < 2) return 0;

  const joinedIndex = candidate.joined.indexOf(query.joined);
  if (joinedIndex >= 0) return (900 - Math.min(100, joinedIndex * 4)) * weight;
  const compactIndex = candidate.compact.indexOf(query.compact);
  if (compactIndex >= 0) return (875 - Math.min(100, compactIndex * 4)) * weight;

  if (query.tokens.length > 0) {
    const matched = query.tokens.filter((token) => (
      candidate.tokens.some((candidateToken) => candidateToken === token || candidateToken.startsWith(token))
    )).length;
    if (matched === query.tokens.length) return (780 + matched * 8) * weight;
    if (query.tokens.length > 1 && matched / query.tokens.length >= 0.75) return (650 + matched * 8) * weight;
  }

  if (fuzzy) {
    const compactDistance = fuzzyDistance(query.compact, candidate.compact);
    if (compactDistance !== null) return (690 - compactDistance * 70) * weight;

    if (query.tokens.length > 0) {
      let totalDistance = 0;
      for (const token of query.tokens) {
        const best = candidate.tokens.reduce<number | null>((current, candidateToken) => {
          const distance = fuzzyDistance(token, candidateToken);
          if (distance === null) return current;
          return current === null ? distance : Math.min(current, distance);
        }, null);
        if (best === null) return 0;
        totalDistance += best;
      }
      return (640 - totalDistance * 55) * weight;
    }
  }

  return 0;
}

function decimalVersionBonus(query: SearchProfile, candidate: SearchProfile): number {
  const versions = query.folded.match(/\d+(?:\.\d+)+/gu) ?? [];
  return versions.some((version) => candidate.folded.includes(version)) ? 90 : 0;
}

function modelSearchScore(model: CatalogModel, query: SearchProfile): number {
  const modelId = searchProfile(model.modelId);
  const name = searchProfile(model.name || "");
  const nameScore = Math.max(
    scoreProfile(query, modelId, 1, true) + decimalVersionBonus(query, modelId),
    scoreProfile(query, name, 0.98, true) + decimalVersionBonus(query, name),
  );
  const familyScore = Math.max(
    scoreProfile(query, searchProfile(model.family || ""), 0.72, true),
    scoreProfile(query, searchProfile(model.provider), 0.7, true),
  );
  const typeScore = scoreProfile(query, searchProfile(getModelTypeValues(model).join(" ")), 0.62, false);
  const descriptionScore = scoreProfile(query, searchProfile(model.description || ""), 0.48, false);
  return Math.max(nameScore, familyScore, typeScore, descriptionScore);
}

/** Rank a catalog locally. This is intentionally deterministic and fast for 650+ rows. */
export function rankCatalogModels(models: CatalogModel[], query: string, limit = 50): RankedCatalogModel[] {
  const profile = searchProfile(query);
  if (!profile.compact) {
    return models.slice(0, limit).map((model, index) => ({ model, score: models.length - index, source: "local" }));
  }

  return models
    .map((model, index) => ({ model, index, score: modelSearchScore(model, profile) }))
    .filter((entry) => entry.score >= 260)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ model, score }) => ({ model, score, source: "local" as const }));
}

function modelIdentity(provider: string, modelId: string): string {
  return `${provider.toLowerCase()}:${modelId.toLowerCase()}`;
}

/**
 * Merge semantic ranks into local ranks without ever selecting Worker-owned
 * model objects. Every semantic hit is resolved back to the canonical catalog.
 */
export function mergeSemanticModelRanks(
  catalog: CatalogModel[],
  local: RankedCatalogModel[],
  semantic: SemanticModelHit[],
  limit = 50,
): RankedCatalogModel[] {
  const byIdentity = new Map(catalog.map((model) => [modelIdentity(model.provider, model.modelId), model]));
  const byModelId = new Map<string, CatalogModel[]>();
  for (const model of catalog) {
    const id = model.modelId.toLowerCase();
    byModelId.set(id, [...(byModelId.get(id) || []), model]);
  }

  const ranked = new Map<string, RankedCatalogModel>();
  for (const item of local) {
    ranked.set(modelIdentity(item.model.provider, item.model.modelId), item);
  }

  for (const hit of semantic) {
    const identity = modelIdentity(hit.provider, hit.modelId);
    const exact = byIdentity.get(identity);
    const fallback = byModelId.get(hit.modelId.toLowerCase());
    const model = exact ?? (fallback?.length === 1 ? fallback[0] : undefined);
    if (!model) continue;

    const semanticScore = 600 + Math.max(0, Math.min(1, hit.score)) * 260;
    const existing = ranked.get(modelIdentity(model.provider, model.modelId));
    ranked.set(modelIdentity(model.provider, model.modelId), {
      model,
      score: existing ? Math.max(existing.score, semanticScore) + 35 : semanticScore,
      source: existing ? "hybrid" : "semantic",
    });
  }

  return [...ranked.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
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
  return type
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getModelTypeClass(type: string): string {
  const direct = typeClass(getModelTypeVisualId(type));
  if (direct) return direct;
  const id = type.trim().toLowerCase();
  if (id === "all") return "";
  return "cm-type--classification";
}

export function getModelTypeVisualId(type: string): string {
  const id = type.trim().toLowerCase();
  if (id.includes("music")) return "audio";
  if (id.includes("realtime")) return "conversational";
  if (id.includes("ocr") || id.includes("detection") || id.includes("segmentation")) return "image";
  if (id.includes("rerank")) return "embedding";
  if (id.includes("pipe")) return "text";
  return type;
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

export function buildFamilyCategories(models: CatalogModel[]): ModelCategory[] {
  const counts = new Map<string, number>();

  for (const model of models) {
    const family = model.family || model.provider;
    counts.set(family, (counts.get(family) || 0) + 1);
  }

  return [
    { id: "all", label: "All Families", count: models.length },
    ...Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: id, count })),
  ];
}

export function toSelectedCatalogModel(model: CatalogModel): SelectedCatalogModel {
  return {
    modelId: model.modelId,
    name: model.name,
    provider: model.provider,
    family: model.family || model.provider,
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

export function shorten(val: number): string {
  if (val >= 1_000_000) {
    return `${Math.round(val / 1_000_000)}M`;
  }
  if (val >= 1_000) {
    return `${Math.round(val / 1_000)}k`;
  }
  return String(val);
}

export function getModelContextWindowEntries(model: CatalogModel): ModelDisplayField[] {
  const contextWindow = model.contextWindow;
  if (typeof contextWindow === "number") {
    return [{ label: "Input tokens", value: shorten(contextWindow) }];
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
    value: typeof value === "number" ? shorten(value) : formatPrimitiveValue(value),
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
