import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PoweredByChainGpt, usedWeb3Chatbot } from "../src/components/chaingpt";
import type { ActivityState } from "@compose-market/sdk";

const root = resolve(import.meta.dirname, "..");

function read(path: string): string {
    return readFileSync(resolve(root, path), "utf8");
}

test("PoweredByChainGpt renders official ChainGPT Brand Kit Neon lockup and mobile-safe link", () => {
    const html = renderToStaticMarkup(React.createElement(PoweredByChainGpt));

    assert.match(html, /href="https:\/\/www\.chaingpt\.org"/);
    assert.match(html, /data-chaingpt-attribution="true"/);
    assert.match(html, /Powered by/);
    assert.match(html, /viewBox="0 0 156 34"/);
    // Official Brand Kit Neon gradient stops
    assert.match(html, /#6C5AE6/);
    assert.match(html, /#FC6756/);
    assert.match(html, /#26F4D0/);
    assert.match(html, /#F8CF3E/);
    // Mobile touch-target safeguard against global <768px min-h/min-w rules
    assert.match(html, /min-h-0/);
    assert.match(html, /min-w-0/);
});

test("NotificationsDialog pins PoweredByChainGpt in a non-shrinking modal footer", () => {
    const source = read("src/components/notifications.tsx");

    assert.match(source, /import \{ PoweredByChainGpt \} from "@\/components\/chaingpt"/);
    assert.match(source, /<div className="flex-shrink-0 border-t border-border\/40[^"]*">[\s\S]*?<PoweredByChainGpt/);
});

test("usedWeb3Chatbot detects web3_chatbot_call tool usage on assistant message activity", () => {
    assert.equal(usedWeb3Chatbot(undefined), false);

    const unrelatedActivity: ActivityState = {
        roots: ["tool:other"],
        nodes: {
            "tool:other": {
                id: "tool:other",
                kind: "tool",
                status: "completed",
                spanId: "tool:other",
                path: ["tool:other"],
                name: "other_tool",
                text: "",
                children: [],
                updatedAt: 1,
                events: 1,
            },
        },
        traces: [],
        errors: [],
        seen: {},
    };
    assert.equal(usedWeb3Chatbot(unrelatedActivity), false);

    const web3ChatbotActivity: ActivityState = {
        roots: ["tool:web3"],
        nodes: {
            "tool:web3": {
                id: "tool:web3",
                kind: "tool",
                status: "completed",
                spanId: "tool:web3",
                path: ["tool:web3"],
                name: "web3_chatbot_call",
                target: {
                    kind: "tool",
                    id: "web3_chatbot_call",
                    name: "chaingpt",
                    details: {
                        toolName: "web3_chatbot_call",
                        provider: "chaingpt",
                    },
                },
                text: "",
                children: [],
                updatedAt: 1,
                events: 1,
            },
        },
        traces: [],
        errors: [],
        seen: {},
    };
    assert.equal(usedWeb3Chatbot(web3ChatbotActivity), true);

    const chatSource = read("src/components/chat.tsx");
    assert.match(chatSource, /showChainGptAttribution[\s\S]*?<PoweredByChainGpt \/>/);
});

test("SnippetCard renders PoweredByChainGpt in the artifact card footer and appends attribution on .md download", () => {
    const snippetSource = read("src/components/snippet.tsx");

    assert.match(snippetSource, /import \{ PoweredByChainGpt \} from "@\/components\/chaingpt"/);
    assert.match(snippetSource, /<PoweredByChainGpt \/>/);
    assert.match(snippetSource, /_Powered by \[ChainGPT\]\(https:\/\/www\.chaingpt\.org\)_/);
});
