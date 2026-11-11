/**
 * Model Card Component
 *
 * Inspector panel showing model description, capabilities, context & pricing specs,
 * Artificial Analysis benchmarks, and custom runtime parameters.
 */
import * as React from "react";
import { useEffect, useState } from "react";
import { Excerpt, Hint } from "@compose-market/theme/shell";
import { Switch } from "@/components/ui/switch";
import { JsonParamTextarea, Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
    Cpu,
    DollarSign,
    LayoutGrid,
    LogIn,
    LogOut,
    Settings,
    BarChart3,
    Scale,
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
import { typeIcon, typeLabel } from "@/lib/modalities";
import { cn } from "@/lib/utils";

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
    tab?: "details" | "custom" | "benchmarks";
    onTabChange?: (tab: "details" | "custom" | "benchmarks") => void;
}

interface TabDef {
    id: "details" | "benchmarks" | "custom";
    label: string;
    icon: React.ReactNode;
    tone: "cyan" | "fuchsia";
}

function ModelSection({
    label,
    className,
    children,
}: {
    label: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <section className={cn("cm-model-card__section", className)}>
            <div className="cm-model-card__section-label">{label}</div>
            <div className="cm-model-card__section-body">{children}</div>
        </section>
    );
}

function ModelPricing({
    unit,
    children,
}: {
    unit?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="cm-model-card__pricing-group">
            {unit ? <div className="cm-model-card__pricing-unit">{unit}</div> : null}
            <div className="cm-model-card__kv-grid">{children}</div>
        </div>
    );
}

function ModelRow({
    label,
    value,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
}) {
    return (
        <div className="cm-model-card__metric-cell">
            <span className="cm-model-card__metric-label">{label}</span>
            <span className="cm-model-card__metric-val">{value}</span>
        </div>
    );
}

function renderParamInput(
    key: string,
    definition: ParamDefinition,
    value: unknown,
    onChange: (nextValue: unknown) => void,
) {
    const inputType = Array.isArray(definition.type) ? definition.type[0] : definition.type;
    if (definition.options && definition.options.length > 0) {
        const selected = value === undefined ? definition.default : value;
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
                        {canDeselect && <option value="">Default</option>}
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

    if (inputType === "object" || inputType === "array") {
        return (
            <JsonParamTextarea
                value={value}
                placeholder={inputType === "array" ? "[]" : "{}"}
                onValidChange={onChange}
            />
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
                    const parsed = Number.parseInt(rawValue, 10);
                    onChange(rawValue === "" ? undefined : (Number.isFinite(parsed) ? parsed : undefined));
                    return;
                }
                if (inputType === "number") {
                    const parsed = Number.parseFloat(rawValue);
                    onChange(rawValue === "" ? undefined : (Number.isFinite(parsed) ? parsed : undefined));
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
                className={cn("cm-model-card__icon-label", variant === "section" && "cm-model-card__icon-label--section")}
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
    tab,
    onTabChange,
}: ModelCardProps) {
    const [internalTab, setInternalTab] = useState<"details" | "custom" | "benchmarks">("details");
    const activeTab = tab ?? internalTab;
    const setActiveTab = (next: "details" | "custom" | "benchmarks") => {
        setInternalTab(next);
        onTabChange?.(next);
    };
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

    const tabs: TabDef[] = [
        { id: "details", label: "Details", icon: <LayoutGrid className="cm-model-card__tab-icon" />, tone: "cyan" },
        ...(supportsBenchmarks
            ? [{ id: "benchmarks" as const, label: "Benchmarks", icon: <BarChart3 className="cm-model-card__tab-icon" />, tone: "cyan" as const }]
            : []),
        { id: "custom", label: "Custom", icon: <Settings className="cm-model-card__tab-icon" />, tone: "fuchsia" },
    ];

    if (!selectedModel) {
        return (
            <aside className="cm-model-card cm-model-card--empty">
                <Cpu className="cm-model-card__empty-icon" />
                <p className="cm-model-card__empty-text">Select a model to inspect pricing, limits, and settings</p>
            </aside>
        );
    }

    const familyLogo = modelInfo?.family ? getFamilyLogoUrl(modelInfo.family) : null;

    return (
        <>
            <aside className="cm-model-card" data-tab={activeTab}>
                {/* ── Header: Family emblem + Title + Provider & Modality Chips ── */}
                <header className="cm-model-card__header">
                    <div className="cm-model-card__identity">
                        <span className="cm-model-card__emblem" aria-hidden="true">
                            {familyLogo ? (
                                <img src={familyLogo} alt={modelInfo?.family || ""} className="cm-family-icon" />
                            ) : activeTab === "benchmarks" ? (
                                <BarChart3 className="cm-model-card__emblem-svg" />
                            ) : (
                                <Cpu className="cm-model-card__emblem-svg" />
                            )}
                        </span>
                        <div className="cm-model-card__titles">
                            <Hint label={modelInfo?.name || selectedModel}>
                                <h2 className="cm-model-card__title-text">{modelInfo?.name || selectedModel}</h2>
                            </Hint>
                            <div className="cm-model-card__model-meta-row">
                                <Hint label={modelInfo?.family || modelInfo?.provider || "unknown"}>
                                    <span className="cm-model-card__provider">
                                        {modelInfo?.family || modelInfo?.provider || "unknown"}
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
                            </div>
                        </div>
                    </div>

                    {/* ── Unified Segmented Tab Rail ── */}
                    <div className="cm-model-card__tabs" role="tablist" aria-label="Model inspector">
                        {tabs.map((item) => {
                            const active = activeTab === item.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    className="cm-model-card__tab"
                                    data-active={active ? "true" : "false"}
                                    data-tone={item.tone}
                                    onClick={() => setActiveTab(item.id)}
                                >
                                    {item.icon}
                                    <span>{item.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </header>

                {/* ── Scrollable Inspector Body ── */}
                <div className="cm-model-card__body">
                    {activeTab === "details" && (
                        <div className="cm-model-card__details">
                            {modelInfo?.description && (
                                <div className="cm-model-card__description">
                                    <Excerpt title={modelInfo.name || selectedModel} text={modelInfo.description} lines={5}>
                                        {modelInfo.description}
                                    </Excerpt>
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

                    {activeTab === "benchmarks" && supportsBenchmarks && (
                        <div className="cm-model-card__benchmarks">
                            {benchmarkLoading && (
                                <div className="cm-model-card__bench-empty" role="status">
                                    <div className="cm-model-card__spinner" />
                                    <p>Loading benchmark snapshot...</p>
                                </div>
                            )}

                            {!benchmarkLoading && benchmarkData && (
                                <>
                                    {benchmarkHeadlineMetrics.length > 0 && (
                                        <div className="cm-model-card__bench-kpis">
                                            {benchmarkHeadlineMetrics.slice(0, 4).map((metric, index) => (
                                                <div
                                                    key={metric.key}
                                                    className="cm-model-card__bench-kpi"
                                                    data-tone={index % 2 === 0 ? "cyan" : "fuchsia"}
                                                >
                                                    <span className="cm-model-card__bench-kpi-label">{metric.label}</span>
                                                    <strong className="cm-model-card__bench-kpi-val">
                                                        {formatBenchmarkMetric(metric)}
                                                    </strong>
                                                    <span className="cm-model-card__bench-kpi-unit">{metric.unit}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <ModelSection label={<span className="cm-model-card__section-text">Published Metrics</span>}>
                                        <div className="cm-model-card__bench-list">
                                            {benchmarkAllMetrics.map((metric) => (
                                                <div key={metric.key} className="cm-model-card__bench-row">
                                                    <span>{metric.label}</span>
                                                    <strong>{formatBenchmarkMetric(metric)}</strong>
                                                </div>
                                            ))}
                                        </div>
                                    </ModelSection>

                                    {cleanBenchmarkParameters(benchmarkData.parameters).length > 0 && (
                                        <p className="cm-model-card__bench-note">
                                            Parameters: {cleanBenchmarkParameters(benchmarkData.parameters).join(", ")}
                                        </p>
                                    )}

                                    <Button
                                        type="button"
                                        onClick={() => setCompareDialogOpen(true)}
                                        className="cm-model-card__compare-btn"
                                    >
                                        <Scale className="cm-model-card__tab-icon" />
                                        <span>Compare Similar Models</span>
                                    </Button>

                                    <div className="cm-model-card__bench-attrib">
                                        <span>Source: </span>
                                        <a href="https://artificialanalysis.ai" target="_blank" rel="noopener noreferrer">
                                            Artificial Analysis <ExternalLink className="cm-model-card__inline-icon" />
                                        </a>
                                    </div>
                                </>
                            )}

                            {!benchmarkLoading && !benchmarkData && (
                                <div className="cm-model-card__bench-empty">
                                    <BarChart3 className="cm-model-card__empty-icon" />
                                    <p>No independently measured benchmark is linked to this model yet.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "custom" && (
                        <div className="cm-model-card__custom-content">
                            <ModelSection label={<span className="cm-model-card__section-text">System Prompt</span>} className="cm-model-card__section--custom">
                                <Textarea
                                    value={systemPrompt}
                                    onChange={(event) => onSystemPromptChange(event.target.value)}
                                    placeholder="Optional system prompt..."
                                    rows={3}
                                    className="cm-model-card__text-area"
                                />
                            </ModelSection>

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

                            {hasOptionalParams && modelParams && (
                                <>
                                    {Object.entries(modelParams.params)
                                        .filter(([, definition]) => definition.required !== true)
                                        .map(([key, definition]) => (
                                            <ModelSection
                                                key={key}
                                                label={(
                                                    <Hint label={definition.description || key}>
                                                        <span className="cm-model-card__section-text">{key}</span>
                                                    </Hint>
                                                )}
                                                className="cm-model-card__section--param"
                                            >
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

                            {!hasOptionalParams && optionalPricingSections.length === 0 && (
                                <div className="cm-model-card__no-params">
                                    No optional parameters exposed for this model.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </aside>

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
