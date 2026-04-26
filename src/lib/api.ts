/**
 * API Configuration and Types
 *
 * - Base URL configuration for API (sourced from the SDK singleton)
 * - OpenAI-compatible response types (from backend)
 * - SSE stream parser
 * - Response handling utilities
 */

import { sdk } from "./sdk";

// =============================================================================
// API Configuration
// =============================================================================

/**
 * Canonical api.compose.market base URL. Sourced from `sdk.baseUrl` so every
 * module in the app sees the same value.
 */
export const API_BASE_URL: string = sdk.baseUrl;

export function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

/**
 * Thin shim around `sdk.fetch`. Use this for authenticated api.compose.market
 * calls that aren't yet covered by a typed `sdk.*` resource; the SDK attaches
 * the canonical header contract and emits `budget` / `sessionInvalid` /
 * `receipt` events on every response.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return sdk.fetch(path, init);
}

// =============================================================================
// OpenAI-Compatible Types (from api/shared/inference/types.ts)
// =============================================================================

/** OpenAI API message format - for requests/responses */
export interface APIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | APIChatContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type APIChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "input_audio"; input_audio: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// =============================================================================
// UI Chat Types - Single Source of Truth for Frontend
// =============================================================================

export type MessageType = "text" | "image" | "audio" | "video" | "embedding";

/** UI message format - for frontend state management */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  type?: MessageType;
  imageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  partialImage?: boolean;
  /** Progressive reasoning / thinking text emitted while the model is working. */
  reasoning?: string;
  /** Inline, persisted tool activity attached to this assistant message. */
  toolCalls?: Array<{
    id: string;
    name: string;
    source?: "chat" | "responses" | "agent" | "workflow";
    summary?: string;
    arguments?: string;
    status: "running" | "completed" | "error";
    error?: string;
  }>;
  /** Workflow / agent lifecycle breadcrumbs retained in the message bubble. */
  progressEvents?: Array<{
    id: string;
    phase: "thinking" | "start" | "step" | "agent" | "progress" | "complete";
    message: string;
  }>;
}

/** Attached file for uploads */
export interface AttachedFile {
  file: File;
  cid?: string;
  url?: string;
  preview?: string;
  uploading: boolean;
  type: "image" | "audio" | "video";
}

export function buildAttachmentPart(attached: Pick<AttachedFile, "type" | "url"> | undefined): APIChatContentPart | undefined {
  if (!attached?.url) {
    return undefined;
  }

  if (attached.type === "image") {
    return { type: "image_url", image_url: { url: attached.url } };
  }

  if (attached.type === "audio") {
    return { type: "input_audio", input_audio: { url: attached.url } };
  }

  if (attached.type === "video") {
    return { type: "video_url", video_url: { url: attached.url } };
  }

  return undefined;
}

// =============================================================================
// Tag Parsing
// =============================================================================

export interface ParsedInvoke {
  toolName: string;
  params: Record<string, string>;
  raw: string;
}

export interface ParsedContent {
  think: string | null;
  invokes: ParsedInvoke[];
  reply: string;
}

/**
 * Parses <think> and <invoke> tags from content
 * Used by UI components and hooks to understand agent state
 */
export function parseContentTags(content: string): ParsedContent {
  if (!content) return { think: null, invokes: [], reply: "" };

  // 1. Extract Think Block
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  const think = thinkMatch?.[1]?.trim() || null;

  // 2. Extract Invoke Blocks
  const invokes: ParsedInvoke[] = [];
  const invokeRegex = /<invoke>([\s\S]*?)<\/invoke>/gi;
  let invokeMatch;
  while ((invokeMatch = invokeRegex.exec(content)) !== null) {
    const raw = invokeMatch[1];
    const lines = raw.trim().split('\n');
    const toolName = lines[0]?.trim() || 'Unknown Tool';

    const params: Record<string, string> = {};
    const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/gi;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(raw)) !== null) {
      params[paramMatch[1]] = paramMatch[2].trim();
    }

    invokes.push({ toolName, params, raw });
  }

  // 3. Clean Content (Reply)
  let cleanContent = content
    .replace(/<think>([\s\S]*?)<\/think>/gi, '')
    .replace(/<invoke>([\s\S]*?)<\/invoke>/gi, '')
    .replace(/<reply>|<\/reply>/gi, '') // Legacy tags
    .trim();

  // Handle partial tags (cleaning up incomplete tags at the end of stream)
  cleanContent = cleanContent
    .replace(/<think>([\s\S]*)$/gi, '')
    .replace(/<invoke>([\s\S]*)$/gi, '')
    .replace(/<\/invoke>|<\/think>/gi, '')
    .trim();

  return {
    think,
    invokes,
    reply: cleanContent
  };
}

// =============================================================================
// OpenAI Response Types
// =============================================================================

export interface ChatCompletionChoice {
  index: number;
  message: APIChatMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: TokenUsage;
}

// SSE Streaming
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: { index: number; delta: Partial<APIChatMessage>; finish_reason: string | null }[];
}

// Images
export interface ImageData {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

export interface ImagesResponse {
  created: number;
  data: ImageData[];
}

// Audio
export interface AudioTranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
}

// Video
export interface VideoData {
  url?: string;
  b64_json?: string;
  duration?: number;
}

export interface VideoGenerationResponse {
  created: number;
  data: VideoData[];
  model: string;
}

// Async video job response (for long-running generation)
export interface VideoJobResponse {
  id: string;
  object: "video.generation";
  status: "queued" | "processing" | "completed" | "failed";
  created?: number;
  model?: string;
  url?: string;
  error?: string;
  progress?: number;
}

// Embeddings
export interface EmbeddingData {
  object: "embedding";
  embedding: number[];
  index: number;
}

export interface EmbeddingResponse {
  object: "list";
  data: EmbeddingData[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// Responses API (canonical inference format)
export interface ResponsesOutputItem {
  type: string;
  role?: "assistant";
  text?: string;
  content?: Array<{ type?: string; text?: string } | Record<string, unknown>>;
  image_url?: string;
  audio_url?: string;
  video_url?: string;
  embedding?: number[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

export interface ResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  status: "completed" | "in_progress" | "failed" | "cancelled";
  model: string;
  output?: ResponsesOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  job_id?: string;
}

// =============================================================================
// Unified Multimodal Result (for frontend consumption)
// =============================================================================

export type MultimodalType = "text" | "image" | "audio" | "video" | "embedding";

export interface MultimodalResult {
  type: MultimodalType;
  success: boolean;
  content?: string;       // For text/transcription
  url?: string;           // For media (IPFS URL after Pinata upload)
  base64?: string;        // Raw base64 if not yet uploaded
  mimeType?: string;
  embeddings?: number[];  // For embeddings
  error?: string;
  // Async video generation
  jobId?: string;         // Video job ID for polling
  polling?: boolean;      // True if async video job needs polling
}

// =============================================================================
// SSE Stream Parser
// =============================================================================

export interface ParsedSSEBlock {
  event: string;
  data: string;
}

export async function* parseEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<ParsedSSEBlock, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) break;

      const rawBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (!rawBlock.trim()) continue;

      let event = "message";
      const dataLines: string[] = [];

      for (const line of rawBlock.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
          continue;
        }
        if (line.trim() && !line.startsWith(":")) {
          dataLines.push(line);
        }
      }

      if (dataLines.length === 0) continue;

      yield {
        event,
        data: dataLines.join("\n"),
      };
    }
  }

  if (buffer.trim()) {
    yield {
      event: "message",
      data: buffer.trim(),
    };
  }
}

/**
 * Parse SSE stream from text/event-stream response
 * Yields text content chunks as they arrive
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<string, void, unknown> {
  for await (const block of parseEventStream(reader)) {
    const data = block.data.trim();
    if (!data || data === "[DONE]") {
      if (data === "[DONE]") return;
      continue;
    }

    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const chatChunk = parsed as unknown as ChatCompletionChunk;

      if (
        Array.isArray(chatChunk.choices) &&
        typeof chatChunk.choices?.[0]?.delta?.content === "string"
      ) {
        yield chatChunk.choices[0].delta.content as string;
        continue;
      }

      if (parsed.type === "response.output_text.delta") {
        if (typeof parsed.delta === "string") {
          yield parsed.delta;
          continue;
        }
        if (
          parsed.delta &&
          typeof parsed.delta === "object" &&
          typeof (parsed.delta as { text?: unknown }).text === "string"
        ) {
          yield (parsed.delta as { text: string }).text;
          continue;
        }
        continue;
      }

      if (typeof parsed.content === "string") {
        yield parsed.content;
        continue;
      }
      if (typeof parsed.text === "string") {
        yield parsed.text;
        continue;
      }
    } catch {
      if (!data.startsWith("{") && !data.startsWith("[")) {
        yield data;
      }
    }
  }
}

// =============================================================================
// Response Content Type Detection
// =============================================================================

export type ResponseType = "sse" | "json" | "image" | "audio" | "video" | "binary" | "text";

export function detectResponseType(contentType: string): ResponseType {
  if (contentType.includes("text/event-stream")) return "sse";
  if (contentType.includes("text/plain")) return "text";
  if (contentType.includes("application/json")) return "json";
  if (contentType.includes("image/")) return "image";
  if (contentType.includes("audio/")) return "audio";
  if (contentType.includes("video/")) return "video";
  return "binary";
}

// =============================================================================
// Parse OpenAI-format JSON responses
// =============================================================================

/**
 * Parse JSON response from API into unified MultimodalResult
 */
export function parseJsonResponse(data: unknown): MultimodalResult {
  // Error response - handle first to catch errors early
  if (isErrorResponse(data)) {
    const err = data.error;
    const msg = typeof err === "string" ? err : (err?.message || JSON.stringify(err));
    return { type: "text", success: false, error: msg };
  }

  // Agent chat response: { output: string, messages?: [...] }
  if (isAgentChatResponse(data)) {
    return { type: "text", success: true, content: data.output };
  }

  // Workflow multimodal response: { success, type, url, mimeType }
  if (isWorkflowMultimodalResponse(data)) {
    return {
      type: data.type,
      success: data.success,
      url: data.url,          // IPFS URL from backend Pinata upload
      content: data.content,
      mimeType: data.mimeType,
      error: data.error,
    };
  }

  // Canonical Responses API response
  if (isResponsesResponse(data)) {
    if (data.error?.message) {
      return { type: "text", success: false, error: data.error.message };
    }

    if (data.status === "failed") {
      return { type: "text", success: false, error: data.error?.message || "Request failed" };
    }

    if (data.status === "cancelled") {
      return { type: "text", success: false, error: "Request cancelled" };
    }

    const textParts: string[] = [];
    let imageUrl: string | undefined;
    let audioUrl: string | undefined;
    let videoUrl: string | undefined;
    let embedding: number[] | undefined;

    const outputItems = Array.isArray(data.output) ? data.output : [];
    for (const item of outputItems) {
      if (item.type === "output_text" && typeof item.text === "string") {
        textParts.push(item.text);
        continue;
      }
      if (item.type === "output_text" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (
            part &&
            typeof part === "object" &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            textParts.push((part as { text: string }).text);
          }
        }
        continue;
      }
      if (item.type === "output_image" && typeof item.image_url === "string") {
        imageUrl = item.image_url;
        continue;
      }
      if (item.type === "output_audio" && typeof item.audio_url === "string") {
        audioUrl = item.audio_url;
        continue;
      }
      if (item.type === "output_video" && typeof item.video_url === "string") {
        videoUrl = item.video_url;
        continue;
      }
      if (item.type === "output_embedding" && Array.isArray(item.embedding)) {
        embedding = item.embedding;
      }
    }

    if (videoUrl) {
      return { type: "video", success: true, url: videoUrl, mimeType: "video/mp4" };
    }
    if (imageUrl) {
      return { type: "image", success: true, url: imageUrl, mimeType: "image/png" };
    }
    if (audioUrl) {
      return { type: "audio", success: true, url: audioUrl, mimeType: "audio/mpeg" };
    }
    if (embedding) {
      return {
        type: "embedding",
        success: true,
        embeddings: embedding,
        content: JSON.stringify(embedding),
      };
    }

    const text = textParts.join("").trim();
    if (text.length > 0) {
      return { type: "text", success: true, content: text };
    }

    if (data.status === "in_progress" && typeof data.job_id === "string") {
      return {
        type: "video",
        success: true,
        jobId: data.job_id,
        polling: true,
        content: "Video generating... (in_progress)",
      };
    }

    return { type: "text", success: true, content: "" };
  }

  // Chat completion
  if (isChatCompletionResponse(data)) {
    const rawContent = data.choices?.[0]?.message?.content;
    let content: string;
    if (typeof rawContent === "string") {
      content = rawContent;
    } else if (Array.isArray(rawContent)) {
      content = rawContent
        .map((part) => ("text" in part ? part.text : ""))
        .join("");
    } else {
      content = "";
    }
    return {
      type: "text",
      success: true,
      content,
    };
  }

  // Image response
  if (isImagesResponse(data)) {
    const item = data.data?.[0];
    return {
      type: "image",
      success: true,
      base64: item?.b64_json,
      url: item?.url,
      mimeType: "image/png",
    };
  }

  // Async video job response (needs polling)
  if (isVideoJobResponse(data)) {
    if (data.status === "completed" && data.url) {
      return {
        type: "video",
        success: true,
        url: data.url,
        mimeType: "video/mp4",
      };
    }
    if (data.status === "failed") {
      return {
        type: "video",
        success: false,
        error: data.error || "Video generation failed",
      };
    }
    // Job is still processing - return polling info
    return {
      type: "video",
      success: true,
      jobId: data.id,
      polling: true,
      content: `Video generating... (${data.status})`,
    };
  }

  // Video response (sync - has data array)
  if (isVideoResponse(data)) {
    const item = data.data?.[0];
    return {
      type: "video",
      success: true,
      base64: item?.b64_json,
      url: item?.url,
      mimeType: "video/mp4",
    };
  }

  // Embedding response
  if (isEmbeddingResponse(data)) {
    return {
      type: "embedding",
      success: true,
      embeddings: data.data?.[0]?.embedding,
      content: JSON.stringify(data.data?.[0]?.embedding),
    };
  }

  // Transcription response
  if (isTranscriptionResponse(data)) {
    return {
      type: "text",
      success: true,
      content: data.text,
    };
  }

  // Fallback: stringify unknown
  return {
    type: "text",
    success: true,
    content: typeof data === "string" ? data : JSON.stringify(data),
  };
}

// Type guards
function isChatCompletionResponse(data: unknown): data is ChatCompletionResponse {
  return !!data && typeof data === "object" && "choices" in data && Array.isArray((data as ChatCompletionResponse).choices);
}

function isImagesResponse(data: unknown): data is ImagesResponse {
  return !!data && typeof data === "object" && "data" in data &&
    Array.isArray((data as ImagesResponse).data) &&
    ((data as ImagesResponse).data[0]?.b64_json !== undefined || (data as ImagesResponse).data[0]?.url !== undefined);
}

function isVideoResponse(data: unknown): data is VideoGenerationResponse {
  if (!data || typeof data !== "object" || !("data" in data)) return false;
  const arr = (data as VideoGenerationResponse).data;
  if (!Array.isArray(arr) || arr.length === 0) return false;
  // Must have video data item with either b64_json or url
  const item = arr[0];
  return item && (item.b64_json !== undefined || item.url !== undefined);
}

function isVideoJobResponse(data: unknown): data is VideoJobResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  // Must have id and status, and object should be "video.generation"
  return typeof d.id === "string" &&
    typeof d.status === "string" &&
    d.object === "video.generation";
}

function isResponsesResponse(data: unknown): data is ResponsesResponse {
  if (!data || typeof data !== "object") return false;
  const response = data as Record<string, unknown>;
  return response.object === "response" &&
    typeof response.id === "string";
}

function isEmbeddingResponse(data: unknown): data is EmbeddingResponse {
  return !!data && typeof data === "object" && "data" in data &&
    (data as EmbeddingResponse).object === "list";
}

function isTranscriptionResponse(data: unknown): data is AudioTranscriptionResponse {
  return !!data && typeof data === "object" && "text" in data &&
    typeof (data as AudioTranscriptionResponse).text === "string";
}

function isErrorResponse(data: unknown): data is { error: string | { message?: string } } {
  return !!data && typeof data === "object" && "error" in data;
}

function isAgentChatResponse(data: unknown): data is { output: string; messages?: unknown[] } {
  return !!data && typeof data === "object" && "output" in data &&
    typeof (data as { output: unknown }).output === "string";
}

function isWorkflowMultimodalResponse(data: unknown): data is {
  success: boolean;
  type: MultimodalType;
  url?: string;   // IPFS URL from Pinata upload
  data?: string;  // base64 encoded (fallback)
  content?: string;
  mimeType?: string;
  error?: string;
} {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  // Must have success (boolean) and type (valid multimodal type)
  if (typeof d.success !== "boolean") return false;
  if (typeof d.type !== "string") return false;
  const validTypes: MultimodalType[] = ["text", "image", "audio", "video", "embedding"];
  return validTypes.includes(d.type as MultimodalType);
}

// =============================================================================
// Global API Configuration - NO Frontend Timeouts (Always-on Pattern)
// =============================================================================

export const TIMEOUT_CONFIG = {
  FETCH_TIMEOUT_MS: undefined as undefined,
  VIDEO_POLL: {
    INTERVAL_MS: 5000,
    MAX_ATTEMPTS: parseInt(import.meta.env.VITE_VIDEO_POLL_MAX_ATTEMPTS || "900", 10),
  },
  SSE_RETRY: {
    INITIAL_DELAY_MS: 1000,
    MAX_DELAY_MS: 30000,
    BACKOFF_MULTIPLIER: 2,
  },
  SESSION_POLL: {
    INTERVAL_MS: 2000,
    MAX_ATTEMPTS: 30,
  },
} as const;
