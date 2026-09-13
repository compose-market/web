import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { DirectoryAgent } from "@compose-market/sdk";

import {
  agentsOrigin,
  fetchAgentCardByWallet,
  fetchAgentsCatalogHealth,
  fetchAgentsCatalogIndex,
  indexAgentCard,
  isAgentIndexing,
  mergeSemanticAgentRanks,
  rankCatalogAgents,
  rememberJustCreatedAgent,
  toOnchainAgent,
} from "../src/lib/agents.ts";

function card(walletAddress: string, overrides: Record<string, unknown> = {}): DirectoryAgent {
  return {
    schemaVersion: "1.0.0",
    name: "BTC Checker",
    description: "Checks bitcoin prices.",
    skills: ["onchain:coingecko"],
    x402Support: true,
    dnaHash: "0x" + "aa".repeat(32),
    walletAddress,
    network: "eip155:43113",
    model: "gpt-4o",
    licensePrice: "1000000",
    licenses: 0,
    cloneable: true,
    protocols: [{ name: "x402", version: "1.0" }],
    createdAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  } as DirectoryAgent;
}

test("agentsOrigin strips noncanonical deployment paths", () => {
  assert.equal(agentsOrigin("https://agents.compose.market/sandbox"), "https://agents.compose.market");
});

test("agent catalog health returns the catalog version and counts", async () => {
  const health = await fetchAgentsCatalogHealth("https://agents.compose.market", async (input) => {
    assert.equal(String(input), "https://agents.compose.market/health");
    return Response.json({
      service: "agents",
      ok: true,
      counts: { total: 98, daily: 98, source: "cloudflare-d1", updatedAt: "2026-09-03 21:07:32" },
      version: "catalog-digest",
      lastUpdated: "2026-09-03 21:07:32",
      time: "2026-09-03T21:07:36.000Z",
    });
  });
  assert.deepEqual(health, {
    agents: 98,
    version: "catalog-digest",
    lastUpdated: "2026-09-03 21:07:32",
  });

  await assert.rejects(
    fetchAgentsCatalogHealth("https://agents.compose.market", async () => Response.json({ ok: true })),
    /Invalid agent catalog health response/,
  );
});

test("agent catalog index requires a complete matching version", async () => {
  const agents = await fetchAgentsCatalogIndex("https://agents.compose.market", "catalog-digest", async (input) => {
    assert.equal(String(input), "https://agents.compose.market/index?version=catalog-digest");
    return Response.json({
      version: "catalog-digest",
      total: 1,
      agents: [card(`0x${"Aa".repeat(20)}`)],
    });
  });
  assert.equal(agents[0]?.name, "BTC Checker");

  await assert.rejects(
    fetchAgentsCatalogIndex("https://agents.compose.market", "catalog-digest", async () => Response.json({
      version: "catalog-digest",
      total: 2,
      agents: [card(`0x${"Aa".repeat(20)}`)],
    })),
    /Incomplete agent catalog index/,
  );

  await assert.rejects(
    fetchAgentsCatalogIndex("https://agents.compose.market", "catalog-digest", async () => Response.json({
      error: { code: "catalog_version_mismatch" },
      version: "new-digest",
    }, { status: 409 })),
    /409/,
  );
});

test("agent card lookup only treats 404 as not found", async () => {
  const wallet = `0x${"Aa".repeat(20)}`;

  const found = await fetchAgentCardByWallet(wallet, async (input) => {
    assert.equal(String(input), `https://agents.compose.market/agent/${wallet.toLowerCase()}`);
    return Response.json(card(wallet));
  });
  assert.equal(found?.walletAddress, wallet);

  const missing = await fetchAgentCardByWallet(wallet, async () => Response.json({}, { status: 404 }));
  assert.equal(missing, null);

  // A 500 must throw (retry + retained data), never resolve to null.
  await assert.rejects(
    fetchAgentCardByWallet(wallet, async () => Response.json({}, { status: 500 })),
    /500/,
  );
});

test("indexAgentCard posts the pinned cid for immediate indexing", async () => {
  const agent = await indexAgentCard({ cid: "ipfs://bafynew", walletAddress: `0x${"Bb".repeat(20)}` }, {
    fetcher: async (input, init) => {
      assert.equal(String(input), "https://agents.compose.market/agents/upsert");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        cid: "bafynew",
        walletAddress: `0x${"Bb".repeat(20)}`,
      });
      return Response.json({ ok: true, indexed: 1, agent: card(`0x${"Bb".repeat(20)}`) });
    },
  });
  assert.equal(agent?.walletAddress, `0x${"Bb".repeat(20)}`);

  await assert.rejects(
    indexAgentCard({ cid: "bafybad" }, { fetcher: async () => Response.json({}, { status: 422 }) }),
    /422/,
  );
});

test("just-created flag gates only the minted wallet and expires", () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };

  const wallet = `0x${"Cc".repeat(20)}`;
  assert.equal(isAgentIndexing(wallet), false);
  rememberJustCreatedAgent(wallet);
  assert.equal(isAgentIndexing(wallet), true);
  // Other wallets are unaffected.
  assert.equal(isAgentIndexing(`0x${"Dd".repeat(20)}`), false);
  // Case-insensitive for EVM wallets.
  assert.equal(isAgentIndexing(wallet.toLowerCase()), true);

  // Expired flag stops gating.
  store.set("cm:agent-indexing", JSON.stringify({ walletAddress: wallet, at: Date.now() - 11 * 60 * 1000 }));
  assert.equal(isAgentIndexing(wallet), false);

  delete (globalThis as Record<string, unknown>).sessionStorage;
});

test("rankCatalogAgents scores name, skills, and model fields", () => {
  const btc = card(`0x${"Aa".repeat(20)}`, { name: "BTC Checker", skills: ["onchain:coingecko"] });
  const writer = card(`0x${"Bb".repeat(20)}`, {
    name: "README Writer",
    description: "Writes long-form documentation.",
    skills: ["mcp:docs"],
  });
  const ranked = rankCatalogAgents([writer, btc], "btc price");
  assert.equal(ranked[0]?.agent.walletAddress, btc.walletAddress);
  assert.ok(ranked[0]?.score > 0);
  assert.equal(ranked.find((entry) => entry.agent.walletAddress === writer.walletAddress), undefined);
});

test("mergeSemanticAgentRanks resolves hits back to the canonical snapshot", () => {
  const btc = card(`0x${"Aa".repeat(20)}`);
  const writer = card(`0x${"Bb".repeat(20)}`, { name: "README Writer" });
  const snapshot = [btc, writer];
  const local = rankCatalogAgents(snapshot, "readme");

  const merged = mergeSemanticAgentRanks(snapshot, local, [
    { walletAddress: btc.walletAddress, name: btc.name, score: 0.9 },
    // Unknown wallets are dropped, never rendered from worker objects.
    { walletAddress: `0x${"Ee".repeat(20)}`, score: 1 },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.agent.walletAddress, btc.walletAddress);
  assert.equal(merged[0]?.source, "semantic");
  assert.equal(merged[1]?.agent.walletAddress, writer.walletAddress);
  assert.equal(merged[1]?.source, "local");
});

test("toOnchainAgent maps economics and identity from the snapshot card", () => {
  const wallet = `0x${"Aa".repeat(20)}`;
  const agent = toOnchainAgent(card(wallet, { licensePrice: "1500000", creator: `0x${"22".repeat(20)}` }));
  assert.equal(agent.walletAddress, wallet);
  assert.equal(agent.licensePrice, "1.500000");
  assert.equal(agent.licensesAvailable, Infinity);
  assert.equal(agent.metadata?.name, "BTC Checker");
});

test("create-agent indexes the minted card immediately on mint success", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../src/pages/create-agent.tsx"), "utf8");
  const start = source.indexOf("const handleMintSuccess");
  assert.ok(start > 0, "handleMintSuccess must exist");
  const block = source.slice(start);

  assert.match(block, /rememberJustCreatedAgent\(walletAddress\)/);
  assert.match(block, /indexAgentCard\(\{ cid, walletAddress \}/);
  assert.match(block, /refreshAgentCatalog\(\)/);
  // Indexing failure must never block navigation — cron is the fallback.
  assert.match(block, /catch \(error\)/);
  assert.match(block, /setLocation\("\/my-assets"\)/);
});
