import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer, normalizeMediaUrl } from "../src/lib/performance/markdown";
import { DocumentCard } from "../src/components/document";
import { SlashCommandPopover } from "../src/components/slash-commands";
import {
  reconcileMessageReceipts,
  summarizeTurnReceipts,
} from "../src/hooks/use-receipts";
import { formatWeiUsd } from "../src/lib/receipts";
import type { InferenceAnalytics, Receipt } from "@compose-market/sdk";

test("1a: MarkdownRenderer renders inline backtick code inline and fenced blocks in .cm-code-block", () => {
  const md = [
    "Audit of the `Remix` contract referencing `IERC20` and `remixSong`.",
    "",
    "```solidity",
    "pragma solidity ^0.8.28;",
    "contract Remix {}",
    "```",
  ].join("\n");

  const html = renderToStaticMarkup(React.createElement(MarkdownRenderer, { content: md }));

  // Inline backticks must use .cm-inline-code and must NOT create extra .cm-code-block frames
  assert.match(html, /<code class="cm-inline-code">Remix<\/code>/);
  assert.match(html, /<code class="cm-inline-code">IERC20<\/code>/);
  assert.match(html, /<code class="cm-inline-code">remixSong<\/code>/);
  const blockCount = (html.match(/class="cm-code-block"/g) ?? []).length;
  assert.equal(blockCount, 1, "Only the single fenced Solidity block should render as .cm-code-block");
  assert.match(html, /class="cm-code-block__lang">solidity</);
});

test("1b: DocumentCard renders formatted preview, exact filename, and conditional ChainGPT attribution", () => {
  const auditHtml = renderToStaticMarkup(
    React.createElement(DocumentCard, {
      variant: "document",
      artifact: {
        id: "art-audit-1",
        artifactType: "document",
        title: "Remix Security Audit",
        filename: "Remix-audit.md",
        provider: "chaingpt",
        bytes: 4096,
        content: "# Audit Report\n\n**Score:** 84/100\n\nCheck `remixSong`.",
      },
    }),
  );

  assert.match(auditHtml, /Remix Security Audit/);
  assert.match(auditHtml, /Remix-audit\.md/);
  assert.match(auditHtml, /<h1 class="cm-markdown__h1">Audit Report<\/h1>/);
  assert.match(auditHtml, /<strong class="cm-markdown__strong">Score:<\/strong>/);
  assert.doesNotMatch(auditHtml, /\*\*Score:\*\*/);
  assert.match(auditHtml, /Powered by/);

  const genericCodeHtml = renderToStaticMarkup(
    React.createElement(DocumentCard, {
      variant: "code",
      artifact: {
        id: "art-code-2",
        artifactType: "code",
        title: "Remix Refactored",
        filename: "Remix.sol",
        language: "solidity",
        content: "pragma solidity ^0.8.28;\ncontract Remix {}",
      },
    }),
  );

  assert.match(genericCodeHtml, /Remix\.sol/);
  assert.match(genericCodeHtml, /SOLIDITY/);
  assert.doesNotMatch(genericCodeHtml, /Powered by/, "Generic non-ChainGPT artifacts must not hardcode ChainGPT attribution");
});

test("1c: MarkdownRenderer suppresses exact media URLs already rendered as message artifacts", () => {
  const mediaUrl = "https://gateway.pinata.cloud/ipfs/QmTestImage123/image-1.png";
  const otherUrl = "https://example.com/docs";
  const md = `Here is your image:\n\n![cover](${mediaUrl})\n\n[Open file](${mediaUrl})\n\n[Read docs](${otherUrl})`;
  const suppressed = new Set([normalizeMediaUrl(mediaUrl)]);

  const html = renderToStaticMarkup(
    React.createElement(MarkdownRenderer, { content: md, suppressedMediaUrls: suppressed }),
  );

  assert.doesNotMatch(html, /QmTestImage123/, "Suppressed artifact URL must not render again in prose");
  assert.match(html, /https:\/\/example\.com\/docs/, "Unrelated links must remain visible");
});

test("1d: SlashCommandPopover uses unified .cm-slash-popover glass classes and output.tsx removes snap-y leftovers", () => {
  const html = renderToStaticMarkup(
    React.createElement(SlashCommandPopover, {
      input: "/p",
      selectedIndex: 0,
      onSelect: () => undefined,
      onHighlight: () => undefined,
    }),
  );

  assert.match(html, /class="cm-slash-popover"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /\/plan/);
  assert.match(html, /\/proof/);

  const outputSrc = readFileSync(resolve(process.cwd(), "src/components/output.tsx"), "utf8");
  assert.doesNotMatch(outputSrc, /snap-y|snap-proximity|snap-start/);
});

test("1e: reconcileMessageReceipts & summarizeTurnReceipts merge all turn settlements and upgrade queued -> settled", () => {
  const initialAgentReceipt: Receipt = {
    id: "pi-agent-1",
    service: "agent",
    action: "stream",
    subject: "agent:0xabc",
    finalAmountWei: "90",
    platformFeeWei: "90",
    settlementStatus: "queued",
    paymentIntentId: "pi-agent-1",
    network: "eip155:43114",
    settledAt: 0,
  };

  const fetchedFromApi: Receipt[] = [
    {
      id: "rct_model_1",
      service: "inference",
      subject: "openai/gpt-4o",
      finalAmountWei: "4500",
      providerAmountWei: "4455",
      platformFeeWei: "45",
      settlementStatus: "settled",
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      paymentIntentId: "pi-model-1",
      network: "eip155:43114",
      settledAt: 1_700_000_001_000,
    },
    {
      id: "rct_conn_1",
      service: "connector",
      subject: "mcp:smart-contracts",
      finalAmountWei: "5000",
      providerAmountWei: "5000",
      settlementStatus: "queued",
      paymentIntentId: "pi-conn-1",
      network: "eip155:43114",
      settledAt: 0,
    },
    {
      id: "rct_agent_1",
      service: "agent",
      subject: "agent:0xabc",
      finalAmountWei: "90",
      platformFeeWei: "90",
      settlementStatus: "settled",
      txHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      paymentIntentId: "pi-agent-1",
      network: "eip155:43114",
      settledAt: 1_700_000_003_000,
    },
  ];

  const analyticsRows: InferenceAnalytics.InferenceSettlement[] = [
    {
      id: "settle-conn-1",
      requestId: "req-conn-1",
      paymentIntentId: "pi-conn-1",
      network: "eip155:43114",
      family: "connector",
      model: "mcp:smart-contracts",
      types: [],
      operation: "execute",
      status: "settled",
      transactionHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      pricedUnits: [],
      billing: {
        inferenceAmountAtomic: "5000",
        platformFeeAtomic: "0",
        finalAmountAtomic: "5000",
        currency: "USDC",
        decimals: 6,
      },
      settledAt: new Date(1_700_000_002_000).toISOString(),
      createdAt: new Date(1_700_000_000_000).toISOString(),
    },
  ];

  const merged = reconcileMessageReceipts([initialAgentReceipt], fetchedFromApi, analyticsRows);
  assert.equal(merged.length, 3, "Should deduplicate agent receipt by paymentIntentId and include model + connector");

  const summary = summarizeTurnReceipts(merged);
  assert.ok(summary);
  assert.equal(summary.totalAmountWei, "9590");
  assert.equal(formatWeiUsd(summary.totalAmountWei), "$0.009590");
  assert.equal(summary.status, "settled");
  assert.equal(summary.settledCount, 3);
  assert.equal(summary.totalCount, 3);
  assert.ok(summary.primaryTxHash?.startsWith("0x"));
});

test("2: agent side-panel scrolls gracefully and Graph Canvas2D prevents clipping/overlay collisions", () => {
  const agentsCss = readFileSync(resolve(process.cwd(), "src/styles/agents.css"), "utf8");
  const motionCss = readFileSync(resolve(process.cwd(), "src/styles/motion.css"), "utf8");
  const graphSrc = readFileSync(resolve(process.cwd(), "src/motion/graph.tsx"), "utf8");

  assert.match(agentsCss, /\.cm-agent-panel\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(agentsCss, /\.cm-agent-panel__activity-icon-btn/);
  assert.match(motionCss, /\.cm-graph__svg\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(motionCss, /@container cm-iso \(max-width: 26rem\)/);
  assert.match(graphSrc, /const VB_W = 360;/);
  assert.match(graphSrc, /const VB_H = 192;/);
  assert.match(graphSrc, /const LABEL_X = 208;/);
});
