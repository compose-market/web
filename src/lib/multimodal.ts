/**
 * Multimodal Response Handler
 * 
 * - Parses responses into unified format
 * - Uploads base64 media to Pinata → IPFS URLs
 * - Handles binary blobs (audio, video, image)
 */

import { uploadConversationFile } from "./pinata";
import {
    API_BASE_URL,
    TIMEOUT_CONFIG,
    type MultimodalResult,
    type MultimodalType,
    type VideoJobResponse,
    parseSSEStream,
    parseJsonResponse,
    detectResponseType,
} from "./api";

type VideoStatusFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// =============================================================================
// Parse Any Response
// =============================================================================

/**
 * Parse any response into unified MultimodalResult
 * Handles SSE, JSON, and binary responses
 */
export async function parseMultimodalResponse(
    response: Response,
    options?: {
        onStreamChunk?: (chunk: string) => void;
        uploadToPinata?: boolean;
        conversationId?: string;
        // Async video polling callbacks
        onVideoPolling?: {
            onProgress?: (status: string, progress?: number) => void;
            onComplete: (url: string) => void;
            onError: (error: string) => void;
        };
        videoStatusFetch?: VideoStatusFetch;
    }
): Promise<MultimodalResult> {
    const contentType = response.headers.get("content-type") || "";
    const responseType = detectResponseType(contentType);

    switch (responseType) {
        case "sse":
        case "text": {
            // Streaming text response
            const reader = response.body?.getReader();
            if (!reader) {
                return { type: "text", success: false, error: "No response body" };
            }

            let fullContent = "";
            for await (const chunk of parseSSEStream(reader)) {
                fullContent += chunk;
                options?.onStreamChunk?.(chunk);
            }

            return { type: "text", success: true, content: fullContent };
        }

        case "json": {
            const data = await response.json();
            const result = parseJsonResponse(data);

            // Handle async video job - trigger polling if callbacks provided
            if (result.polling && result.jobId && options?.onVideoPolling) {
                // Start polling in background, return immediately with polling status
                pollVideoJob(result.jobId, options.onVideoPolling, {
                    conversationId: options.conversationId,
                    fetcher: options.videoStatusFetch,
                });
                return result;
            }

            // Upload base64 to Pinata if enabled
            if (options?.uploadToPinata && result.base64 && !result.url) {
                try {
                    const url = await uploadBase64ToPinata(
                        result.base64,
                        result.type as "image" | "audio" | "video",
                        options.conversationId
                    );
                    return { ...result, url, base64: undefined };
                } catch (err) {
                    console.error("[multimodal] Pinata upload failed:", err);
                    // Return with base64 as fallback
                }
            }

            return result;
        }

        case "image": {
            return await handleBinaryResponse(response, "image", options);
        }

        case "audio": {
            return await handleBinaryResponse(response, "audio", options);
        }

        case "video": {
            return await handleBinaryResponse(response, "video", options);
        }

        default: {
            // Binary fallback
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            return {
                type: "text",
                success: true,
                url,
                mimeType: contentType,
            };
        }
    }
}

// =============================================================================
// Binary Response Handler
// =============================================================================

async function handleBinaryResponse(
    response: Response,
    type: "image" | "audio" | "video",
    options?: { uploadToPinata?: boolean; conversationId?: string }
): Promise<MultimodalResult> {
    const contentType = response.headers.get("content-type") || "";
    const blob = await response.blob();

    if (options?.uploadToPinata) {
        try {
            const url = await uploadBlobToPinata(blob, type, options.conversationId);
            return { type, success: true, url, mimeType: contentType };
        } catch (err) {
            console.error(`[multimodal] Pinata upload failed for ${type}:`, err);
        }
    }

    // Fallback to object URL
    const url = URL.createObjectURL(blob);
    return { type, success: true, url, mimeType: contentType };
}

// =============================================================================
// Pinata Upload Helpers
// =============================================================================

/**
 * Upload base64-encoded media to Pinata
 */
export async function uploadBase64ToPinata(
    base64: string,
    type: "image" | "audio" | "video",
    conversationId?: string
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

    // Convert base64 to blob
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeTypes[type] });

    // Create file for upload
    const filename = `${type}-${Date.now()}.${extensions[type]}`;
    const file = new File([blob], filename, { type: mimeTypes[type] });

    // Upload via pinata lib
    const { url } = await uploadConversationFile(file, conversationId || "default");
    return url;
}

/**
 * Upload blob to Pinata
 */
export async function uploadBlobToPinata(
    blob: Blob,
    type: "image" | "audio" | "video",
    conversationId?: string
): Promise<string> {
    const extensions = {
        image: "png",
        audio: "wav",
        video: "mp4",
    };

    const filename = `${type}-${Date.now()}.${extensions[type]}`;
    const file = new File([blob], filename, { type: blob.type });

    const { url } = await uploadConversationFile(file, conversationId || "default");
    return url;
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Revoke object URLs to free memory
 */
export function cleanupObjectUrl(url: string): void {
    if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
    }
}

// =============================================================================
// Async Video Polling
// =============================================================================

export interface VideoPollingCallbacks {
    onProgress?: (status: string, progress?: number) => void;
    onComplete: (url: string) => void;
    onError: (error: string) => void;
}

/**
 * Poll for async video generation completion
 * Automatically uploads to Pinata when complete
 */
export async function pollVideoJob(
    jobId: string,
    callbacks: VideoPollingCallbacks,
    options?: {
        pollIntervalMs?: number;
        maxAttempts?: number;
        conversationId?: string;
        fetcher?: VideoStatusFetch;
    }
): Promise<void> {
    const API_BASE = API_BASE_URL;
    const pollInterval = options?.pollIntervalMs ?? TIMEOUT_CONFIG.VIDEO_POLL.INTERVAL_MS;
    const maxAttempts = options?.maxAttempts ?? TIMEOUT_CONFIG.VIDEO_POLL.MAX_ATTEMPTS;
    const statusFetch = options?.fetcher ?? fetch;

    let attempts = 0;

    const poll = async () => {
        attempts++;

        try {
            const response = await statusFetch(`${API_BASE}/v1/videos/${encodeURIComponent(jobId)}`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });

            if (!response.ok) {
                throw new Error(`Status check failed: ${response.status}`);
            }

            const data = await response.json() as VideoJobResponse;

            if (data.status === "completed" && data.url) {
                // Backend already uploaded to Pinata, just use the URL directly
                callbacks.onComplete(data.url);
                return;
            }

            if (data.status === "failed") {
                callbacks.onError(data.error || "Video generation failed");
                return;
            }

            // Still processing
            callbacks.onProgress?.(data.status, data.progress);

            if (attempts >= maxAttempts) {
                callbacks.onError("Video generation timed out");
                return;
            }

            // Schedule next poll
            setTimeout(poll, pollInterval);

        } catch (error) {
            callbacks.onError(error instanceof Error ? error.message : "Unknown error");
        }
    };

    // Start polling
    poll();
}
