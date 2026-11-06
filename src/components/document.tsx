/**
 * Unified Document & Code Artifact Card + Pop-Up Reader Modal.
 *
 * Renders structured `document`, `code`, `delivery`, and `snippet` artifacts
 * as a clean formatted preview card inside chat with a full-screen ShellModal
 * reader, copy button, exact-filename download, and print-to-PDF (documents).
 */
import React, { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, FileCode2, FileText, Maximize2, Printer } from "lucide-react";
import { ShellButton, ShellModal } from "@compose-market/theme/shell";

import { HighlightedCode, MarkdownRenderer } from "@/lib/performance/markdown";
import { PoweredByChainGpt } from "@/components/chaingpt";
import type { Artifact } from "@/hooks/use-chat";
import { cn } from "@/lib/utils";

export interface DocumentCardProps {
  artifact: Artifact;
  variant?: "document" | "code";
  className?: string;
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  sol: "solidity",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rs: "rust",
  go: "go",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "bash",
  sql: "sql",
  css: "css",
  html: "html",
  md: "markdown",
};

function languageFromFilename(filename?: string): string | undefined {
  if (!filename) return undefined;
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return undefined;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGE[ext];
}

function fileStem(titleOrId: string): string {
  const cleaned = titleOrId
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "document";
}

function formatByteSize(bytes?: number): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
}

function triggerBlobDownload(body: string, filename: string, mimeType: string): void {
  const blob = new Blob([body], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function buildPreviewExcerpt(body: string, isCode: boolean): string {
  if (!body) return "";
  const maxLines = isCode ? 18 : 22;
  const maxChars = isCode ? 1200 : 1400;
  const lines = body.split("\n");
  let excerpt = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : body;
  if (excerpt.length > maxChars) {
    excerpt = excerpt.slice(0, maxChars);
    const lastBreak = excerpt.lastIndexOf("\n");
    if (lastBreak > maxChars * 0.45) {
      excerpt = excerpt.slice(0, lastBreak);
    }
  }
  if (!isCode) {
    const fences = excerpt.match(/^\s*```/gm);
    if (fences && fences.length % 2 === 1) {
      excerpt = `${excerpt}\n\`\`\``;
    }
  }
  return excerpt;
}

function DocumentCardInner({ artifact, variant, className }: DocumentCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);

  const isCode = variant === "code"
    || artifact.artifactType === "code"
    || (artifact.artifactType === "snippet" && Boolean(artifact.code) && !artifact.content);

  const body = isCode
    ? (artifact.content ?? artifact.code ?? "")
    : (artifact.content ?? artifact.summary ?? artifact.code ?? "");

  const hasSecondarySol = !isCode && artifact.artifactType === "snippet" && Boolean(artifact.code);

  const title = artifact.title?.trim()
    || artifact.filename?.trim()
    || (artifact.artifactType === "delivery" ? "Plan Delivery" : isCode ? "Source Code" : "Document");

  const filename = useMemo(() => {
    if (artifact.filename?.trim()) return artifact.filename.trim();
    if (artifact.artifactType === "delivery") {
      return `deliverable-${artifact.taskId ?? "final"}.md`;
    }
    const ext = isCode ? "sol" : "md";
    return `${fileStem(title)}.${ext}`;
  }, [artifact.artifactType, artifact.filename, artifact.taskId, isCode, title]);

  const language = useMemo(() => {
    const explicit = artifact.language?.trim().toLowerCase();
    if (explicit) return explicit;
    return languageFromFilename(filename) ?? (isCode ? "solidity" : undefined);
  }, [artifact.language, filename, isCode]);

  const provider = artifact.provider?.trim().toLowerCase()
    || (typeof artifact.raw?.provider === "string" ? artifact.raw.provider.trim().toLowerCase() : undefined);
  const showChainGpt = provider === "chaingpt";

  const byteCount = useMemo(
    () => artifact.bytes ?? (body ? new Blob([body]).size : undefined),
    [artifact.bytes, body],
  );
  const sizeLabel = formatByteSize(byteCount);

  const handleCopy = useCallback(async () => {
    if (!body) return;
    await navigator.clipboard.writeText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [body]);

  const handleDownload = useCallback(() => {
    if (!body) return;
    const downloadBody = !isCode && showChainGpt && !body.includes("chaingpt.org")
      ? `${body.trimEnd()}\n\n---\n_Powered by [ChainGPT](https://www.chaingpt.org)_\n`
      : body;
    const mime = isCode ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8";
    triggerBlobDownload(downloadBody, filename, mime);
  }, [body, filename, isCode, showChainGpt]);

  const handleDownloadSecondarySol = useCallback(() => {
    if (!artifact.code) return;
    triggerBlobDownload(artifact.code, `${fileStem(title)}.sol`, "text/plain;charset=utf-8");
  }, [artifact.code, title]);

  const handlePrintPdf = useCallback(() => {
    setPrinting(true);
    document.body.classList.add("cm-print-doc-only");
    const cleanup = () => {
      document.body.classList.remove("cm-print-doc-only");
      setPrinting(false);
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    void (async () => {
      try {
        await document.fonts?.ready;
      } catch {
        // Best-effort font load before print
      }
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      window.print();
    })();
  }, []);

  const previewBody = useMemo(
    () => buildPreviewExcerpt(body, isCode),
    [body, isCode],
  );

  const kindLabel = isCode
    ? (language ? language.toUpperCase() : "CODE")
    : artifact.artifactType === "delivery"
      ? "DELIVERY"
      : "DOCUMENT";

  return (
    <>
      <article
        className={cn("cm-doc-card", isCode && "cm-doc-card--code", className)}
        data-artifact-id={artifact.id}
        data-artifact-kind={isCode ? "code" : "document"}
      >
        <div className="cm-doc-card__head">
          <div className="cm-doc-card__identity">
            <span className="cm-doc-card__icon" aria-hidden="true">
              {isCode ? <FileCode2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="cm-doc-card__title" title={title}>{title}</div>
              <div className="cm-doc-card__meta">
                <span className="cm-doc-card__badge">{kindLabel}</span>
                <span className="cm-doc-card__filename">{filename}</span>
                {sizeLabel ? <span>{sizeLabel}</span> : null}
              </div>
            </div>
          </div>

          <div className="cm-doc-card__actions">
            <button
              type="button"
              className="cm-doc-card__btn"
              onClick={() => void handleCopy()}
              title="Copy full content"
              aria-label={`Copy ${title}`}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

            <button
              type="button"
              className="cm-doc-card__btn"
              onClick={handleDownload}
              title={`Download ${filename}`}
              aria-label={`Download ${filename}`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>

            {hasSecondarySol ? (
              <button
                type="button"
                className="cm-doc-card__btn"
                onClick={handleDownloadSecondarySol}
                title="Download Solidity source"
              >
                <Download className="h-3.5 w-3.5" />
                <span>.sol</span>
              </button>
            ) : null}

            {!isCode ? (
              <button
                type="button"
                className="cm-doc-card__btn"
                onClick={handlePrintPdf}
                title="Save as PDF"
                aria-label={`Print ${title} to PDF`}
              >
                <Printer className="h-3.5 w-3.5" />
                <span>PDF</span>
              </button>
            ) : null}

            <button
              type="button"
              className="cm-doc-card__btn cm-doc-card__btn--primary"
              onClick={() => setOpen(true)}
              title={`Open ${title}`}
              aria-label={`Expand ${title}`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Open</span>
            </button>
          </div>
        </div>

        {artifact.summary && artifact.summary !== title ? (
          <p className="cm-doc-card__summary">{artifact.summary}</p>
        ) : null}

        <div
          role="button"
          tabIndex={0}
          className="cm-doc-card__preview"
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          aria-label={`Open full preview of ${title}`}
        >
          <div className="cm-doc-card__preview-inner">
            {isCode ? (
              <pre className="cm-code-block__pre cm-code-block__pre--compact">
                <code>{previewBody || "// Empty file"}</code>
              </pre>
            ) : (
              <MarkdownRenderer content={previewBody || "Empty document."} />
            )}
          </div>
          <div className="cm-doc-card__fade" aria-hidden="true">
            <span className="cm-doc-card__fade-cta">
              <Maximize2 className="h-3 w-3" />
              Open full {isCode ? "file" : "document"}
            </span>
          </div>
        </div>

        {showChainGpt ? (
          <div className="cm-doc-card__footer">
            <PoweredByChainGpt />
          </div>
        ) : null}
      </article>

      {open ? (
        <ShellModal
          open={open}
          onClose={() => setOpen(false)}
          title={(
            <span className="cm-doc-modal__title">
              {isCode ? <FileCode2 className="h-4 w-4 text-fuchsia-400" /> : <FileText className="h-4 w-4 text-cyan-400" />}
              <span className="truncate">{title}</span>
            </span>
          )}
          subtitle={`${filename}${language ? ` · ${language}` : ""}${sizeLabel ? ` · ${sizeLabel}` : ""}`}
          className="cm-doc-modal"
          contentClassName="cm-doc-modal__content"
        >
          <div className="cm-doc-modal__toolbar">
            <div className="cm-doc-modal__toolbar-actions">
              <ShellButton tone="secondary" size="sm" onClick={() => void handleCopy()}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </ShellButton>
              <ShellButton tone="secondary" size="sm" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
                <span>{filename}</span>
              </ShellButton>
              {hasSecondarySol ? (
                <ShellButton tone="secondary" size="sm" onClick={handleDownloadSecondarySol}>
                  <Download className="h-3.5 w-3.5" />
                  <span>.sol</span>
                </ShellButton>
              ) : null}
              {!isCode ? (
                <ShellButton tone="ghost" size="sm" onClick={handlePrintPdf}>
                  <Printer className="h-3.5 w-3.5" />
                  <span>PDF</span>
                </ShellButton>
              ) : null}
            </div>
            {showChainGpt ? <PoweredByChainGpt /> : null}
          </div>

          <div className="cm-doc-modal__body cm-delivery-body">
            {isCode ? (
              <HighlightedCode
                code={body || "// Empty file"}
                language={language || "text"}
                showHeader={false}
              />
            ) : (
              <MarkdownRenderer content={body || "Empty document."} />
            )}
          </div>
        </ShellModal>
      ) : null}

      {printing && typeof document !== "undefined"
        ? createPortal(
          <article className="cm-doc-print-surface" data-printing="true">
            <header className="cm-doc-print-surface__head">
              <h1 className="cm-doc-print-surface__title">{title}</h1>
              <div className="cm-doc-print-surface__meta">
                <span>{filename}</span>
                {sizeLabel ? <span>{sizeLabel}</span> : null}
              </div>
            </header>
            <div className="cm-doc-print-surface__body">
              <MarkdownRenderer content={body || "Empty document."} />
            </div>
            {showChainGpt ? (
              <footer className="cm-doc-print-surface__footer">
                <PoweredByChainGpt />
              </footer>
            ) : null}
          </article>,
          document.body,
        )
        : null}
    </>
  );
}

export const DocumentCard = memo(DocumentCardInner);
export default DocumentCard;
