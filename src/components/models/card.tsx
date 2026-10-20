/**
 * Model Card Component
 *
 * Side panel showing model details (pricing, limits, I/O) and settings (system prompt, tools).
 * 
 * Styling: uses @compose-market/theme BEM classes (cm-model-card*).
 */
import { useEffect, useState } from "react";
import {
    ModelCard as ModelCardShell,
    ModelPricing,
    ModelRow,
    ModelSection,
} from "@compose-market/theme/model";
import { Excerpt, Hint } from "@compose-market/theme/shell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
    Cpu,
    DollarSign,
    LayoutGrid,
    LogIn,
    LogOut,
    Settings,
    BarChart3,
    Trophy,
    Zap,
    Scale,
    Sparkles,
    Clock,
    ExternalLink,
} from "lucide-react";
import type { CanonicalModality } from "@compose-market/sdk";
import { useModelBenchmark } from "@/hooks/use-benchmarks";
import { ModelComparisonDialog } from "@/components/benchmarks/comparison";
import {
    catalogModelSupportsBenchmarks,
    formatBenchmarkMetric,
    headlineMetrics,
    cleanBenchmarkParameters,
} from "@/lib/benchmarks";
import { Button } from "@/components/ui/button";
import {
    formatModelTypeLabel,
    getDefaultModelPricingSections,
    getModelContextWindowEntries,
    getOptionalModelPricingSections,
    getModelTypeValues,
    getModelValueList,
    type CatalogModel,
    getFamilyLogoUrl,
} from "@/lib/models";
import { typeIcon, typeLabel } from "@compose-market/theme/icons/react";

export interface ParamDefinition {
    type: "string" | "integer" | "number" | "boolean" | "array" | "object" | Array<"string" | "integer" | "number" | "boolean" | "array" | "object">;
    required: boolean;
    default?: string | number | boolean;
    options?: Array<string | number>;
    minimum?: number;
    maximum?: number;
    description?: string;
}

export interface ModelParamsSchema {
    modelId: string;
    type: CanonicalModality | null;
    params: Record<string, ParamDefinition>;
    defaults: Record<string, unknown>;
    provider: string | null;
}

export interface ModelCardProps {
    selectedModel: string;
    modelInfo: CatalogModel | null;
    systemPrompt: string;
    onSystemPromptChange: (value: string) => void;
    modelParams?: ModelParamsSchema | null;
    paramValues?: Record<string, unknown>;
    onParamValuesChange?: (values: Record<string, unknown>) => void;
}

function renderParamInput(
    key: string,
    definition: ParamDefinition,
    value: unknown,
    onChange: (nextValue: unknown) => void,
) {
    const inputType = Array.isArray(definition.type) ? definition.type[0] : definition.type;
    if (definition.options && definition.options.length > 0) {
        const selected = value === undefined
            ? definition.default
            : value;
        const canDeselect = !definition.required && definition.default === undefined;
        return (
            <>
                <div className="cm-model-card__option-grid cm-model-card__option-grid--desktop" role="radiogroup" aria-label={key}>
                    {definition.options.map((option) => {
                        const active = selected !== undefined && String(selected) === String(option);
                        return (
                            <button
                                key={`${key}-${option}`}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                className="cm-model-card__option"
                                data-active={active ? "true" : "false"}
                                onClick={() => onChange(active && canDeselect ? undefined : option)}
                            >
                                <Hint label={String(option)}>
                                    <span>{String(option)}</span>
                                </Hint>
                            </button>
                        );
                    })}
                </div>
                <div className="cm-model-card__option-select-container cm-model-card__option-select-container--mobile">
                    <select
                        value={selected === undefined ? "" : String(selected)}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === "") {
                                onChange(undefined);
                            } else if (inputType === "integer") {
                                onChange(Number.parseInt(val, 10));
                            } else if (inputType === "number") {
                                onChange(Number.parseFloat(val));
                            } else {
                                onChange(val);
                            }
                        }}
                        className="cm-model-card__option-select"
                    >
                        {canDeselect && (
                            <option value="">Default</option>
                        )}
                        {definition.options.map((option) => (
                            <option key={`${key}-select-${option}`} value={String(option)}>
                                {String(option)}
                            </option>
                        ))}
                    </select>
                </div>
            </>
        );
    }

    if (inputType === "boolean") {
        const checked = value === undefined ? Boolean(definition.default) : Boolean(value);
        return (
            <div className="cm-model-card__tool-toggle">
                <span className="cm-model-card__field-value">
                    <span className="cm-model-card__field-main">{checked ? "Enabled" : "Disabled"}</span>
                </span>
                <Switch checked={checked} onCheckedChange={onChange as (checked: boolean) => void} />
            </div>
        );
    }

    return (
        <Input
            type={inputType === "integer" || inputType === "number" ? "number" : "text"}
            min={definition.minimum}
            max={definition.maximum}
            value={value === undefined ? "" : String(value)}
            onChange={(event) => {
                const rawValue = event.target.value;
                if (inputType === "integer") {
                    onChange(rawValue === "" ? undefined : Number.parseInt(rawValue, 10));
                    return;
                }
                if (inputType === "number") {
                    onChange(rawValue === "" ? undefined : Number.parseFloat(rawValue));
                    return;
                }
                onChange(rawValue);
            }}
            className="cm-model-card__field"
        />
    );
}

function flow(value: string): "input" | "output" | null {
    const id = value.toLowerCase();
    if (id.includes("input") || id.includes("prompt")) return "input";
    if (id.includes("output") || id.includes("completion") || id.includes("response")) return "output";
    return null;
}

function iconLabel(label: string, kind: "input" | "output" | "price", variant: "section" | "metric" = "metric") {
    const iconClass = "cm-model-card__icon-svg";
    const icon = kind === "input"
        ? <LogIn className={iconClass} />
        : kind === "output"
            ? <LogOut className={iconClass} />
            : <DollarSign className={iconClass} />;

    return (
        <Hint label={label}>
            <span
                className={`cm-model-card__icon-label ${variant === "section" ? "cm-model-card__icon-label--section" : ""}`}
                aria-label={label}
            >
                {icon}
            </span>
        </Hint>
    );
}

function formatId(value: string): string {
    const id = value.toLowerCase().split(":")[0].trim().replace(/^output[_-]/, "").replace(/^input[_-]/, "");
    if (id.includes("speech")) return "audio";
    return id;
}

function formatLabel(value: string): string {
    const id = formatId(value).replace(/[_-]+/g, " ");
    if (id === "audio") return "Audio";
    if (id === "text") return "Text";
    if (id === "image") return "Image";
    if (id === "video") return "Video";
    return typeLabel(id.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "));
}

function tone(value: string): "cyan" | "fuchsia" | "green" {
    const id = formatId(value);
    if (id.includes("image") || id.includes("video")) return "fuchsia";
    if (id.includes("audio")) return "green";
    return "cyan";
}

function FormatBadge({ value }: { value: string }) {
    const id = formatId(value);
    const label = formatLabel(value);

    return (
        <Hint label={label}>
            <span className="cm-model-card__format-badge" data-tone={tone(value)} aria-label={label}>
                {typeIcon(id, "cm-model-card__format-icon")}
            </span>
        </Hint>
    );
}

function FieldValue({ value }: { value: string }) {
    return (
        <Hint label={value}>
            <span className="cm-model-card__field-value">
                <span className="cm-model-card__field-main">{value}</span>
            </span>
        </Hint>
    );
}

function labelIcon(label: string, fallback: "price" | "input" = "input") {
    const kind = flow(label) || fallback;
    return iconLabel(label, kind);
}

export function ModelCard({
    selectedModel,
    modelInfo,
    systemPrompt,
    onSystemPromptChange,
    modelParams,
    paramValues = {},
    onParamValuesChange,
}: ModelCardProps) {
    const [activeTab, setActiveTab] = useState<"details" | "custom" | "benchmarks">("details");
    const [compareDialogOpen, setCompareDialogOpen] = useState(false);
    const supportsBenchmarks = catalogModelSupportsBenchmarks(modelInfo);

    const typeValues = modelInfo ? getModelTypeValues(modelInfo) : [];
    const hasOptionalParams = Boolean(modelParams && Object.keys(modelParams.params).length > 0);
    const inputValues = modelInfo ? getModelValueList(modelInfo.input) : [];
    const outputValues = modelInfo ? getModelValueList(modelInfo.output) : [];
    const contextEntries = modelInfo ? getModelContextWindowEntries(modelInfo) : [];
    const pricingSections = modelInfo ? getDefaultModelPricingSections(modelInfo) : [];
    const optionalPricingSections = modelInfo ? getOptionalModelPricingSections(modelInfo) : [];

    useEffect(() => {
        if (!supportsBenchmarks && activeTab === "benchmarks") setActiveTab("details");
    }, [activeTab, supportsBenchmarks]);

    const { data: benchmarkData, isLoading: benchmarkLoading } = useModelBenchmark(
        activeTab === "benchmarks" && supportsBenchmarks ? selectedModel : null,
        { enabled: activeTab === "benchmarks" && supportsBenchmarks },
    );
    const benchmarkHeadlineMetrics = benchmarkData ? headlineMetrics(benchmarkData) : [];
    const benchmarkAllMetrics = benchmarkData?.metrics ?? [];

    if (!selectedModel) {
        return (
            <ModelCardShell
                empty
                emptyIcon={<Cpu />}
                emptyText="Select a model to inspect pricing, limits, and settings"
            />
        );
    }

    return (
        <>
            <ModelCardShell
                title={activeTab === "details" || activeTab === "benchmarks" ? (
                    <Hint label={modelInfo?.name || selectedModel}>
                        <span className="cm-model-card__title-text">{modelInfo?.name || selectedModel}</span>
                    </Hint>
                ) : undefined}
                subtitle={activeTab !== "custom" ? (
                    <span className="cm-model-card__model-meta-row">
                        <Hint label={modelInfo?.family || modelInfo?.provider || "unknown"}>
                            <span className="cm-model-card__provider">
                                {modelInfo?.family && (() => {
                                    const logoUrl = getFamilyLogoUrl(modelInfo.family);
                                    if (logoUrl) {
                                        return <img src={logoUrl} alt={modelInfo.family} className="cm-family-icon" />;
                                    }
                                    return null;
                                })()}
                                <span>{modelInfo?.family || modelInfo?.provider || "unknown"}</span>
                            </span>
                        </Hint>
                        <span className="cm-model-card__type-list">
                            {typeValues.map((value) => (
                                <Hint key={value} label={formatModelTypeLabel(value)}>
                                    <span className="cm-model-card__type-badge" data-tone={tone(value)}>
                                        {typeIcon(value, "cm-model-card__type-icon")}
                                        <span>{formatModelTypeLabel(value)}</span>
                                    </span>
                                </Hint>
                            ))}
                        </span>
                    </span>
                ) : undefined}
                icon={activeTab === "details" ? (() => {
                    const logoUrl = modelInfo?.family ? getFamilyLogoUrl(modelInfo.family) : null;
                    if (logoUrl) {
                        return <img src={logoUrl} alt={modelInfo?.family} className="cm-family-icon" />;
                    }
                    return <Cpu />;
                })() : activeTab === "benchmarks" ? (() => {
                    const logoUrl = modelInfo?.family ? getFamilyLogoUrl(modelInfo.family) : null;
                    if (logoUrl) {
                        return <img src={logoUrl} alt={modelInfo?.family} className="cm-family-icon" />;
                    }
                    return <BarChart3 />;
                })() : undefined}
                tabs={[
                    { id: "details", label: "Details", icon: <LayoutGrid />, tone: "cyan" },
                    ...(supportsBenchmarks
                        ? [{ id: "benchmarks", label: "Benchmarks", icon: <BarChart3 />, tone: "cyan" as const }]
                        : []),
                    { id: "custom", label: "Custom", icon: <Settings />, tone: "fuchsia" },
                ]}
                activeTab={activeTab}
                onTabChange={(tab: string) =>
                    setActiveTab(tab === "custom" ? "custom" : tab === "benchmarks" ? "benchmarks" : "details")
                }
            >
                {activeTab === "details" && (
                    <div className="cm-model-card__details">
                        {modelInfo?.description && (
                            <div className="cm-model-card__description">
                                <Hint label={modelInfo.description}>
                                    <span className="cm-model-card__description-hint">
                                        <Excerpt title={modelInfo.name || selectedModel} text={modelInfo.description} lines={2}>
                                            {modelInfo.description}
                                        </Excerpt>
                                    </span>
                                </Hint>
                            </div>
                        )}

                        {modelInfo && (
                            <>
                                {(inputValues.length > 0 || outputValues.length > 0) && (
                                    <ModelSection label={<span className="cm-model-card__section-text">Capability</span>} className="cm-model-card__section--capability">
                                        <div className="cm-model-card__lane-grid">
                                            {inputValues.length > 0 && (
                                                <div className="cm-model-card__io-row cm-model-card__metric-cell">
                                                    <span className="cm-model-card__io-label">{iconLabel("Input", "input")}</span>
                                                    <div className="cm-model-card__io-badges">
                                                        {inputValues.map((value) => (
                                                            <FormatBadge key={`in-${value}`} value={value} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {outputValues.length > 0 && (
                                                <div className="cm-model-card__io-row cm-model-card__metric-cell">
                                                    <span className="cm-model-card__io-label">{iconLabel("Output", "output")}</span>
                                                    <div className="cm-model-card__io-badges">
                                                        {outputValues.map((value) => (
                                                            <FormatBadge key={`out-${value}`} value={value} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </ModelSection>
                                )}

                                {contextEntries.length > 0 && (
                                    <ModelSection label={<span className="cm-model-card__section-text">Context</span>} className="cm-model-card__section--context">
                                        <div className="cm-model-card__kv-grid">
                                            {contextEntries.map((entry) => (
                                                <ModelRow
                                                    key={`ctx-${entry.label}`}
                                                    label={labelIcon(entry.label, "input")}
                                                    value={<FieldValue value={entry.value} />}
                                                />
                                            ))}
                                        </div>
                                    </ModelSection>
                                )}

                                {pricingSections.length > 0 && (
                                    <ModelSection label={iconLabel("Price", "price", "section")} className="cm-model-card__section--pricing">
                                        <div className="cm-model-card__pricing-list">
                                            {pricingSections.map((section, index) => (
                                                <ModelPricing key={`price-${section.header}-${index}`} unit={section.unit}>
                                                    {section.entries.map((entry) => (
                                                        <ModelRow
                                                            key={`${section.header}-${entry.label}`}
                                                            label={labelIcon(entry.label, "price")}
                                                            value={<FieldValue value={entry.value} />}
                                                        />
                                                    ))}
                                                </ModelPricing>
                                            ))}
                                        </div>
                                    </ModelSection>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* ── Benchmarks Tab ───────────────────────────────────── */}
                {activeTab === "benchmarks" && supportsBenchmarks && (
                    <div className="cm-model-card__details space-y-4 p-3 font-mono text-xs">
                        {benchmarkLoading && (
                            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground space-y-2" role="status">
                                <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                                <p className="text-[11px]">Loading linked benchmark snapshot...</p>
                            </div>
                        )}

                        {!benchmarkLoading && benchmarkData && (
                            <>
                                {benchmarkHeadlineMetrics.length > 0 && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {benchmarkHeadlineMetrics.slice(0, 4).map((metric, index) => (
                                            <div
                                                key={metric.key}
                                                className={`p-2.5 rounded-lg border ${index % 2 === 0 ? "bg-cyan-500/10 border-cyan-500/30" : "bg-fuchsia-500/10 border-fuchsia-500/30"}`}
                                            >
                                                <div className={`text-[10px] ${index % 2 === 0 ? "text-cyan-400" : "text-fuchsia-400"}`}>
                                                    {metric.label}
                                                </div>
                                                <div className="mt-1 text-lg font-bold text-foreground">
                                                    {formatBenchmarkMetric(metric)}
                                                </div>
                                                <span className="text-[9px] text-muted-foreground">{metric.unit}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="rounded-lg border border-border/40 overflow-hidden bg-background/40">
                                    <div className="p-2 bg-muted/40 border-b border-border/40 font-bold text-[11px] text-foreground flex items-center justify-between">
                                        <span>Published Benchmark Metrics</span>
                                        <BarChart3 className="w-3 h-3 text-cyan-400" />
                                    </div>
                                    <div className="divide-y divide-border/20 text-[11px]">
                                        {benchmarkAllMetrics.map((metric) => (
                                            <div key={metric.key} className="p-2 flex justify-between gap-3">
                                                <span className="text-muted-foreground">{metric.label}</span>
                                                <span className="font-semibold text-foreground text-right">
                                                    {formatBenchmarkMetric(metric)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {cleanBenchmarkParameters(benchmarkData.parameters).length > 0 && (
                                    <div className="rounded-lg border border-border/40 bg-background/40 p-2 text-[10px] text-muted-foreground">
                                        Benchmark parameters: {cleanBenchmarkParameters(benchmarkData.parameters).join(", ")}
                                    </div>
                                )}

                                <Button
                                    onClick={() => setCompareDialogOpen(true)}
                                    className="w-full h-8 text-xs font-mono bg-cyan-500 hover:bg-cyan-400 text-black font-bold shadow-[0_0_12px_rgba(0,240,255,0.25)]"
                                >
                                    <Scale className="w-3.5 h-3.5 mr-1.5" />
                                    <span>Compare with Similar Models</span>
                                </Button>

                                <div className="text-[10px] text-muted-foreground/80 text-center pt-1">
                                    <span>Benchmark data provided by </span>
                                    <a
                                        href="https://artificialanalysis.ai"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:underline inline-flex items-center gap-0.5"
                                    >
                                        Artificial Analysis
                                        <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
                                </div>
                            </>
                        )}

                        {!benchmarkLoading && !benchmarkData && (
                            <div className="text-center py-8 space-y-3">
                                <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground/50" />
                                <p className="text-xs text-muted-foreground">
                                    No independently measured Artificial Analysis result is linked to this Compose model yet.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "custom" && (
                    <div className="cm-model-card__custom-content">
                        <ModelSection label={<span className="cm-model-card__section-text">System</span>} className="cm-model-card__section--custom">
                            <Textarea
                                value={systemPrompt}
                                onChange={(event) => onSystemPromptChange(event.target.value)}
                                placeholder="Optional system prompt..."
                                rows={3}
                                className="cm-model-card__text-area"
                            />
                        </ModelSection>

                        {/* Optional Pricing */}
                        {optionalPricingSections.length > 0 && (
                            <ModelSection label={iconLabel("Price", "price", "section")} className="cm-model-card__section--pricing">
                                <div className="cm-model-card__pricing-list">
                                    {optionalPricingSections.map((section, index) => (
                                        <ModelPricing key={`optional-price-${section.header}-${index}`} unit={section.unit}>
                                            {section.entries.map((entry) => (
                                                <ModelRow
                                                    key={`${section.header}-${entry.label}`}
                                                    label={labelIcon(entry.label, "price")}
                                                    value={<FieldValue value={entry.value} />}
                                                />
                                            ))}
                                        </ModelPricing>
                                    ))}
                                </div>
                            </ModelSection>
                        )}

                        {/* Dynamic model params */}
                        {hasOptionalParams && modelParams && (
                            <>
                                {Object.entries(modelParams.params).filter(([, definition]) => definition.required !== true).map(([key, definition]) => (
                                    <ModelSection key={key} label={(
                                        <Hint label={definition.description || key}>
                                            <span className="cm-model-card__section-text">{key}</span>
                                        </Hint>
                                    )} className="cm-model-card__section--param">
                                        <div className="cm-model-card__param-body">
                                            {renderParamInput(
                                                key,
                                                definition,
                                                paramValues[key],
                                                (nextValue) => onParamValuesChange?.({ ...paramValues, [key]: nextValue }),
                                            )}
                                        </div>
                                    </ModelSection>
                                ))}
                            </>
                        )}

                        {/* No params state */}
                        {!hasOptionalParams && optionalPricingSections.length === 0 && (
                            <div className="cm-model-card__no-params">
                                No optional parameters exposed for this model.
                            </div>
                        )}
                    </div>
                )}
            </ModelCardShell>

            {/* Sub-Dialog: Head-to-Head Comparison */}
            <ModelComparisonDialog
                open={compareDialogOpen}
                onOpenChange={setCompareDialogOpen}
                initialModelIds={[benchmarkData?.sourceId ?? selectedModel]}
            />
        </>
    );
}

export function ModelCardSkeleton() {
    return (
        <ModelCardShell>
            <p className="cm-model-card__param-description">Loading model details...</p>
        </ModelCardShell>
    );
}
