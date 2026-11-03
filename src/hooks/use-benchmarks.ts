/**
 * One sparse, durable benchmark index joined to canonical Compose model IDs.
 * Detail and comparison views derive from this cache instead of refetching
 * duplicated model payloads.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { compareModelBenchmarks } from "@/lib/benchmarks";
import { readBenchmarksSnapshot, writeBenchmarksSnapshot } from "@/lib/cache";
import { DURABLE_CACHE_MAX_AGE, durableQueryMeta } from "@/lib/queryClient";
import { API_BASE_URL, sdk } from "@/lib/sdk";
import type {
    BenchmarkOperation,
    BenchmarksApiResponse,
    ModelBenchmark,
    ModelComparisonResult,
} from "@/types/benchmarks";

export interface UseBenchmarksOptions {
    frontierOnly?: boolean;
    search?: string;
    family?: string;
    creator?: string;
    operation?: BenchmarkOperation | "all";
    enabled?: boolean;
}

export interface UseBenchmarksReturn {
    models: ModelBenchmark[];
    allModels: ModelBenchmark[];
    frontierModels: ModelBenchmark[];
    isLoading: boolean;
    isRefetching: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
    families: string[];
    creators: string[];
    operationCounts: Record<string, number>;
    snapshot: BenchmarksApiResponse["snapshot"] | null;
    attribution: { source: string; url: string } | null;
}

const BENCHMARK_STALE_TIME = 6 * 60 * 60 * 1000;
const BENCHMARK_INDEX_KEY = ["model-benchmarks-index", API_BASE_URL, "v2"] as const;

async function fetchBenchmarkIndex(): Promise<BenchmarksApiResponse> {
    const response = await sdk.fetch("/api/benchmarks", {
        method: "GET",
        key: null,
        paymentMode: "key",
    });
    if (!response.ok) {
        throw new Error(`Failed to load benchmarks: ${response.status}`);
    }
    const payload = await response.json() as BenchmarksApiResponse;
    writeBenchmarksSnapshot(API_BASE_URL, payload);
    return payload;
}

function useBenchmarkIndex(enabled = true) {
    const persisted = useMemo(() => readBenchmarksSnapshot(API_BASE_URL), []);
    return useQuery<BenchmarksApiResponse, Error>({
        queryKey: BENCHMARK_INDEX_KEY,
        queryFn: fetchBenchmarkIndex,
        initialData: persisted?.data,
        initialDataUpdatedAt: persisted?.updatedAt,
        enabled,
        staleTime: BENCHMARK_STALE_TIME,
        gcTime: DURABLE_CACHE_MAX_AGE,
        refetchOnMount: false,
        meta: durableQueryMeta,
    });
}

export function useBenchmarks(options: UseBenchmarksOptions = {}): UseBenchmarksReturn {
    const {
        frontierOnly = false,
        search = "",
        family = "",
        creator = "",
        operation = "all",
        enabled = true,
    } = options;
    const queryClient = useQueryClient();
    const { data, isLoading, isFetching, error } = useBenchmarkIndex(enabled);

    const allModels = useMemo(() => data?.data ?? [], [data]);
    const filteredModels = useMemo(() => {
        let result = allModels;

        if (frontierOnly) result = result.filter((model) => model.isFrontier);
        if (operation !== "all") result = result.filter((model) => model.operation === operation);

        const familyFilter = (family || creator).trim().toLowerCase();
        if (familyFilter && familyFilter !== "all") {
            result = result.filter((model) =>
                model.family.toLowerCase() === familyFilter ||
                model.creator.toLowerCase() === familyFilter ||
                model.creatorSlug.toLowerCase() === familyFilter
            );
        }

        const query = search.trim().toLowerCase();
        if (query) {
            result = result.filter((model) =>
                model.name.toLowerCase().includes(query) ||
                model.modelId.toLowerCase().includes(query) ||
                model.family.toLowerCase().includes(query) ||
                model.creator.toLowerCase().includes(query)
            );
        }

        return result;
    }, [allModels, creator, family, frontierOnly, operation, search]);

    const frontierModels = useMemo(
        () => allModels.filter((model) => model.isFrontier),
        [allModels],
    );

    const families = useMemo(() => {
        return [...new Set(allModels.map((model) => model.family).filter(Boolean))].sort();
    }, [allModels]);

    const creators = useMemo(() => {
        return [...new Set(allModels.map((model) => model.creator).filter(Boolean))].sort();
    }, [allModels]);

    const refetch = useCallback(async () => {
        await queryClient.refetchQueries({ queryKey: BENCHMARK_INDEX_KEY, type: "active" });
    }, [queryClient]);

    return {
        models: filteredModels,
        allModels,
        frontierModels,
        isLoading,
        isRefetching: isFetching && !isLoading,
        error: error ?? null,
        refetch,
        families,
        creators,
        operationCounts: data?.operationCounts ?? {},
        snapshot: data?.snapshot ?? null,
        attribution: data?.attribution ?? {
            source: "Artificial Analysis",
            url: "https://artificialanalysis.ai",
        },
    };
}

export function useModelBenchmark(
    modelId: string | null | undefined,
    options: { enabled?: boolean } = {},
) {
    const query = useBenchmarkIndex(Boolean(modelId) && (options.enabled ?? true));
    const data = useMemo(() => {
        if (!modelId) return undefined;
        const normalized = modelId.toLowerCase();
        return query.data?.data.find((model) => model.modelId.toLowerCase() === normalized);
    }, [modelId, query.data]);

    return {
        ...query,
        data,
    };
}

export function useCompareModels(
    modelIds: string[],
    options: { enabled?: boolean } = {},
) {
    const query = useBenchmarkIndex(options.enabled ?? true);
    const data = useMemo<ModelComparisonResult | undefined>(() => {
        if (!query.data || modelIds.length === 0) return undefined;
        return compareModelBenchmarks(query.data.data, modelIds);
    }, [modelIds, query.data]);

    return {
        ...query,
        data,
    };
}
