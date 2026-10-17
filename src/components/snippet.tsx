/**
 * Snippet artifact frame.
 *
 * A snippet is an artifact like any other: the COMPLETE content rides the
 * artifact event and is VISIBLE in the frame — rendered inline like a
 * picture. Download icons sit IN the frame: `.md` (the markdown document
 * or report) and `.sol` (the verbatim contract source) — both blob
 * downloads from the carried bytes, exactly like the plan delivery card.
 * No server fetches, no file routes — the runtime is a content store; the
 * client renders.
 */
import React, { useCallback, useState } from "react";
import { Download, FileCode2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/lib/performance/markdown";
import type { Artifact } from "@/hooks/use-chat";

export interface SnippetCardProps {
    artifact: Artifact;
    defaultExpanded?: boolean;
}

function fileStem(artifact: Artifact): string {
    const stem = (artifact.title ?? artifact.id)
        .toLowerCase()
        .replace(/\.sol$|\.md$/, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return stem || "snippet";
}

export function SnippetCard({ artifact, defaultExpanded = false }: SnippetCardProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const content = artifact.content ?? "";
    const code = artifact.code ?? "";

    const download = useCallback((extension: "md" | "sol") => {
        const body = extension === "sol" ? code : content;
        if (!body) return;
        const blob = new Blob([body], {
            type: extension === "sol" ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8",
        });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `${fileStem(artifact)}.${extension}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
    }, [artifact, code, content]);

    const bytes = artifact.bytes
        ?? (code ? new Blob([code]).size : undefined);
    const title = artifact.title ?? "Snippet";

    return (
        <div
            className="cm-snippet-card not-prose my-3 rounded-lg border bg-card"
            data-artifact-id={artifact.id}
            data-expanded={expanded ? "true" : "false"}
        >
            <div className="flex items-start justify-between gap-2 px-4 pt-3">
                <div className="flex min-w-0 items-center gap-2">
                    <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{title}</p>
                        <p className="text-xs text-muted-foreground">
                            Smart contract snippet
                            {artifact.sourceTool ? ` · ${artifact.sourceTool}` : ""}
                            {bytes ? ` · ${Math.max(1, Math.round(bytes / 1024))} KB` : ""}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => download("sol")}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title="Download the contract source"
                    >
                        <Download className="h-3.5 w-3.5" />
                        .sol
                    </button>
                    <button
                        type="button"
                        onClick={() => download("md")}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title="Download the document/report"
                    >
                        <Download className="h-3.5 w-3.5" />
                        .md
                    </button>
                    <button
                        type="button"
                        onClick={() => setExpanded((value) => !value)}
                        className="inline-flex items-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title={expanded ? "Collapse the snippet" : "Expand the snippet"}
                    >
                        {expanded ? "Collapse" : "Expand"}
                    </button>
                </div>
            </div>
            <div className={cn("px-4 pb-3 pt-2", expanded && "cm-snippet-body")}>
                {expanded ? (
                    <MarkdownRenderer content={content || code || "Empty snippet."} />
                ) : (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                        {content.slice(0, 220) || code.slice(0, 220) || "Snippet stored — expand to read, or download the .sol / .md files."}
                    </p>
                )}
            </div>
        </div>
    );
}
