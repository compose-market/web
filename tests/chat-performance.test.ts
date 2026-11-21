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

test("applyPendingDeltaMap coalesces text deltas atomically and preserves untouched message refs", () => {
  const userMsg: ChatMessage = {
    id: "user-1",
    role: "user",
    content: "Audit this contract",
    timestamp: 1000,
    type: "text",
  };
  const assistantMsg: ChatMessage = {
    id: "asst-1",
    role: "assistant",
    content: "Init ",
    timestamp: 1001,
    type: "text",
    isStreaming: true,
    blocks: [{ id: "b-1", type: "text", text: "Init " }],
  };
  const prev = [userMsg, assistantMsg];

  const batch = new Map<string, PendingDeltaBatch>([
    [
      "asst-1",
      {
        blocks: new Map([
          ["b-1", { type: "text", delta: "chunk 1 chunk 2." }],
        ]),
        content: "Init chunk 1 chunk 2.",
      },
    ],
  ]);

  const next = applyPendingDeltaMap(prev, batch);
  assert.equal(next[0], userMsg, "Untouched user message must keep identical reference");
  assert.notEqual(next[1], assistantMsg, "Updated assistant message must produce new object");
  assert.equal(next[1].content, "Init chunk 1 chunk 2.");
  assert.equal(next[1].blocks?.[0]?.type, "text");
  if (next[1].blocks?.[0]?.type === "text") {
    assert.equal(next[1].blocks[0].text, "Init chunk 1 chunk 2.");
  }

  // Empty batch returns exact same array reference
  assert.equal(applyPendingDeltaMap(prev, new Map()), prev);
});

test("MessageItem places sleek actions inline inside assistant footer when present, and below bubble otherwise", () => {
  const receipt: Receipt = {
    id: "rcpt-1",
    service: "agent",
    action: "stream",
    subject: "agent:0x123",
    finalAmountWei: "1200",
    settled: true,
    txHash: "0xdeadbeef",
    createdAt: Date.now(),
  };

  const assistantWithFooter: ChatMessage = {
    id: "m-asst-footer",
    role: "assistant",
    content: "Done auditing.",
    timestamp: 1000,
    type: "text",
    receipt,
    receipts: [receipt],
  };

  const withFooterHtml = renderToStaticMarkup(
    React.createElement(MessageItem, {
      message: assistantWithFooter,
      showActions: true,
      onCopy: () => undefined,
      onRetry: () => undefined,
      onDelete: () => undefined,
    }),
  );

  assert.match(withFooterHtml, /cm-chat-message__footer/);
  assert.match(withFooterHtml, /cm-chat-message__actions--inline/);
  assert.doesNotMatch(withFooterHtml, /cm-chat-message__actions--below/);

  const userMsg: ChatMessage = {
    id: "m-user-1",
    role: "user",
    content: "Hello agent",
    timestamp: 1001,
    type: "text",
  };

  const userHtml = renderToStaticMarkup(
    React.createElement(MessageItem, {
      message: userMsg,
      showActions: true,
      onCopy: () => undefined,
      onRetry: () => undefined,
      onDelete: () => undefined,
    }),
  );

  assert.match(userHtml, /cm-chat-message__actions--below/);
  assert.doesNotMatch(userHtml, /cm-chat-message__actions--inline/);
  // Actions strip must appear after the bubble, never above it
  assert.ok(
    userHtml.indexOf("cm-chat-message__bubble") < userHtml.indexOf("cm-chat-message__actions--below"),
    "Message actions must sit below the bubble, never above it",
  );
});