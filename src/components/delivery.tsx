/**
 * Plan delivery artifact frame.
 *
 * The delivery is an artifact like any other: the COMPLETE content rides the
 * artifact event and is VISIBLE in the frame — rendered inline like a
 * picture. Download icons sit IN the frame: `.md` (blob from the carried
 * bytes) and PDF (print-scoped `window.print()` — "Save as PDF", zero
 * client dependencies). No server fetches, no file routes — the runtime is
 * a content store; the client renders.
 */
import React, { useCallback, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";

import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/lib/performance/markdown";
import type { Artifact } from "@/hooks/use-chat";

export interface DeliveryCardProps {
    artifact: Artifact;
    defaultExpanded?: boolean;
}

export function DeliveryCard({ artifact, defaultExpanded = true }: DeliveryCardProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const content = artifact.content ?? artifact.summary ?? "";

    const download = useCallback(() => {
        const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `deliverable-${artifact.taskId ?? "final"}.md`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
    }, [artifact.taskId, content]);

    const print = useCallback(() => {
        document.body.classList.add("cm-print-delivery-only");
        void (async () => {
            try {
                await document.fonts?.ready;
            } catch {
                // Font readiness is best effort.
            }
            window.print();
        })();
        const cleanup = () => {
            document.body.classList.remove("cm-print-delivery-only");
            window.removeEventListener("afterprint", cleanup);
        };
        window.addEventListener("afterprint", cleanup);
    }, []);

    const bytes = artifact.bytes ?? (content ? new Blob([content]).size : undefined);
    const title = artifact.title ?? "Plan delivery";

    return (
        <div
            className="cm-delivery-card not-prose my-3 rounded-lg border bg-card"
            data-deliverable-id={artifact.deliverableId ?? artifact.id}
            data-expanded={expanded ? "true" : "false"}
        >
            <div className="flex items-start justify-between gap-2 px-4 pt-3">
                <div className="flex min-w-0 items-center gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{title}</p>
                        <p className="text-xs text-muted-foreground">
                            Plan delivery
                            {artifact.taskTitle ? ` · ${artifact.taskTitle}` : ""}
                            {bytes ? ` · ${Math.max(1, Math.round(bytes / 1024))} KB` : ""}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={download}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title="Download the verbatim markdown"
                    >
                        <Download className="h-3.5 w-3.5" />
                        .md
                    </button>
                    <button
                        type="button"
                        onClick={print}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title="Download as PDF (choose 'Save as PDF' in the print dialog)"
                    >
                        <Printer className="h-3.5 w-3.5" />
                        PDF
                    </button>
                    <button
                        type="button"
                        onClick={() => setExpanded((value) => !value)}
                        className="inline-flex items-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title={expanded ? "Collapse the delivery" : "Expand the delivery"}
                    >
                        {expanded ? "Collapse" : "Expand"}
                    </button>
                </div>
            </div>
            <div className={cn("px-4 pb-3 pt-2", expanded && "cm-delivery-body")}>
                {expanded ? (
                    <MarkdownRenderer content={content || "Empty delivery."} />
                ) : (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                        {content.slice(0, 220) || "Delivery stored — expand to read, download, or print."}
                    </p>
                )}
            </div>
        </div>
    );
}
