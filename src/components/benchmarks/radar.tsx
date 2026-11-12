/**
 * Benchmark Radar Chart Component
 *
 * Visualizes multi-dimensional model capability profiles using Recharts
 * styled with Compose Market luminescent brand tokens.
 */

import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
    Tooltip,
    Legend,
} from "recharts";
import { cleanBenchmarkDisplayName } from "@/lib/benchmarks";
import type { RadarDataPoint, ModelBenchmark } from "@/types/benchmarks";

export interface BenchmarkRadarChartProps {
    data: RadarDataPoint[];
    models: ModelBenchmark[];
    height?: number | string;
    showLegend?: boolean;
    compact?: boolean;
}

const MODEL_COLORS = [
    { stroke: "#00f0ff", fill: "#00f0ff", fillOpacity: 0.25, name: "Cyan" },
    { stroke: "#ff007a", fill: "#ff007a", fillOpacity: 0.25, name: "Fuchsia" },
    { stroke: "#00ff9d", fill: "#00ff9d", fillOpacity: 0.25, name: "Emerald" },
    { stroke: "#ffb800", fill: "#ffb800", fillOpacity: 0.25, name: "Amber" },
];

function CustomRadarTooltip({ active, payload, label }: any) {
    if (!active || !payload || !payload.length) return null;

    return (
        <div className="bg-background/95 backdrop-blur-md border border-cyan-500/30 rounded-lg p-3 shadow-xl text-xs font-mono">
            <p className="font-bold text-foreground mb-2 text-sm border-b border-border/50 pb-1 flex items-center justify-between gap-4">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground uppercase">Score / 100</span>
            </p>
            <div className="space-y-1.5">
                {payload.map((entry: any, index: number) => (
                    <div key={index} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                            <span
                                className="w-2.5 h-2.5 rounded-full inline-block"
                                style={{ backgroundColor: entry.stroke || entry.color }}
                            />
                            <span className="text-muted-foreground truncate max-w-36">
                                {entry.name}
                            </span>
                        </div>
                        <span className="font-bold text-foreground">
                            {Math.round(entry.value)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function BenchmarkRadarChart({
    data,
    models,
    height = "clamp(220px, 35cqh, 340px)",
    showLegend = true,
    compact = false,
}: BenchmarkRadarChartProps) {
    if (!data || data.length === 0 || !models || models.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-xs font-mono">
                No comparison benchmark data available
            </div>
        );
    }

    return (
        <div className="w-full relative min-h-56" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart
                    data={data}
                    margin={{ top: 12, right: 28, bottom: 12, left: 28 }}
                    outerRadius={compact ? "54%" : "62%"}
                >
                    <PolarGrid
                        stroke="rgba(255, 255, 255, 0.1)"
                        strokeDasharray="3 3"
                    />
                    <PolarAngleAxis
                        dataKey="metric"
                        tick={{
                            fill: "rgba(255, 255, 255, 0.7)",
                            fontSize: 12,
                            fontFamily: "var(--font-mono, monospace)",
                        }}
                    />
                    <PolarRadiusAxis
                        angle={30}
                        domain={[0, 100]}
                        tick={false}
                        axisLine={false}
                    />
                    <Tooltip content={<CustomRadarTooltip />} />
                    {showLegend && models.length > 1 && (
                        <Legend
                            wrapperStyle={{
                                paddingTop: 8,
                                fontSize: 12,
                                fontFamily: "var(--font-mono, monospace)",
                            }}
                            formatter={(value) => {
                                const model = models.find((m) => m.sourceId === value || m.modelId === value || m.name === value);
                                return (
                                    <span className="text-foreground/90 font-medium">
                                        {cleanBenchmarkDisplayName(model || value)}
                                    </span>
                                );
                            }}
                        />
                    )}
                    {models.map((model, index) => {
                        const style = MODEL_COLORS[index % MODEL_COLORS.length];
                        const displayName = cleanBenchmarkDisplayName(model);
                        return (
                            <Radar
                                key={model.sourceId}
                                name={displayName}
                                dataKey={model.sourceId}
                                stroke={style.stroke}
                                fill={style.fill}
                                fillOpacity={models.length === 1 ? 0.4 : style.fillOpacity}
                                strokeWidth={2}
                                dot={{
                                    r: 3,
                                    fill: style.stroke,
                                    strokeWidth: 1,
                                    stroke: "#080c14",
                                }}
                            />
                        );
                    })}
                </RadarChart>
            </ResponsiveContainer>
        </div>
    );
}
