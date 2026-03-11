/**
 * useModels - Central React Query hook for model fetching
 * 
 * Single source of truth for all model data in the frontend.
 * Fetches from /v1/models (canonical) with registry fallback and 6-hour cache.
 * ALL DATA FETCHED DYNAMICALLY - NO HARDCODING.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";
import {
    buildTypeCategories,
    fetchAvailableModels,
    getModelTypeValues,
    type CatalogModel,
    type ModelCategory,
} from "@/lib/models";

// =============================================================================
// Types
// =============================================================================

export interface UseModelsOptions {
    type?: string;
    provider?: string;
    search?: string;
    enabled?: boolean;
}

export interface UseModelsReturn {
    models: CatalogModel[];
    filteredModels: CatalogModel[];
    isLoading: boolean;
    isRefetching: boolean;
    error: Error | null;
    forceRefresh: () => Promise<void>;
    lastUpdated: Date | null;
    typeCategories: ModelCategory[];
}

// =============================================================================
// Constants
// =============================================================================

const STALE_TIME = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_KEY = ["models-catalog"];

// =============================================================================
// Hook
// =============================================================================

export function useModels(options: UseModelsOptions = {}): UseModelsReturn {
    const { type, provider, search, enabled = true } = options;
    const queryClient = useQueryClient();

    const {
        data: models = [],
        isLoading,
        isFetching,
        error,
        dataUpdatedAt,
    } = useQuery<CatalogModel[], Error>({
        queryKey: CACHE_KEY,
        queryFn: fetchAvailableModels,
        staleTime: STALE_TIME,
        gcTime: STALE_TIME * 2, // Keep cached 12 hours
        enabled,
    });

    // Filter models based on options
    const filteredModels = useMemo(() => {
        let result = models;

        if (type && type !== "all") {
            result = result.filter((model) => getModelTypeValues(model).includes(type));
        }

        if (provider && provider !== "all") {
            result = result.filter((model) => model.provider === provider);
        }

        if (search?.trim()) {
            const query = search.toLowerCase().trim();
            result = result.filter(
                (model) =>
                    model.modelId.toLowerCase().includes(query) ||
                    (model.name || "").toLowerCase().includes(query) ||
                    model.provider.toLowerCase().includes(query)
            );
        }

        return result;
    }, [models, type, provider, search]);

    const typeCategories = useMemo(() => buildTypeCategories(models), [models]);

    // Manual refresh - named distinctly to avoid collision with query.refetch
    const forceRefresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: CACHE_KEY });
    }, [queryClient]);

    const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

    return {
        models,
        filteredModels,
        isLoading,
        isRefetching: isFetching && !isLoading,
        error: error || null,
        forceRefresh,
        lastUpdated,
        typeCategories,
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

export function useModelsByProvider(provider: string): CatalogModel[] {
    const { filteredModels } = useModels({ provider });
    return filteredModels;
}
