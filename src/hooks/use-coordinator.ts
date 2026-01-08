/**
 * Agentic Coordinator Models Hook
 * 
 * React Query hook for fetching curated agentic coordinator models.
 * These models are specifically designed for multi-agent workflows,
 * tool-calling, and long-horizon reasoning tasks.
 * 
 * Follows the pattern from use-model.ts but with a restricted selection
 * of agentic-specialized models.
 */

import { useQuery } from "@tanstack/react-query";

// =============================================================================
// Types
// =============================================================================

export interface AgenticModel {
    id: string;
    name: string;
    provider: string;
    contextLength: number;
    activeParams: string;
    keyStrength: string;
    description: string;
}

// =============================================================================
// Curated Agentic Coordinator Models
// Model IDs verified against the project's normalized registry in models.json
// =============================================================================

export const coordinatorModels: AgenticModel[] = [
    {
        id: "nvidia/nemotron-3-nano-30b-a3b:free",
        name: "Nemotron 3 Nano 30B",
        provider: "nvidia",
        contextLength: 128000,
        activeParams: "30B",
        keyStrength: "Multi-step tool orchestration, RAG, reasoning",
        description: "Post-trained for agentic workflows with SFT across math, code, and science.",
    },
    {
        id: "moonshotai/kimi-k2-thinking",
        name: "Kimi K2 Thinking",
        provider: "moonshotai",
        contextLength: 256000,
        activeParams: "32B",
        keyStrength: "200-300 sequential tool calls, long-horizon reasoning",
        description: "Advanced agentic capabilities with tool-use learning and general RL.",
    },
    {
        id: "minimax/minimax-m2.1",
        name: "MiniMax M2.1",
        provider: "minimax",
        contextLength: 4000000,
        activeParams: "45.9B",
        keyStrength: "Interleaved Thinking (plan→act→reflect), 4M context",
        description: "Agentic-first design with dynamic Plan→Act→Reflect loop.",
    },
    {
        id: "nex-agi/deepseek-v3.1-nex-n1:free",
        name: "DeepSeek V3.1 Nex N1",
        provider: "nex-agi",
        contextLength: 164000,
        activeParams: "~10B",
        keyStrength: "Autonomous operation, tool adherence",
        description: "Post-trained for agent autonomy, tool use, and real-world productivity.",
    },
    {
        id: "allenai/olmo-3.1-32b-think",
        name: "OLMo 3.1 Think 32B",
        provider: "allenai",
        contextLength: 128000,
        activeParams: "32B",
        keyStrength: "Fully open, long chain-of-thought reasoning",
        description: "Ai2's strongest fully open reasoning model with tool use support.",
    },
];

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to get all agentic coordinator models
 */
export function useAgenticModels() {
    return useQuery({
        queryKey: ["agentic-coordinator-models"],
        queryFn: () => Promise.resolve(coordinatorModels),
        staleTime: Infinity, // Static data, never stale
        gcTime: Infinity,
    });
}

/**
 * Hook to get a specific agentic model by ID
 */
export function useAgenticModel(modelId: string | undefined) {
    return useQuery({
        queryKey: ["agentic-coordinator-model", modelId],
        queryFn: () => {
            const model = coordinatorModels.find(m => m.id === modelId);
            return model || null;
        },
        enabled: !!modelId,
        staleTime: Infinity,
        gcTime: Infinity,
    });
}

/**
 * Get the default coordinator model (MiniMax M2.1 for largest context)
 */
export function getDefaultCoordinatorModel(): string {
    return "minimax/minimax-m2.1";
}

/**
 * Get all agentic model IDs (for filtering)
 */
export function getAgenticModelIds(): string[] {
    return coordinatorModels.map(m => m.id);
}

/**
 * Check if a model ID is an approved agentic coordinator model
 */
export function isAgenticCoordinatorModel(modelId: string): boolean {
    return coordinatorModels.some(m => m.id === modelId);
}
