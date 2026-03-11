import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
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
            <div className="flex items-center justify-between rounded-sm border border-sidebar-border bg-background/30 px-3 py-2">
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
            <TooltipProvider>
                <Card className="glass-panel border-cyan-500/30 h-full flex flex-col overflow-hidden">
                    <CardContent className="p-4 sm:p-5 flex flex-col items-center justify-center flex-1 text-center">
                        <Cpu className="w-10 h-10 text-zinc-600 mb-3" />
                        <p className="text-sm text-zinc-500">Select a model to inspect pricing, limits, and settings</p>
                    </CardContent>
                </Card>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider>
            <Card className="glass-panel border-cyan-500/30 h-full flex flex-col overflow-hidden">
                <div className="shrink-0 flex items-center gap-1 p-2 border-b border-sidebar-border bg-background/30">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setActiveTab("details")}
                                className={cn(
                                    "p-2 rounded-md transition-colors",
                                    activeTab === "details"
                                        ? "bg-cyan-500/20 text-cyan-400"
                                        : "text-muted-foreground hover:text-white hover:bg-zinc-800",
                                )}
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
                                className={cn(
                                    "p-2 rounded-md transition-colors",
                                    activeTab === "settings"
                                        ? "bg-fuchsia-500/20 text-fuchsia-400"
                                        : "text-muted-foreground hover:text-white hover:bg-zinc-800",
                                )}
                                aria-label="Settings"
                            >
                                <Settings className="w-4 h-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Settings</TooltipContent>
                    </Tooltip>
                </div>

                <CardContent className="p-3 sm:p-4 md:p-5 flex flex-col gap-4 flex-1 overflow-y-auto">
                    {activeTab === "details" && (
                        <>
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg shrink-0">
                                    <Cpu className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h3 className="font-semibold text-white truncate text-sm md:text-base">
                                        {modelInfo?.name || selectedModel}
                                    </h3>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {modelInfo?.provider || "unknown"}
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                                {typeValues.map((typeValue) => (
                                    <Badge key={typeValue} className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                                        {formatModelTypeLabel(typeValue)}
                                    </Badge>
                                ))}
                            </div>

                            {modelInfo && (
                                <div className="space-y-3 text-xs">
                                    <div className="rounded-sm border border-sidebar-border bg-background/30 p-3 space-y-3">
                                        <div>
                                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Model ID</span>
                                            <div className="font-mono text-cyan-400 break-all">{modelInfo.modelId}</div>
                                        </div>
                                        <div>
                                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Input</span>
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
                                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Output</span>
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
                                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Context Window</span>
                                            <div className="mt-1 space-y-1">
                                                {contextEntries.length > 0 ? contextEntries.map((entry) => (
                                                    <div key={`context-${entry.label}`} className="flex items-center justify-between gap-3 font-mono">
                                                        <span className="text-muted-foreground">{entry.label}</span>
                                                        <span className="text-foreground text-right">{entry.value}</span>
                                                    </div>
                                                )) : (
                                                    <span className="text-muted-foreground">Not provided</span>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Pricing</span>
                                            <div className="mt-2 space-y-2">
                                                {pricingSections.length > 0 ? pricingSections.map((section, index) => (
                                                    <div key={`${section.header}-${index}`} className="rounded-sm border border-sidebar-border bg-background/40 p-2 space-y-1.5">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="font-mono text-cyan-400">{section.header}</span>
                                                            {section.unit && (
                                                                <Badge variant="outline" className="text-[10px] border-sidebar-border">
                                                                    {section.unit}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        {section.entries.map((entry) => (
                                                            <div key={`${section.header}-${entry.label}`} className="flex items-center justify-between gap-3 font-mono">
                                                                <span className="text-muted-foreground">{entry.label}</span>
                                                                <span className="text-foreground text-right">{entry.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )) : (
                                                    <span className="text-muted-foreground">No pricing metadata</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {modelInfo.description && (
                                        <div className="rounded-sm border border-sidebar-border bg-background/30 p-3 text-muted-foreground leading-relaxed">
                                            {modelInfo.description}
                                        </div>
                                    )}
                                </div>
                            )}

                        </>
                    )}

                    {activeTab === "settings" && (
                        <div className="space-y-3">
                            <div className="space-y-2">
                                <Label className="text-xs font-mono text-muted-foreground">SYSTEM PROMPT</Label>
                                <Textarea
                                    value={systemPrompt}
                                    onChange={(event) => onSystemPromptChange(event.target.value)}
                                    placeholder="Optional system prompt..."
                                    className="min-h-[120px] bg-background/50 border-sidebar-border font-mono text-xs"
                                />
                            </div>

                            {isGoogleModel && googleTools && (
                                <div className="space-y-3 rounded-sm border border-cyan-500/20 bg-cyan-500/5 p-3">
                                    <div className="text-xs font-mono text-cyan-400">GEMINI TOOLS</div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm">
                                            <Search className="w-4 h-4 text-cyan-400" />
                                            <span>Google Search</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableGoogleSearch}
                                            onCheckedChange={googleTools.setEnableGoogleSearch}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm">
                                            <Code2 className="w-4 h-4 text-cyan-400" />
                                            <span>Code Execution</span>
                                        </div>
                                        <Switch
                                            checked={googleTools.enableCodeExecution}
                                            onCheckedChange={googleTools.setEnableCodeExecution}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm">
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

                            {optionalPricingSections.length > 0 && (
                                <div className="space-y-2 rounded-sm border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
                                    <Label className="text-xs font-mono text-fuchsia-400">OPTIONAL PRICING</Label>
                                    <div className="space-y-2">
                                        {optionalPricingSections.map((section, index) => (
                                            <div key={`${section.header}-${section.unit}-${index}`} className="rounded-sm border border-sidebar-border bg-background/40 p-2 space-y-1.5">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="font-mono text-fuchsia-300">{section.header}</span>
                                                    {section.unit && (
                                                        <Badge variant="outline" className="text-[10px] border-sidebar-border">
                                                            {section.unit}
                                                        </Badge>
                                                    )}
                                                </div>
                                                {section.entries.map((entry) => (
                                                    <div key={`${section.header}-${entry.label}`} className="flex items-center justify-between gap-3 font-mono text-xs">
                                                        <span className="text-muted-foreground">{entry.label}</span>
                                                        <span className="text-foreground text-right">{entry.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {!hasOptionalParams && optionalPricingSections.length === 0 && (
                                <div className="rounded-sm border border-sidebar-border bg-background/30 p-4 text-sm text-muted-foreground">
                                    No optional parameters exposed for this model.
                                </div>
                            )}

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
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}

export function MirrorPaneSkeleton() {
    return (
        <Card className="glass-panel border-cyan-500/30 h-full">
            <CardContent className="p-4 text-sm text-muted-foreground">
                Loading model details...
            </CardContent>
        </Card>
    );
}
