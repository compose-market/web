import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAnalyticsQueryKey,
  buildRollingAnalyticsFilters,
} from "../src/lib/analytics.ts";
import { toggleNetworkSelection } from "../src/components/dashboard/networks.tsx";
import { createReconciliationController } from "../src/lib/reconciliation.ts";
import { shouldPersistQuery } from "../src/lib/queryClient.ts";

const OWNER = `0x${"11".repeat(20)}`;
const EVM = "eip155:43114" as const;
const SVM = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;

test("Dashboard network selection treats empty as All and supports multiple explicit networks", () => {
  let selected: string[] = [];
  selected = toggleNetworkSelection(selected, SVM, true);
  assert.deepEqual(selected, [SVM]);
  selected = toggleNetworkSelection(selected, EVM, true);
  assert.deepEqual(selected, [EVM, SVM]);
  selected = toggleNetworkSelection(selected, SVM, false);
  assert.deepEqual(selected, [EVM]);
  selected = toggleNetworkSelection(selected, EVM, false);
  assert.deepEqual(selected, []);
});

test("Analytics query identity is stable while rolling timestamps are calculated at fetch time", () => {
  const stable = { interval: "day" as const, limit: 100, settlementStatus: "settled" as const };
  const firstKey = buildAnalyticsQueryKey(OWNER.toUpperCase().replace("0X", "0x"), "30d", [SVM, EVM, SVM], stable);
  const secondKey = buildAnalyticsQueryKey(OWNER, "30d", [EVM, SVM], stable);
  assert.deepEqual(firstKey, secondKey);
  assert.equal(JSON.stringify(firstKey).includes("2026-"), false);

  const first = buildRollingAnalyticsFilters({ rangeMs: 30 * 86_400_000, filters: stable, networks: [] }, 1_000_000_000);
  const second = buildRollingAnalyticsFilters({ rangeMs: 30 * 86_400_000, filters: stable, networks: [] }, 1_000_001_000);
  assert.notEqual(first.to, second.to);
  assert.equal(first.networks, undefined);
});

test("reconciliation performs one dirty second pass and schedules later events from that pass", async () => {
  const releases: Array<() => void> = [];
  let calls = 0;
  const controller = createReconciliationController(async () => {
    calls += 1;
    await new Promise<void>((resolve) => releases.push(resolve));
  });

  const firstCycle = controller.reconcile();
  await Promise.resolve();
  assert.equal(calls, 1);
  void controller.reconcile();
  void controller.reconcile();
  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);

  void controller.reconcile();
  releases.shift()?.();
  await firstCycle;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 3);
  releases.shift()?.();
});

test("persistence allowlist accepts only successful explicitly marked durable queries", () => {
  assert.equal(shouldPersistQuery({ meta: { persist: true }, state: { status: "success" } } as any), true);
  assert.equal(shouldPersistQuery({ meta: { persist: false }, state: { status: "success" } } as any), false);
  assert.equal(shouldPersistQuery({ meta: { persist: true }, state: { status: "pending" } } as any), false);
});

test("pair registration, persisted providers, owner reads, local filters, and one Keys hook stay within scope", async () => {
  const [pair, app, wallet, analytics, keysHook, dashboard, networks, keysPage, quickstart, session, connector] = await Promise.all([
    readFile(new URL("../src/hooks/use-pair.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/wallet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/use-analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/use-keys.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/dashboard/networks.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/keys.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/keys/quickstart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/use-session.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/connector.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(pair, /sdk\.user\.get\(evmAddress\)/);
  assert.match(pair, /status\s*!==\s*404/);
  assert.match(pair, /deriveSwigWalletAddress\(adminAddress\)/);
  assert.match(pair, /sdk\.user\.set\(\{\s*evmAddress,\s*svmAddress/s);
  assert.doesNotMatch(pair, /useSolanaSmartAccount|fetchSwigAccount|buildCreateSwigTransaction|sdk\.svm/);

  assert.match(app, /PersistQueryClientProvider/);
  assert.doesNotMatch(app, /<QueryClientProvider/);
  assert.match(wallet, /OwnerCacheBoundary/);

  assert.doesNotMatch(analytics, /useChain|paymentNetwork|wallets\.attach/);
  assert.match(analytics, /readCachedAccount/);
  assert.match(analytics, /enabled:\s*Boolean\(owner\)/);
  assert.match(analytics, /sdk\.analytics\.get\([^]*\{\s*userAddress:\s*owner\s*\}/);
  assert.match(analytics, /select:\s*summarize/);
  assert.match(analytics, /meta:\s*durableQueryMeta/);
  assert.match(keysHook, /sdk\.keys\.list\(\{\s*userAddress:\s*owner\s*\}\)/);
  assert.match(keysHook, /readCachedAccount/);
  assert.match(keysHook, /enabled:\s*Boolean\(owner\)/);
  assert.match(keysHook, /useReconciliation/);

  // The page composes the standard rail network selector; the merged
  // networks module owns the multi-select reducer and the dropdown surface.
  assert.match(dashboard, /<NetworkFilter/);
  assert.match(dashboard, /@\/components\/dashboard\/networks/);
  assert.match(networks, /toggleNetworkSelection/);
  assert.match(networks, /DropdownMenuCheckboxItem/);
  assert.match(networks, /cm-control-menu/);
  assert.match(networks, /cm-shell-tab cm-network-filter/);
  assert.doesNotMatch(dashboard, /anchor|setAnchor|Date\.now\(\)/);
  assert.equal((keysPage.match(/useKeys\(\)/g) ?? []).length, 1);
  assert.match(keysPage, /<NetworkBadge\s+network=\{key\.network\}/);
  assert.match(keysPage, /Unable to load keys/);
  assert.match(keysPage, /<SessionBudgetDialog/);
  assert.match(keysPage, /const \{ sessionActive \} = useSession\(\)/);
  assert.match(keysPage, /onCreateSession=\{openSession\}/);
  assert.match(keysPage, /sessionActive=\{sessionActive\}/);
  assert.match(quickstart, /onClick=\{onCreateSession\}/);
  assert.match(quickstart, /disabled=\{sessionActive\}/);
  assert.match(quickstart, /sessionActive \? "Session Active" : "Create a Session"/);

  assert.doesNotMatch(session, /useWalletPair|sdk\.user\./);
  assert.match(session, /sdk\.fetch\("\/api\/session"/);
  assert.match(session, /key:\s*null/);
  assert.match(session, /sdk\.wallets\.attach\(\{\s*address:\s*userAddress/s);
  assert.doesNotMatch(session, /sdk\.wallets\.attach\(\{\s*address:\s*cachedUserAddress/s);
  assert.doesNotMatch(connector, /useWalletPair|sdk\.user\./);
});

test("all current settlement statuses and remaining list call sites use the new SDK contract", async () => {
  const [receipts, sessionUi] = await Promise.all([
    readFile(new URL("../src/components/dashboard/receipts.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/session.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(receipts, /submitted:\s*0/);
  assert.match(sessionUi, /sdk\.keys\.list\(\{\s*userAddress\s*\}\)/);
});
