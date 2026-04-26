"use client";

/**
 * ToolTimeline — horizontal strip of tool-call lifecycle events.
 * Subscribes to sdk.events.toolCallStart + toolCallEnd; fires uniformly
 * across chat / responses / agent / workflow stream sources.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle, Wrench } from "lucide-react";
import { sdk } from "@/lib/sdk";

type ToolStatus = "running" | "success" | "failed";

interface ToolTimelineEntry {
    id: string;
    toolName: string;
    source: "chat" | "responses" | "agent" | "workflow";
    summary?: string;
    status: ToolStatus;
    error?: string;
    startedAt: number;
}

const MAX_VISIBLE = 8;

export function ToolTimeline({ className }: { className?: string }) {
    const [entries, setEntries] = useState<ToolTimelineEntry[]>([]);

    useEffect(() => {
        const upsert = (id: string, mutate: (e: ToolTimelineEntry) => ToolTimelineEntry) => {
            setEntries((prev) => {
                const idx = prev.findIndex((e) => e.id === id);
                if (idx === -1) return prev;
                const next = prev.slice();
                next[idx] = mutate(prev[idx]);
                return next;
            });
        };

        const unsubStart = sdk.events.on("toolCallStart", (event) => {
            setEntries((prev) => {
                if (prev.some((e) => e.id === event.toolCallId)) return prev;
                const entry: ToolTimelineEntry = {
                    id: event.toolCallId,
                    toolName: event.toolName,
                    source: event.source,
                    summary: event.summary,
                    status: "running",
                    startedAt: Date.now(),
                };
                return [entry, ...prev].slice(0, MAX_VISIBLE);
            });
        });

        const unsubEnd = sdk.events.on("toolCallEnd", (event) => {
            upsert(event.toolCallId, (existing) => ({
                ...existing,
                status: event.failed ? "failed" : "success",
                error: event.error,
                summary: event.summary ?? existing.summary,
            }));
        });

        return () => {
            unsubStart();
            unsubEnd();
        };
    }, []);

    if (entries.length === 0) return null;

    return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
            {entries.map((entry) => {
                const icon = entry.status === "running"
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : entry.status === "failed"
                        ? <XCircle className="h-3 w-3 text-red-400" />
                        : <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
                const borderClass = entry.status === "running"
                    ? "border-cyan-500/30 bg-cyan-500/5 text-cyan-300"
                    : entry.status === "failed"
                        ? "border-red-500/30 bg-red-500/5 text-red-300"
                        : "border-emerald-500/30 bg-emerald-500/5 text-emerald-300";
                const title = entry.error
                    ? `${entry.toolName} (${entry.source}) — ${entry.error}`
                    : entry.summary
                        ? `${entry.toolName} (${entry.source}) — ${entry.summary}`
                        : `${entry.toolName} (${entry.source})`;
                return (
                    <span
                        key={entry.id}
                        className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-mono ${borderClass}`}
                        title={title}
                    >
                        <Wrench className="h-2.5 w-2.5 opacity-60" aria-hidden="true" />
                        {icon}
                        <span>{entry.toolName}</span>
                    </span>
                );
            })}
        </div>
    );
}
