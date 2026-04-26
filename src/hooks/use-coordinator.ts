import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import type { CatalogModel } from "@/lib/models";

export const COORDINATOR_MODEL_IDS = [
    "nvidia/nemotron-3-nano-30b-a3b",
    "moonshotai/kimi-k2-thinking",
    "minimax/minimax-m2.1",
    "nex-agi/deepseek-v3.1-nex-n1",
    "allenai/olmo-3.1-32b-think",
] as const;

async function fetchCoordinatorModels(): Promise<CatalogModel[]> {
    const { data } = await sdk.models.list();
    return COORDINATOR_MODEL_IDS
        .map((modelId) => data.find((model) => model.modelId === modelId) || null)
        .filter((model): model is CatalogModel => model !== null);
}

export function useAgenticModels() {
    return useQuery({
        queryKey: ["agentic-coordinator-models"],
        queryFn: fetchCoordinatorModels,
        staleTime: 6 * 60 * 60 * 1000,
        gcTime: 12 * 60 * 60 * 1000,
    });
}

export function useAgenticModel(modelId: string | undefined) {
    return useQuery({
        queryKey: ["agentic-coordinator-model", modelId],
        queryFn: async () => {
            const models = await fetchCoordinatorModels();
            return models.find((model) => model.modelId === modelId) || null;
        },
        enabled: Boolean(modelId),
        staleTime: 6 * 60 * 60 * 1000,
        gcTime: 12 * 60 * 60 * 1000,
    });
}

export function getDefaultCoordinatorModel(): string | null {
    return null;
}

export function getAgenticModelIds(): string[] {
    return [...COORDINATOR_MODEL_IDS];
}

export function isAgenticCoordinatorModel(modelId: string): boolean {
    return COORDINATOR_MODEL_IDS.includes(modelId as (typeof COORDINATOR_MODEL_IDS)[number]);
}
