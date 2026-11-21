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