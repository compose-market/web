import assert from "node:assert/strict";
import test from "node:test";

import { ComposeSDK } from "@compose-market/sdk";
import {
  formatModelTypeLabel,
  getModelTypeClass,
  getModelTypeVisualId,
  mergeSemanticModelRanks,
  normalizeModelSearchText,
  rankCatalogModels,
  type CatalogModel,
} from "../src/lib/models";

test("model type labels preserve shared color tones across catalog types", () => {
  assert.equal(formatModelTypeLabel("music generation"), "Music Generation");
  assert.equal(getModelTypeClass("text generation"), "cm-type--text");
  assert.equal(getModelTypeClass("music generation"), "cm-type--audio");
  assert.equal(getModelTypeClass("object-detection"), "cm-type--image");
  assert.equal(getModelTypeClass("reranker"), "cm-type--embedding");
  assert.equal(getModelTypeVisualId("music generation"), "audio");
  assert.equal(getModelTypeVisualId("realtime"), "conversational");
});

function catalogModel(modelId: string, name: string, provider = "alibaba"): CatalogModel {
  return {
    modelId,
    provider: provider as CatalogModel["provider"],
    family: provider,
    name,
    type: "text generation",
    description: `${name} language model`,
    input: ["text"],
    output: ["text"],
    contextWindow: null,
    pricing: null,
  };
}

test("web consumes @compose-market/sdk as a third-party integrator", async () => {
  const calls: Array<{ host: string; method: string; path: string; headers: Headers }> = [];
  const sdk = new ComposeSDK({
    baseUrl: "https://api.example.test",
    channelsUrl: "https://services.example.test",
    defaultHeaders: {
      Authorization: "Bearer compose-test",
      "x-network-id": "eip155:43113",
      "x-session-active": "true",
      "x-payment-intent-id": "intent-test",
    },
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      calls.push({
        host: url.host,
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        headers: new Headers(init?.headers),
      });
      const body = url.pathname.startsWith("/channels/")
        ? {
          code: "link-test",
          channel: "telegram",
          userAddress: "0x0000000000000000000000000000000000000001",
          agentWallet: "0x0000000000000000000000000000000000000002",
          createdAt: Date.now(),
          expiresAt: Date.now() + 60000,
          url: "https://t.me/compose_bot?start=link-test",
        }
        : { agents: [], total: 0, tags: [], categories: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(typeof sdk.models.pricing, "function");
  assert.equal(typeof sdk.x402.payments.prepare, "function");
  assert.equal(typeof sdk.x402.payments.meterModel, "function");
  assert.equal(typeof sdk.directory.agents.agentverse, "function");
  assert.equal(typeof sdk.system.health, "function");
  assert.equal(typeof sdk.permissions.list, "function");
  assert.equal(typeof sdk.accounts.connect, "function");
  assert.equal(typeof sdk.channels.link, "function");
  assert.equal(typeof sdk.dispenser.status, "function");
  assert.equal(typeof sdk.settlement.status, "function");
  assert.equal("metrics" in sdk, false);

  await sdk.directory.agents.agentverse({
    search: "research",
    tags: ["ai", "payments"],
    limit: 5,
    sort: "interactions",
    direction: "desc",
  });

  assert.equal(
    calls[0]?.path,
    "/api/agentverse/agents?search=research&tags=ai%2Cpayments&limit=5&sort=interactions&direction=desc",
  );
  assert.equal(calls[0]?.host, "api.example.test");

  await sdk.channels.link("telegram", {
    userAddress: "0x0000000000000000000000000000000000000001",
    agentWallet: "0x0000000000000000000000000000000000000002",
    agentName: "Echo",
  });

  const channelCall = calls.at(-1);
  assert.equal(channelCall?.host, "services.example.test");
  assert.equal(channelCall?.method, "POST");
  assert.equal(channelCall?.path, "/channels/telegram/link");
  assert.equal(channelCall?.headers.has("authorization"), false);
  assert.equal(channelCall?.headers.has("x-network-id"), false);
  assert.equal(channelCall?.headers.has("x-session-active"), false);
  assert.equal(channelCall?.headers.has("x-payment-intent-id"), false);
});

test("web catalog models can carry API-owned operations without local routing", () => {
  const model: CatalogModel = {
    modelId: "misleading-model",
    provider: "openai",
    name: "Misleading Model",
    type: "text-generation",
    description: null,
    input: ["text"],
    output: ["audio"],
    contextWindow: null,
    pricing: null,
    operations: [{
      modality: "audio",
      operation: "text-to-speech",
      sourceTypes: ["speech"],
      input: ["text"],
      output: ["audio"],
      pricingUnits: [],
      streamable: false,
    }],
  };

  assert.equal(Array.isArray(model.operations), true);
  assert.equal((model.operations?.[0] as { operation?: string }).operation, "text-to-speech");
});

test("model search normalizes separators and letter-number boundaries", () => {
  assert.equal(normalizeModelSearchText(" QWEN-3.8_Max "), "qwen 3 8 max");
  const models = [
    catalogModel("qwen3.8-max", "Qwen3.8-Max"),
    catalogModel("qwen3-8b", "Qwen3-8B"),
    catalogModel("llama-3.8", "Llama 3.8", "meta"),
  ];

  assert.equal(rankCatalogModels(models, "qwen 3.8")[0]?.model.modelId, "qwen3.8-max");
  assert.equal(rankCatalogModels(models, "QWEN-3.8")[0]?.model.modelId, "qwen3.8-max");
});

test("model search tolerates a short typo without matching every short query", () => {
  const models = [
    catalogModel("qwen3.8-max", "Qwen3.8-Max"),
    catalogModel("gpt-4o", "GPT-4o", "openai"),
    catalogModel("llama-3.3", "Llama 3.3", "meta"),
  ];

  assert.equal(rankCatalogModels(models, "gwen 3.8")[0]?.model.modelId, "qwen3.8-max");
  assert.deepEqual(rankCatalogModels(models, "x"), []);
});

test("semantic hits enrich rankings but resolve to canonical catalog models", () => {
  const qwen = catalogModel("qwen3.8-max", "Qwen3.8-Max");
  const vision = catalogModel("vision-pro", "Vision Pro", "google");
  const catalog = [qwen, vision];
  const local = rankCatalogModels(catalog, "cheap vision model");
  const merged = mergeSemanticModelRanks(catalog, local, [{
    modelId: "vision-pro",
    provider: "google",
    score: 0.97,
  }]);

  assert.equal(merged[0]?.model, vision);
  assert.equal(merged[0]?.source, "semantic");
  assert.deepEqual(mergeSemanticModelRanks(catalog, [], [{
    modelId: "missing-model",
    provider: "unknown",
    score: 1,
  }]), []);
});

test("Playground catalog loading uses the durable compact index and independent resources", async () => {
  const { readFile } = await import("node:fs/promises");
  const [modelsHook, modelCatalog, playground, commandBar, capabilities, styles] = await Promise.all([
    readFile(new URL("../src/hooks/use-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/models.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/playground.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/models/command-bar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/models/capabilities.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/index.css", import.meta.url), "utf8"),
  ]);

  assert.match(modelsHook, /fetchModelCatalogHealth\(MODELS_ORIGIN\)/);
  assert.match(modelsHook, /fetchModelCatalogIndex\(MODELS_ORIGIN,\s*version!/);
  assert.match(modelCatalog, /new URL\(`\$\{origin\}\/index`\)/);
  assert.match(modelCatalog, /cache:\s*"force-cache"/);
  assert.match(modelsHook, /meta:\s*durableQueryMeta/);
  assert.match(modelsHook, /model\.isFrontier\s*===\s*true\s*\|\|\s*model\.isLatest\s*===\s*true/);
  assert.match(modelsHook, /refetchOnMount:\s*"always"/);
  assert.match(modelsHook, /refetchOnMount:\s*false/);
  assert.match(modelsHook, /queryKey:\s*\[\.\.\.CATALOG_CACHE_PREFIX,\s*health\.version\]/);
  assert.match(modelsHook, /refetchQueries\(\{\s*queryKey:\s*\["model-card"\],\s*type:\s*"active"\s*\}\)/);
  assert.match(modelsHook, /removeQueries\(\{\s*queryKey:\s*\["model-card"\],\s*type:\s*"inactive"\s*\}\)/);
  assert.match(modelsHook, /useModelDetails/);
  assert.match(modelsHook, /useModelParams/);
  assert.doesNotMatch(modelsHook, /sdk\.models\.list\(\)/);
  assert.doesNotMatch(modelsHook, /sdk\.fetch\("\/v1\/models\/index"/);
  assert.match(playground, /useRegistryMeta\(\{\s*enabled:\s*activeTab\s*===\s*"connectors"\s*\}\)/);
  assert.doesNotMatch(playground, /sdk\.models\.getParams/);
  assert.match(playground, /isRefetching:\s*modelsRefetching/);
  assert.match(playground, /disabled=\{modelsRefetching\}/);
  assert.match(playground, /refreshedModelsOnMount/);
  assert.match(commandBar, /useModels\(\{\s*enabled:\s*open\s*\}\)/);
  assert.match(commandBar, /\["Frontier",\s*frontierModels\]/);
  assert.match(commandBar, /\["Latest",\s*latestModels\]/);
  assert.doesNotMatch(commandBar, /Frontier ·|Latest ·|cm-command-group__type-label/);
  assert.match(commandBar, /cm-command-item--frontier/);
  assert.match(commandBar, /const byId = new Map/);
  assert.match(commandBar, /\?\?\s*byId\.get\(modelId\)/);
  assert.match(commandBar, /promoted\.filter\(\(item\)\s*=>\s*item\.isLatest\)/);
  assert.match(commandBar, /const flatIndexByKey = useMemo/);
  assert.match(commandBar, /flatIndexByKey\.get\(rowKey\)/);
  assert.match(commandBar, /FRONTIER_TYPE_ORDER\s*=\s*\["text",\s*"image",\s*"video",\s*"music"\]/);
  assert.match(commandBar, />\s*Frontier\s*</);
  assert.match(commandBar, /if\s*\(!open\)\s*return\s*\[\]/);
  assert.match(capabilities, /cm-type-label/);
  assert.match(capabilities, /getModelTypeClass/);
  assert.match(capabilities, /cat\.count <= 2/);
  assert.match(capabilities, />Others…</);
  assert.match(capabilities, /event\.preventDefault\(\)/);
  assert.match(capabilities, /otherFamilies\.map\(categoryItem\)/);
  assert.match(styles, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.cm-playground__family-others-grid/);
});
