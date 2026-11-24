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