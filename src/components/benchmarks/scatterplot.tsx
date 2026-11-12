/**
 * Benchmark Scatter Plot Component
 *
 * Interactive visual frontier analysis:
 * 1. Quality vs. Price (Pareto Value Frontier with Log-scale cost)
 * 2. Quality vs. Output Speed (Throughput tok/s)
 *
 * Container-aware, fluidly responsive, with mobile point inspector card.
 */

import { useState, useMemo } from "react";
import {
    Scatter,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
    Line,
    ComposedChart,
} from "recharts";
import { Sparkles, DollarSign, Zap, Trophy, Plus, Check, Play, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { benchmarkMetric, formatBenchmarkMetric, cleanBenchmarkDisplayName } from "@/lib/benchmarks";
import { FamilyLogo } from "./family";
import type { ModelBenchmark } from "@/types/benchmarks";

export interface BenchmarkScatterPlotProps {
    models: ModelBenchmark[];
    selectedModelIds?: string[];
    onSelectModel?: (model: ModelBenchmark) => void;
    onLaunchPlayground?: (modelId: string) => void;
    height?: number | string;
}

type ScatterMode = "price" | "speed";
type BenchmarkChartDatum = ModelBenchmark & { xVal: number; yVal: number };

function CustomScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BenchmarkChartDatum }> }) {
    if (!active || !payload || !payload.length) return null;
    // The Pareto frontier Line can land in the tooltip payload — its points
    // carry only {xVal, yVal, name}. Pick the first entry that is a real model.
    const data = payload.find((entry: any) => entry?.payload?.metrics)?.payload;
    if (!data) return null;

    return (
        <div className="bg-background/95 backdrop-blur-md border border-cyan-500/40 rounded-lg p-3 shadow-2xl text-xs font-mono max-w-72">
            <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 mb-2">
                <span className="font-bold text-foreground truncate text-sm">
                    {cleanBenchmarkDisplayName(data)}
                </span>
                {data.isFrontier && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30">
                        Frontier
                    </span>
                )}
            </div>

            <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                    <span>Family:</span>
                    <span className="text-foreground font-medium flex items-center gap-1.5">
                        <FamilyLogo family={data.family} />
                        {data.family}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Intelligence Index:</span>
                    <span className="text-cyan-400 font-bold">
                        {data.intelligenceIndex ?? "—"}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Cost / Task:</span>
                    <span className="text-emerald-400 font-medium">
                        {formatBenchmarkMetric(benchmarkMetric(data, "costPerTask"))}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Output Speed:</span>
                    <span className="text-amber-400 font-medium">
                        {data.tokensPerSecond ? `${data.tokensPerSecond} tok/s` : "—"}
                    </span>
                </div>
                {data.timeToFirstTokenSeconds && (
                    <div className="flex justify-between">
                        <span>Latency (TTFT):</span>
                        <span className="text-foreground">
                            {`${Math.round(data.timeToFirstTokenSeconds * 1000)}ms`}
                        </span>
                    </div>
                )}
            </div>
            <p className="mt-2 pt-1 border-t border-border/30 text-xs text-cyan-300/80 text-center">
                Click point to inspect & compare
            </p>
        </div>
    );
}

export function BenchmarkScatterPlot({
    models,
    selectedModelIds = [],
    onSelectModel,
    onLaunchPlayground,
    height = "clamp(17.5rem, 45dvh, 28.75rem)",
}: BenchmarkScatterPlotProps) {
    const [mode, setMode] = useState<ScatterMode>("price");
    const [inspectedModel, setInspectedModel] = useState<ModelBenchmark | null>(null);

    // Prepare chart data
    const chartData = useMemo(() => {
        return models
            .filter((m) => m.intelligenceIndex !== null)
            .map((m) => {
                const xVal =
                    mode === "price"
                        ? benchmarkMetric(m, "costPerTask")?.value ?? null
                        : m.tokensPerSecond ?? null;
                const yVal = m.intelligenceIndex ?? null;

                return {
                    ...m,
                    xVal,
                    yVal,
                };
            })
            .filter((d): d is BenchmarkChartDatum =>
                d.xVal !== null && d.yVal !== null && d.xVal > 0 && d.yVal > 0
            );
    }, [models, mode]);

    // Calculate Pareto Frontier line for Quality vs Price (lower price & higher quality)
    const paretoPoints = useMemo(() => {
        if (mode !== "price" || chartData.length === 0) return [];

        // Sort by price ascending
        const sorted = [...chartData].sort((a, b) => a.xVal - b.xVal);
        const pareto: Array<{ xVal: number; yVal: number; name: string }> = [];
        let maxQuality = -1;

        for (const point of sorted) {
            if (point.yVal > maxQuality) {
                pareto.push({ xVal: point.xVal, yVal: point.yVal, name: point.name });
                maxQuality = point.yVal;
            }
        }
        return pareto;
    }, [chartData, mode]);

    const handlePointClick = (entry: any) => {
        const target = (entry?.payload || entry) as ModelBenchmark;
        if (!target) return;
        setInspectedModel(target);
        if (onSelectModel) onSelectModel(target);
    };

    return (
        <div className="cm-benchmarks-scatter-pane">
            {/* Chart Mode Controls */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                    <Trophy className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Visual Frontier Analysis</span>
                </div>

                <div className="inline-flex rounded-full bg-background/60 p-0.5 border border-primary/20 font-mono text-xs">
                    <button
                        type="button"
                        onClick={() => setMode("price")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-all ${
                            mode === "price"
                                ? "bg-cyan-500/20 text-cyan-400 font-semibold shadow-sm border border-cyan-500/40"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <DollarSign className="w-3 h-3" />
                        <span>Quality vs. Price</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode("speed")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-all ${
                            mode === "speed"
                                ? "bg-cyan-500/20 text-cyan-400 font-semibold shadow-sm border border-cyan-500/40"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Zap className="w-3 h-3" />
                        <span>Quality vs. Speed</span>
                    </button>
                </div>
            </div>

            {/* Main Scatter Chart Box */}
            <div className="cm-benchmarks-scatter-box" style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        margin={{ top: 20, right: 20, bottom: 25, left: 5 }}
                    >
                        <CartesianGrid
                            stroke="rgba(255, 255, 255, 0.05)"
                            strokeDasharray="3 3"
                        />
                        <XAxis
                            type="number"
                            dataKey="xVal"
                            name={mode === "price" ? "Cost / Task ($)" : "Speed (tok/s)"}
                            scale={mode === "price" ? "log" : "linear"}
                            domain={mode === "price" ? ["auto", "auto"] : [0, "auto"]}
                            tick={{
                                fill: "rgba(255, 255, 255, 0.6)",
                                fontSize: "var(--cm-text-xs)",
                                fontFamily: "var(--font-mono, monospace)",
                            }}
                            label={{
                                value:
                                    mode === "price"
                                        ? "Cost per Task ($) [Log Scale] →"
                                        : "Output Speed (Tokens / Sec) →",
                                position: "bottom",
                                offset: 12,
                                fill: "rgba(255, 255, 255, 0.4)",
                                fontSize: "var(--cm-text-xs)",
                                fontFamily: "var(--font-mono, monospace)",
                            }}
                        />
                        <YAxis
                            type="number"
                            dataKey="yVal"
                            name="Intelligence Index"
                            domain={[0, "auto"]}
                            tick={{
                                fill: "rgba(255, 255, 255, 0.6)",
                                fontSize: "var(--cm-text-xs)",
                                fontFamily: "var(--font-mono, monospace)",
                            }}
                            label={{
                                value: "Intelligence ↑",
                                angle: -90,
                                position: "insideLeft",
                                offset: 8,
                                fill: "rgba(255, 255, 255, 0.4)",
                                fontSize: "var(--cm-text-xs)",
                                fontFamily: "var(--font-mono, monospace)",
                            }}
                        />
                        <Tooltip content={<CustomScatterTooltip />} />

                        {/* Pareto Curve (when mode === 'price') */}
                        {mode === "price" && paretoPoints.length > 1 && (
                            <Line
                                type="stepAfter"
                                data={paretoPoints}
                                dataKey="yVal"
                                stroke="#00f0ff"
                                strokeWidth={1.5}
                                strokeDasharray="4 4"
                                dot={false}
                                isAnimationActive={false}
                            />
                        )}

                        <Scatter
                            name="Models"
                            data={chartData}
                            onClick={handlePointClick}
                            className="cursor-pointer"
                        >
                            {chartData.map((entry, index) => {
                                const isSelected = selectedModelIds.includes(entry.sourceId);
                                const isInspected = inspectedModel?.sourceId === entry.sourceId;
                                const isFrontier = entry.isFrontier;

                                let fill = "#00f0ff";
                                if (isSelected) fill = "#ff007a";
                                else if (isFrontier) fill = "#00ff9d";
                                else fill = "rgba(0, 240, 255, 0.6)";

                                return (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={fill}
                                        stroke={isInspected ? "#ffffff" : isSelected ? "#ff007a" : isFrontier ? "#00ff9d" : "#080c14"}
                                        strokeWidth={isInspected ? 3 : isSelected ? 2 : 1}
                                        r={isInspected ? 7 : isSelected ? 6 : isFrontier ? 5 : 3.5}
                                    />
                                );
                            })}
                        </Scatter>
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Mobile / Touch Interactive Point Inspector Pocket */}
            {inspectedModel && (
                <div className="cm-benchmarks-scatter-inspector">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-foreground truncate text-sm">
                                    {cleanBenchmarkDisplayName(inspectedModel)}
                                </span>
                                {inspectedModel.isFrontier && (
                                    <span className="px-1.5 py-0.2 rounded text-xs bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30">
                                        Frontier
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                                <FamilyLogo family={inspectedModel.family} />
                                <span>{inspectedModel.family}</span>
                                <span>·</span>
                                <span className="text-cyan-400">Score: {inspectedModel.intelligenceIndex ?? "—"}</span>
                                <span>·</span>
                                <span className="text-emerald-400">{formatBenchmarkMetric(benchmarkMetric(inspectedModel, "costPerTask"))}</span>
                                {inspectedModel.tokensPerSecond && (
                                    <>
                                        <span>·</span>
                                        <span className="text-amber-400">{inspectedModel.tokensPerSecond} tok/s</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onSelectModel?.(inspectedModel)}
                            className={`h-7 px-2.5 text-xs font-mono gap-1 ${
                                selectedModelIds.includes(inspectedModel.sourceId)
                                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                    : "border-primary/20 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {selectedModelIds.includes(inspectedModel.sourceId) ? (
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

                        {onLaunchPlayground && (
                            <Button
                                size="sm"
                                onClick={() => onLaunchPlayground(inspectedModel.modelId)}
                                className="h-7 px-2.5 text-xs font-mono bg-cyan-500 hover:bg-cyan-400 text-black font-bold"
                            >
                                <Play className="w-3 h-3 mr-1 fill-current" />
                                <span>Playground</span>
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Legend & Guide */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-mono text-muted-foreground">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                        <span>Frontier Model</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400/60 inline-block" />
                        <span>Standard Model</span>
                    </span>
                    {selectedModelIds.length > 0 && (
                        <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-fuchsia-400 inline-block ring-2 ring-white/50" />
                            <span>Comparing ({selectedModelIds.length})</span>
                        </span>
                    )}
                </div>
                {mode === "price" && (
                    <span className="text-cyan-400/80">
                        --- Dashed Line: Pareto Optimal Value Frontier
                    </span>
                )}
            </div>
        </div>
    );
}
