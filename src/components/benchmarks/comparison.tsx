import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    ArrowRight,
    ExternalLink,
    Flame,
    Plus,
    Scale,
    Search,
    Trophy,
    X,
    Play,
    Zap,
} from "lucide-react";

import { Hint, ShellChip } from "@compose-market/theme/shell";
import { BenchmarkRadarChart } from "./radar";
import { FamilyLogo } from "./family";
import { useBenchmarks, useCompareModels } from "@/hooks/use-benchmarks";
import { useIsMobile } from "@/hooks/use-mobile";
import {
    benchmarkMetric,
    benchmarkMetricShortLabel,
    benchmarkOperationLabel,
    cleanBenchmarkDisplayName,
    cleanBenchmarkParameters,
    defaultComparisonModelIds,
    formatBenchmarkMetric,
} from "@/lib/benchmarks";
import type { ModelBenchmark } from "@/types/benchmarks";

export interface ModelComparisonViewProps {
    modelIds: string[];
    onModelIdsChange: (modelIds: string[]) => void;
    onSelectPlaygroundModel?: (modelId: string) => void;
}

export interface ModelComparisonDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialModelIds?: string[];
    onSelectPlaygroundModel?: (modelId: string) => void;
}

const MODEL_TONES = [
    { name: "cyan" as const, text: "text-cyan-400" },
    { name: "fuchsia" as const, text: "text-fuchsia-400" },
    { name: "emerald" as const, text: "text-emerald-400" },
    { name: "amber" as const, text: "text-amber-400" },
];

function modelTone(index: number) {
    return MODEL_TONES[index % MODEL_TONES.length];
}

function metricKeys(models: ModelBenchmark[]): string[] {
    const keys: string[] = [];
    for (const model of models) {
        for (const metric of model.metrics) {
            if (!keys.includes(metric.key)) keys.push(metric.key);
        }
    }
    return keys;
}

export function ModelComparisonView({
    modelIds,
    onModelIdsChange,
    onSelectPlaygroundModel,
}: ModelComparisonViewProps) {
    const [, setLocation] = useLocation();
    const { allModels, attribution, isLoading: indexLoading } = useBenchmarks({ enabled: true });

    const { data: comparison, isLoading: comparisonLoading } = useCompareModels(modelIds, {
        enabled: modelIds.length > 0,
    });

    const [pickerOpen, setPickerOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const isMobile = useIsMobile();

    const models = comparison?.models ?? [];
    const operation = models[0]?.operation;
    const compatibleModels = useMemo(() => {
        if (!operation) return allModels;
        return allModels.filter((model) => model.operation === operation);
    }, [allModels, operation]);

    const selectedSet = new Set(modelIds.map((id) => id.toLowerCase()));
    const keys = metricKeys(models);
    const isLoading = indexLoading || comparisonLoading;

    // Filter candidate models for searchable selector
    const filteredCandidates = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return compatibleModels
            .filter((model) => !selectedSet.has(model.sourceId.toLowerCase()) && !selectedSet.has(model.modelId.toLowerCase()))
            .filter((model) => {
                if (!query) return true;
                const cleanName = cleanBenchmarkDisplayName(model).toLowerCase();
                const family = (model.family || "").toLowerCase();
                const provider = (model.provider || "").toLowerCase();
                return cleanName.includes(query) || family.includes(query) || provider.includes(query);
            });
    }, [compatibleModels, selectedSet, searchQuery]);

    // Suggest top frontier rival for quick-add
    const topFrontierRival = useMemo(() => {
        return compatibleModels.find((m) =>
            m.isFrontier &&
            !selectedSet.has(m.sourceId.toLowerCase()) &&
            !selectedSet.has(m.modelId.toLowerCase())
        );
    }, [compatibleModels, selectedSet]);

    const handleAddModel = (modelId: string) => {
        if (modelIds.length < 4) {
            onModelIdsChange([...modelIds, modelId]);
            setPickerOpen(false);
            setSearchQuery("");
        }
    };

    const handleRemoveModel = (modelId: string) => {
        if (modelIds.length > 1) {
            onModelIdsChange(modelIds.filter((id) => id.toLowerCase() !== modelId.toLowerCase()));
        }
    };

    const handleLaunch = (modelId: string) => {
        if (onSelectPlaygroundModel) {
            onSelectPlaygroundModel(modelId);
        } else {
            setLocation(`/playground?model=${encodeURIComponent(modelId)}`);
        }
    };

    // Folded chips: always a single row — 3 visible + "+N" on web, 1 + "+N" on mobile
    const chipVisibleCount = isMobile ? 1 : 3;
    const visibleModels = models.slice(0, chipVisibleCount);
    const foldedModels = models.slice(chipVisibleCount);

    return (
        <div className="cm-benchmarks-battle">
            {/* Model Selection Toolbar — snap target so scrolling back up always works */}
            <div className="cm-benchmarks-battle__models-rail cm-benchmarks-snap-block">
                <div className="cm-benchmarks-battle__chips">
                    {visibleModels.map((model, index) => {
                        const tone = modelTone(index);
                        const cleanName = cleanBenchmarkDisplayName(model);
                        const cleanParams = cleanBenchmarkParameters(model.parameters);
                        return (
                            <ShellChip
                                key={`${model.operation}:${model.variant ?? "default"}:${model.sourceId}`}
                                label={cleanName}
                                count={cleanParams.length > 0 ? `(${cleanParams.join(", ")})` : undefined}
                                tone={tone.name}
                                onRemove={modelIds.length > 1 ? () => handleRemoveModel(model.sourceId) : undefined}
                            />
                        );
                    })}

                    {/* Folded models overflow menu */}
                    {foldedModels.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    className="cm-benchmarks-battle__fold"
                                    aria-label={`${foldedModels.length} more compared models`}
                                >
                                    +{foldedModels.length}
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" sideOffset={8} className="cm-control-menu">
                                {foldedModels.map((model) => {
                                    const cleanName = cleanBenchmarkDisplayName(model);
                                    return (
                                        <DropdownMenuItem
                                            key={`${model.operation}:${model.variant ?? "default"}:${model.sourceId}`}
                                            className="cm-control-menu__item"
                                            disabled={modelIds.length <= 1}
                                            onSelect={() => handleRemoveModel(model.sourceId)}
                                        >
                                            <span className="cm-control-menu__label">{cleanName}</span>
                                            <X className="w-3 h-3 ml-auto text-muted-foreground" />
                                        </DropdownMenuItem>
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                <div className="flex items-center gap-2 flex-nowrap ml-auto shrink-0">
                    {/* Quick Add Top Rival — wide screens only (keeps the single-row rail on mobile) */}
                    {!isMobile && topFrontierRival && modelIds.length < 4 && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddModel(topFrontierRival.sourceId)}
                            className="h-7 text-xs font-mono border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/10 gap-1"
                        >
                            <Zap className="w-3 h-3 text-fuchsia-400" />
                            <span>+ vs {cleanBenchmarkDisplayName(topFrontierRival)}</span>
                        </Button>
                    )}

                    {/* Searchable Competitor Selector */}
                    {modelIds.length < 4 && compatibleModels.length > modelIds.length && (
                        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs font-mono bg-background/60 border-primary/30 gap-1 text-cyan-300 hover:bg-cyan-500/10"
                                >
                                    <Plus className="w-3 h-3 text-cyan-400" />
                                    <span>{isMobile ? `${modelIds.length}/4` : `Add Competitor (${modelIds.length}/4)`}</span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 p-2 bg-background/95 backdrop-blur-xl border-primary/30 font-mono text-xs shadow-2xl">
                                <div className="relative mb-2">
                                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                                    <Input
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search models to compare..."
                                        className="h-8 pl-8 text-xs font-mono bg-background/80 border-primary/20"
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                                    {filteredCandidates.map((candidate) => {
                                        const cleanName = cleanBenchmarkDisplayName(candidate);
                                        return (
                                            <button
                                                key={`${candidate.operation}:${candidate.variant ?? "default"}:${candidate.sourceId}`}
                                                type="button"
                                                onClick={() => handleAddModel(candidate.sourceId)}
                                                className="w-full flex items-center justify-between p-1.5 px-2 rounded-md hover:bg-primary/10 text-left transition-colors"
                                            >
                                                <div className="flex items-center gap-1.5 truncate">
                                                    {candidate.isFrontier && <Flame className="w-3 h-3 text-fuchsia-400 shrink-0" />}
                                                    <span className="font-semibold text-foreground truncate">{cleanName}</span>
                                                </div>
                                                <span className="text-xs text-muted-foreground uppercase shrink-0 flex items-center gap-1">
                                                    <FamilyLogo family={candidate.family} />
                                                    {candidate.family}
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {filteredCandidates.length === 0 && (
                                        <div className="py-4 text-center text-muted-foreground text-xs">
                                            No matching candidate models found
                                        </div>
                                    )}
                                </div>
                            </PopoverContent>
                        </Popover>
                    )}
                </div>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 font-mono text-xs text-muted-foreground">
                    <div className="w-7 h-7 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                    <p>Calculating multi-dimensional comparison...</p>
                </div>
            )}

            {!isLoading && models.length > 0 && comparison && (
                <>
                    {/* Winner Podium Cards */}
                    <div className="cm-benchmarks-battle__podium cm-benchmarks-snap-block">
                        {keys.filter((key) => models.some((model) => benchmarkMetric(model, key)?.headline)).map((key) => {
                            const winner = comparison.winners[key];
                            if (!winner) return null;
                            const winningModel = models.find((model) => model.sourceId === winner.modelId || model.modelId === winner.modelId);
                            const metric = winningModel ? benchmarkMetric(winningModel, key) : null;
                            const cleanName = cleanBenchmarkDisplayName(winningModel);

                            return (
                                <div key={key} className="cm-benchmarks-battle__podium-card">
                                    <div className="flex items-center justify-between text-xs text-cyan-400 font-bold">
                                        <Hint label={metric?.label ?? key}>
                                            <span>{benchmarkMetricShortLabel(metric ?? { key, label: key })}</span>
                                        </Hint>
                                        <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                    </div>
                                    <p className="font-bold text-foreground text-xs truncate">
                                        {cleanName}
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <Badge className="w-fit bg-cyan-500/20 text-cyan-300 border-cyan-500/40 text-xs py-0 px-1.5 font-mono">
                                            {formatBenchmarkMetric(metric)}
                                        </Badge>
                                        <span className="text-xs text-emerald-400 font-bold">Leader</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Radar capability chart */}
                    {comparison.radarData.length > 1 && (
                        <div className="cm-benchmarks-battle__radar-card cm-benchmarks-snap-block p-3.5 rounded-xl bg-background/30 border border-primary/15">
                            <div className="flex items-center justify-between mb-1 text-xs font-mono">
                                <span className="font-bold text-foreground">Relative Capability Profile</span>
                                <span className="text-xs text-muted-foreground">Normalized / 100 among candidates</span>
                            </div>
                            <BenchmarkRadarChart data={comparison.radarData} models={models} height="clamp(12.5rem, 30cqb, 18.75rem)" />
                        </div>
                    )}

                    {/* Detailed Metric Breakdown Matrix */}
                    <div className="cm-benchmarks-battle__matrix cm-benchmarks-snap-block">
                        <table>
                            <caption className="sr-only">Head-to-head model benchmark comparison</caption>
                            <thead>
                                <tr className="border-b border-primary/20 text-muted-foreground text-xs bg-background/80">
                                    <th scope="col">Benchmarks</th>
                                    {models.map((model, index) => {
                                        const cleanName = cleanBenchmarkDisplayName(model);
                                        const cleanParams = cleanBenchmarkParameters(model.parameters);
                                        return (
                                            <th scope="col" key={`${model.variant ?? "default"}:${model.sourceId}`} className={`font-bold ${modelTone(index).text}`}>
                                                <div>{cleanName}</div>
                                                {cleanParams.length > 0 && (
                                                    <div className="text-xs font-normal text-muted-foreground">{cleanParams.join(", ")}</div>
                                                )}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-primary/10">
                                {keys.map((key) => {
                                    const winner = comparison.winners[key];
                                    return (
                                        <tr key={key} className="hover:bg-muted/20">
                                            <th scope="row" className="font-medium text-foreground">
                                                {(() => {
                                                    const metric = models.map((model) => benchmarkMetric(model, key)).find(Boolean) ?? null;
                                                    return (
                                                        <Hint label={metric?.label ?? key}>
                                                            <span>{benchmarkMetricShortLabel(metric ?? { key, label: key })}</span>
                                                        </Hint>
                                                    );
                                                })()}
                                            </th>
                                            {models.map((model) => {
                                                const metric = benchmarkMetric(model, key);
                                                const isWinner = winner?.modelId === model.sourceId;
                                                return (
                                                    <td key={`${key}:${model.sourceId}:${model.variant ?? "default"}`} className="font-medium">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={isWinner ? "text-cyan-300 font-bold" : "text-foreground"}>
                                                                {formatBenchmarkMetric(metric)}
                                                            </span>
                                                            {isWinner && <Trophy className="w-3 h-3 text-amber-400 shrink-0" />}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                                <tr className="bg-background/90">
                                    <th scope="row" className="font-medium text-foreground">Playground</th>
                                    {models.map((model) => (
                                        <td key={`action:${model.sourceId}:${model.variant ?? "default"}`}>
                                            <Button
                                                size="sm"
                                                onClick={() => handleLaunch(model.modelId)}
                                                className="h-7 text-xs font-mono bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 gap-1"
                                            >
                                                <Play className="w-3 h-3 fill-current" />
                                                <span>Test</span>
                                            </Button>
                                        </td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {!isLoading && models.length === 0 && (
                <div className="py-14 text-center font-mono text-xs text-muted-foreground border border-dashed border-primary/20 rounded-xl">
                    Select models from the Leaderboard or Visual Frontiers to start a Head-to-Head comparison.
                </div>
            )}
        </div>
    );
}

export function ModelComparisonDialog({
    open,
    onOpenChange,
    initialModelIds = [],
    onSelectPlaygroundModel,
}: ModelComparisonDialogProps) {
    const [selectedIds, setSelectedIds] = useState<string[]>(initialModelIds);
    const { allModels, attribution } = useBenchmarks({ enabled: open });

    const requestedKey = initialModelIds.join(",");
    useEffect(() => {
        if (!open) return;
        const requested = initialModelIds.filter(Boolean);
        const defaults = defaultComparisonModelIds(requested[0] ?? null, allModels);
        setSelectedIds([...new Set([...requested, ...defaults])].slice(0, 4));
    }, [allModels, open, requestedKey]);

    const handleLaunch = (modelId: string) => {
        onOpenChange(false);
        if (onSelectPlaygroundModel) {
            onSelectPlaygroundModel(modelId);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100dvi-2rem)] max-w-4xl max-h-[92dvh] flex flex-col p-0 bg-background/95 backdrop-blur-xl border border-cyan-500/30 shadow-2xl overflow-hidden font-sans">
                <DialogHeader className="p-4 sm:p-5 border-b border-border/50 bg-background/60">
                    <DialogTitle className="font-display font-bold text-lg sm:text-xl text-foreground flex items-center gap-2">
                        <Scale className="w-5 h-5 text-cyan-400" />
                        <span>Head-to-Head Model Comparison</span>
                    </DialogTitle>
                    <DialogDescription className="font-mono text-xs text-muted-foreground mt-1">
                        Independent multi-metric performance and cost battle matrix
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                    <ModelComparisonView
                        modelIds={selectedIds}
                        onModelIdsChange={setSelectedIds}
                        onSelectPlaygroundModel={handleLaunch}
                    />
                </div>

                <div className="p-3 px-5 border-t border-border/50 bg-background/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-muted-foreground">
                    <span>
                        Data provided by{" "}
                        <a
                            href={attribution?.url ?? "https://artificialanalysis.ai"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline inline-flex items-center gap-1"
                        >
                            {attribution?.source ?? "Artificial Analysis"}
                            <ExternalLink className="w-3 h-3" />
                        </a>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs font-mono">
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
