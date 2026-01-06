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

// =============================================================================
// OpenAI-Compatible /v1/models Endpoints
// =============================================================================

/**
 * OpenAI-format model response
 */
export interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  name?: string;
  description?: string;
  context_window?: number;
  max_output_tokens?: number;
  capabilities?: string[];
  pricing?: {
    input: number;
    output: number;
  };
  task_type?: string;
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface OpenAIModelsResponse {
  object: "list";
  data: OpenAIModel[];
}

/**
 * Fetch models from OpenAI-compatible /v1/models endpoint
 * Returns optimized set (~810 models) for fast app loading
 */
export async function fetchOpenAIModels(): Promise<OpenAIModel[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/models`);
    if (!res.ok) throw new Error(`Failed to fetch /v1/models: ${res.status}`);

    const data: OpenAIModelsResponse = await res.json();
    console.log(`[models] Loaded ${data.data.length} models from /v1/models`);
    return data.data;
  } catch (error) {
    console.error("[models] Failed to fetch /v1/models:", error);
    return [];
  }
}

/**
 * Fetch extended models from /v1/models/all endpoint
 * Returns full catalog (~43k+ models)
 */
export async function fetchOpenAIModelsExtended(): Promise<OpenAIModel[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/models/all`);
    if (!res.ok) throw new Error(`Failed to fetch /v1/models/all: ${res.status}`);

    const data: OpenAIModelsResponse = await res.json();
    console.log(`[models] Loaded ${data.data.length} extended models from /v1/models/all`);
    return data.data;
  } catch (error) {
    console.error("[models] Failed to fetch /v1/models/all:", error);
    return [];
  }
}

/**
 * Fetch a specific model by ID from /v1/models/:model
 */
export async function fetchOpenAIModel(modelId: string): Promise<OpenAIModel | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/models/${encodeURIComponent(modelId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to fetch model: ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error(`[models] Failed to fetch model ${modelId}:`, error);
    return null;
  }
}

/**
 * Convert OpenAI model format to AIModel format
 */
export function openAIModelToAIModel(model: OpenAIModel): AIModel {
  return {
    id: model.id,
    name: model.name || model.id,
    ownedBy: model.owned_by,
    source: (model.owned_by || "unknown") as ModelProvider,
    task: model.task_type,
    description: model.description,
    available: true,
    contextLength: model.context_window,
    maxOutputTokens: model.max_output_tokens,
    pricing: model.pricing,
    capabilities: model.capabilities,
    inputModalities: model.input_modalities,
    outputModalities: model.output_modalities,
  };
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
