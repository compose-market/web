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

test("scroll performance invariants hold across theme, styles, graph, and market without stripping glass aesthetics", () => {
  const shellCss = readFileSync(resolve(process.cwd(), "../packages/theme/src/shell/shell.css"), "utf8");
  assert.match(shellCss, /\.cm-shell-modal-overlay::before/);
  assert.match(shellCss, /\.cm-shell-modal::before/);
  assert.match(shellCss, /\.cm-shell-modal__body[\s\S]*contain:\s*layout style paint/);

  const indexCss = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");
  assert.match(indexCss, /\.cm-agent-chat-cell::before/);
  assert.match(indexCss, /backdrop-filter:\s*blur\(16px\)/);

  const traceCss = readFileSync(resolve(process.cwd(), "src/styles/trace.css"), "utf8");
  assert.match(traceCss, /\.cm-trace-backdrop::before/);
  assert.match(traceCss, /\.cm-trace__body[\s\S]*contain:\s*layout style paint/);

  const motionCss = readFileSync(resolve(process.cwd(), "src/styles/motion.css"), "utf8");
  assert.doesNotMatch(motionCss, /animation-timeline:\s*view\(\)/);
  assert.match(motionCss, /\.cm-tilt-surface\[data-tilt="active"\][\s\S]*will-change:\s*transform/);

  const marketCss = readFileSync(resolve(process.cwd(), "src/styles/market.css"), "utf8");
  assert.doesNotMatch(marketCss, /content-visibility:\s*auto/);
  assert.match(marketCss, /\.cm-market-agent-slot[\s\S]*contain:\s*layout style paint/);

  const graphSrc = readFileSync(resolve(process.cwd(), "src/motion/graph.tsx"), "utf8");
  assert.match(graphSrc, /<canvas\b/);
  assert.match(graphSrc, /getContext\("2d"\)/);
  assert.match(graphSrc, /memo\(/);

  const chatSrc = readFileSync(resolve(process.cwd(), "src/components/chat.tsx"), "utf8");
  assert.doesNotMatch(chatSrc, /\bmessages:\s*ChatMessage\[\]/);
  assert.match(chatSrc, /const MessageList = memo\(/);

  const identikitSrc = readFileSync(resolve(process.cwd(), "src/components/identikit.tsx"), "utf8");
  assert.match(identikitSrc, /export const AgentCard = React\.memo\(/);
  assert.match(identikitSrc, /onError=\{/);
});

test("sizedAvatarUrl selects thumb for market tiles and full for detail portraits without touching external/data URLs", () => {
  assert.equal(
    sizedAvatarUrl("https://agents.compose.market/agent/0xabc/avatar?v=0123456789abcdef", "thumb"),
    "https://agents.compose.market/agent/0xabc/avatar?v=0123456789abcdef&size=thumb",
  );
  assert.equal(
    sizedAvatarUrl("https://agents.compose.market/agent/0xabc/avatar?v=0123456789abcdef", "full"),
    "https://agents.compose.market/agent/0xabc/avatar?v=0123456789abcdef&size=full",
  );
  assert.equal(
    sizedAvatarUrl("https://agents.compose.market/agent/0xabc/avatar?v=0123456789abcdef&w=160", "thumb"),
    "https://agents.compose.market/agent/0xabc/avatar?v=0123456789abcdef&size=thumb",
  );
  assert.equal(
    sizedAvatarUrl("https://cdn.example.com/photo.png", "thumb"),
    "https://cdn.example.com/photo.png",
  );
  assert.equal(sizedAvatarUrl("data:image/png;base64,AAAA", "full"), "data:image/png;base64,AAAA");
  assert.equal(sizedAvatarUrl(null, "thumb"), null);
});

test("synchronous localStorage snapshots survive reload and purge owner-scoped data cleanly", () => {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    get length() { return store.size; },
    key(index: number) { return [...store.keys()][index] ?? null; },
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
  };
  const prevWindow = globalThis.window;
  const prevStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "window", { value: { localStorage: mockLocalStorage }, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage, configurable: true });

  try {
    writeAgentSnapshot("https://agents.compose.market", "v1", [{ walletAddress: "0x1111111111111111111111111111111111111111" } as never], "2026-11-20T00:00:00Z");
    const agentSnap = readAgentSnapshot("https://agents.compose.market");
    assert.equal(agentSnap?.version, "v1");
    assert.equal(agentSnap?.items.length, 1);

    writeModelSnapshot("https://models.compose.market", "m1", [{ modelId: "gpt-4o", provider: "openai" } as never], null);
    assert.equal(readModelSnapshot("https://models.compose.market")?.items[0]?.modelId, "gpt-4o");

    writeBenchmarksSnapshot("https://api.compose.market", { ok: true, data: [{ modelId: "gpt-4o" }] } as never);
    assert.equal(readBenchmarksSnapshot("https://api.compose.market")?.data.data.length, 1);

    const owner = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
    writeCachedKeys(owner, [{ keyId: "k1", createdAt: 100 } as never]);
    writeCachedAnalytics(owner, "7d::{}", { kind: "inference" } as never);
    assert.equal(readCachedKeys(owner)?.data.length, 1);
    assert.equal(readCachedAnalytics(owner, "7d::{}")?.data.kind, "inference");

    // Purging owner clears keys + analytics but keeps public catalogs intact
    purgeOwnerCaches(owner);
    assert.equal(readCachedKeys(owner), null);
    assert.equal(readCachedAnalytics(owner, "7d::{}"), null);
    assert.equal(readAgentSnapshot("https://agents.compose.market")?.version, "v1");
    assert.equal(readModelSnapshot("https://models.compose.market")?.version, "m1");
  } finally {
    Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: prevStorage, configurable: true });
  }
});
