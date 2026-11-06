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