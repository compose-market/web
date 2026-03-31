/**
 * Mirror Pane Component
 *
 * Side panel showing model details (pricing, limits, I/O) and settings (system prompt, tools).
 * 
 * Styling: uses @compose-market/theme BEM classes (cm-mirror-pane*).
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Cpu,
    Search,
    Code2,
    MapPin,
    Link,
    LayoutGrid,
    Settings,
} from "lucide-react";
import {
    formatModelTypeLabel,
    getDefaultModelPricingSections,
    getModelContextWindowEntries,
    getOptionalModelPricingSections,
    getModelTypeValues,
    getModelValueList,
    type CatalogModel,
} from "@/lib/models";

export interface GoogleToolsState {
    enableGoogleSearch: boolean;
    setEnableGoogleSearch: (value: boolean) => void;
    enableCodeExecution: boolean;
    setEnableCodeExecution: (value: boolean) => void;
    enableMapsGrounding: boolean;
    setEnableMapsGrounding: (value: boolean) => void;
    urlContextUrls: string;
    setUrlContextUrls: (value: string) => void;
}

export interface ParamDefinition {
    type: "string" | "integer" | "number" | "boolean" | "array";
    required: boolean;
    default?: string | number | boolean;
    options?: Array<string | number>;
    description?: string;
}

export interface ModelParamsSchema {
    modelId: string;
    type: "video" | "image" | null;
    params: Record<string, ParamDefinition>;
    defaults: Record<string, unknown>;
    provider: string | null;
}

export interface MirrorPaneProps {
    selectedModel: string;
    modelInfo: CatalogModel | null;
    isGoogleModel: boolean;
    systemPrompt: string;
    onSystemPromptChange: (value: string) => void;
    googleTools?: GoogleToolsState;
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
    if (definition.options && definition.options.length > 0) {
        const stringValue = value === undefined ? "" : String(value);
        return (
            <Select value={stringValue} onValueChange={onChange as (value: string) => void}>
                <SelectTrigger className="bg-background/50 border-sidebar-border">
                    <SelectValue placeholder={`Select ${key}`} />
                </SelectTrigger>
                <SelectContent>
                    {definition.options.map((option) => (
                        <SelectItem key={`${key}-${option}`} value={String(option)}>
                            {String(option)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    if (definition.type === "boolean") {
        return (
            <div className="cm-mirror-pane__tool-toggle">
                <span className="text-xs text-muted-foreground">{definition.description || key}</span>
                <Switch checked={Boolean(value)} onCheckedChange={onChange as (checked: boolean) => void} />
            </div>
        );
    }

    return (
        <Input
            type={definition.type === "integer" || definition.type === "number" ? "number" : "text"}
            value={value === undefined ? "" : String(value)}
            onChange={(event) => {
                const rawValue = event.target.value;
                if (definition.type === "integer") {
                    onChange(rawValue === "" ? undefined : Number.parseInt(rawValue, 10));
                    return;
                }
                if (definition.type === "number") {
                    onChange(rawValue === "" ? undefined : Number.parseFloat(rawValue));
                    return;
                }
                onChange(rawValue);
            }}
            className="bg-background/50 border-sidebar-border"
        />
    );
}

export function MirrorPane({
    selectedModel,
    modelInfo,
    isGoogleModel,
    systemPrompt,
    onSystemPromptChange,
    googleTools,
    modelParams,
    paramValues = {},
    onParamValuesChange,
}: MirrorPaneProps) {
    const [activeTab, setActiveTab] = useState<"details" | "custom">("details");
    const typeValues = modelInfo ? getModelTypeValues(modelInfo) : [];
    const hasOptionalParams = Boolean(modelParams && Object.keys(modelParams.params).length > 0);
    const inputValues = modelInfo ? getModelValueList(modelInfo.input) : [];
    const outputValues = modelInfo ? getModelValueList(modelInfo.output) : [];
    const contextEntries = modelInfo ? getModelContextWindowEntries(modelInfo) : [];
    const pricingSections = modelInfo ? getDefaultModelPricingSections(modelInfo) : [];
    const optionalPricingSections = modelInfo ? getOptionalModelPricingSections(modelInfo) : [];

    if (!selectedModel) {
        return (
            <div className="cm-mirror-pane">
                <div className="cm-mirror-pane__empty">
                    <Cpu className="cm-mirror-pane__empty-icon" />
                    <p className="cm-mirror-pane__empty-text">Select a model to inspect pricing, limits, and settings</p>
                </div>
            </div>
        );
    }

    return (
        <TooltipProvider>
            <div className="cm-mirror-pane">
                {/* Toolbar */}
                <div className="cm-mirror-pane__toolbar">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setActiveTab("details")}
                                className={`cm-mirror-pane__toolbar-btn ${activeTab === "details" ? "cm-mirror-pane__toolbar-btn--active-cyan" : ""}`}
                                aria-label="Details"
                            >
                                <LayoutGrid />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Details</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setActiveTab("custom")}
                                className={`cm-mirror-pane__toolbar-btn ${activeTab === "custom" ? "cm-mirror-pane__toolbar-btn--active-fuchsia" : ""}`}
                                aria-label="Custom"
                            >
                                <Settings />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Custom</TooltipContent>
                    </Tooltip>
                </div>

                {/* Body */}
                <div className="cm-mirror-pane__body">
                    {activeTab === "details" && (
                        <>
                            {/* ── Model Identity: icon + name + types + id ── */}
                            <div className="cm-mirror-pane__model-header">
                                <div className="cm-mirror-pane__model-icon-box">
                                    <Cpu className="text-cyan-400" />
                                </div>
                                <div className="cm-mirror-pane__model-copy">
                                    <div className="cm-mirror-pane__model-name-row">
                                        <h3 className="cm-mirror-pane__model-name">
                                            {modelInfo?.name || selectedModel}
                                        </h3>
                                        {typeValues.length > 0 && (
                                            <span className="cm-mirror-pane__model-types">
                                                {typeValues.map((v) => (
                                                    <Badge key={v} className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-[10px] px-1.5 py-0">
                                                        {formatModelTypeLabel(v)}
                                                    </Badge>
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                    <p className="cm-mirror-pane__model-provider">
                                        {modelInfo?.provider || "unknown"}
                                        {modelInfo?.modelId && (
                                            <span className="cm-mirror-pane__model-id"> ({modelInfo.modelId})</span>
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* ── Description: 2-line clamp, full text on hover ── */}
                            {modelInfo?.description && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <p className="cm-mirror-pane__description cm-mirror-pane__description--clamped">
                                            {modelInfo.description}
                                        </p>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                                        {modelInfo.description}
                                    </TooltipContent>
                                </Tooltip>
                            )}

                            {modelInfo && (
                                <>
                                    {/* ── I/O Modalities: compact inline ── */}
                                    {(inputValues.length > 0 || outputValues.length > 0) && (
                                        <div className="cm-mirror-pane__section cm-mirror-pane__section--compact">
                                            {inputValues.length > 0 && (
                                                <div className="cm-mirror-pane__io-row">
                                                    <span className="cm-mirror-pane__io-label">IN</span>
                                                    <div className="cm-mirror-pane__io-badges">
                                                        {inputValues.map((value) => (
                                                            <Badge key={`in-${value}`} variant="outline" className="text-[10px] border-sidebar-border py-0 px-1.5">
                                                                {value}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {outputValues.length > 0 && (
                                                <div className="cm-mirror-pane__io-row">
                                                    <span className="cm-mirror-pane__io-label">OUT</span>
                                                    <div className="cm-mirror-pane__io-badges">
                                                        {outputValues.map((value) => (
                                                            <Badge key={`out-${value}`} variant="outline" className="text-[10px] border-sidebar-border py-0 px-1.5">
                                                                {value}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ── Context Window: entries on same row ── */}
                                    {contextEntries.length > 0 && (
                                        <div className="cm-mirror-pane__section cm-mirror-pane__section--compact">
                                            <span className="cm-mirror-pane__section-label">Context Window</span>
                                            <div className="cm-mirror-pane__kv-grid">
                                                {contextEntries.map((entry) => (
                                                    <div key={`ctx-${entry.label}`} className="cm-mirror-pane__kv-row">
                                                        <span className="cm-mirror-pane__kv-label">{entry.label}</span>
                                                        <span className="cm-mirror-pane__kv-value">{entry.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Pricing: consolidated rows, unit below ── */}
                                    {pricingSections.length > 0 && (
                                        <div className="cm-mirror-pane__section cm-mirror-pane__section--compact">
                                            <span className="cm-mirror-pane__section-label">Pricing</span>
                                            {pricingSections.map((section, index) => (
                                                <div key={`price-${section.header}-${index}`} className="cm-mirror-pane__pricing-compact">
                                                    <div className="cm-mirror-pane__pricing-entries">
                                                        {section.entries.map((entry) => (
                                                            <div key={`${section.header}-${entry.label}`} className="cm-mirror-pane__kv-row">
                                                                <span className="cm-mirror-pane__kv-label">{entry.label}</span>
                                                                <span className="cm-mirror-pane__kv-value">{entry.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {section.unit && (
                                                        <span className="cm-mirror-pane__pricing-unit">{section.unit}</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {activeTab === "custom" && (
                        <div className="cm-mirror-pane__custom-content">
                            {/* System Prompt */}
                            <div className="cm-mirror-pane__custom-section">
                                <Label className="cm-mirror-pane__section-label">SYSTEM PROMPT</Label>
                                <Textarea
                                    value={systemPrompt}
                                    onChange={(event) => onSystemPromptChange(event.target.value)}
                                    placeholder="Optional system prompt..."
                                    className="cm-mirror-pane__text-area"
                                />
                            </div>

                            {/* Google Tools */}
                            {isGoogleModel && googleTools && (
                                <div className="cm-mirror-pane__tool-group">
                                    <div className="cm-mirror-pane__tool-group-label text-cyan-400">GEMINI TOOLS</div>
                                    <div className="cm-mirror-pane__tool-toggle">
                                        <div className="cm-mirror-pane__tool-toggle-label">
                                            <Search className="text-cyan-400" />
                                            <span>Google Search</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableGoogleSearch}
                                            onCheckedChange={googleTools.setEnableGoogleSearch}
                                        />
                                    </div>
                                    <div className="cm-mirror-pane__tool-toggle">
                                        <div className="cm-mirror-pane__tool-toggle-label">
                                            <Code2 className="text-cyan-400" />
                                            <span>Code Execution</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableCodeExecution}
                                            onCheckedChange={googleTools.setEnableCodeExecution}
                                        />
                                    </div>
                                    <div className="cm-mirror-pane__tool-toggle">
                                        <div className="cm-mirror-pane__tool-toggle-label">
                                            <MapPin className="text-cyan-400" />
                                            <span>Maps Grounding</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableMapsGrounding}
                                            onCheckedChange={googleTools.setEnableMapsGrounding}
                                        />
                                    </div>
                                    <div className="cm-mirror-pane__custom-section">
                                        <Label className="cm-mirror-pane__section-label flex items-center gap-2">
                                            <Link className="cm-mirror-pane__tool-toggle-label-icon" />
                                            URL CONTEXT
                                        </Label>
                                        <Textarea
                                            value={googleTools.urlContextUrls}
                                            onChange={(event) => googleTools.setUrlContextUrls(event.target.value)}
                                            placeholder="One URL per line"
                                            className="cm-mirror-pane__text-area"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Optional Pricing */}
                            {optionalPricingSections.length > 0 && (
                                <div className="cm-mirror-pane__tool-group cm-mirror-pane__tool-group--fuchsia">
                                    <Label className="cm-mirror-pane__tool-group-label text-fuchsia-400">OPTIONAL PRICING</Label>
                                    <div className="cm-mirror-pane__custom-content">
                                        {optionalPricingSections.map((section, index) => (
                                            <div key={`${section.header}-${section.unit}-${index}`} className="cm-mirror-pane__pricing-block">
                                                <div className="cm-mirror-pane__pricing-header">
                                                    <span className="font-mono text-fuchsia-300">{section.header}</span>
                                                    {section.unit && (
                                                        <Badge variant="outline" className="text-[10px] border-sidebar-border">
                                                            {section.unit}
                                                        </Badge>
                                                    )}
                                                </div>
                                                {section.entries.map((entry) => (
                                                    <div key={`${section.header}-${entry.label}`} className="cm-mirror-pane__kv-row text-xs">
                                                        <span className="cm-mirror-pane__kv-label">{entry.label}</span>
                                                        <span className="cm-mirror-pane__kv-value">{entry.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* No params state */}
                            {!hasOptionalParams && optionalPricingSections.length === 0 && (
                                <div className="cm-mirror-pane__no-params">
                                    No optional parameters exposed for this model.
                                </div>
                            )}

                            {/* Dynamic model params */}
                            {hasOptionalParams && modelParams && (
                                <>
                                    {Object.entries(modelParams.params).filter(([, definition]) => definition.required !== true).map(([key, definition]) => (
                                        <div key={key} className="cm-mirror-pane__custom-section">
                                            <Label className="cm-mirror-pane__section-label">
                                                {key}
                                            </Label>
                                            {renderParamInput(
                                                key,
                                                definition,
                                                paramValues[key],
                                                (nextValue) => onParamValuesChange?.({ ...paramValues, [key]: nextValue }),
                                            )}
                                            {definition.description && (
                                                <p className="cm-mirror-pane__param-description">{definition.description}</p>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
}

export function MirrorPaneSkeleton() {
    return (
        <div className="cm-mirror-pane">
            <div className="cm-mirror-pane__body">
                <p className="text-sm text-muted-foreground">Loading model details...</p>
            </div>
        </div>
    );
}
