import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchModelCatalogHealth,
  fetchModelCatalogIndex,
  isSupersededCatalogQueryKey,
  modelsOrigin,
} from "../src/lib/models.js";

test("modelsOrigin strips noncanonical deployment paths", () => {
  assert.equal(modelsOrigin("https://models.compose.market/sandbox"), "https://models.compose.market");
});

test("model catalog health returns the immutable import version", async () => {
  const health = await fetchModelCatalogHealth("https://models.compose.market", async (input, init) => {
    assert.equal(String(input), "https://models.compose.market/health");
    assert.equal(init?.cache, "no-store");
    return Response.json({ models: 755, version: "catalog-hash", lastUpdated: "2026-08-28T00:00:00.000Z" });
  });
  assert.deepEqual(health, {
    models: 755,
    version: "catalog-hash",
    lastUpdated: "2026-08-28T00:00:00.000Z",
  });
});

test("model catalog index requires a complete matching version and supports cache bypass", async () => {
  const seenCaches: Array<RequestCache | undefined> = [];
  const models = await fetchModelCatalogIndex("https://models.compose.market", "catalog-hash", async (input, init) => {
    assert.equal(String(input), "https://models.compose.market/index?version=catalog-hash");
    seenCaches.push(init?.cache);
    return Response.json({
      version: "catalog-hash",
      total: 1,
      data: [{ modelId: "glm-5.3", provider: "cloudflare" }],
    });
  });
  assert.equal(models[0]?.modelId, "glm-5.3");
  assert.equal(seenCaches[0], "default");

  await fetchModelCatalogIndex(
    "https://models.compose.market",
    "catalog-hash",
    async (_input, init) => {
      seenCaches.push(init?.cache);
      return Response.json({
        version: "catalog-hash",
        total: 1,
        data: [{ modelId: "glm-5.3", provider: "cloudflare" }],
      });
    },
    { cache: "no-store" },
  );
  assert.equal(seenCaches[1], "no-store");

  await assert.rejects(
    fetchModelCatalogIndex("https://models.compose.market", "catalog-hash", async () => Response.json({
      version: "catalog-hash",
      total: 2,
      data: [{ modelId: "glm-5.3", provider: "cloudflare" }],
    })),
    /Incomplete model catalog index/,
  );
});

test("isSupersededCatalogQueryKey matches only older catalog versions for the same origin", () => {
  const origin = "https://models.compose.market";
  assert.equal(isSupersededCatalogQueryKey(["models-catalog", origin, "old-hash"], origin, "new-hash"), true);
  assert.equal(isSupersededCatalogQueryKey(["models-catalog", origin, "new-hash"], origin, "new-hash"), false);
  assert.equal(isSupersededCatalogQueryKey(["models-catalog", "https://other.origin", "old-hash"], origin, "new-hash"), false);
  assert.equal(isSupersededCatalogQueryKey(["models-health", origin], origin, "new-hash"), false);
});
