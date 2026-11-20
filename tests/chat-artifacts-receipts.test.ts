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