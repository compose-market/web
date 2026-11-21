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

test("connector snapshot client helpers validate versioned index and merge semantic rerank-2.5 hits", async () => {
  const {
    connectorsOrigin,
    fetchConnectorCatalogHealth,
    fetchConnectorCatalogIndex,
    mergeSemanticConnectorRanks,
    rankCatalogConnectors,
  } = await import("../src/lib/connectors.js");

  assert.equal(connectorsOrigin("https://connectors.compose.market/mcps"), "https://connectors.compose.market");

  const health = await fetchConnectorCatalogHealth("https://connectors.compose.market", async () =>
    new Response(JSON.stringify({
      version: "v1234abcd",
      lastUpdated: "2026-11-12T08:00:00Z",
      counts: { total: 3, mcp: 1, account: 1, onchain: 1 },
    }), { status: 200 }),
  );
  assert.equal(health.version, "v1234abcd");
  assert.equal(health.counts.total, 3);

  await assert.rejects(() =>
    fetchConnectorCatalogIndex("https://connectors.compose.market", "v1234abcd", async () =>
      new Response(JSON.stringify({ version: "wrong", mcps: [], accounts: [], onchain: { connectors: [], status: {} } }), { status: 200 }),
    ),
  );

  const catalog = [
    {
      registryId: "mcp:notion",
      origin: "mcp" as const,
      slug: "notion",
      name: "Notion MCP",
      description: "Gated MCP server for Notion",
      tags: ["docs"],
      status: "credential_gated" as const,
    },
    {
      registryId: "account:notion",
      origin: "account" as const,
      slug: "notion",
      name: "Notion",
      description: "1-click OAuth Notion workspace",
      tags: ["productivity"],
      status: "credential_gated" as const,
      authMode: "oauth" as const,
    },
    {
      registryId: "account:gmail",
      origin: "account" as const,
      slug: "gmail",
      name: "Gmail",
      description: "Send and read email messages",
      tags: ["communication"],
      status: "credential_gated" as const,
      authMode: "oauth" as const,
    },
  ];

  const localNotion = rankCatalogConnectors(catalog, "notion", 10);
  assert.equal(localNotion[0]?.item.registryId, "account:notion");

  const localConceptual = rankCatalogConnectors(catalog, "inbox newsletter dispatch", 10);
  const merged = mergeSemanticConnectorRanks(catalog, localConceptual, [
    { bindingId: "account:gmail", origin: "account", slug: "gmail", score: 0.94 },
  ], 10);
  assert.equal(merged[0]?.registryId, "account:gmail");
});


