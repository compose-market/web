import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("agent page lets runtime resolve cards by wallet", () => {
  const page = readFileSync(resolve(root, "src/pages/agent.tsx"), "utf8");
  const streamHook = readFileSync(resolve(root, "src/hooks/use-stream.ts"), "utf8");

  assert.doesNotMatch(page, /RuntimeAgentCard|runtimeAgentCard|agentCardUri|agentCard:/);
  assert.doesNotMatch(streamHook, /RuntimeAgentCard|agentCard\?:|agentCard:\s*args\.agentCard/);
});

test("agent stream hook forwards structured MSM controls into the SDK request", () => {
  const streamHook = readFileSync(resolve(root, "src/hooks/use-stream.ts"), "utf8");

  assert.match(streamHook, /AgentStreamControls/);
  assert.match(streamHook, /interface AgentStreamArgs extends AgentStreamControls/);
  assert.match(streamHook, /\.\.\.\(args\.plan\s*!==\s*undefined\s*\?\s*\{\s*plan:\s*args\.plan\s*\}/);
  assert.match(streamHook, /\.\.\.\(args\.constraints\s*\?\s*\{\s*constraints:\s*args\.constraints\s*\}/);
});

test("agent page persists thread ids across remounts until clear chat", () => {
  const page = readFileSync(resolve(root, "src/pages/agent.tsx"), "utf8");
  const threadHook = readFileSync(resolve(root, "src/hooks/use-thread.ts"), "utf8");

  // The page scopes the thread key (user + agent); the shared hook owns the
  // sessionStorage persistence (get on reattach, set on reset, remove on clear).
  assert.match(page, /agent-thread-\$\{backpackUserId\}-\$\{agentWallet\}/);
  assert.match(page, /useConversationThread\(/);
  assert.match(threadHook, /sessionStorage\.getItem\(thread\.key\)/);
  assert.match(threadHook, /sessionStorage\.setItem\(thread\.key, nextThreadId\)/);
  assert.match(threadHook, /sessionStorage\.removeItem\(thread\.key\)/);
});
