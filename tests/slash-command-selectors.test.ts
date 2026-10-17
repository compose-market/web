import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  clearSlashCommandToken,
  isSelectableSlashCommandName,
  nextSelectedSlashCommands,
  selectableSlashCommandNames,
  withoutSelectedSlashCommand,
} from "../src/components/slash-commands.tsx";

const root = resolve(import.meta.dirname, "..");

test("only plan, goal, sandbox, and proof are composer selector slash commands", () => {
  assert.deepEqual(selectableSlashCommandNames, ["plan", "goal", "sandbox", "proof"]);
  for (const name of ["plan", "goal", "sandbox", "proof"]) {
    assert.equal(isSelectableSlashCommandName(name), true);
  }
  for (const name of ["mode", "receipt", "artifacts", "thread"]) {
    assert.equal(isSelectableSlashCommandName(name), false);
  }
});

test("selector slash commands clear only the active leading slash token", () => {
  assert.equal(clearSlashCommandToken("/"), "");
  assert.equal(clearSlashCommandToken("/pl"), "");
  assert.equal(clearSlashCommandToken("/plan "), "");
  assert.equal(clearSlashCommandToken("/plan build a research plan"), "build a research plan");
  assert.equal(clearSlashCommandToken("keep /plan literal text"), "keep /plan literal text");
});

test("selected slash command state dedupes and removes controls", () => {
  assert.deepEqual(nextSelectedSlashCommands([], "plan"), ["plan"]);
  assert.deepEqual(nextSelectedSlashCommands(["plan"], "plan"), ["plan"]);
  assert.deepEqual(nextSelectedSlashCommands(["plan"], "goal"), ["plan", "goal"]);
  assert.deepEqual(nextSelectedSlashCommands(["plan"], "mode"), ["plan"]);
  assert.deepEqual(withoutSelectedSlashCommand(["plan", "goal"], "plan"), ["goal"]);
});

test("slash command selection is owned by the composer and cannot submit through a global keydown path", () => {
  const slash = readFileSync(resolve(root, "src/components/slash-commands.tsx"), "utf8");
  const chat = readFileSync(resolve(root, "src/components/chat.tsx"), "utf8");

  assert.doesNotMatch(slash, /window\.addEventListener\("keydown"/);
  assert.match(slash, /stopPropagation\(\)/);
  assert.match(chat, /selectedSlashCommands/);
  assert.doesNotMatch(chat, /onInputChange\(`\/\$\{cmd\.name\} `\)/);
});

test("agent send maps selector badges into existing stream controls while preserving message text", () => {
  const agent = readFileSync(resolve(root, "src/pages/agent.tsx"), "utf8");

  assert.match(agent, /selectedSlashCommands/);
  assert.match(agent, /selected\.has\("plan"\)/);
  assert.match(agent, /selected\.has\("sandbox"\)/);
  assert.match(agent, /selected\.has\("proof"\)/);
  assert.match(agent, /name:\s*"goal"/);
  assert.match(agent, /objective:\s*prompt/);
  assert.match(agent, /let message = prompt/);
});
