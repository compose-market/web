/**
 * Benchmarks Explorer Component
 *
 * Built strictly on Compose.Market core shell architecture:
 * - Uses shared `Switcher`, `SearchFold`, and `Ordering` from `@/components/control`
 * - Uses `@compose-market/theme` workspace layout (`cm-market-workspace`, `cm-control-rail`, `cm-market-tab-panel--scroll`)
 * - Responsive mobile-native dropdowns and responsive card grids with zero reinvented wheels
 */

import { useState, useMemo, useEffect, useDeferredValue, useRef } from "react";
import { useLocation } from "wouter";
import {
    Dialog,
    DialogContent,
} from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Trophy,
    Sparkles,
    Zap,
    DollarSign,
    Clock,
    ExternalLink,
    Scale,
    Flame,
    ArrowUpDown,
    Check,
    Activity,
    Plus,
    X,
    Play,
    Bot,
    Code,
    GripVertical,
    ChevronDown,
} from "lucide-react";
import { Hint } from "@compose-market/theme/shell";
import { Ordering, SearchFold, Switcher, type Option } from "@/components/control";
import { BenchmarkScatterPlot } from "./scatterplot";
import { ModelComparisonView } from "./comparison";
import { FamilyLogo } from "./family";
import { useBenchmarks } from "@/hooks/use-benchmarks";
import { useIsMobile } from "@/hooks/use-mobile";
import {
    BENCHMARK_OPERATION_OPTIONS,
    benchmarkMetric,
    benchmarkMetricShortLabel,
    benchmarkOperationLabel,
    cleanBenchmarkDisplayName,
    cleanBenchmarkParameters,
    compareBenchmarkModels,
    defaultComparisonModelIds,
    formatBenchmarkMetric,
} from "@/lib/benchmarks";
import type { BenchmarkOperation, ModelBenchmark } from "@/types/benchmarks";

export interface BenchmarksExplorerProps {
    variant?: "page" | "dialog";
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    initialTab?: "leaderboard" | "frontiers" | "battle";
    initialCompareModelIds?: string[];
    initialFamily?: string;
    initialOperation?: BenchmarkOperation;
    initialFrontierOnly?: boolean;
    onSelectModel?: (modelId: string) => void;
}

type SortField = "primary" | "intelligence" | "speed" | "ttft" | "costPerTask" | "coding" | "agentic";

const SORT_OPTIONS: Option<SortField>[] = [
    { value: "primary", label: "Default Rank", icon: Trophy },
    { value: "intelligence", label: "Intelligence", icon: Sparkles },
    { value: "speed", label: "Output Speed", icon: Zap },
    { value: "ttft", label: "Latency (TTFT)", icon: Clock },
    { value: "costPerTask", label: "Cost / Task", icon: DollarSign },
    { value: "coding", label: "Coding Score", icon: Code },
    { value: "agentic", label: "Agentic Index", icon: Bot },
];

export function BenchmarksExplorer({
    variant = "page",
    open = true,
    onOpenChange,
    initialTab = "leaderboard",
    initialCompareModelIds = [],
    initialFamily = "all",
    initialOperation = "chat",
    initialFrontierOnly = true,
    onSelectModel,
}: BenchmarksExplorerProps) {
    const [, setLocation] = useLocation();
    const [activeTab, setActiveTab] = useState<"leaderboard" | "frontiers" | "battle">(initialTab);
    const [frontierOnly, setFrontierOnly] = useState(initialFrontierOnly);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const deferredSearch = useDeferredValue(searchQuery);

    const [selectedFamily, setSelectedFamily] = useState(initialFamily);
    const [selectedOperation, setSelectedOperation] = useState<BenchmarkOperation>(initialOperation);
    const [sortField, setSortField] = useState<SortField>("primary");
    const [sortAsc, setSortAsc] = useState(false);

    const [compareModelIds, setCompareModelIds] = useState<string[]>(initialCompareModelIds);
    const [expandedCardKey, setExpandedCardKey] = useState<string | null>(null);

    const isMobile = useIsMobile();

    const {
        models,
        allModels,
        isLoading,
        operationCounts,
        attribution,
    } = useBenchmarks({
        enabled: open,
        frontierOnly,
        search: deferredSearch,
        family: selectedFamily,
        operation: selectedOperation,
    });

    useEffect(() => {
        if (!open || compareModelIds.length > 0) return;
        setCompareModelIds(defaultComparisonModelIds(
            null,
            allModels.filter((model) => model.operation === selectedOperation),
        ));
    }, [allModels, compareModelIds.length, open, selectedOperation]);

    const changeOperation = (operation: BenchmarkOperation) => {
        setSelectedOperation(operation);
        setSelectedFamily("all");
        setCompareModelIds([]);
        setSortField("primary");
        setSortAsc(false);
    };

    // Sort models — missing values always sort last, deterministic tie-break matches API
    const sortedModels = useMemo(() => {
        if (sortField === "primary") {
            return [...models].sort((left, right) => {
                const result = compareBenchmarkModels(left, right);
                return sortAsc ? -result : result;
            });
        }
        return [...models].sort((a, b) => {
            const valA = benchmarkMetric(a, sortField)?.value ?? null;
            const valB = benchmarkMetric(b, sortField)?.value ?? null;
            if (valA == null && valB == null) {
                return (a.name || a.modelId).localeCompare(b.name || b.modelId);
            }
            if (valA == null) return 1;
            if (valB == null) return -1;
            const diff = sortAsc ? valA - valB : valB - valA;
            if (diff !== 0) return diff;
            return (a.name || a.modelId).localeCompare(b.name || b.modelId);
        });
    }, [models, sortField, sortAsc]);

    const selectSortField = (field: SortField) => {
        setSortField(field);
        if (field === "primary") {
            setSortAsc(false);
            return;
        }
        const metric = models.map((model) => benchmarkMetric(model, field)).find(Boolean);
        setSortAsc(metric?.direction === "lower");
    };

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortAsc(!sortAsc);
        } else {
            selectSortField(field);
        }
    };

    const toggleCompareModel = (modelId: string) => {
        if (compareModelIds.includes(modelId)) {
            if (compareModelIds.length > 1) {
                setCompareModelIds(compareModelIds.filter((id) => id !== modelId));
            }
        } else {
            if (compareModelIds.length < 4) {
                setCompareModelIds([...compareModelIds, modelId]);
            }
        }
    };

    const handleLaunchPlayground = (modelId: string) => {
        if (onOpenChange) onOpenChange(false);
        if (onSelectModel) {
            onSelectModel(modelId);
        } else {
            setLocation(`/playground?model=${encodeURIComponent(modelId)}`);
        }
    };

    const resetFilters = () => {
        setSearchQuery("");
        setSelectedFamily("all");
        setFrontierOnly(false);
        setSortField("primary");
        setSortAsc(false);
    };

    // View options for Switcher (Leaderboard, Frontiers, Battle)
    const viewOptions = useMemo<Option<"leaderboard" | "frontiers" | "battle">[]>(() => {
        return [
            { value: "leaderboard", label: "Leaderboard", icon: Trophy, count: String(models.length) },
            { value: "frontiers", label: "Frontiers", icon: Activity },
            { value: "battle", label: "Battle", icon: Scale, count: compareModelIds.length > 0 ? String(compareModelIds.length) : undefined },
        ];
    }, [models.length, compareModelIds.length]);

    const metricKeys = useMemo(() => {
        const preferred = models[0]?.operation === "chat"
            ? ["intelligence", "coding", "agentic", "speed", "ttft", "costPerTask"]
            : models[0]?.metrics.filter((metric) => metric.headline).map((metric) => metric.key) ?? [];
        return preferred.filter((key) => models.some((model) => benchmarkMetric(model, key)?.value != null));
    }, [models]);

    // Compared models resolved for the dock: 3 visible pills on web, 1 on mobile, "+N" overflow menu
    const comparedModels = useMemo(() => {
        return compareModelIds.map((id) => {
            const model = allModels.find((entry) => entry.sourceId === id || entry.modelId === id);
            return { id, label: cleanBenchmarkDisplayName(model || id) };
        });
    }, [compareModelIds, allModels]);
    const dockVisibleCount = isMobile ? 1 : 3;
    const dockVisible = comparedModels.slice(0, dockVisibleCount);
    const dockOverflow = comparedModels.slice(dockVisibleCount);

    // Draggable compare dock — grab anywhere on the bar except its buttons.
    // Offset is clamped to the viewport so the dock can never be lost.
    // The grip folds the dock down to a draggable scale icon (and back).
    const dockRef = useRef<HTMLElement | null>(null);
    const dockDrag = useRef<{
        startX: number;
        startY: number;
        baseX: number;
        baseY: number;
        minDx: number;
        maxDx: number;
        minDy: number;
        maxDy: number;
    } | null>(null);
    const dockMoved = useRef(false);
    const [dockOffset, setDockOffset] = useState({ x: 0, y: 0 });
    const [dockFolded, setDockFolded] = useState(false);

    const handleDockPointerDown = (event: React.PointerEvent<HTMLElement>, allowFromControl = false) => {
        if (!allowFromControl && (event.target as HTMLElement).closest("button, a, input, [role='button']")) return;
        const dock = dockRef.current;
        const rect = dock?.getBoundingClientRect();
        if (!dock || !rect) return;
        const margin = 8;
        dockMoved.current = false;
        dockDrag.current = {
            startX: event.clientX,
            startY: event.clientY,
            baseX: dockOffset.x,
            baseY: dockOffset.y,
            minDx: margin - rect.left,
            maxDx: window.innerWidth - margin - rect.right,
            minDy: margin - rect.top,
            maxDy: window.innerHeight - margin - rect.bottom,
        };
        dock.setPointerCapture(event.pointerId);
        dock.setAttribute("data-dragging", "true");
    };

    const handleDockPointerMove = (event: React.PointerEvent<HTMLElement>) => {
        const drag = dockDrag.current;
        if (!drag) return;
        const rawDx = event.clientX - drag.startX;
        const rawDy = event.clientY - drag.startY;
        if (Math.hypot(rawDx, rawDy) > 4) dockMoved.current = true;
        const dx = Math.min(drag.maxDx, Math.max(drag.minDx, rawDx));
        const dy = Math.min(drag.maxDy, Math.max(drag.minDy, rawDy));
        setDockOffset({ x: drag.baseX + dx, y: drag.baseY + dy });
    };

    const handleDockPointerUp = (event: React.PointerEvent<HTMLElement>) => {
        if (!dockDrag.current) return;
        dockDrag.current = null;
        dockRef.current?.releasePointerCapture(event.pointerId);
        dockRef.current?.removeAttribute("data-dragging");
    };

    // Folded icon click unfolds — unless the press was actually a drag.
    const handleDockFoldedClick = () => {
        if (dockMoved.current) {
            dockMoved.current = false;
            return;
        }
        setDockFolded(false);
    };

    const content = (
        <div className="cm-market-workspace cm-benchmarks-workspace">
            {/* ── Top-Level Control Rail: Canonical // BENCHMARKS Title + Switcher ── */}
            <div className="cm-control-rail cm-market-control-rail">
                <div className="cm-market-control-rail__brand">
                    <h1 className="cm-page-header__title cm-market-control-rail__title">
                        <span className="text-fuchsia-500 mr-1.5">//</span>
                        BENCHMARKS
                    </h1>
                </div>

                <Switcher
                    value={activeTab}
                    options={viewOptions}
                    label="Benchmarks section"
                    onChange={setActiveTab}
                    className="cm-market-control-rail__tabs"
                />

                <div className="cm-market-control-rail__actions">
                    {/* Expandable Search Bar */}
                    <SearchFold
                        open={searchOpen}
                        value={searchQuery}
                        label="Search benchmarks"
                        placeholder="Search models or families..."
                        onOpenChange={setSearchOpen}
                        onChange={setSearchQuery}
                    />
                    {/* Ordering Dropdown */}
                    <Ordering
                        value={sortField}
                        options={SORT_OPTIONS}
                        onChange={(val) => selectSortField(val as SortField)}
                        label="Sort criteria"
                    />
                </div>
            </div>

            {/* ── Main Content Cell — contains sub-toolbar + tab panels ── */}
            <div className="cm-playground__chat-cell cm-benchmarks-content-cell">
                {/* ── Sub-toolbar: Modality selector + Frontier micro-toggle ── */}
                <div className="cm-playground__chat-toolbar cm-benchmarks__filter-toolbar">
                    {/* Modality Dropdown */}
                    <Select value={selectedOperation} onValueChange={(v) => changeOperation(v as BenchmarkOperation)}>
                        <SelectTrigger className="cm-benchmarks__modality-select h-8 text-xs font-mono bg-background/60 border-primary/20 px-2.5" aria-label="Select Modality">
                            <SelectValue placeholder="Modality" />
                        </SelectTrigger>
                        <SelectContent className="font-mono text-xs bg-background/95 border-border max-h-[38dvh]">
                            {BENCHMARK_OPERATION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label} ({operationCounts[opt.value] ?? 0})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* Micro Frontier Toggle */}
                    <button
                        type="button"
                        onClick={() => setFrontierOnly(!frontierOnly)}
                        className={`h-8 px-2.5 text-xs font-mono rounded-full border inline-flex items-center gap-1.5 transition-all cursor-pointer ${frontierOnly
                            ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/50 shadow-sm shadow-fuchsia-500/25"
                            : "bg-background/40 text-muted-foreground border-primary/20 hover:text-foreground"
                            }`}
                        title="Toggle frontier-only models"
                    >
                        <Flame className={`w-3.5 h-3.5 ${frontierOnly ? "text-fuchsia-400" : "opacity-60"}`} />
                        <span>Frontier</span>
                    </button>
                </div>

                {/* ── Tab Panels: Snap-scrolling container ── */}
                <Tabs value={activeTab} className="cm-market-tabs w-full">
                    {/* Tab 1: Leaderboard */}
                    <TabsContent value="leaderboard" className="cm-market-tab-panel cm-market-tab-panel--scroll mt-0 flex-1 min-h-0">
                        {isLoading && (
                            <div className="flex flex-col items-center justify-center py-24 text-center space-y-3 font-mono text-xs text-muted-foreground">
                                <div className="w-7 h-7 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                                <p>Loading benchmarks...</p>
                            </div>
                        )}

                        {!isLoading && sortedModels.length === 0 && (
                            <div className="cm-empty-state-inline">
                                <Trophy className="cm-empty-state-inline__icon" />
                                <p className="cm-empty-state-inline__text">
                                    {deferredSearch ? "No benchmarked models match your search" : "No benchmark models match the active filters"}
                                </p>
                                <Button
                                    variant="outline"
                                    onClick={resetFilters}
                                    className="mt-2 text-xs font-mono"
                                >
                                    Reset Filters
                                </Button>
                            </div>
                        )}

                        {!isLoading && sortedModels.length > 0 && (
                            <>
                                {/* Desktop View: Sortable Table */}
                                <div className="cm-benchmarks-table-view cm-benchmarks-table-wrapper">
                                    <table className="cm-benchmarks-table">
                                        <caption className="sr-only">
                                            Benchmark leaderboard for {benchmarkOperationLabel(selectedOperation)}
                                        </caption>
                                        <thead>
                                            <tr>
                                                <th scope="col" className="cm-benchmarks-table__rank-col">#</th>
                                                <th scope="col">Model</th>
                                                {metricKeys.map((key) => {
                                                    const isCurrentSort = sortField === key;
                                                    const metric = models[0] ? benchmarkMetric(models[0], key) : null;
                                                    const fullLabel = metric?.label ?? key;
                                                    const unit = metric?.unit ? ` (${metric.unit})` : "";
                                                    const direction = metric?.direction === "lower" ? "lower is better" : "higher is better";
                                                    return (
                                                        <th scope="col" key={key}>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleSort(key as SortField)}
                                                                        className={`flex items-center gap-1 hover:text-cyan-300 transition-colors uppercase font-mono ${isCurrentSort ? "text-cyan-400 font-bold" : ""
                                                                            }`}
                                                                        aria-label={`${fullLabel}${unit}, ${direction}`}
                                                                    >
                                                                        <span>{benchmarkMetricShortLabel(metric ?? { key, label: key })}</span>
                                                                        <ArrowUpDown className={`w-3 h-3 ${isCurrentSort ? "text-cyan-400" : "opacity-50"}`} />
                                                                    </button>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="font-mono text-xs">
                                                                    {fullLabel}{unit} — {direction}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </th>
                                                    );
                                                })}
                                                <th scope="col">Params</th>
                                                <th scope="col" className="text-center">
                                                    <Hint label="Compare models">
                                                        <Scale className="w-3.5 h-3.5 mx-auto" aria-label="Compare models" />
                                                    </Hint>
                                                </th>
                                                <th scope="col" className="text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedModels.map((model, index) => {
                                                const isComparing = compareModelIds.includes(model.sourceId);
                                                const cleanName = cleanBenchmarkDisplayName(model);
                                                const cleanParams = cleanBenchmarkParameters(model.parameters);
                                                const rankClass = index === 0 ? "cm-benchmarks-rank--1" : index === 1 ? "cm-benchmarks-rank--2" : index === 2 ? "cm-benchmarks-rank--3" : "cm-benchmarks-rank--other";

                                                return (
                                                    <tr
                                                        key={`${model.operation}:${model.variant ?? "default"}:${model.provider}:${model.sourceId}`}
                                                        data-comparing={isComparing ? "true" : "false"}
                                                    >
                                                        <td className="text-center">
                                                            <span className={`cm-benchmarks-rank ${rankClass}`}>
                                                                {index + 1}
                                                            </span>
                                                        </td>
                                                        <th scope="row" className="font-normal">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleLaunchPlayground(model.modelId)}
                                                                className="font-bold text-foreground hover:text-cyan-300 transition-colors text-left"
                                                            >
                                                                {cleanName}
                                                            </button>
                                                            <div className="cm-benchmarks-table__sub text-muted-foreground flex items-center gap-1.5">
                                                                <FamilyLogo family={model.family} />
                                                                <span>{model.family}</span>
                                                                {model.isFrontier && (
                                                                    <span className="text-fuchsia-400 font-semibold">Frontier</span>
                                                                )}
                                                            </div>
                                                        </th>
                                                        {metricKeys.map((key) => (
                                                            <td key={key} className="font-medium text-foreground">
                                                                {formatBenchmarkMetric(benchmarkMetric(model, key))}
                                                            </td>
                                                        ))}
                                                        <td className="cm-benchmarks-table__params text-muted-foreground truncate">
                                                            {cleanParams.length > 0 ? cleanParams.join(", ") : "—"}
                                                        </td>
                                                        <td className="text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleCompareModel(model.sourceId)}
                                                                className={`w-4 h-4 rounded flex items-center justify-center border transition-all mx-auto ${isComparing
                                                                    ? "bg-cyan-500 text-black border-cyan-400 shadow-sm shadow-cyan-400/40"
                                                                    : "border-primary/20 hover:border-cyan-400/80 bg-background/50"
                                                                    }`}
                                                                aria-label={`Toggle compare for ${cleanName}`}
                                                            >
                                                                {isComparing && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                                            </button>
                                                        </td>
                                                        <td className="text-right">
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleLaunchPlayground(model.modelId)}
                                                                className="h-6 px-2 text-xs font-mono bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 gap-1"
                                                            >
                                                                <Play className="w-2.5 h-2.5 fill-current" />
                                                                <span>Playground</span>
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile View: Compact Tap-to-Expand Ranked Rows */}
                                <div className="cm-benchmarks-cards-view cm-benchmarks-cards">
                                    {sortedModels.map((model, index) => {
                                        const cardKey = `card:${model.operation}:${model.variant ?? "default"}:${model.sourceId}`;
                                        const isExpanded = expandedCardKey === cardKey;
                                        const isComparing = compareModelIds.includes(model.sourceId);
                                        const cleanName = cleanBenchmarkDisplayName(model);
                                        const cleanParams = cleanBenchmarkParameters(model.parameters);
                                        const primaryMetric = benchmarkMetric(model, model.primaryMetric);
                                        const costMetric = benchmarkMetric(model, "costPerTask") ?? benchmarkMetric(model, "priceInput");
                                        const speedMetric = benchmarkMetric(model, "speed") ?? (model.tokensPerSecond ? { key: "speed", label: "Output Speed", value: model.tokensPerSecond, format: "tokens-per-second" } : null);
                                        const latencyMetric = benchmarkMetric(model, "ttft") ?? (model.timeToFirstTokenSeconds ? { key: "ttft", label: "Time to First Token", value: model.timeToFirstTokenSeconds, format: "seconds" } : null);
                                        const rankClass = index === 0 ? "cm-benchmarks-rank--1" : index === 1 ? "cm-benchmarks-rank--2" : index === 2 ? "cm-benchmarks-rank--3" : "cm-benchmarks-rank--other";

                                        return (
                                            <div
                                                key={cardKey}
                                                className="cm-benchmarks-card"
                                                data-comparing={isComparing ? "true" : "false"}
                                                data-expanded={isExpanded ? "true" : undefined}
                                            >
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-expanded={isExpanded}
                                                    className="cm-benchmarks-card__row"
                                                    onClick={() => setExpandedCardKey(isExpanded ? null : cardKey)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setExpandedCardKey(isExpanded ? null : cardKey);
                                                        }
                                                    }}
                                                >
                                                    <span className={`cm-benchmarks-rank ${rankClass}`}>{index + 1}</span>
                                                    <div className="cm-benchmarks-card__identity">
                                                        <div className="cm-benchmarks-card__title-line">
                                                            <FamilyLogo family={model.family} />
                                                            <h3 className="cm-benchmarks-card__name">{cleanName}</h3>
                                                            {model.isFrontier && (
                                                                <Flame className="w-3 h-3 text-fuchsia-400 shrink-0" aria-label="Frontier" />
                                                            )}
                                                        </div>
                                                        <div className="cm-benchmarks-card__meta">
                                                            <span>{model.family}</span>
                                                            {cleanParams.length > 0 ? (
                                                                <>
                                                                    <span>·</span>
                                                                    <span>{cleanParams.join(", ")}</span>
                                                                </>
                                                            ) : null}
                                                        </div>
                                                    </div>

                                                    <div className="cm-benchmarks-card__score-pill">
                                                        <span className="cm-benchmarks-card__score-value">
                                                            {formatBenchmarkMetric(primaryMetric)}
                                                        </span>
                                                        <span className="cm-benchmarks-card__score-label">
                                                            {primaryMetric ? benchmarkMetricShortLabel(primaryMetric) : "Score"}
                                                        </span>
                                                    </div>

                                                    <div className="cm-benchmarks-card__row-actions">
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                toggleCompareModel(model.sourceId);
                                                            }}
                                                            aria-label={isComparing ? `Remove ${cleanName} from comparison` : `Compare ${cleanName}`}
                                                            title={isComparing ? "Comparing" : "Compare"}
                                                            className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${isComparing
                                                                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                                                : "border-primary/20 text-muted-foreground hover:text-foreground"
                                                                }`}
                                                        >
                                                            {isComparing ? (
                                                                <Check className="w-3 h-3 text-cyan-400" />
                                                            ) : (
                                                                <Plus className="w-3 h-3" />
                                                            )}
                                                        </button>
                                                        <ChevronDown className="cm-benchmarks-card__chevron" />
                                                    </div>
                                                </div>

                                                <div className="cm-benchmarks-card__drawer">
                                                    <div className="cm-benchmarks-card__metrics">
                                                        {speedMetric ? (
                                                            <div className="cm-benchmarks-card__metric-item">
                                                                <span className="cm-benchmarks-card__metric-label">
                                                                    <Hint label={speedMetric.label}>
                                                                        <span>{benchmarkMetricShortLabel(speedMetric as any)}</span>
                                                                    </Hint>
                                                                </span>
                                                                <span className="cm-benchmarks-card__metric-value cm-benchmarks-card__metric-value--speed">
                                                                    {formatBenchmarkMetric(speedMetric as any)}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div className="cm-benchmarks-card__metric-item">
                                                                <span className="cm-benchmarks-card__metric-label">
                                                                    <Hint label={primaryMetric?.label ?? "Primary score"}>
                                                                        <span>{primaryMetric ? benchmarkMetricShortLabel(primaryMetric) : "Score"}</span>
                                                                    </Hint>
                                                                </span>
                                                                <span className="cm-benchmarks-card__metric-value cm-benchmarks-card__metric-value--primary">
                                                                    {formatBenchmarkMetric(primaryMetric)}
                                                                </span>
                                                            </div>
                                                        )}

                                                        {costMetric && (
                                                            <div className="cm-benchmarks-card__metric-item">
                                                                <span className="cm-benchmarks-card__metric-label">
                                                                    <Hint label={costMetric.label}>
                                                                        <span>{benchmarkMetricShortLabel(costMetric)}</span>
                                                                    </Hint>
                                                                </span>
                                                                <span className="cm-benchmarks-card__metric-value cm-benchmarks-card__metric-value--price">
                                                                    {formatBenchmarkMetric(costMetric)}
                                                                </span>
                                                            </div>
                                                        )}

                                                        {latencyMetric && (
                                                            <div className="cm-benchmarks-card__metric-item">
                                                                <span className="cm-benchmarks-card__metric-label">
                                                                    <Hint label={latencyMetric.label}>
                                                                        <span>{benchmarkMetricShortLabel(latencyMetric as any)}</span>
                                                                    </Hint>
                                                                </span>
                                                                <span className="cm-benchmarks-card__metric-value">
                                                                    {formatBenchmarkMetric(latencyMetric as any)}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="cm-benchmarks-card__footer">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => toggleCompareModel(model.sourceId)}
                                                            className={`h-7 px-2.5 text-xs font-mono gap-1.5 ${isComparing
                                                                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                                                : "border-primary/20 text-muted-foreground hover:text-foreground"
                                                                }`}
                                                        >
                                                            {isComparing ? (
                                                                <>
                                                                    <Check className="w-3 h-3 text-cyan-400" />
                                                                    <span>Comparing</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Plus className="w-3 h-3" />
                                                                    <span>Compare</span>
                                                                </>
                                                            )}
                                                        </Button>

                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleLaunchPlayground(model.modelId)}
                                                            className="h-7 px-2.5 text-xs font-mono bg-cyan-500 hover:bg-cyan-400 text-black font-bold gap-1"
                                                        >
                                                            <Play className="w-3 h-3 fill-current" />
                                                            <span>Playground</span>
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </TabsContent>

                    {/* Tab 2: Visual Frontiers */}
                    <TabsContent value="frontiers" className="cm-market-tab-panel cm-market-tab-panel--scroll mt-0">
                        {selectedOperation === "chat" ? (
                            <BenchmarkScatterPlot
                                models={sortedModels}
                                selectedModelIds={compareModelIds}
                                onSelectModel={(m) => toggleCompareModel(m.sourceId)}
                                onLaunchPlayground={handleLaunchPlayground}
                            />
                        ) : (
                            <div className="rounded-xl border border-primary/20 bg-background/40 p-4 font-mono text-xs space-y-3">
                                <div>
                                    <p className="font-bold text-foreground text-sm">
                                        {benchmarkOperationLabel(selectedOperation)} Arena Quality Ranking
                                    </p>
                                    <p className="mt-0.5 text-muted-foreground text-xs">
                                        Independent benchmark metrics published by Artificial Analysis.
                                    </p>
                                </div>
                                <div className="space-y-2 pt-1">
                                    {sortedModels.slice(0, 30).map((model, index) => {
                                        const metric = benchmarkMetric(model, model.primaryMetric);
                                        const cleanName = cleanBenchmarkDisplayName(model);
                                        const values = sortedModels
                                            .map((entry) => benchmarkMetric(entry, entry.primaryMetric)?.value)
                                            .filter((value): value is number => value != null);
                                        const max = values.length > 0 ? Math.max(...values) : 0;
                                        const width = metric?.value != null && max > 0 ? Math.max(3, (metric.value / max) * 100) : 0;
                                        const isComparing = compareModelIds.includes(model.sourceId);

                                        return (
                                            <div
                                                key={`${model.operation}:${model.variant ?? "default"}:${model.sourceId}`}
                                                className="p-2 rounded-lg border border-primary/10 bg-background/30 hover:border-primary/30 transition-all space-y-1"
                                            >
                                                <div className="flex items-center justify-between gap-2 text-xs">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <span className="text-cyan-400 font-bold">{index + 1}.</span>
                                                        <span className="font-bold text-foreground truncate">{cleanName}</span>
                                                        <FamilyLogo family={model.family} />
                                                        <span className="text-muted-foreground text-xs">({model.family})</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className="text-cyan-300 font-bold">{formatBenchmarkMetric(metric)}</span>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => toggleCompareModel(model.sourceId)}
                                                            className={`h-5 px-1.5 text-xs font-mono ${isComparing
                                                                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                                                : "border-primary/20 text-muted-foreground"
                                                                }`}
                                                        >
                                                            {isComparing ? "Comparing" : "Compare"}
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleLaunchPlayground(model.modelId)}
                                                            className="h-5 px-1.5 text-xs font-mono bg-cyan-500 hover:bg-cyan-400 text-black font-bold"
                                                        >
                                                            Playground
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500"
                                                        style={{ width: `${width}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    {/* Tab 3: Head-to-Head Battle */}
                    <TabsContent value="battle" className="cm-market-tab-panel cm-market-tab-panel--scroll cm-market-tab-panel--proximity mt-0">
                        <ModelComparisonView
                            modelIds={compareModelIds}
                            onModelIdsChange={setCompareModelIds}
                            onSelectPlaygroundModel={handleLaunchPlayground}
                        />
                    </TabsContent>
                </Tabs>
            </div>

            {/* Floating Compare Tray HUD Dock — draggable; folds to a scale icon via the grip */}
            {compareModelIds.length > 0 && activeTab !== "battle" && (
                dockFolded ? (
                    <button
                        type="button"
                        ref={(node) => { dockRef.current = node; }}
                        className="cm-benchmarks-dock cm-benchmarks-dock--folded"
                        style={{ transform: `translate(calc(-50% + ${dockOffset.x}px), ${dockOffset.y}px)` }}
                        onPointerDown={(e) => handleDockPointerDown(e, true)}
                        onPointerMove={handleDockPointerMove}
                        onPointerUp={handleDockPointerUp}
                        onPointerCancel={handleDockPointerUp}
                        onClick={handleDockFoldedClick}
                        aria-label={`Comparison tray folded with ${compareModelIds.length} models. Tap to expand, drag to move.`}
                    >
                        <GripVertical className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
                        <Scale className="w-4 h-4" />
                        <span className="cm-benchmarks-dock__folded-count">{compareModelIds.length}</span>
                    </button>
                ) : (
                    <div
                        ref={(node) => { dockRef.current = node; }}
                        className="cm-benchmarks-dock"
                        style={{ transform: `translate(calc(-50% + ${dockOffset.x}px), ${dockOffset.y}px)` }}
                        onPointerDown={handleDockPointerDown}
                        onPointerMove={handleDockPointerMove}
                        onPointerUp={handleDockPointerUp}
                        onPointerCancel={handleDockPointerUp}
                    >
                        <button
                            type="button"
                            className="cm-benchmarks-dock__grip"
                            onClick={() => setDockFolded(true)}
                            aria-label="Fold comparison tray"
                        >
                            <GripVertical className="w-3.5 h-3.5" />
                        </button>
                        <div className="cm-benchmarks-dock__models">
                            <span className="text-muted-foreground shrink-0 text-xs hidden sm:inline">Comparing:</span>
                            {dockVisible.map(({ id, label }) => (
                                <span key={id} className="cm-benchmarks-dock__pill">
                                    <span className="cm-benchmarks-dock__pill-label">{label}</span>
                                    {compareModelIds.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => toggleCompareModel(id)}
                                            className="hover:text-red-400 ml-0.5 shrink-0"
                                            aria-label={`Remove ${label}`}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </span>
                            ))}
                            {dockOverflow.length > 0 && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            className="cm-benchmarks-dock__pill cm-benchmarks-dock__pill--more"
                                            aria-label={`${dockOverflow.length} more compared models`}
                                        >
                                            +{dockOverflow.length}
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent side="top" align="center" sideOffset={8} className="cm-control-menu">
                                        {dockOverflow.map(({ id, label }) => (
                                            <DropdownMenuItem
                                                key={id}
                                                className="cm-control-menu__item"
                                                onSelect={() => toggleCompareModel(id)}
                                            >
                                                <span className="cm-control-menu__label">{label}</span>
                                                <X className="w-3 h-3 ml-auto text-muted-foreground" />
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>

                        <div className="cm-benchmarks-dock__actions">
                            <Button
                                size="sm"
                                onClick={() => setActiveTab("battle")}
                                className="cm-benchmarks-dock__battle h-6 px-2.5 text-xs font-mono bg-cyan-500 hover:bg-cyan-400 text-black font-bold gap-1 shadow-md shadow-cyan-400/40"
                            >
                                <Scale className="w-3 h-3" />
                                <span className="cm-benchmarks-dock__battle-label">Battle ({compareModelIds.length})</span>
                            </Button>
                        </div>
                    </div>
                )
            )}

            {/* Attribution Bar */}
            <div className="cm-benchmarks-attribution">
                <span>
                    Powered by{" "}
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
                <span>{allModels.length} models tracked</span>
            </div>
        </div>
    );

    if (variant === "dialog") {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="w-[calc(100dvi-2rem)] max-w-6xl max-h-[92dvh] flex flex-col p-0 bg-background/95 backdrop-blur-xl border border-cyan-500/30 shadow-2xl overflow-hidden font-sans">
                    <div className="flex-1 overflow-y-auto p-4">
                        {content}
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return content;
}
