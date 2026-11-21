import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildPreviewExcerpt, DocumentCard } from "../src/components/document";
import { applyPendingDeltaMap, type ChatMessage, type PendingDeltaBatch } from "../src/hooks/use-chat";
import { sizedAvatarUrl } from "../src/components/identikit";
import {
  purgeOwnerCaches,
  readAgentSnapshot,
  readBenchmarksSnapshot,
  readCachedAnalytics,
  readCachedKeys,
  readModelSnapshot,
  writeAgentSnapshot,
  writeBenchmarksSnapshot,
  writeCachedAnalytics,
  writeCachedKeys,
  writeModelSnapshot,
} from "../src/lib/cache";
import { MessageItem } from "../src/components/chat";
import type { Receipt } from "@compose-market/sdk";

test("buildPreviewExcerpt caps huge code and markdown bodies and closes truncated fences", () => {
  const shortMd = "# Title\n\nShort summary.";
  assert.equal(buildPreviewExcerpt(shortMd, false), shortMd);

  const hugeCode = Array.from({ length: 120 }, (_, i) => `uint256 constant LINE_${i} = ${i};`).join("\n");
  const slicedCode = buildPreviewExcerpt(hugeCode, true);
  assert.ok(slicedCode.split("\n").length <= 18, "Code preview should cap lines");
  assert.ok(slicedCode.length <= 1200, "Code preview should cap byte length");

  const hugeFencedMd = [
    "# Audit",
    "",
    "```solidity",
    ...Array.from({ length: 60 }, (_, i) => `function step${i}() external {}`),
    "```",
  ].join("\n");
  const slicedMd = buildPreviewExcerpt(hugeFencedMd, false);
  const fenceCount = (slicedMd.match(/^```/gm) ?? []).length;
  assert.equal(fenceCount % 2, 0, "Truncated markdown excerpt must close any open code fence");
});

test("DocumentCard does not mount ShellModal while closed and renders capped preview", () => {
  const longBody = Array.from({ length: 80 }, (_, i) => `Paragraph line ${i} about security findings.`).join("\n");
  const html = renderToStaticMarkup(
    React.createElement(DocumentCard, {
      variant: "document",
      artifact: {
        id: "doc-perf-1",
        artifactType: "document",
        title: "Large Audit",
        filename: "audit.md",
        content: longBody,
      },
    }),
  );

  assert.match(html, /Paragraph line 0/);
  assert.doesNotMatch(html, /Paragraph line 75/, "Closed DocumentCard preview must not parse tail of huge body");
  assert.doesNotMatch(html, /cm-shell-modal/, "ShellModal must remain unmounted until expanded");
});