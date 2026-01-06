/**
 * Mirror Pane Component
 *
 * Side panel displaying model configuration, Google AI tools, and settings.
 * Designed to appear alongside the canvas as a permanent visible panel.
 * Follows styling patterns from agent-card.tsx and manowar-card.tsx.
 */
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";

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

export interface MirrorPaneProps {
    selectedModel: string;
    modelInfo: ModelInfo | null;
    isGoogleModel: boolean;
    systemPrompt: string;
    onSystemPromptChange: (value: string) => void;
    googleTools?: GoogleToolsState;
}

export function MirrorPane({
    selectedModel,
    modelInfo,
    isGoogleModel,
    systemPrompt,
    onSystemPromptChange,
    googleTools,
}: MirrorPaneProps) {
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
                <CardContent className="p-3 sm:p-4 md:p-5 flex flex-col gap-3 md:gap-4 flex-1 overflow-y-auto">
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

                    {/* Badges - Dynamic capabilities from backend (only show positive/affirmative) */}
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
                        <div className="flex-1 min-h-0 p-3 bg-background/50 border border-sidebar-border rounded-lg flex flex-col">
                            <div className="flex items-center gap-2 mb-3 shrink-0">
                                <Sparkles className="w-4 h-4 text-fuchsia-400" />
                                <span className="text-xs text-muted-foreground uppercase">Google AI Tools</span>
                            </div>
                            <div className="space-y-2 overflow-y-auto">
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
