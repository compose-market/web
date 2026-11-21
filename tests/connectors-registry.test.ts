import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("use-registry routes search through unified sdk.connectors.all(?q=) and includes accounts by default", async () => {
  const source = await readFile(path.join(WEB_ROOT, "src/hooks/use-registry.ts"), "utf-8");

  assert.match(source, /sdk\.connectors\.all\(\{\s*q:\s*query/s);
  assert.match(source, /\["mcp",\s*"account",\s*"onchain"\]/);
  assert.match(source, /accounts\?\.total\s*\?\?\s*accounts\?\.toolkits\?\.length\s*\?\?\s*0/);
  assert.doesNotMatch(source, /connectors\.search\(/);
  assert.doesNotMatch(source, /connectors\.accounts\.meta\(/);
  assert.doesNotMatch(source, /connectors\.accounts\.search\(/);
});

test("command bar, tester, backpack, and chat support full Composio accounts and OAuth polling without legacy registry page", async () => {
  assert.equal(existsSync(path.join(WEB_ROOT, "src/pages/registry.tsx")), false);
  const [commandBar, tester, backpack, chat] = await Promise.all([
    readFile(path.join(WEB_ROOT, "src/components/connectors/command-bar.tsx"), "utf-8"),
    readFile(path.join(WEB_ROOT, "src/components/connectors/tester.tsx"), "utf-8"),
    readFile(path.join(WEB_ROOT, "src/components/backpack.tsx"), "utf-8"),
    readFile(path.join(WEB_ROOT, "src/components/chat.tsx"), "utf-8"),
  ]);

  assert.match(commandBar, /origin = "mcp,account,onchain"/);
  assert.match(tester, /!accountConnection\?\.noAuth/);
  assert.match(tester, /Public \(No Auth\)/);
  assert.match(backpack, /sdk\.connectors\.accounts\.toolkits\.list\(\{\s*q:\s*query,\s*limit:\s*50\s*\}/);
  assert.match(chat, /sdk\.connectors\.accounts\.status\(/);
  assert.match(chat, /Waiting for login in popup/);
});