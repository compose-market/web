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