import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("market agents tab renders the cached catalog snapshot with semantic search", () => {
  const source = readFileSync(resolve(root, "src/pages/market.tsx"), "utf8");
  const agentsStart = source.indexOf("function AgentsTab(");
  assert.ok(agentsStart > 0, "AgentsTab code must exist");
  const agents = source.slice(agentsStart);

  // The snapshot comes from the shared catalog hook — no private fetching,
  // no infinite query, no zero-TTL cache that destroys agents on unmount.
  assert.match(agents, /useAgentCatalog\(\)/);
  assert.match(agents, /useSemanticAgentSearch\(q/);
  assert.match(agents, /mergeSemanticAgentRanks/);
  assert.match(agents, /rankCatalogAgents/);
  assert.match(agents, /toOnchainAgent/);
  assert.doesNotMatch(source, /useInfiniteQuery/);
  assert.doesNotMatch(source, /AGENTS_URL/);
  assert.doesNotMatch(source, /AGENTS_PATH/);
  assert.doesNotMatch(source, /fetch\(`\$\{AGENTS_URL\}/);
  assert.doesNotMatch(agents, /sdk\.directory\.agents\.list/);
  assert.doesNotMatch(agents, /sdk\.fetch/);
  assert.doesNotMatch(agents, /useOnchainAgents/);
  assert.doesNotMatch(source, /staleTime:\s*0/);
  assert.doesNotMatch(source, /gcTime:\s*0/);
  // Progressive reveal still works from the complete snapshot.
  assert.match(agents, /IntersectionObserver/);
  assert.match(agents, /content-visibility:auto/);
  // Price sorts are client-side over the snapshot.
  assert.match(agents, /"price-low" \|\| sort === "price-high"/);
});

test("agent catalog retention follows the models-worker pattern in use-agents", () => {
  const hooks = readFileSync(resolve(root, "src/hooks/use-agents.ts"), "utf8");

  // Health poll -> version -> immutable, persisted snapshot with placeholder.
  assert.match(hooks, /refetchInterval:\s*5_000/);
  assert.match(hooks, /staleTime:\s*Infinity/);
  assert.match(hooks, /refetchOnMount:\s*false/);
  assert.match(hooks, /placeholderData:\s*cachedAgents/);
  assert.match(hooks, /meta:\s*durableQueryMeta/);
  assert.match(hooks, /gcTime:\s*DURABLE_CACHE_MAX_AGE/);
  assert.match(hooks, /useAgentCatalog/);
  assert.match(hooks, /useAgentByIdentifier/);
  assert.match(hooks, /useSemanticAgentSearch/);
  assert.match(hooks, /AgentIndexingError/);

  // No zero-TTL caches remain anywhere in the agents hooks.
  assert.doesNotMatch(hooks, /staleTime:\s*0/);
  assert.doesNotMatch(hooks, /gcTime:\s*0/);

  // Dead multi-registry network hooks are gone; manowar is snapshot-backed.
  assert.doesNotMatch(hooks, /useAgentsPaginated/);
  assert.doesNotMatch(hooks, /searchManowar/);
});

test("agent detail page uses the catalog hook with an indexing state", () => {
  const page = readFileSync(resolve(root, "src/pages/agent.tsx"), "utf8");

  assert.match(page, /useAgentByIdentifier\(identifier\)/);
  assert.doesNotMatch(page, /useOnchainAgentByIdentifier/);
  assert.match(page, /isIndexing/);
  assert.match(page, /Indexing agent…/);
  // A transient failure must not read as "not found".
  assert.match(page, /Agent temporarily unavailable/);
});

test("default market agents path does not statically pull on-chain tab code", () => {
  const source = readFileSync(resolve(root, "src/pages/market.tsx"), "utf8");
  const card = readFileSync(resolve(root, "src/components/agent-card.tsx"), "utf8");

  assert.doesNotMatch(source, /import\s+\{[^}]*useOnchainWorkflows[^}]*\}\s+from\s+"@\/hooks\/use-onchain"/);
  assert.doesNotMatch(source, /import\s+\{[^}]*useOpenRFAs[^}]*\}\s+from\s+"@\/hooks\/use-onchain"/);
  assert.doesNotMatch(source, /from\s+"@\/lib\/contracts"/);
  assert.doesNotMatch(source, /from\s+"@\/lib\/chains"/);
  assert.doesNotMatch(source, /import\s+\{[^}]*RFADetails[^}]*\}\s+from\s+"@\/components\/RFADetails"/);
  assert.match(source, /import\("@\/hooks\/use-onchain"\)/);
  assert.match(source, /React\.lazy\(\(\) =>\s*import\("@\/components\/RFADetails"\)/);

  assert.doesNotMatch(card, /from\s+"@\/lib\/contracts"/);
  assert.doesNotMatch(card, /from\s+"@\/hooks\/use-warp"/);
  assert.match(card, /import\("@\/hooks\/use-warp"\)/);
});
