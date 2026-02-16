/**
 * useModels - Central React Query hook for model fetching
 * 
 * Single source of truth for all model data in the frontend.
 * Fetches from /v1/models (canonical) with registry fallback and 6-hour cache.
 * ALL DATA FETCHED DYNAMICALLY - NO HARDCODING.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";
import { fetchAvailableModels, type AIModel } from "@/lib/models";

// =============================================================================
// Types
// =============================================================================

export interface UseModelsOptions {
    task?: string;
    source?: string;
    search?: string;
    enabled?: boolean;
}

export interface TaskCategory {
    id: string;
    label: string;
    count: number;
}

export interface UseModelsReturn {
    models: AIModel[];
    filteredModels: AIModel[];
    isLoading: boolean;
    isRefetching: boolean;
    error: Error | null;
    forceRefresh: () => Promise<void>;
    lastUpdated: Date | null;
    taskCategories: TaskCategory[];
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
    const { task, source, search, enabled = true } = options;
    const queryClient = useQueryClient();

    const {
        data: models = [],
        isLoading,
        isFetching,
        error,
        dataUpdatedAt,
    } = useQuery<AIModel[], Error>({
        queryKey: CACHE_KEY,
        queryFn: fetchAvailableModels,
        staleTime: STALE_TIME,
        gcTime: STALE_TIME * 2, // Keep cached 12 hours
        enabled,
    });

    // Filter models based on options
    const filteredModels = useMemo(() => {
        let result = models;

        if (task && task !== "all") {
            result = result.filter((m) => m.task === task);
        }

        if (source && source !== "all") {
            result = result.filter((m) => m.source === source);
        }

        if (search?.trim()) {
            const query = search.toLowerCase().trim();
            result = result.filter(
                (m) =>
                    m.id.toLowerCase().includes(query) ||
                    m.name.toLowerCase().includes(query) ||
                    m.ownedBy?.toLowerCase().includes(query)
            );
        }

        return result;
    }, [models, task, source, search]);

    // Compute task categories dynamically from model data - NO HARDCODING
    const taskCategories = useMemo(() => {
        const counts = new Map<string, number>();

        for (const model of models) {
            const taskType = model.task || "text-generation";
            counts.set(taskType, (counts.get(taskType) || 0) + 1);
        }

        const categories: TaskCategory[] = [];

        categories.push({
            id: "all",
            label: "All Models",
            count: models.length,
        });

        // Sort by count and use task value directly as label (formatted)
        const sortedTasks = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        for (const [taskId, count] of sortedTasks) {
            categories.push({
                id: taskId,
                label: taskId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
                count,
            });
        }

        return categories;
    }, [models]);

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
        taskCategories,
    };
}

// =============================================================================
// Convenience Hooks
// =============================================================================

export function useModel(modelId: string | null): AIModel | null {
    const { models } = useModels({ enabled: !!modelId });
    return useMemo(() => {
        if (!modelId) return null;
        return models.find((m) => m.id === modelId) || null;
    }, [models, modelId]);
}

export function useModelsByTask(task: string): AIModel[] {
    const { filteredModels } = useModels({ task });
    return filteredModels;
}

export function useModelsBySource(source: string): AIModel[] {
    const { filteredModels } = useModels({ source });
    return filteredModels;
}
