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

test("agent page exposes icon-only channel binding through theme primitives", () => {
  const source = read("src/pages/agent.tsx");

  assert.match(source, /import \{ Hint, ShellButton \} from "@compose-market\/theme\/shell"/);
  assert.match(source, /<Hint label="Backpack">\s*<ShellButton\s+size="sm"\s+tone="secondary"\s+iconOnly\s+aria-label="Backpack"\s+onClick=\{openBackpack\}\s*>[\s\S]*?<Backpack size=\{14\} \/>[\s\S]*?<\/ShellButton>\s*<\/Hint>/);
  assert.match(source, /<BackpackDialog/);
  assert.doesNotMatch(source, /fetch\([^)]*\/channels/u);
});

test("channel dialog uses only SDK channel resources for channel routes", () => {
  const source = read("src/components/backpack.tsx");

  assert.match(source, /sdk\.channels\.status/);
  assert.match(source, /sdk\.channels\.link/);
  assert.match(source, /sdk\.channels\.disconnect/);
  assert.doesNotMatch(source, /fetch\([^)]*\/channels/u);
  assert.doesNotMatch(source, /Authorization|x-session-|x-payment-|FACILITATOR_KEY|x402/u);
});
