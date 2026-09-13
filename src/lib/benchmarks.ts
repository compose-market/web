import type { CatalogModel } from "@/lib/models";
import { getModelTypeValues } from "@/lib/models";
import type {
    BenchmarkMetric,
    BenchmarkOperation,
    ModelBenchmark,
} from "@/types/benchmarks";

export const BENCHMARK_OPERATION_OPTIONS: Array<{ value: BenchmarkOperation; label: string }> = [
    { value: "chat", label: "Language" },
    { value: "text-to-image", label: "Text to Image" },
    { value: "image-to-image", label: "Image Editing" },
    { value: "text-to-video", label: "Text to Video" },
    { value: "image-to-video", label: "Image to Video" },
    { value: "text-to-speech", label: "Text to Speech" },
    { value: "speech-to-text", label: "Speech to Text" },
    { value: "speech-to-speech", label: "Speech to Speech" },
    { value: "text-to-audio", label: "Music" },
];

export function benchmarkOperationLabel(operation: BenchmarkOperation): string {
    return BENCHMARK_OPERATION_OPTIONS.find((option) => option.value === operation)?.label ?? operation;
}

export function benchmarkMetric(model: Pick<ModelBenchmark, "metrics"> | null | undefined, key: string | null | undefined): BenchmarkMetric | null {
    if (!model || !key) return null;
    return model.metrics?.find((metric) => metric.key === key) ?? null;
}

/**
 * Canonical compact labels for dense benchmark surfaces (table headers, card
 * metric slots, battle podium/matrix). The full server-provided label always
 * remains available via tooltips.
 */
export const BENCHMARK_METRIC_ACRONYMS: Record<string, string> = {
    intelligence: "II",
    coding: "CI",
    agentic: "AX",
    speed: "TOK/S",
    ttft: "TTFT",
    ttfa: "TTFA",
    endToEnd: "E2E",
    costPerTask: "COST/TASK",
    priceInput: "INPUT",
    priceOutput: "OUTPUT",
    priceCacheHit: "CACHE HIT",
    priceCacheWrite: "CACHE WRITE",
    elo: "ELO",
    ci95: "±95%",
    samples: "N",
    wer: "WER",
    tauVoice: "τ-V",
    bba: "BBA",
    fdb: "FDB",
};

export function benchmarkMetricShortLabel(metric: Pick<BenchmarkMetric, "key" | "label"> | null | undefined): string {
    if (!metric) return "—";
    return BENCHMARK_METRIC_ACRONYMS[metric.key] ?? metric.label;
}

export function formatBenchmarkMetric(metric: BenchmarkMetric | null): string {
    if (!metric || metric.value === null) return "—";
    switch (metric.format) {
        case "currency":
            return `$${metric.value.toFixed(metric.value < 1 ? 3 : 2)}`;
        case "milliseconds":
            return `${Math.round(metric.value * 1000)}ms`;
        case "seconds":
            return `${metric.value.toFixed(2)}s`;
        case "percent":
            return `${(metric.value * 100).toFixed(1)}%`;
        case "tokens-per-second":
            return `${metric.value.toFixed(1)} tok/s`;
        case "number":
            return Math.round(metric.value).toLocaleString();
        default:
            return metric.value.toFixed(metric.value < 10 ? 2 : 1);
    }
}

export function cleanBenchmarkDisplayName(model: ModelBenchmark | { name: string; sourceName?: string } | string | null | undefined): string {
    if (!model) return "—";
    const rawName = typeof model === "string" ? model : (model.name || model.sourceName || "");
    // Remove raw artificial analysis parenthetical details like "(adaptive reasoning, opus 4.8 fallback)"
    // or "(high)" or "(minimal effort)"
    const sanitized = rawName.replace(/\s*\([^)]*(?:reasoning|fallback|effort|tier|variant|parameter|speed|latency|cost)[^)]*\)\s*$/i, "").trim();
    return sanitized || rawName;
}

export function cleanBenchmarkParameters(parameters: string[] = []): string[] {
    const noisyPatterns = [
        /fallback/i,
        /adaptive reasoning/i,
        /minimal/i,
        /low effort/i,
        /medium effort/i,
        /high effort/i,
        /max effort/i,
        /maximum effort/i,
    ];
    return parameters
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && !noisyPatterns.some((pattern) => pattern.test(p)));
}

export function benchmarkScore(model: ModelBenchmark): number | null {
    return benchmarkMetric(model, model.primaryMetric)?.value ?? null;
}

export function compareBenchmarkModels(left: ModelBenchmark, right: ModelBenchmark): number {
    const leftMetric = benchmarkMetric(left, left.primaryMetric);
    const rightMetric = benchmarkMetric(right, right.primaryMetric);
    if (leftMetric?.value != null && rightMetric?.value != null) {
        const diff = leftMetric.direction === "lower"
            ? leftMetric.value - rightMetric.value
            : rightMetric.value - leftMetric.value;
        if (diff !== 0) return diff;
    }
    return (left.name || left.modelId).localeCompare(right.name || right.modelId);
}

export function defaultComparisonModelIds(
    currentModelId: string | null | undefined,
    models: ModelBenchmark[],
): string[] {
    const normalized = currentModelId?.toLowerCase();
    const current = normalized
        ? models.find((model) =>
            model.modelId.toLowerCase() === normalized ||
            model.sourceId.toLowerCase() === normalized
        )
        : undefined;
    const candidates = current
        ? models.filter((model) => model.operation === current.operation)
        : models.filter((model) => model.operation === "chat");

    const ordered = [...candidates].sort((left, right) => {
        if (left.isFrontier !== right.isFrontier) return left.isFrontier ? -1 : 1;
        return compareBenchmarkModels(left, right);
    });

    const selected = current ? [current.sourceId] : [];
    for (const model of ordered) {
        if (selected.length >= 4) break;
        if (!selected.includes(model.sourceId)) selected.push(model.sourceId);
    }
    return selected;
}

export function benchmarkOperationForCatalogModel(model: CatalogModel | null | undefined): BenchmarkOperation {
    if (!model) return "chat";
    const types = getModelTypeValues(model);
    if (types.includes("music generation")) return "text-to-audio";
    if (types.includes("image generation")) {
        const inputs = Array.isArray(model.input) ? model.input : typeof model.input === "string" ? [model.input] : [];
        return inputs.includes("image") ? "image-to-image" : "text-to-image";
    }
    if (types.includes("video generation")) {
        const inputs = Array.isArray(model.input) ? model.input : typeof model.input === "string" ? [model.input] : [];
        return inputs.includes("image") ? "image-to-video" : "text-to-video";
    }
    if (types.includes("speech")) {
        const outputs = Array.isArray(model.output) ? model.output : typeof model.output === "string" ? [model.output] : [];
        const inputs = Array.isArray(model.input) ? model.input : typeof model.input === "string" ? [model.input] : [];
        if (outputs.includes("audio")) return "text-to-speech";
        if (inputs.includes("audio")) return "speech-to-text";
    }
    if (types.includes("realtime")) return "speech-to-speech";
    return "chat";
}

export function catalogModelSupportsBenchmarks(model: CatalogModel | null | undefined): boolean {
    if (!model) return false;
    // Operations are served by the models worker's /index, derived from
    // the catalog's per-operation capabilities.
    const operations = Array.isArray(model.operations)
        ? model.operations.map((operation) =>
            typeof operation === "string"
                ? operation
                : operation && typeof operation === "object"
                    ? (operation as { operation?: unknown }).operation
                    : undefined
        ).filter(Boolean)
        : [];
    const supportedOperations = new Set([
        "chat",
        "vision-chat",
        "text-to-image",
        "image-to-image",
        "text-to-video",
        "image-to-video",
        "text-to-speech",
        "speech-to-text",
        "speech-to-speech",
        "realtime-speech",
        "realtime-omni",
        "text-to-audio",
    ]);
    if (operations.some((operation) => supportedOperations.has(String(operation)))) return true;

    return getModelTypeValues(model).some((type) => [
        "text generation",
        "image generation",
        "video generation",
        "speech",
        "music generation",
        "realtime",
        "deep-research",
    ].includes(type));
}

export function headlineMetrics(model: ModelBenchmark): BenchmarkMetric[] {
    return model.metrics.filter((metric) => metric.headline && metric.value !== null);
}

export function compareModelBenchmarks(
    availableModels: ModelBenchmark[],
    requestedIds: string[],
): import("@/types/benchmarks").ModelComparisonResult {
    const byId = new Map<string, ModelBenchmark>();
    for (const model of availableModels) {
        byId.set(model.modelId.toLowerCase(), byId.get(model.modelId.toLowerCase()) ?? model);
        byId.set(model.sourceId.toLowerCase(), model);
    }
    const models: ModelBenchmark[] = [];
    const unresolved: string[] = [];

    for (const requestedId of [...new Set(requestedIds.filter(Boolean))]) {
        const model = byId.get(requestedId.toLowerCase());
        if (model && !models.some((existing) =>
            existing.modelId === model.modelId &&
            existing.operation === model.operation &&
            existing.variant === model.variant
        )) {
            models.push(model);
        } else if (!model) {
            unresolved.push(requestedId);
        }
    }

    if (models.length === 0 || models.some((model) => model.operation !== models[0].operation)) {
        return { models, winners: {}, radarData: [], unresolved };
    }

    const definitions = models[0].metrics.filter((metric) => metric.headline);
    const winners: import("@/types/benchmarks").ModelComparisonResult["winners"] = {};
    for (const definition of definitions) {
        const entries = models
            .map((model) => ({ model, metric: benchmarkMetric(model, definition.key) }))
            .filter((entry): entry is { model: ModelBenchmark; metric: BenchmarkMetric & { value: number } } =>
                entry.metric?.value != null
            );
        if (entries.length === 0) continue;
        const winner = entries.reduce((best, current) => {
            const currentWins = definition.direction === "higher"
                ? current.metric.value > best.metric.value
                : current.metric.value < best.metric.value;
            return currentWins ? current : best;
        });
        winners[definition.key] = {
            modelId: winner.model.sourceId,
            value: winner.metric.value,
            advantageLabel: formatBenchmarkMetric(winner.metric),
        };
    }

    const radarData = definitions.map((definition) => {
        const entries = models
            .map((model) => benchmarkMetric(model, definition.key))
            .filter((metric): metric is BenchmarkMetric & { value: number } => metric?.value != null);
        const values = entries.map((metric) => metric.value);
        const point: import("@/types/benchmarks").RadarDataPoint = {
            metric: definition.label,
            fullMark: 100,
        };
        for (const model of models) {
            const metric = benchmarkMetric(model, definition.key);
            if (metric?.value == null) continue;
            if (definition.direction === "higher") {
                const max = Math.max(...values);
                if (max > 0) point[model.sourceId] = Math.round((metric.value / max) * 100);
            } else {
                const min = Math.min(...values);
                if (min > 0) point[model.sourceId] = Math.round((min / metric.value) * 100);
            }
        }
        return point;
    });

    return { models, winners, radarData, unresolved };
}
