import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ActivityEvent, ModelEvent } from "@compose-market/sdk";
import type { MessageBlock, UseChatReturn } from "../src/hooks/use-chat";
import {
  createReasoningState,
  projectStreamEvent,
} from "../src/hooks/use-stream";
import {
  mergeSemanticModelRanks,
  rankCatalogModels,
  type CatalogModel,
} from "../src/lib/models";
import {
  hasSessionAuth,
  shouldAttachPersistedKey,
} from "../src/lib/sdk";
import { API_BASE_URL, RUNTIME_BASE_URL } from "../src/lib/performance/urls";

function makeMockChat() {
  const blocks: MessageBlock[] = [];
  const chat = {
    currentAssistantIdRef: { current: "assistant-1" },
    planMessageIdRef: { current: null },
    streamedTextRef: { current: "" },
    applyAssistantModelEvent: () => {},
    applyAssistantActivityEvent: () => {},
    setActivityPhase: () => {},
    startToolActivity: () => {},
    finishToolActivity: () => {},
    clearActivityStateUnlessError: () => {},
    stopRealtimeArtifacts: () => {},
    attachAssistantUsage: () => {},
    attachAssistantRun: () => {},
    flushPendingDeltas: () => {},
    upsertAssistantBlock: (_id: string, block: MessageBlock) => {
      const idx = blocks.findIndex((item) => item.id === block.id);
      if (idx >= 0) blocks[idx] = { ...blocks[idx], ...block } as MessageBlock;
      else blocks.push(block);
    },
    appendAssistantBlockText: (_id: string, blockId: string, type: "text" | "reasoning", delta: string) => {
      const idx = blocks.findIndex((item) => item.id === blockId);
      if (idx >= 0) {
        const current = blocks[idx];
        const existing = current.type === "text" || current.type === "reasoning" ? current.text : "";
        blocks[idx] = type === "reasoning"
          ? { id: blockId, type: "reasoning", text: existing + delta, startedAt: current.type === "reasoning" ? current.startedAt : 1 }
          : { id: blockId, type: "text", text: existing + delta };
      } else {
        blocks.push(type === "reasoning"
          ? { id: blockId, type: "reasoning", text: delta, startedAt: 1 }
          : { id: blockId, type: "text", text: delta });
      }
    },
    finishAssistantReasoningBlock: (_id: string, blockId: string, finalText?: string) => {
      const idx = blocks.findIndex((item) => item.id === blockId);
      if (idx >= 0) {
        const current = blocks[idx];
        const existing = current.type === "reasoning" ? current.text : "";
        const nextText = !finalText
          ? existing
          : !existing
            ? finalText
            : existing.includes(finalText)
              ? existing
              : finalText.startsWith(existing)
                ? finalText
                : `${existing}\n\n${finalText}`;
        blocks[idx] = { id: blockId, type: "reasoning", text: nextText, startedAt: 1, finishedAt: 2 };
      } else if (finalText) {
        blocks.push({ id: blockId, type: "reasoning", text: finalText, startedAt: 1, finishedAt: 2 });
      }
    },
  } as unknown as UseChatReturn;
  return { chat, blocks };
}

test("shouldAttachPersistedKey covers both api and runtime authenticated paths only", () => {
  assert.equal(shouldAttachPersistedKey(new URL(`${RUNTIME_BASE_URL}/agent/0xabc/threads?userAddress=0x1`)), true);
  assert.equal(shouldAttachPersistedKey(new URL(`${RUNTIME_BASE_URL}/api/workspace/upload`)), true);
  assert.equal(shouldAttachPersistedKey(new URL(`${API_BASE_URL}/permissions?userAddress=0x1`)), true);
  assert.equal(shouldAttachPersistedKey(new URL(`${API_BASE_URL}/api/local/link-token`)), true);
  assert.equal(shouldAttachPersistedKey(new URL(`${API_BASE_URL}/api/analytics/inference`)), true);
  assert.equal(shouldAttachPersistedKey(new URL("https://evil.example/agent/0xabc/threads")), false);
  assert.equal(shouldAttachPersistedKey(new URL(`${API_BASE_URL}/v1/models`)), false);
  assert.equal(hasSessionAuth("0x0000000000000000000000000000000000000001"), false);
});

test("projectStreamEvent deduplicates repeated model.reasoning.done events into one ReasoningBlock", () => {
  const { chat, blocks } = makeMockChat();
  const cbRef = { current: {} };
  const textBlockRef = { current: null as string | null };
  const blockTextRef = { current: "" };
  const reasoningStateRef = { current: createReasoningState() };
  const blockSeqRef = { current: 0 };

  const events: ModelEvent[] = [
    { domain: "model", type: "model.start", id: "start:1", ts: 1, responseId: "resp_1" },
    { domain: "model", type: "model.reasoning.delta", id: "rs_1", itemId: "rs_1", ts: 2, responseId: "resp_1", delta: "First " },
    { domain: "model", type: "model.reasoning.delta", id: "rs_1", itemId: "rs_1", ts: 3, responseId: "resp_1", delta: "thought." },
    { domain: "model", type: "model.reasoning.done", id: "rs_1", itemId: "rs_1", ts: 4, responseId: "resp_1", text: "First thought." },
    { domain: "model", type: "model.reasoning.done", id: "rs_1", itemId: "rs_1", ts: 5, responseId: "resp_1", text: "First thought." },
    { domain: "model", type: "model.reasoning.done", id: "rs_alt", ts: 6, responseId: "resp_1", text: "First thought." },
    { domain: "model", type: "model.text.delta", id: "txt:1", ts: 7, responseId: "resp_1", delta: "Answer" },
    { domain: "model", type: "model.done", id: "done:1", ts: 8, responseId: "resp_1" },
  ];

  for (const event of events) {
    projectStreamEvent(event, chat, cbRef, textBlockRef, blockTextRef, reasoningStateRef, blockSeqRef);
  }

  const reasoningBlocks = blocks.filter((b) => b.type === "reasoning");
  assert.equal(reasoningBlocks.length, 1);
  assert.equal(reasoningBlocks[0].text, "First thought.");
  assert.equal(reasoningBlocks[0].finishedAt, 2);
});

test("projectStreamEvent coalesces multi-step tool-loop reasoning rounds into one ReasoningBlock", () => {
  const { chat, blocks } = makeMockChat();
  const cbRef = { current: {} };
  const textBlockRef = { current: null as string | null };
  const blockTextRef = { current: "" };
  const reasoningStateRef = { current: createReasoningState() };
  const blockSeqRef = { current: 0 };

  const events: Array<ModelEvent | ActivityEvent> = [
    { domain: "model", type: "model.start", id: "m1", ts: 1, responseId: "resp_1" },
    { domain: "model", type: "model.reasoning.delta", id: "r1", itemId: "rs_1", ts: 2, responseId: "resp_1", delta: "Step 1: inspect tools." },
    { domain: "model", type: "model.reasoning.done", id: "r1", itemId: "rs_1", ts: 3, responseId: "resp_1", text: "Step 1: inspect tools." },
    { domain: "activity", type: "activity.tool", id: "tool:1", ts: 4, kind: "tool", status: "running", name: "search" },
    { domain: "activity", type: "activity.tool", id: "tool:1", ts: 5, kind: "tool", status: "completed", name: "search" },
    { domain: "model", type: "model.start", id: "m2", ts: 6, responseId: "resp_2" },
    { domain: "model", type: "model.reasoning.delta", id: "r2", itemId: "rs_2", ts: 7, responseId: "resp_2", delta: "Step 2: synthesize result." },
    { domain: "model", type: "model.reasoning.done", id: "r2", itemId: "rs_2", ts: 8, responseId: "resp_2", text: "Step 2: synthesize result." },
    { domain: "model", type: "model.text.delta", id: "t1", ts: 9, responseId: "resp_2", delta: "Here is the final answer." },
    { domain: "model", type: "model.done", id: "d1", ts: 10, responseId: "resp_2" },
  ];

  for (const event of events) {
    projectStreamEvent(event, chat, cbRef, textBlockRef, blockTextRef, reasoningStateRef, blockSeqRef, true);
  }

  const reasoningBlocks = blocks.filter((b) => b.type === "reasoning");
  const textBlocks = blocks.filter((b) => b.type === "text");
  assert.equal(reasoningBlocks.length, 1);
  assert.equal(reasoningBlocks[0].text, "Step 1: inspect tools.\n\nStep 2: synthesize result.");
  assert.equal(reasoningBlocks[0].finishedAt, 2);
  assert.equal(textBlocks.length, 1);
  assert.equal(textBlocks[0].text, "Here is the final answer.");
});

test("projectStreamEvent keeps late mid-sentence reasoning deltas and reasoning.done in one ReasoningBlock above the answer", () => {
  const { chat, blocks } = makeMockChat();
  const cbRef = { current: {} };
  const textBlockRef = { current: null as string | null };
  const blockTextRef = { current: "" };
  const reasoningStateRef = { current: createReasoningState() };
  const blockSeqRef = { current: 0 };

  const prefix = "The user is asking a flirtatious/inappropriate question in French. No tools";
  const tail = " needed.";
  const fullReasoning = `${prefix}${tail}`;
  const answer = "I’m here to help you get things done—research, code, plans, whatever you need. Let’s keep it professional. What can I do for you today?";

  const events: ModelEvent[] = [
    { domain: "model", type: "model.start", id: "start:1", ts: 1, responseId: "resp_nemo" },
    { domain: "model", type: "model.reasoning.delta", id: "rs_1", itemId: "rs_1", ts: 2, responseId: "resp_nemo", delta: prefix },
    { domain: "model", type: "model.text.delta", id: "txt:1", ts: 3, responseId: "resp_nemo", delta: answer },
    { domain: "model", type: "model.reasoning.delta", id: "rs_2", itemId: "rs_1", ts: 4, responseId: "resp_nemo", delta: tail },
    { domain: "model", type: "model.reasoning.done", id: "rs_done", itemId: "rs_1", ts: 5, responseId: "resp_nemo", text: fullReasoning },
    { domain: "model", type: "model.done", id: "done:1", ts: 6, responseId: "resp_nemo" },
  ];

  for (const event of events) {
    projectStreamEvent(event, chat, cbRef, textBlockRef, blockTextRef, reasoningStateRef, blockSeqRef);
  }

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.type, "reasoning");
  assert.equal(blocks[1]?.type, "text");
  assert.equal(blocks[0]?.type === "reasoning" ? blocks[0].text : "", fullReasoning);
  assert.equal(blocks[1]?.type === "text" ? blocks[1].text : "", answer);
});

test("stream and pulse never fabricate client-side Connecting to model status copy", () => {
  const streamSource = readFileSync(new URL("../src/hooks/use-stream.ts", import.meta.url), "utf8");
  const pulseSource = readFileSync(new URL("../src/components/pulse.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(streamSource, /Connecting to model|Connecting to agent|Starting workflow/);
  assert.doesNotMatch(pulseSource, /if \(status === "waiting"\) return "Connecting"/);
});

test("model search ranks Frontier models ahead of older variants while exact modelId stays first", () => {
  const catalog: CatalogModel[] = [
    {
      modelId: "gpt-image-2.5-flare",
      name: "GPT Image 2.5 Flare",
      provider: "openai",
      family: "openai",
      type: "text-to-image",
      input: ["text"],
      output: ["image"],
      description: "Fast image generation model",
      isFrontier: false,
      isLatest: false,
    },
    {
      modelId: "gpt-image-2.5",
      name: "GPT Image 2.5",
      provider: "openai",
      family: "openai",
      type: "text-to-image",
      input: ["text"],
      output: ["image"],
      description: "Flagship image generation model",
      isFrontier: true,
      isLatest: true,
    },
  ];

  const generalLocal = rankCatalogModels(catalog, "image generation", 10);
  const generalMerged = mergeSemanticModelRanks(catalog, generalLocal, [
    { modelId: "gpt-image-2.5", provider: "openai", score: 0.96, isFrontier: true, isLatest: true },
    { modelId: "gpt-image-2.5-flare", provider: "openai", score: 0.72, isFrontier: false, isLatest: false },
  ], 10);
  assert.equal(generalMerged[0]?.model.modelId, "gpt-image-2.5");

  const exactLocal = rankCatalogModels(catalog, "gpt-image-2.5-flare", 10);
  const exactMerged = mergeSemanticModelRanks(catalog, exactLocal, [
    { modelId: "gpt-image-2.5", provider: "openai", score: 0.9, isFrontier: true, isLatest: true },
    { modelId: "gpt-image-2.5-flare", provider: "openai", score: 0.99, isFrontier: false, isLatest: false },
  ], 10);
  assert.equal(exactMerged[0]?.model.modelId, "gpt-image-2.5-flare");
});
