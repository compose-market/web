/**
 * useModels - Central React Query hook for model fetching
 *
 * Single source of truth for selector/search model data. Fetches the compact,
 * versioned Models Worker index; selected full cards and params use the API.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";
import {
    buildTypeCategories,
    getModelTypeValues,
    normalizeModelSearchText,
    rankCatalogModels,
    type CatalogModel,
    type ModelCategory,
    type SemanticModelHit,
} from "@/lib/models";
import { sdk } from "@/lib/sdk";
import { durableQueryMeta, DURABLE_CACHE_MAX_AGE } from "@/lib/queryClient";
import { fetchModelCatalogHealth, fetchModelCatalogIndex, modelsOrigin } from "@/lib/models";

// =============================================================================
// Types
// =============================================================================

export interface UseModelsOptions {
    type?: string;
    family?: string;
    search?: string;
    enabled?: boolean;
}

export interface UseModelsReturn {
    models: CatalogModel[];
    frontiers: FrontierModelRef[];
    filteredModels: CatalogModel[];
    isLoading: boolean;
    isRefetching: boolean;
    error: Error | null;
    /** Refresh failed while cached catalog data renders; null whenever `error` is set. */
    refreshError: Error | null;
    forceRefresh: () => Promise<void>;
    lastUpdated: Date | null;
    typeCategories: ModelCategory[];
}

export interface FrontierModelRef {
    modelId: string;
    provider: string;
    family?: string;
    isFrontier: boolean;
    isLatest: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const STALE_TIME = 6 * 60 * 60 * 1000; // 6 hours
const MODELS_URL = (import.meta.env.VITE_MODELS_URL ?? "https://models.compose.market").replace(/\/+$/u, "");
const MODELS_ORIGIN = modelsOrigin(MODELS_URL);
const CATALOG_CACHE_PREFIX = ["models-catalog", MODELS_ORIGIN];
const CATALOG_VERSION_KEY = ["models-health", MODELS_ORIGIN];

// =============================================================================
// Hook
// =============================================================================

function latestCachedCatalog(queryClient: ReturnType<typeof useQueryClient>): CatalogModel[] {
    const current = queryClient.getQueryCache()
        .findAll({ queryKey: CATALOG_CACHE_PREFIX })
        .filter((query) => Array.isArray(query.state.data))
        .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)[0]
        ?.state.data;
    if (Array.isArray(current) && current.length > 0) return current as CatalogModel[];
    return [];
}

export function useModels(options: UseModelsOptions = {}): UseModelsReturn {
    const { type, family, search, enabled = true } = options;
    const queryClient = useQueryClient();
    const healthQuery = useQuery({
        queryKey: CATALOG_VERSION_KEY,
        queryFn: () => fetchModelCatalogHealth(MODELS_ORIGIN),
        // Background /health poll: a worker catalog update swaps the catalog
        // in within one interval, non-blocking, while the old one renders.
        staleTime: 5_000,
        gcTime: DURABLE_CACHE_MAX_AGE,
        refetchInterval: 5_000,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        enabled,
        retry: 2,
    });
    const version = healthQuery.data?.version ?? null;
    const cachedModels = latestCachedCatalog(queryClient);

    const {
        data: loadedModels,
        isLoading: isCatalogLoading,
        isFetching,
        error: catalogError,
        dataUpdatedAt,
    } = useQuery<CatalogModel[], Error>({
        queryKey: [...CATALOG_CACHE_PREFIX, version],
        queryFn: () => fetchModelCatalogIndex(MODELS_ORIGIN, version!),
        staleTime: Infinity,
        gcTime: DURABLE_CACHE_MAX_AGE,
        placeholderData: cachedModels,
        refetchOnMount: false,
        enabled: enabled && Boolean(version),
        meta: durableQueryMeta,
    });
    const models = loadedModels ?? cachedModels;
    const error = models.length === 0 ? (catalogError ?? healthQuery.error ?? null) : null;
    // A refresh failure while cached catalog data renders is surfaced
    // separately so a stale catalog can never silently masquerade as live.
    const refreshError = models.length > 0 ? (catalogError ?? healthQuery.error ?? null) : null;
    const isLoading = enabled && models.length === 0 && (healthQuery.isLoading || isCatalogLoading);
    const frontiers = useMemo(() => models.flatMap((model): FrontierModelRef[] =>
        model.isFrontier === true || model.isLatest === true
            ? [{
                modelId: model.modelId,
                provider: model.provider,
                ...(model.family ? { family: model.family } : {}),
                isFrontier: model.isFrontier === true,
                isLatest: model.isLatest === true,
            }]
            : []
    ), [models]);

    // Filter models based on options
    const filteredModels = useMemo(() => {
        let result = models;

        if (type && type !== "all") {
            result = result.filter((model) => getModelTypeValues(model).includes(type));
        }

        if (family && family !== "all") {
            result = result.filter((model) => (model.family || model.provider) === family);
        }

        if (search?.trim()) {
            result = rankCatalogModels(result, search, result.length).map((entry) => entry.model);
        }

        return result;
    }, [models, type, family, search]);

    const typeCategories = useMemo(() => buildTypeCategories(models), [models]);

    // Manual refresh - named distinctly to avoid collision with query.refetch
    const forceRefresh = useCallback(async () => {
        queryClient.removeQueries({ queryKey: ["model-card"], type: "inactive" });
        const health = await fetchModelCatalogHealth(MODELS_ORIGIN);
        queryClient.setQueryData(CATALOG_VERSION_KEY, health);
        await Promise.all([
            queryClient.fetchQuery({
                queryKey: [...CATALOG_CACHE_PREFIX, health.version],
                queryFn: () => fetchModelCatalogIndex(MODELS_ORIGIN, health.version),
                staleTime: Infinity,
            }),
            queryClient.refetchQueries({ queryKey: ["model-card"], type: "active" }),
        ]);
    }, [queryClient]);

    const lastUpdated = healthQuery.data?.lastUpdated
        ? new Date(healthQuery.data.lastUpdated)
        : dataUpdatedAt ? new Date(dataUpdatedAt) : null;

    return {
        models,
        frontiers,
        filteredModels,
        isLoading,
        isRefetching: isFetching && !isLoading,
        error: error || null,
        refreshError,
        forceRefresh,
        lastUpdated,
        typeCategories,
    };
}

export interface UseModelResourceReturn<T> {
    data: T | null;
    isLoading: boolean;
    error: Error | null;
}

async function fetchModelResource<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await sdk.fetch(path, {
        method: "GET",
        signal,
        key: null,
        paymentMode: "key",
    });
    if (!response.ok) throw new Error(`Model resource request failed: ${response.status}`);
    return await response.json() as T;
}

export function useModelDetails(modelId: string | null): UseModelResourceReturn<CatalogModel> {
    const result = useQuery<CatalogModel, Error>({
        queryKey: ["model-card", modelId],
        queryFn: ({ signal }) => fetchModelResource<CatalogModel>(
            `/v1/models/${encodeURIComponent(modelId!)}`,
            signal,
        ),
        enabled: Boolean(modelId),
        staleTime: 5 * 60 * 1000,
        gcTime: DURABLE_CACHE_MAX_AGE,
    });
    return { data: result.data ?? null, isLoading: result.isLoading, error: result.error ?? null };
}

export function useModelParams<T>(modelId: string | null): UseModelResourceReturn<T> {
    const result = useQuery<T, Error>({
        queryKey: ["model-params", modelId],
        queryFn: ({ signal }) => fetchModelResource<T>(
            `/v1/models/${encodeURIComponent(modelId!)}/params`,
            signal,
        ),
        enabled: Boolean(modelId),
        staleTime: STALE_TIME,
        gcTime: DURABLE_CACHE_MAX_AGE,
        meta: durableQueryMeta,
    });
    return { data: result.data ?? null, isLoading: result.isLoading, error: result.error ?? null };
}

export interface UseSemanticModelSearchOptions {
    enabled?: boolean;
    limit?: number;
}

export interface UseSemanticModelSearchReturn {
    hits: SemanticModelHit[];
    isLoading: boolean;
    error: Error | null;
}

/**
 * Semantic ranking hints from models.compose.market. These are never selected
 * directly; CommandBar resolves every hit back to the canonical loaded catalog.
 */
export function useSemanticModelSearch(
    query: string,
    options: UseSemanticModelSearchOptions = {},
): UseSemanticModelSearchReturn {
    const normalized = normalizeModelSearchText(query);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const enabled = (options.enabled ?? true) && normalized.replace(/\s+/gu, "").length >= 3;

    const result = useQuery<SemanticModelHit[], Error>({
        queryKey: ["models-semantic-search", normalized, limit],
        queryFn: async ({ signal }) => {
            const target = new URL(`${MODELS_ORIGIN}/search`);
            target.searchParams.set("q", query.trim());
            target.searchParams.set("limit", String(limit));
            target.searchParams.set("compact", "1");
            const response = await fetch(target, {
                method: "GET",
                headers: { Accept: "application/json" },
                signal,
            });
            if (!response.ok) {
                throw new Error(`Semantic model search failed: ${response.status}`);
            }
            const body = await response.json() as { data?: unknown };
            if (!Array.isArray(body.data)) return [];
            return body.data.flatMap((item): SemanticModelHit[] => {
                if (!item || typeof item !== "object") return [];
                const row = item as Record<string, unknown>;
                if (typeof row.modelId !== "string" || typeof row.provider !== "string") return [];
                return [{
                    ...(typeof row.key === "string" ? { key: row.key } : {}),
                    modelId: row.modelId,
                    provider: row.provider,
                    ...(typeof row.family === "string" ? { family: row.family } : {}),
                    ...(typeof row.name === "string" || row.name === null ? { name: row.name as string | null } : {}),
                    score: typeof row.score === "number" ? row.score : 0,
                }];
            });
        },
        enabled,
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
    });

    return {
        hits: result.data ?? [],
        isLoading: result.isFetching,
        error: result.error ?? null,
    };
}

// =============================================================================
// Convenience Hooks
// =============================================================================

export function useModel(modelId: string | null): CatalogModel | null {
    const { models } = useModels({ enabled: !!modelId });
    return useMemo(() => {
        if (!modelId) return null;
        return models.find((model) => model.modelId === modelId) || null;
    }, [models, modelId]);
}

export function useModelsByType(type: string): CatalogModel[] {
    const { filteredModels } = useModels({ type });
    return filteredModels;
}

export function useModelsByFamily(family: string): CatalogModel[] {
    const { filteredModels } = useModels({ family });
    return filteredModels;
}
