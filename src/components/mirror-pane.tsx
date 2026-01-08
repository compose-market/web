/**
 * Mirror Pane Component
 *
 * Side panel displaying model configuration, Google AI tools, and settings.
 * Designed to appear alongside the canvas as a permanent visible panel.
 * Follows styling patterns from agent-card.tsx and manowar-card.tsx.
 * 
 * Features tabbed interface:
 * - Model Card: Model identity, capabilities, pricing, system prompt
 * - Optional Params: Dynamic parameters for image/video models
 */
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
    DollarSign,
    Layers,
    Search,
    Code2,
    MapPin,
    Link,
    Sparkles,
    Settings2,
    ChevronDown,
    ChevronRight,
    Sliders,
    LayoutGrid,
    Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModelInfo {
    id: string;
    name: string;
    source: string;
    ownedBy?: string;
    task?: string;
    description?: string;
    contextLength?: number;
    maxOutputTokens?: number;
    pricing?: {
        input: number;    // USD per million tokens
        output: number;   // USD per million tokens
        provider?: string;
    };
    // Model capabilities from backend - array of capability names (e.g., ["tools", "vision"])
    // Only positive/affirmative capabilities are included
    capabilities?: string[];
    inputModalities?: string[];
    outputModalities?: string[];
}

export interface GoogleToolsState {
    enableGoogleSearch: boolean;
    setEnableGoogleSearch: (v: boolean) => void;
    enableCodeExecution: boolean;
    setEnableCodeExecution: (v: boolean) => void;
    enableMapsGrounding: boolean;
    setEnableMapsGrounding: (v: boolean) => void;
    urlContextUrls: string;
    setUrlContextUrls: (v: string) => void;
}

// Model parameter schema (from backend paramsHandler)
export interface ParamDefinition {
    type: "string" | "integer" | "number" | "boolean" | "array";
    required: boolean;
    default?: string | number | boolean;
    options?: (string | number)[];
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
    modelInfo: ModelInfo | null;
    isGoogleModel: boolean;
    systemPrompt: string;
    onSystemPromptChange: (value: string) => void;
    googleTools?: GoogleToolsState;
    // Optional model params (for image/video models)
    modelParams?: ModelParamsSchema | null;
    paramValues?: Record<string, unknown>;
    onParamValuesChange?: (values: Record<string, unknown>) => void;
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
    // Tab state: 'model-card' or 'optional-params'
    const [activeTab, setActiveTab] = useState<"model-card" | "optional-params">("model-card");
    // Collapsible state for optional params section (legacy, kept for backwards compat)
    const [paramsExpanded, setParamsExpanded] = useState(true);

    // Check if we have optional params to show
    const hasOptionalParams = modelParams && Object.keys(modelParams.params).length > 0;

    if (!selectedModel) {
        return (
            <TooltipProvider>
                <Card className="glass-panel border-cyan-500/30 h-full flex flex-col overflow-hidden">
                    <CardContent className="p-4 sm:p-5 flex flex-col items-center justify-center flex-1 text-center">
                        <Cpu className="w-10 h-10 text-zinc-600 mb-3" />
                        <p className="text-sm text-zinc-500">Select a model to configure</p>
                    </CardContent>
                </Card>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider>
            <Card className="glass-panel border-cyan-500/30 h-full flex flex-col overflow-hidden">
                {/* Icon-only Tab Bar */}
                <div className="shrink-0 flex items-center gap-1 p-2 border-b border-sidebar-border bg-background/30">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setActiveTab("model-card")}
                                className={cn(
                                    "p-2 rounded-md transition-colors",
                                    activeTab === "model-card"
                                        ? "bg-cyan-500/20 text-cyan-400"
                                        : "text-muted-foreground hover:text-white hover:bg-zinc-800"
                                )}
                                aria-label="Model Card"
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Model Card</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setActiveTab("optional-params")}
                                className={cn(
                                    "p-2 rounded-md transition-colors",
                                    activeTab === "optional-params"
                                        ? "bg-fuchsia-500/20 text-fuchsia-400"
                                        : "text-muted-foreground hover:text-white hover:bg-zinc-800"
                                )}
                                aria-label="Optional Params"
                            >
                                <Settings className="w-4 h-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Optional Params</TooltipContent>
                    </Tooltip>
                </div>

                <CardContent className="p-3 sm:p-4 md:p-5 flex flex-col gap-3 md:gap-4 flex-1 overflow-y-auto">
                    {/* ==================== MODEL CARD TAB ==================== */}
                    {/* Shows ONLY registry schema data: name, provider, task, capabilities, pricing, context, description, owner */}
                    {activeTab === "model-card" && (
                        <>
                            {/* Header: Model Info */}
                            <div className="flex items-start gap-2 sm:gap-3">
                                <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg shrink-0">
                                    <Cpu className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-white truncate text-sm md:text-base">
                                        {modelInfo?.name || selectedModel}
                                    </h3>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {modelInfo?.source || "Unknown Provider"}
                                    </p>
                                </div>
                            </div>

                            {/* Badges - Dynamic capabilities from backend */}
                            <div className="flex flex-wrap gap-1.5">
                                {modelInfo?.task && (
                                    <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                                        <Layers className="w-3 h-3 mr-1" />
                                        {modelInfo.task}
                                    </Badge>
                                )}
                                {isGoogleModel && (
                                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
                                        <Sparkles className="w-3 h-3 mr-1" />
                                        Google AI
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("tools") && (
                                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                                        Tools
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("vision") && (
                                    <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                                        Vision
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("reasoning") && (
                                    <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">
                                        Reasoning
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("structured-outputs") && (
                                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                                        JSON
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("thinking") && (
                                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                                        Thinking
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("streaming") && (
                                    <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30 text-xs">
                                        Stream
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("code-execution") && (
                                    <Badge className="bg-lime-500/20 text-lime-400 border-lime-500/30 text-xs">
                                        Code Exec
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("search-grounding") && (
                                    <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 text-xs">
                                        Search
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("live-api") && (
                                    <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">
                                        Live API
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("embeddings") && (
                                    <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-xs">
                                        Embeddings
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("image-generation") && (
                                    <Badge className="bg-pink-500/20 text-pink-400 border-pink-500/30 text-xs">
                                        Image Gen
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("audio-generation") && (
                                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                                        Audio Gen
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("audio-understanding") && (
                                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                                        Audio In
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("video-understanding") && (
                                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                                        Video In
                                    </Badge>
                                )}
                                {modelInfo?.capabilities?.includes("agentic") && (
                                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                                        Agentic
                                    </Badge>
                                )}
                            </div>

                            {/* Stats Row - Pricing */}
                            {modelInfo?.pricing && (
                                <div className="grid grid-cols-2 gap-2 text-center">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                                <DollarSign className="w-4 h-4 text-green-400 mx-auto" />
                                                <p className="font-mono text-xs sm:text-sm text-green-400 mt-1">
                                                    ${modelInfo.pricing.input}/M
                                                </p>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>Input Token Price</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="p-2 bg-background/50 border border-sidebar-border rounded-lg cursor-default">
                                                <DollarSign className="w-4 h-4 text-fuchsia-400 mx-auto" />
                                                <p className="font-mono text-xs sm:text-sm text-fuchsia-400 mt-1">
                                                    ${modelInfo.pricing.output}/M
                                                </p>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>Output Token Price</TooltipContent>
                                    </Tooltip>
                                </div>
                            )}

                            {/* Context Window */}
                            {modelInfo?.contextLength && modelInfo.contextLength > 0 && (
                                <div className="text-center p-2 bg-background/30 border border-sidebar-border rounded-lg">
                                    <p className="text-xs text-muted-foreground">Context Window</p>
                                    <p className="font-mono text-sm text-cyan-400">
                                        {(modelInfo.contextLength / 1000).toFixed(0)}K tokens
                                    </p>
                                </div>
                            )}

                            {/* Model Description */}
                            {modelInfo?.description && (
                                <div className="p-2 bg-background/30 rounded text-xs text-muted-foreground line-clamp-3">
                                    {modelInfo.description}
                                </div>
                            )}

                            {/* Model Details Footer */}
                            {modelInfo && (
                                <div className="pt-3 border-t border-sidebar-border mt-auto shrink-0">
                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                        <span>Owner: <span className="text-cyan-400">{modelInfo.ownedBy}</span></span>
                                        {modelInfo.contextLength && (
                                            <span>Context: <span className="text-cyan-400">{(modelInfo.contextLength / 1000).toFixed(0)}K</span></span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* ==================== OPTIONAL PARAMS TAB ==================== */}
                    {/* Shows: System Prompt, Google Tools (for Google models), Dynamic Params (for image/video) */}
                    {activeTab === "optional-params" && (
                        <>
                            {/* System Prompt */}
                            <div className="p-3 bg-background/50 border border-sidebar-border rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                    <Settings2 className="w-4 h-4 text-cyan-400" />
                                    <Label className="text-xs text-muted-foreground uppercase">System Prompt</Label>
                                </div>
                                <Textarea
                                    value={systemPrompt}
                                    onChange={(e) => onSystemPromptChange(e.target.value)}
                                    placeholder="Define the AI's behavior..."
                                    className="bg-zinc-900 border-zinc-700 min-h-16 sm:min-h-20 text-sm"
                                />
                            </div>

                            {/* Google Tools Section */}
                            {isGoogleModel && googleTools && (
                                <div className="p-3 bg-background/50 border border-sidebar-border rounded-lg">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Sparkles className="w-4 h-4 text-fuchsia-400" />
                                        <span className="text-xs text-muted-foreground uppercase">Google AI Tools</span>
                                    </div>
                                    <div className="space-y-2">
                                        {/* Google Search */}
                                        <div className="flex items-center justify-between p-2 sm:p-3 bg-zinc-800/50 rounded-lg">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Search className="w-4 h-4 text-cyan-400 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-sm text-white">Google Search</p>
                                                    <p className="text-xs text-muted-foreground hidden sm:block">Ground with real-time search</p>
                                                </div>
                                            </div>
                                            <Switch
                                                checked={googleTools.enableGoogleSearch}
                                                onCheckedChange={googleTools.setEnableGoogleSearch}
                                            />
                                        </div>

                                        {/* Code Execution */}
                                        <div className="flex items-center justify-between p-2 sm:p-3 bg-zinc-800/50 rounded-lg">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Code2 className="w-4 h-4 text-green-400 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-sm text-white">Code Execution</p>
                                                    <p className="text-xs text-muted-foreground hidden sm:block">Execute Python for analysis</p>
                                                </div>
                                            </div>
                                            <Switch
                                                checked={googleTools.enableCodeExecution}
                                                onCheckedChange={googleTools.setEnableCodeExecution}
                                            />
                                        </div>

                                        {/* Maps Grounding */}
                                        <div className="flex items-center justify-between p-2 sm:p-3 bg-zinc-800/50 rounded-lg">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <MapPin className="w-4 h-4 text-fuchsia-400 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-sm text-white">Maps Grounding</p>
                                                    <p className="text-xs text-muted-foreground hidden sm:block">Ground with Google Maps</p>
                                                </div>
                                            </div>
                                            <Switch
                                                checked={googleTools.enableMapsGrounding}
                                                onCheckedChange={googleTools.setEnableMapsGrounding}
                                            />
                                        </div>

                                        {/* URL Context */}
                                        <div className="p-2 sm:p-3 bg-zinc-800/50 rounded-lg">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Link className="w-4 h-4 text-yellow-400 shrink-0" />
                                                <p className="text-sm text-white">URL Context</p>
                                            </div>
                                            <Textarea
                                                value={googleTools.urlContextUrls}
                                                onChange={(e) => googleTools.setUrlContextUrls(e.target.value)}
                                                placeholder="https://example.com/doc&#10;(one per line)"
                                                className="bg-zinc-900 border-zinc-700 min-h-12 text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Dynamic Model Parameters (for image/video models) */}
                            {hasOptionalParams && modelParams && (
                                <div className="p-3 bg-background/50 border border-sidebar-border rounded-lg">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Sliders className="w-4 h-4 text-fuchsia-400" />
                                        <span className="text-xs text-muted-foreground uppercase">Model Parameters</span>
                                        <Badge className="ml-auto bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-[10px]">
                                            {modelParams.type}
                                        </Badge>
                                    </div>
                                    <div className="space-y-3">
                                        {Object.entries(modelParams.params)
                                            .filter(([key]) => key !== "prompt")
                                            .map(([key, param]) => (
                                                <div key={key} className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-xs text-white/80 capitalize">
                                                            {key.replace(/_/g, " ")}
                                                        </Label>
                                                        {param.required && (
                                                            <span className="text-red-400 text-[10px]">*</span>
                                                        )}
                                                    </div>

                                                    {param.options && param.options.length > 0 ? (
                                                        <Select
                                                            value={String(paramValues[key] ?? param.default ?? "")}
                                                            onValueChange={(val) => {
                                                                const newVal = param.type === "integer" ? parseInt(val) : val;
                                                                onParamValuesChange?.({ ...paramValues, [key]: newVal });
                                                            }}
                                                        >
                                                            <SelectTrigger className="bg-zinc-900 border-zinc-700 h-8 text-xs">
                                                                <SelectValue placeholder={`Select ${key}`} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {param.options.map((opt) => (
                                                                    <SelectItem key={String(opt)} value={String(opt)}>
                                                                        {String(opt)}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    ) : param.type === "boolean" ? (
                                                        <Switch
                                                            checked={Boolean(paramValues[key] ?? param.default)}
                                                            onCheckedChange={(val) => {
                                                                onParamValuesChange?.({ ...paramValues, [key]: val });
                                                            }}
                                                        />
                                                    ) : param.type === "integer" || param.type === "number" ? (
                                                        <Input
                                                            type="number"
                                                            value={String(paramValues[key] ?? param.default ?? "")}
                                                            onChange={(e) => {
                                                                const val = param.type === "integer"
                                                                    ? parseInt(e.target.value)
                                                                    : parseFloat(e.target.value);
                                                                onParamValuesChange?.({ ...paramValues, [key]: isNaN(val) ? undefined : val });
                                                            }}
                                                            placeholder={param.default !== undefined ? String(param.default) : ""}
                                                            className="bg-zinc-900 border-zinc-700 h-8 text-xs"
                                                        />
                                                    ) : (
                                                        <Input
                                                            type="text"
                                                            value={String(paramValues[key] ?? param.default ?? "")}
                                                            onChange={(e) => {
                                                                onParamValuesChange?.({ ...paramValues, [key]: e.target.value || undefined });
                                                            }}
                                                            placeholder={param.description || `Enter ${key}`}
                                                            className="bg-zinc-900 border-zinc-700 h-8 text-xs"
                                                        />
                                                    )}

                                                    {param.description && (
                                                        <p className="text-[10px] text-muted-foreground">
                                                            {param.description}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}

export function MirrorPaneSkeleton() {
    return (
        <Card className="glass-panel border-cyan-500/30 h-full">
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                    <Skeleton className="w-10 h-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                </div>
                <Skeleton className="h-24" />
                <Skeleton className="h-32" />
            </CardContent>
        </Card>
    );
}
