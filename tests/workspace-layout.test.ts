import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getAgentCapabilities } from "../src/lib/capabilities.tsx";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

test("root route redirects to keys while home stays outside the app graph", () => {
  const app = read("src/App.tsx");
  const wallet = read("src/components/wallet.tsx");
  const layout = read("src/components/layout/Layout.tsx");

  assert.equal(existsSync(resolve(root, "src/pages/home.tsx")), false);
  assert.doesNotMatch(app, /@\/pages\/home/);
  assert.match(app, /<Redirect\s+to="\/playground"\s+replace\s*\/>/);
  assert.match(wallet, /const Dashboard = lazy\(\(\) => import\("@\/pages\/dashboard"\)\);/);
  assert.match(wallet, /<Route path="\/dashboard" component=\{Dashboard\} \/>/);
  assert.match(app, /import Market from "@\/pages\/market";/);
  assert.match(app, /location === "\/market"/);
  assert.doesNotMatch(layout, /label:\s*"Home"/);
});

test("network selector lives in the nav utility, not the top HUD or overflow", () => {
  const layout = read("src/components/layout/Layout.tsx");
  const wallet = read("src/components/wallet.tsx");
  const selectorUses = wallet.match(/<NetworkSelector/g) || [];

  assert.equal(selectorUses.length, 1);
  assert.match(layout, /cm-app-chrome__navutility[\s\S]*ref=\{onNavUtilityRef\}/);
  assert.match(wallet, /navUtilityEl[\s\S]*<NetworkSelector/);
  assert.doesNotMatch(layout, /cm-app-chrome__hud-item[\s\S]{0,140}<NetworkSelector/);
  assert.doesNotMatch(wallet, /cm-app-chrome__hud-item[\s\S]{0,140}<NetworkSelector/);
  assert.doesNotMatch(wallet, /cm-app-chrome__hud-popover-title">Network/);
});

test("market agent cards use root open handlers without nested links", () => {
  const market = read("src/pages/market.tsx");
  const card = read("src/components/identikit.tsx");
  const networks = read("src/contexts/Network.tsx");

  assert.match(market, /cm-market-agent-canvas/);
  assert.match(market, /onOpen=\{handleOpenAgent\}/);
  assert.doesNotMatch(market, /<Link[\s\S]{0,220}<SharedAgentCard/);
  assert.match(card, /onOpen\?: \(triggerEl\?: HTMLElement \| null, agent\?: OnchainAgent\) => void/);
  assert.match(card, /role=\{onOpen \? \(compact \? "button" : "link"\) : undefined\}/);
  assert.match(card, /variant === "market"/);
  assert.match(card, /cm-agent-card__verified/);
  assert.match(card, /cm-agent-card__network/);
  assert.doesNotMatch(card, /logo\.dev|chainLogoUrl|VITE_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY/);
  assert.match(card, /@\/contexts\/Network/);
  // Chain logos live in the shared network module (dashboard filter reuses it).
  assert.match(networks, /"eip155:43113": "\/networks\/avalancheFuji\.jpeg"/);
  assert.match(networks, /"eip155:43114": "\/networks\/avalanche\.jpeg"/);
  assert.match(networks, /"eip155:421614": "\/networks\/arbitrumSepolia\.png"/);
  assert.match(networks, /"eip155:42161": "\/networks\/arbitrum\.png"/);
  assert.match(networks, /"eip155:5042002": "\/networks\/arcTestnet\.jpeg"/);
  assert.match(networks, /"eip155:5042": "\/networks\/arc\.jpeg"/);
  assert.match(networks, /"eip155:84532": "\/networks\/baseSepolia\.png"/);
  assert.match(networks, /"eip155:8453": "\/networks\/base\.png"/);
  assert.match(networks, /"eip155:1328": "\/networks\/seiTestnet\.jpeg"/);
  assert.match(networks, /"eip155:1329": "\/networks\/sei\.jpeg"/);
  assert.match(networks, /"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "\/networks\/solanaDevnet\.jpeg"/);
  assert.match(networks, /"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "\/networks\/solana\.jpeg"/);
  assert.match(card, /function MarketAgentCard\(/);
  assert.match(card, /function IdentikitAgentCard\(/);
  assert.match(card, /navigator\.clipboard\.writeText\(apiEndpoint\)/);
  assert.match(card, /title=\{apiEndpoint\}/);
  assert.match(card, /return value \? `\/agent\/\$\{short\(value,\s*8,\s*6\)\}` : "Unavailable"/);
  assert.doesNotMatch(card, /API_BASE_URL\.replace\([\s\S]{0,120}\/agent\/\$\{value\.slice/);
  assert.doesNotMatch(market, /A2A Endpoint|Creator|Cloneable/);
});

test("shared card and model primitives stay self-contained without internal card scroll", () => {
  const agentsCss = read("src/styles/agents.css");
  const modelsCss = read("src/styles/models.css");
  const chatCss = read("src/styles/chat.css");
  const shell = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");
  const playground = read("src/pages/playground.tsx");
  const chips = read("src/components/models/capabilities.tsx");

  assert.doesNotMatch(agentsCss, /cm-agent-card--match-chat[\s\S]{0,180}overflow-y:\s*auto/);
  assert.match(agentsCss, /cm-agent-card--market/);
  assert.match(playground, /<CapabilityChips/);
  assert.doesNotMatch(playground, /<select/);
  assert.match(chips, /cm-playground__chip-trigger/);
  assert.doesNotMatch(chips, /"cm-chip"/);
  assert.doesNotMatch(chips, /hidden sm:inline/);
  assert.match(chips, /cm-type-icon/);
  assert.match(chips, /DropdownMenuTrigger/);
  assert.match(chips, /DropdownMenuContent/);
  assert.match(chips, /cm-playground__chip-menu-grid/);
  assert.match(chips, /familyCategories/);
  assert.match(modelsCss, /container:\s*cm-chat-toolbar \/ inline-size/);
  assert.match(modelsCss, /\.cm-type-icon\s*\{[\s\S]*?inline-size:\s*clamp/);
  assert.match(modelsCss, /\.cm-playground__chip-trigger\s*\{[\s\S]*?border-radius:\s*var\(--radius-md/);
  assert.match(modelsCss, /\.cm-type--text/);
  assert.match(shell, /\.cm-command-panel/);
  assert.match(chatCss, /\.cm-chat\s*\{/);
  assert.match(chatCss, /\.cm-chat__composer-row textarea\s*\{[\s\S]*?field-sizing:\s*content/);
  assert.doesNotMatch(shell, /\.cm-playground__|\.cm-chat\b|\.cm-type--text/);
});

test("model card owns its responsive inline-size styles cleanly in web/src/styles/models.css", () => {
  const styles = read("src/styles/index.css");
  const modelsCss = read("src/styles/models.css");
  const card = read("src/components/models/card.tsx");
  const playground = read("src/pages/playground.tsx");

  assert.equal(existsSync(resolve(repo, "packages/theme/src/model")), false);
  assert.doesNotMatch(styles, /\.cm-model-card/);
  assert.match(modelsCss, /\.cm-model-card\s*\{/);
  assert.match(modelsCss, /container:\s*cm-model-card \/ inline-size/);
  assert.match(modelsCss, /--cm-model-unit:\s*clamp/);
  assert.match(modelsCss, /@container cm-model-card \(max-width:\s*17rem\)/);
  assert.doesNotMatch(card, /<Prism/);
  assert.match(card, /cm-model-card__description/);
  assert.match(card, /modelInfo\?\.description/);
  assert.match(card, /role="radiogroup"/);
  assert.match(card, /role="radio"/);
  assert.match(playground, /definition\.default !== undefined/);
  assert.doesNotMatch(card, /@\/components\/ui\/select|SelectTrigger|SelectContent|SelectItem/);
});

test("launch recovery pages use content canvases and proximity snap-scrolling without blind clipping", () => {
  const market = read("src/pages/market.tsx");
  const boards = read("src/components/boards.tsx");
  const create = read("src/pages/create.tsx");
  const createCss = read("src/styles/create.css");
  const assets = read("src/pages/profile.tsx");
  const styles = read("src/styles/index.css");
  const marketCss = read("src/styles/market.css");
  const agentsCss = read("src/styles/agents.css");
  const control = read("src/components/control.tsx");

  assert.match(market, /variant="market"/);
  assert.match(market, /cm-control-rail cm-market-control-rail/);
  assert.match(market, /<SearchFold/);
  assert.doesNotMatch(market, /<Colony|cm-market-hero|Colony/);
  assert.match(control, /cm-control-search-fold/);
  assert.match(boards, /cm-market-row-grid/);
  assert.match(marketCss, /\.cm-market-agent-slot/);
  assert.doesNotMatch(marketCss, /scroll-snap-type:\s*y (mandatory|proximity)/);
  assert.match(agentsCss, /\.cm-agent-tile__head/);
  assert.match(agentsCss, /\.cm-identikit\b/);
  assert.match(agentsCss, /\.cm-cap-glyph\b/);
  assert.match(agentsCss, /\.cm-agent-panel/);
  assert.match(create, /cm-create-page/);
  assert.match(create, /cm-split/);
  assert.match(create, /activeSection/);
  assert.match(create, /cm-create-sections-stage/);
  assert.match(create, /cm-create-sections/);
  assert.match(create, /cm-create-preview-stage/);
  assert.match(createCss, /\.cm-create-page\s*\{[\s\S]*?container:\s*cm-stage \/ inline-size/);
  assert.match(createCss, /\.cm-create-form\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s*auto/);
  assert.match(createCss, /\.cm-create-sections\s*\{[\s\S]*?margin-block:\s*auto/);
  assert.doesNotMatch(createCss, /scroll-snap-type/);
  assert.match(assets, /cm-market-agent-canvas/);
  assert.match(assets, /useAgentCatalog/);
  assert.match(assets, /toOnchainAgent/);
  assert.doesNotMatch(styles, /scroll-snap-type:\s*y mandatory/);
});

test("fixed page shells keep whole-page canvases locked and avoid forced snapping on reading/form surfaces", () => {
  const styles = read("src/styles/index.css");
  const disclaimer = read("src/components/disclaimer.tsx");
  const shell = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");
  const assets = read("src/pages/profile.tsx");

  assert.equal(existsSync(resolve(root, "src/pages/agents.tsx")), false);
  assert.equal(existsSync(resolve(root, "src/pages/models.tsx")), false);
  assert.equal(existsSync(resolve(root, "src/pages/registry.tsx")), false);

  assert.match(styles, /\.cm-web-page__canvas\s*\{[^}]*overflow-y:\s*hidden/);
  assert.match(styles, /\.cm-web-page__canvas--scroll\s*\{[^}]*overflow-y:\s*auto/);
  assert.doesNotMatch(styles, /\.cm-web-page__canvas--scroll\s*\{[^}]*scroll-snap-type/);
  assert.doesNotMatch(disclaimer, /snap-y|snap-start/);
  assert.match(shell, /\.cm-page-list\s*\{[^}]*padding-block:/);
  assert.match(shell, /\.cm-page-tab-panel\s*\{[^}]*padding-block:/);
  assert.doesNotMatch(shell, /\.cm-page-list,\s*\.cm-page-tab-panel,\s*\.cm-shell-scroll\s*\{[^}]*scroll-snap-type/);
  assert.match(shell, /\.cm-fold:not\(\[open\]\)\s*>\s*\.cm-fold__body\s*\{[\s\S]*display:\s*none/);
  assert.match(assets, /cm-market-workspace/);
  assert.match(assets, /cm-market-tabs/);
});

test("dashboard uses the platform rail, picker stats, and composite mobile grid", () => {
  const dashboard = read("src/pages/dashboard.tsx");
  const networks = read("src/components/dashboard/networks.tsx");
  const overview = read("src/components/dashboard/overview.tsx");
  const spending = read("src/components/dashboard/spending.tsx");
  const styles = read("src/styles/dashboard.css");

  // Header is the standard control rail with the standard page title naming.
  assert.match(dashboard, /cm-control-rail cm-dashboard-control-rail/);
  assert.match(dashboard, /cm-page-header__title/);
  assert.match(dashboard, /<Switcher/);
  assert.match(dashboard, /cm-control-icon-button/);
  assert.match(dashboard, /title="Refresh analytics"/);
  assert.doesNotMatch(dashboard, /cm-dashboard__header|cm-time-range|<Filter/);

  // Network selector: single merged module, STANDARD switcher chrome
  // (cm-shell-tab pill, centered content), logo-driven, shared menu.
  assert.match(networks, /export function toggleNetworkSelection/);
  assert.match(networks, /export function NetworkFilter/);
  assert.match(networks, /@\/contexts\/Network/);
  assert.match(networks, /cm-shell-tab cm-network-filter/);
  assert.match(networks, /cm-control-switcher__label/);
  assert.match(networks, /cm-control-switcher__chevron/);
  assert.match(networks, /title=\{tooltip\}/);
  assert.match(styles, /\.cm-network-filter\s*\{[\s\S]*?justify-content:\s*center/);
  assert.doesNotMatch(networks, /cm-network-filter__trigger/);
  assert.doesNotMatch(styles, /cm-network-filter__trigger/);
  // Narrow rails: network trigger folds to the centered icon only
  // (scoped to .cm-network-filter — the range Switcher keeps its label).
  assert.match(styles, /@container \(max-width: 45rem\) \{[\s\S]*?\.cm-network-filter \.cm-control-switcher__label,[\s\S]*?display:\s*none/);

  // Stats: picker card swaps the visible stat; the dead fold toggle is gone.
  assert.match(overview, /data-selected-stat/);
  assert.match(overview, /cm-stat-card--picker/);
  assert.match(overview, /DropdownMenuTrigger/);
  assert.doesNotMatch(overview, /fold-toggle|data-fold|cm-stat-card--fold/);
  assert.match(styles, /button\.cm-stat-card--picker/);
  // Picker is hidden on wide containers (specificity-locked against the
  // base .cm-stat-card display rule) and only appears in the narrow query.
  assert.match(styles, /button\.cm-stat-card--picker\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /cm-overview__fold|cm-stat-card--fold/);

  // Chart metric tabs follow the block convention: compact BlockDropdown in
  // smaller/non-focused view (like MODELS ▼ / REQUESTS ▼), pills only when
  // the block is focused and has room.
  assert.match(spending, /cm-time-range/);
  assert.match(spending, /BlockDropdown/);
  assert.match(spending, /focused \?/);
  assert.doesNotMatch(spending, /<Switcher/);

  // Mobile pocketed layout: overview | models | activity pockets give each surface full stage height.
  assert.match(styles, /\.cm-dashboard\[data-pocket="overview"\]/);
  assert.match(styles, /\.cm-dashboard\[data-pocket="models"\]/);
  assert.match(styles, /\.cm-dashboard\[data-pocket="activity"\]/);
  assert.doesNotMatch(styles, /repeat\(3, minmax\(10rem/);
  assert.doesNotMatch(styles, /"sideA\s+sideB"/);
  // Spacious 3:1 desktop grid + proximity snapping on dashboard blocks & feed.
  assert.match(styles, /"chart  chart  chart  feed"/);
  assert.match(styles, /"models models models feed"/);
  assert.doesNotMatch(styles, /scroll-snap-type:\s*y mandatory/);
  // Internal scrollers contain overscroll instead of chaining to the shell.
  assert.match(styles, /\.cm-block__body\s*\{[\s\S]*?overscroll-behavior:\s*contain/);
  assert.match(styles, /\.cm-feed-list\s*\{[\s\S]*?overscroll-behavior:\s*contain/);
});

test("playground header keeps the platform title and tab counts visible everywhere", () => {
  const playground = read("src/pages/playground.tsx");
  const styles = read("src/styles/index.css");
  const shell = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");

  // Standard page title convention (same as market/dashboard).
  assert.match(playground, /cm-page-header__title cm-playground__toolbar-title/);
  assert.match(playground, /<span className="text-fuchsia-500 mr-2">\/\/<\/span>/);
  assert.doesNotMatch(playground, /cm-playground__title|Sparkles/);
  // The leftover Benchmarks header button is gone (it lives in the model card tab).
  assert.doesNotMatch(playground, /Open Model Benchmarks|benchmarkOperationForCatalogModel|BarChart3/);
  // One-line default model before user selection (deep link still wins).
  assert.match(playground, /const DEFAULT_MODEL = "[^"]+"/);
  assert.match(playground, /requested\.trim\(\) : DEFAULT_MODEL/);
  // The title never hides — it inherits the calibrated .cm-page-header__title token and ellipsizes cleanly.
  assert.match(styles, /\.cm-playground__toolbar-title\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(styles, /\.cm-playground__toolbar-title\s*\{[^}]*3cqi/);
  assert.doesNotMatch(styles, /cm-playground__title-text|cm-playground__model-count/);
  // The page root keeps the standard separation (rail ↔ composition ↔ edges).
  assert.match(styles, /\.cm-playground\s*\{[\s\S]*?gap:\s*clamp\(0\.4rem,\s*1cqi,\s*0\.7rem\)/);
  assert.match(styles, /\.cm-playground\s*\{[\s\S]*?padding:\s*clamp\(0\.4rem,\s*1cqi,\s*0\.7rem\)/);
  // Collapsed switchers keep their count badge on ultra-narrow containers.
  assert.doesNotMatch(shell, /cm-control-switcher__badge\s*\{[\s\S]*?display:\s*none/);
});

test("keys page uses the standard title and a contained central panel", () => {
  const keys = read("src/components/keys.tsx");
  const styles = read("src/styles/dashboard.css");

  // Standard page title convention (same as market/dashboard/playground).
  assert.match(keys, /cm-page-header__title cm-keys-header__title/);
  assert.match(keys, /<span className="text-fuchsia-500 mr-2">\/\/<\/span>/);
  assert.doesNotMatch(keys, /cm-keys-header__title-icon/);
  assert.doesNotMatch(styles, /cm-keys-header__title-icon/);
  assert.match(styles, /\.cm-keys-header__title\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(styles, /\.cm-keys-header__title\s*\{[^}]*3cqi/);

  // Named cm-stage container + main-first split ratio keeps API Keys dominant and Setup beside it.
  assert.match(styles, /\.cm-keys-page\s*\{[\s\S]*?container:\s*cm-stage \/ inline-size/);
  assert.match(styles, /\.cm-keys-page\s*>\s*\.cm-split\s*\{[\s\S]*?--cm-split-main:\s*1\.35fr/);

  // Central composition is a contained panel (like .cm-quickstart beside it)
  // with internal list scrolling — never a bare transparent region.
  assert.match(styles, /\.cm-keys-main\s*\{[\s\S]*?border:\s*1px solid hsl\(var\(--primary\)/);
  assert.match(styles, /\.cm-keys-main\s*\{[\s\S]*?backdrop-filter:\s*blur/);
  assert.match(styles, /\.cm-keys-main\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.cm-keys-list\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain/);
  assert.match(styles, /\.cm-keys-list\s*\{[\s\S]*?scroll-padding-block:/);
  assert.doesNotMatch(styles, /\.cm-quickstart\s*\{[^}]*scroll-snap-type/);
  assert.match(styles, /\.cm-quickstart__body\s*\{[\s\S]*?flex:\s*0 0 auto/);
  assert.match(keys, /<ShellModal/);
  assert.doesNotMatch(keys, /cm-create-key__|border-violet-500/);
  assert.doesNotMatch(styles, /\.cm-create-key__/);
});

test("benchmark surfaces show family logos with proportional, non-breaking sizing", () => {
  const explorer = read("src/components/benchmarks/explorer.tsx");
  const comparison = read("src/components/benchmarks/comparison.tsx");
  const scatterplot = read("src/components/benchmarks/scatterplot.tsx");
  const family = read("src/components/benchmarks/family.tsx");
  const models = read("src/lib/models.ts");
  const benchmarks = read("src/styles/benchmarks.css");
  const modelsCss = read("src/styles/models.css");

  // Shared renderer reuses the platform logo map + cm-family-icon class and
  // renders nothing for unmapped families (text fallback never shifts).
  assert.match(family, /getFamilyLogoUrl/);
  assert.match(family, /cm-family-icon/);
  assert.match(family, /if \(!logoUrl\) return null/);

  // Every benchmark surface that prints a family name carries the logo.
  assert.match(explorer, /<FamilyLogo family=\{model\.family\} \/>/);
  assert.match(comparison, /<FamilyLogo family=\{candidate\.family\} \/>/);
  assert.match(scatterplot, /<FamilyLogo family=\{data\.family\} \/>/);
  assert.match(scatterplot, /<FamilyLogo family=\{inspectedModel\.family\} \/>/);

  // The map covers the newly added families.
  assert.match(models, /anthropic:\s*"anthropic\.png"/);
  assert.match(models, /tencent:\s*"tencent\.png"/);
  assert.match(models, /pixverse:\s*"pixverse\.png"/);

  // Base class can never stretch a row; workspace rule keeps logos
  // proportional to the benchmarks unit on small screens.
  assert.match(modelsCss, /\.cm-family-icon\s*\{[\s\S]*?flex:\s*0 0 auto[\s\S]*?object-fit:\s*contain/);
  assert.match(benchmarks, /\.cm-benchmarks-workspace \.cm-family-icon[\s\S]*?calc\(var\(--cm-bm-unit\) \* 0\.85\)/);
});

test("backpack rows and binary controls use high-contrast theme primitives", () => {
  const backpack = read("src/components/backpack.tsx");
  const sw = read("src/components/ui/switch.tsx");
  const checkbox = read("src/components/ui/checkbox.tsx");

  assert.match(backpack, /cm-setting-row/);
  assert.doesNotMatch(backpack, /bg-zinc|border-zinc|text-zinc/);
  assert.match(sw, /cm-switch/);
  assert.match(checkbox, /cm-checkbox/);
});

test("published theme stays 100% brand-pure with zero product-specific directories", () => {
  const shell = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");

  assert.equal(existsSync(resolve(repo, "packages/theme/src/agents")), false);
  assert.equal(existsSync(resolve(repo, "packages/theme/src/workflows")), false);
  assert.equal(existsSync(resolve(repo, "packages/theme/src/model")), false);
  assert.equal(existsSync(resolve(repo, "packages/theme/src/market")), false);
  assert.equal(existsSync(resolve(repo, "packages/theme/src/session")), false);
  assert.equal(existsSync(resolve(repo, "packages/theme/src/stream")), false);
  assert.equal(existsSync(resolve(repo, "packages/theme/src/icons")), false);

  assert.match(shell, /\.cm-shell-grid/);
  assert.match(shell, /\.cm-shell-split/);
  assert.match(shell, /\.cm-chip/);
  assert.match(shell, /\.cm-command-panel/);
  assert.match(shell, /\.cm-control-search-fold/);
  assert.doesNotMatch(shell, /\.cm-app-chrome|\.cm-playground__|\.cm-chat\b|\.cm-market-control-rail/);
});

test("split workspaces and mobile stages use single-tree pockets without duplicate Sheet drawers", () => {
  const agent = read("src/pages/agent.tsx");
  const playground = read("src/pages/playground.tsx");
  const workflow = read("src/pages/workflow.tsx");
  const keys = read("src/components/keys.tsx");
  const dashboard = read("src/pages/dashboard.tsx");
  const create = read("src/pages/create.tsx");
  const explorer = read("src/components/benchmarks/explorer.tsx");

  assert.doesNotMatch(agent, /@\/components\/ui\/sheet|<Sheet\b/);
  assert.doesNotMatch(playground, /@\/components\/ui\/sheet|<Sheet\b/);
  assert.doesNotMatch(workflow, /@\/components\/ui\/sheet|<Sheet\b/);
  assert.doesNotMatch(keys, /@\/components\/ui\/sheet|<Sheet\b/);

  assert.match(agent, /<Pockets[\s\S]*?data-pocket=/);
  assert.match(playground, /<Pockets[\s\S]*?data-pocket=/);
  assert.match(workflow, /<Pockets[\s\S]*?data-pocket=/);
  assert.match(keys, /<Pockets/);
  assert.match(keys, /data-pocket=\{pocket\}/);
  assert.match(dashboard, /<Pockets/);
  assert.match(dashboard, /data-pocket=\{pocket\}/);
  assert.match(create, /<Pockets/);
  assert.match(create, /data-pocket=\{builderPocket\}/);
  assert.match(explorer, /cm-benchmarks-card__row/);
  assert.match(explorer, /cm-benchmarks-card__drawer/);
});

test("notifications dialog does not render an in-place trigger icon in layout", () => {
  const notifications = read("src/components/notifications.tsx");
  assert.doesNotMatch(notifications, /<DialogTrigger/);
  assert.doesNotMatch(notifications, /cm-app-chrome__search-toggle/);
});

test("harness capability mapping derives real role-gated and attachment capabilities", () => {
  const executor = getAgentCapabilities({ role: "executor", connectorCount: 0, knowledgeCount: 0 });
  assert.deepEqual(
    executor.map((c) => c.id),
    ["memory", "search", "web3", "models", "connectors"],
  );
  assert.equal(executor.find((c) => c.id === "connectors")?.badge, undefined);

  const coordinator = getAgentCapabilities({ role: "coordinator", connectorCount: 3, knowledgeCount: 2 });
  assert.deepEqual(
    coordinator.map((c) => c.id),
    ["memory", "search", "web3", "models", "connectors", "swarm", "knowledge"],
  );
  assert.equal(coordinator.find((c) => c.id === "connectors")?.badge, "3");
  assert.equal(coordinator.find((c) => c.id === "knowledge")?.badge, "2");
});
