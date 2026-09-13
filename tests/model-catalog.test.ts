import assert from "node:assert/strict";
import test from "node:test";

import { fetchModelCatalogHealth, fetchModelCatalogIndex, modelsOrigin } from "../src/lib/models.js";

test("modelsOrigin strips noncanonical deployment paths", () => {
  assert.equal(modelsOrigin("https://models.compose.market/sandbox"), "https://models.compose.market");
});

test("model catalog health returns the immutable import version", async () => {
  const health = await fetchModelCatalogHealth("https://models.compose.market", async (input) => {
    assert.equal(String(input), "https://models.compose.market/health");
    return Response.json({ models: 755, version: "catalog-hash", lastUpdated: "2026-08-28T00:00:00.000Z" });
  });
  assert.deepEqual(health, {
    models: 755,
    version: "catalog-hash",
    lastUpdated: "2026-08-28T00:00:00.000Z",
  });
});

test("model catalog index requires a complete matching version", async () => {
  const models = await fetchModelCatalogIndex("https://models.compose.market", "catalog-hash", async (input) => {
    assert.equal(String(input), "https://models.compose.market/index?version=catalog-hash");
    return Response.json({
      version: "catalog-hash",
      total: 1,
      data: [{ modelId: "glm-5.3", provider: "cloudflare" }],
    });
  });
  assert.equal(models[0]?.modelId, "glm-5.3");

  await assert.rejects(
    fetchModelCatalogIndex("https://models.compose.market", "catalog-hash", async () => Response.json({
      version: "catalog-hash",
      total: 2,
      data: [{ modelId: "glm-5.3", provider: "cloudflare" }],
    })),
    /Incomplete model catalog index/,
  );
});
