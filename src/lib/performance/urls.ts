const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env ?? ({} as ImportMetaEnv);

export const API_BASE_URL = (env.VITE_API_URL ?? "https://api.compose.market").replace(/\/+$/, "");
export const AGENTS_BASE_URL = (env.VITE_AGENTS_URL ?? "https://agents.compose.market").replace(/\/+$/, "");
export const AGENTS_ORIGIN = new URL(AGENTS_BASE_URL).origin;
export const CONNECTORS_BASE_URL = (env.VITE_CONNECTORS_URL ?? "https://connectors.compose.market").replace(/\/+$/, "");
export const RUNTIME_BASE_URL = (env.VITE_RUNTIME_URL ?? "https://runtime.compose.market").replace(/\/+$/, "");
export const CHANNELS_BASE_URL = (env.VITE_CHANNELS_URL ?? "https://services.compose.market").replace(/\/+$/, "");
export const MODELS_BASE_URL = (env.VITE_MODELS_URL ?? "https://models.compose.market").replace(/\/+$/, "");

export function createObjectUrlPreview(file: Blob): string {
    return URL.createObjectURL(file);
}

export function revokeObjectUrlPreview(url: string | undefined): void {
    if (!url || !url.startsWith("blob:")) {
        return;
    }

    URL.revokeObjectURL(url);
}

export function revokeObjectUrlSet(urls: Iterable<string | undefined>): void {
    for (const url of urls) {
        revokeObjectUrlPreview(url);
    }
}