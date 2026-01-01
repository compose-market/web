// Available AI models for the Manowar platform
// Users can select any of these for their agents/workflows
// Models are fetched dynamically from the /api/registry endpoints
// to ensure consistency, deduplication, and valid inference providers.

/**
 * Model Provider Types:
 * - openai: Uses OPENAI_API_KEY
 * - anthropic: Uses ANTHROPIC_API_KEY
 * - google: Uses GOOGLE_GENERATIVE_AI_API_KEY
 * - asi-one: Uses ASI_ONE_API_KEY
 * - asi-cloud: Uses ASI_INFERENCE_API_KEY
 * - huggingface: Uses HUGGING_FACE_INFERENCE_TOKEN via Router
 * - openrouter: Uses OPENROUTER_API_KEY
 * - aiml: Uses AIML_API_KEY
 */
export type ModelProvider = "openai" | "anthropic" | "google" | "asi-one" | "asi-cloud" | "huggingface" | "openrouter" | "aiml";

export interface ProviderPricing {
  provider: string;
  status: "live" | "staging" | "offline";
  contextLength?: number;
  pricing?: {
    input: number;  // USD per million tokens
    output: number; // USD per million tokens
  };
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
}

/**
 * Model Capabilities - dynamic metadata about what a model supports
 * All values come from the backend registry, NO hardcoding needed
 */
export interface ModelCapabilities {
  tools: boolean;              // Function calling support
  reasoning: boolean;          // o1/DeepSeek-R1 style extended reasoning  
  structuredOutputs: boolean;  // JSON mode / structured outputs
  vision: boolean;             // Image input support
  codeExecution: boolean;      // Google's code execution tool
  searchGrounding: boolean;    // Google Search grounding
  thinking: boolean;           // Extended thinking (Gemini thinking models)
  streaming: boolean;          // Streaming support
  liveApi: boolean;            // Real-time bidirectional (Live API)
}

export interface AIModel {
  id: string;
  name: string;
  ownedBy?: string;
  source: ModelProvider;
  task?: string;
  description?: string;
  available: boolean;
  contextLength?: number;
  maxOutputTokens?: number;
  pricing?: {
    provider?: string;
    input: number;
    output: number;
  };
  providers?: ProviderPricing[];
  // Model capabilities - array of capability names (positive only)
  // e.g., ["tools", "vision", "reasoning", "streaming"]
  capabilities?: string[];
  // Architecture info for multimodal models
  inputModalities?: string[];
  outputModalities?: string[];
}

export interface ModelRegistry {
  models: AIModel[];
  lastUpdated: number;
  sources: string[];
}

const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * Fetch available models from the backend registry
 * This endpoint returns deduplicated models with valid inference providers
 * 
 * Paginates through all pages (limit=500 per request) to load full dataset
 */
export async function fetchAvailableModels(): Promise<AIModel[]> {
  const allModels: AIModel[] = [];
  let page = 1;
  const limit = 500; // Max allowed by backend
  let hasMore = true;

  try {
    while (hasMore) {
      const res = await fetch(`${API_BASE}/api/registry/models/available?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);

      const data = await res.json();
      const models = (data.models || []).map((m: any) => ({
        ...m,
        id: m.modelId || m.id,
        source: m.provider || m.source,
        task: m.taskType || m.task,
        contextLength: m.contextWindow || m.contextLength,
      }));

      allModels.push(...models);

      hasMore = data.hasMore === true;
      page++;

      // Safety: prevent infinite loops (max 150 pages = 75,000 models)
      if (page > 150) break;
    }

    console.log(`[models] Loaded ${allModels.length} models from registry`);
    return allModels;
  } catch (error) {
    console.error("[models] Failed to fetch available models:", error);
    return [];
  }
}

/**
 * Fetch all models including unavailable ones (registry full view)
 */
export async function fetchModelRegistry(): Promise<ModelRegistry | null> {
  try {
    const res = await fetch(`${API_BASE}/api/registry/models`);
    if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("[models] Failed to fetch registry:", error);
    return null;
  }
}

/**
 * Get the API key environment variable name for a provider
 * Useful for UI hints on what keys are needed
 */
export function getApiKeyEnvName(provider: string): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "asi-one":
      return "ASI_ONE_API_KEY";
    case "asi-cloud":
    case "oss":
      return "ASI_INFERENCE_API_KEY";
    case "huggingface":
      return "HUGGING_FACE_INFERENCE_TOKEN";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "aiml":
      return "AIML_API_KEY";
    default:
      return "ASI_INFERENCE_API_KEY";
  }
}

// Check if a model uses ASI infrastructure
export function isAsiModel(model: AIModel): boolean {
  return model.source === "asi-one" || model.source === "asi-cloud";
}

// Default model ID to use if selection is missing
export const DEFAULT_MODEL_ID = "asi1-mini";

/**
 * @deprecated Use the `useModels` hook from `@/hooks/use-model` instead.
 * This static array is only kept for backward compatibility and contains minimal fallback data.
 * All model data should be fetched dynamically via the registry API.
 * 
 * Example migration:
 * ```tsx
 * // Old (deprecated):
 * import { AVAILABLE_MODELS } from "@/lib/models";
 * const models = AVAILABLE_MODELS;
 * 
 * // New (recommended):
 * import { useModels } from "@/hooks/use-model";
 * const { models, isLoading } = useModels();
 * ```
 */
export const AVAILABLE_MODELS: AIModel[] = [
  {
    id: "asi1-mini",
    name: "ASI-1 Mini",
    ownedBy: "asi-cloud",
    source: "asi-cloud",
    available: true,
    task: "text-generation",
    capabilities: ["streaming", "structured-outputs"],
    pricing: { provider: "asi-cloud", input: 0, output: 0 }
  }
];
