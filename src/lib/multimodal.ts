import type {
    AudioTranscriptionResponse,
    ChatCompletion,
    EmbeddingsResponse,
    ImagesResponse,
    ResponseObject,
    VideoGenerateResponse,
    VideoJobStatus,
} from "@compose-market/sdk";

import { uploadConversationFile } from "./pinata";

export type MultimodalType = "text" | "image" | "audio" | "video" | "embedding";

export interface MultimodalResult {
    type: MultimodalType;
    success: boolean;
    content?: string;
    url?: string;
    base64?: string;
    mimeType?: string;
    embeddings?: number[];
    error?: string;
    jobId?: string;
    polling?: boolean;
}

export async function parseMultimodalData(
    data: unknown,
    options?: {
        uploadToPinata?: boolean;
        conversationId?: string;
    },
): Promise<MultimodalResult> {
    const result = parseJsonResponse(data);

    if (options?.uploadToPinata && result.base64 && !result.url) {
        try {
            const url = await uploadBase64ToPinata(
                result.base64,
                result.type as "image" | "audio" | "video",
                options.conversationId,
            );
            return { ...result, url, base64: undefined };
        } catch (err) {
            console.error("[multimodal] Pinata upload failed:", err);
        }
    }

    return result;
}

export function parseJsonResponse(data: unknown): MultimodalResult {
    if (isErrorResponse(data)) {
        const err = data.error;
        return { type: "text", success: false, error: typeof err === "string" ? err : err?.message || JSON.stringify(err) };
    }

    if (isAgentChatResponse(data)) {
        return { type: "text", success: true, content: data.output };
    }

    if (isWorkflowMultimodalResponse(data)) {
        return {
            type: data.type,
            success: data.success,
            url: data.url,
            content: data.content,
            mimeType: data.mimeType,
            error: data.error,
        };
    }

    if (isResponseObject(data)) {
        return parseResponseObject(data);
    }

    if (isChatCompletion(data)) {
        const raw = data.choices?.[0]?.message?.content as unknown;
        return {
            type: "text",
            success: true,
            content: typeof raw === "string"
                ? raw
                : Array.isArray(raw)
                    ? raw.map((part: unknown) => part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : "").join("")
                    : "",
        };
    }

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

    if (isVideoJobStatus(data)) {
        if (data.status === "completed" && data.url) {
            return { type: "video", success: true, url: data.url, mimeType: "video/mp4" };
        }
        if (data.status === "failed") {
            return { type: "video", success: false, error: data.error || "Video generation failed" };
        }
        return {
            type: "video",
            success: true,
            jobId: data.id,
            polling: true,
            content: `Video generating... (${data.status})`,
        };
    }

    if (isVideoGenerateResponse(data)) {
        const item = data.data?.[0];
        return {
            type: "video",
            success: true,
            base64: item?.b64_json,
            url: item?.url,
            mimeType: "video/mp4",
        };
    }

    if (isEmbeddingsResponse(data)) {
        const embedding = data.data?.[0]?.embedding;
        return {
            type: "embedding",
            success: true,
            embeddings: embedding,
            content: JSON.stringify(embedding),
        };
    }

    if (isAudioTranscriptionResponse(data)) {
        return { type: "text", success: true, content: data.text };
    }

    return { type: "text", success: true, content: typeof data === "string" ? data : JSON.stringify(data) };
}

export async function uploadBase64ToPinata(
    base64: string,
    type: "image" | "audio" | "video",
    conversationId?: string,
): Promise<string> {
    const mimeTypes = {
        image: "image/png",
        audio: "audio/wav",
        video: "video/mp4",
    };
    const extensions = {
        image: "png",
        audio: "wav",
        video: "mp4",
    };

    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i += 1) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeTypes[type] });
    const file = new File([blob], `${type}-${Date.now()}.${extensions[type]}`, { type: mimeTypes[type] });
    const { url } = await uploadConversationFile(file, conversationId || "default");
    return url;
}

function parseResponseObject(data: ResponseObject): MultimodalResult {
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

    for (const item of Array.isArray(data.output) ? data.output : []) {
        const record = item as Record<string, unknown>;
        if (record.type === "output_text" && typeof record.text === "string") {
            textParts.push(record.text);
            continue;
        }
        if (record.type === "output_text" && Array.isArray(record.content)) {
            for (const part of record.content) {
                if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
                    textParts.push((part as { text: string }).text);
                }
            }
            continue;
        }
        if (record.type === "output_image" && typeof record.image_url === "string") {
            imageUrl = record.image_url;
            continue;
        }
        if (record.type === "output_audio" && typeof record.audio_url === "string") {
            audioUrl = record.audio_url;
            continue;
        }
        if (record.type === "output_video" && typeof record.video_url === "string") {
            videoUrl = record.video_url;
            continue;
        }
        if (record.type === "output_embedding" && Array.isArray(record.embedding)) {
            embedding = record.embedding as number[];
        }
    }

    if (videoUrl) return { type: "video", success: true, url: videoUrl, mimeType: "video/mp4" };
    if (imageUrl) return { type: "image", success: true, url: imageUrl, mimeType: "image/png" };
    if (audioUrl) return { type: "audio", success: true, url: audioUrl, mimeType: "audio/mpeg" };
    if (embedding) return { type: "embedding", success: true, embeddings: embedding, content: JSON.stringify(embedding) };

    const text = textParts.join("").trim();
    if (text) return { type: "text", success: true, content: text };

    if (data.status === "in_progress" && typeof (data as { job_id?: unknown }).job_id === "string") {
        return {
            type: "video",
            success: true,
            jobId: (data as { job_id: string }).job_id,
            polling: true,
            content: "Video generating... (in_progress)",
        };
    }

    return { type: "text", success: true, content: "" };
}

function isChatCompletion(data: unknown): data is ChatCompletion {
    return !!data && typeof data === "object" && Array.isArray((data as ChatCompletion).choices);
}

function isImagesResponse(data: unknown): data is ImagesResponse {
    const response = data as ImagesResponse;
    return !!data && typeof data === "object" && Array.isArray(response.data) &&
        (response.data[0]?.b64_json !== undefined || response.data[0]?.url !== undefined);
}

function isVideoGenerateResponse(data: unknown): data is VideoGenerateResponse {
    const response = data as VideoGenerateResponse;
    return !!data && typeof data === "object" && Array.isArray(response.data) &&
        Boolean(response.data[0]?.b64_json || response.data[0]?.url);
}

function isVideoJobStatus(data: unknown): data is VideoJobStatus {
    const record = data as Record<string, unknown>;
    return !!data && typeof data === "object" &&
        typeof record.id === "string" &&
        typeof record.status === "string" &&
        record.object === "video.generation";
}

function isResponseObject(data: unknown): data is ResponseObject {
    const response = data as ResponseObject;
    return !!data && typeof data === "object" && response.object === "response" && typeof response.id === "string";
}

function isEmbeddingsResponse(data: unknown): data is EmbeddingsResponse {
    const response = data as EmbeddingsResponse;
    return !!data && typeof data === "object" && response.object === "list" && Array.isArray(response.data);
}

function isAudioTranscriptionResponse(data: unknown): data is AudioTranscriptionResponse {
    return !!data && typeof data === "object" && typeof (data as AudioTranscriptionResponse).text === "string";
}

function isErrorResponse(data: unknown): data is { error: string | { message?: string } } {
    return !!data && typeof data === "object" && "error" in data;
}

function isAgentChatResponse(data: unknown): data is { output: string; messages?: unknown[] } {
    return !!data && typeof data === "object" && typeof (data as { output?: unknown }).output === "string";
}

function isWorkflowMultimodalResponse(data: unknown): data is {
    success: boolean;
    type: MultimodalType;
    url?: string;
    content?: string;
    mimeType?: string;
    error?: string;
} {
    const record = data as Record<string, unknown>;
    if (!record || typeof record !== "object") return false;
    if (typeof record.success !== "boolean" || typeof record.type !== "string") return false;
    return ["text", "image", "audio", "video", "embedding"].includes(record.type);
}
