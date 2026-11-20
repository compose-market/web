import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

test("web SDK singleton configures the channel service URL", () => {
  const source = read("src/lib/sdk.ts");
  const urlsSource = read("src/lib/performance/urls.ts");

  assert.match(urlsSource, /VITE_CHANNELS_URL/);
  assert.doesNotMatch(source, /wss:|ws:|url\.pathname === "\/channels"/);
  assert.match(source, /channelsUrl:\s*CHANNELS_BASE_URL,\s*\n\s*userAgent:\s*"compose-market-web"/);
});

test("app layout exposes global Backpack dock item and agent page omits per-page Backpack", () => {
  const layoutSource = read("src/components/layout/Layout.tsx");
  const walletSource = read("src/components/wallet.tsx");
  const agentSource = read("src/pages/agent.tsx");
  const testerSource = read("src/components/connectors/tester.tsx");

  assert.match(layoutSource, /aria-label="Backpack"/);
  assert.match(layoutSource, /<Backpack\b/);
  assert.match(walletSource, /<BackpackDialog/);
  assert.doesNotMatch(agentSource, /<BackpackDialog/);
  assert.doesNotMatch(agentSource, /fetch\([^)]*\/channels/u);
  assert.match(testerSource, /value:\s*"account",\s*label:\s*"Accounts"/);
  assert.match(testerSource, /sdk\.connectors\.accounts\.toolkits\.actions/);
  assert.match(testerSource, /sdk\.connectors\.accounts\.execute/);
});

test("channel dialog uses only SDK channel resources for channel routes", () => {
  const source = read("src/components/backpack.tsx");

  assert.match(source, /sdk\.channels\.status/);
  assert.match(source, /sdk\.channels\.link/);
  assert.match(source, /sdk\.channels\.disconnect/);
  assert.doesNotMatch(source, /fetch\([^)]*\/channels/u);
  assert.doesNotMatch(source, /Authorization|x-session-|x-payment-|FACILITATOR_KEY|x402/u);
});
