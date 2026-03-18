/**
 * Mirror Pane Component
 *
 * Side panel showing model details (pricing, limits, I/O) and settings (system prompt, tools).
 * 
 * Styling: uses @compose-market/theme BEM classes (cm-mirror-pane*).
 */
import React, { useState } from "react";
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
    const [activeTab, setActiveTab] = useState<"details" | "settings">("details");
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
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Details</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setActiveTab("settings")}
                                className={`cm-mirror-pane__toolbar-btn ${activeTab === "settings" ? "cm-mirror-pane__toolbar-btn--active-fuchsia" : ""}`}
                                aria-label="Settings"
                            >
                                <Settings className="w-4 h-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Settings</TooltipContent>
                    </Tooltip>
                </div>

                {/* Body */}
                <div className="cm-mirror-pane__body">
                    {activeTab === "details" && (
                        <>
                            {/* Model Identity */}
                            <div className="cm-mirror-pane__model-header">
                                <div className="cm-mirror-pane__model-icon-box">
                                    <Cpu className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" />
                                </div>
                                <div className="cm-mirror-pane__model-copy">
                                    <h3 className="cm-mirror-pane__model-name">
                                        {modelInfo?.name || selectedModel}
                                    </h3>
                                    <p className="cm-mirror-pane__model-provider">
                                        {modelInfo?.provider || "unknown"}
                                    </p>
                                </div>
                            </div>

                            {/* Type badges */}
                            <div className="flex flex-wrap gap-1.5">
                                {typeValues.map((typeValue) => (
                                    <Badge key={typeValue} className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                                        {formatModelTypeLabel(typeValue)}
                                    </Badge>
                                ))}
                            </div>

                            {modelInfo && (
                                <div className="space-y-3 text-xs">
                                    {/* Model Details Section */}
                                    <div className="cm-mirror-pane__section">
                                        <div>
                                            <span className="cm-mirror-pane__section-label">Model ID</span>
                                            <div className="font-mono text-cyan-400 break-all">{modelInfo.modelId}</div>
                                        </div>
                                        <div>
                                            <span className="cm-mirror-pane__section-label">Input</span>
                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                {inputValues.length > 0 ? inputValues.map((value) => (
                                                    <Badge key={`input-${value}`} variant="outline" className="text-[10px] border-sidebar-border">
                                                        {value}
                                                    </Badge>
                                                )) : (
                                                    <span className="text-muted-foreground">None</span>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="cm-mirror-pane__section-label">Output</span>
                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                {outputValues.length > 0 ? outputValues.map((value) => (
                                                    <Badge key={`output-${value}`} variant="outline" className="text-[10px] border-sidebar-border">
                                                        {value}
                                                    </Badge>
                                                )) : (
                                                    <span className="text-muted-foreground">None</span>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="cm-mirror-pane__section-label">Context Window</span>
                                            <div className="mt-1 space-y-1">
                                                {contextEntries.length > 0 ? contextEntries.map((entry) => (
                                                    <div key={`context-${entry.label}`} className="cm-mirror-pane__kv-row">
                                                        <span className="cm-mirror-pane__kv-label">{entry.label}</span>
                                                        <span className="cm-mirror-pane__kv-value">{entry.value}</span>
                                                    </div>
                                                )) : (
                                                    <span className="text-muted-foreground">Not provided</span>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="cm-mirror-pane__section-label">Pricing</span>
                                            <div className="mt-2 space-y-2">
                                                {pricingSections.length > 0 ? pricingSections.map((section, index) => (
                                                    <div key={`${section.header}-${index}`} className="cm-mirror-pane__pricing-block">
                                                        <div className="cm-mirror-pane__pricing-header">
                                                            <span className="cm-mirror-pane__pricing-name">{section.header}</span>
                                                            {section.unit && (
                                                                <Badge variant="outline" className="text-[10px] border-sidebar-border">
                                                                    {section.unit}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        {section.entries.map((entry) => (
                                                            <div key={`${section.header}-${entry.label}`} className="cm-mirror-pane__kv-row">
                                                                <span className="cm-mirror-pane__kv-label">{entry.label}</span>
                                                                <span className="cm-mirror-pane__kv-value">{entry.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )) : (
                                                    <span className="text-muted-foreground">No pricing metadata</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Description */}
                                    {modelInfo.description && (
                                        <div className="cm-mirror-pane__description">
                                            {modelInfo.description}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === "settings" && (
                        <div className="space-y-3">
                            {/* System Prompt */}
                            <div className="space-y-2">
                                <Label className="text-xs font-mono text-muted-foreground">SYSTEM PROMPT</Label>
                                <Textarea
                                    value={systemPrompt}
                                    onChange={(event) => onSystemPromptChange(event.target.value)}
                                    placeholder="Optional system prompt..."
                                    className="min-h-[120px] bg-background/50 border-sidebar-border font-mono text-xs"
                                />
                            </div>

                            {/* Google Tools */}
                            {isGoogleModel && googleTools && (
                                <div className="cm-mirror-pane__tool-group">
                                    <div className="cm-mirror-pane__tool-group-label text-cyan-400">GEMINI TOOLS</div>
                                    <div className="cm-mirror-pane__tool-toggle">
                                        <div className="cm-mirror-pane__tool-toggle-label">
                                            <Search className="w-4 h-4 text-cyan-400" />
                                            <span>Google Search</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableGoogleSearch}
                                            onCheckedChange={googleTools.setEnableGoogleSearch}
                                        />
                                    </div>
                                    <div className="cm-mirror-pane__tool-toggle">
                                        <div className="cm-mirror-pane__tool-toggle-label">
                                            <Code2 className="w-4 h-4 text-cyan-400" />
                                            <span>Code Execution</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableCodeExecution}
                                            onCheckedChange={googleTools.setEnableCodeExecution}
                                        />
                                    </div>
                                    <div className="cm-mirror-pane__tool-toggle">
                                        <div className="cm-mirror-pane__tool-toggle-label">
                                            <MapPin className="w-4 h-4 text-cyan-400" />
                                            <span>Maps Grounding</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableMapsGrounding}
                                            onCheckedChange={googleTools.setEnableMapsGrounding}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                                            <Link className="w-3 h-3" />
                                            URL CONTEXT
                                        </Label>
                                        <Textarea
                                            value={googleTools.urlContextUrls}
                                            onChange={(event) => googleTools.setUrlContextUrls(event.target.value)}
                                            placeholder="One URL per line"
                                            className="min-h-[90px] bg-background/50 border-sidebar-border font-mono text-xs"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Optional Pricing */}
                            {optionalPricingSections.length > 0 && (
                                <div className="cm-mirror-pane__tool-group cm-mirror-pane__tool-group--fuchsia">
                                    <Label className="cm-mirror-pane__tool-group-label text-fuchsia-400">OPTIONAL PRICING</Label>
                                    <div className="space-y-2">
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
                                    {Object.entries(modelParams.params).map(([key, definition]) => (
                                        <div key={key} className="space-y-2">
                                            <Label className="text-xs font-mono text-muted-foreground">
                                                {key}
                                                {definition.required ? " *" : ""}
                                            </Label>
                                            {renderParamInput(
                                                key,
                                                definition,
                                                paramValues[key],
                                                (nextValue) => onParamValuesChange?.({ ...paramValues, [key]: nextValue }),
                                            )}
                                            {definition.description && (
                                                <p className="text-[11px] text-muted-foreground">{definition.description}</p>
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
