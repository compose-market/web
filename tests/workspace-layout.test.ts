import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

test("root route redirects to keys while home stays outside the app graph", () => {
  const app = read("src/App.tsx");
  const layout = read("src/components/layout/Layout.tsx");

  assert.equal(existsSync(resolve(root, "src/pages/home.tsx")), false);
  assert.doesNotMatch(app, /@\/pages\/home/);
  assert.match(app, /<Redirect\s+to="\/keys"\s+replace\s*\/>/);
  assert.match(app, /const Dashboard = lazy\(\(\) => import\("@\/pages\/dashboard"\)\);/);
  assert.match(app, /<Route path="\/dashboard" component=\{Dashboard\} \/>/);
  assert.match(app, /const Market = lazy\(\(\) => import\("@\/pages\/market"\)\);/);
  assert.match(app, /<Route path="\/market" component=\{Market\} \/>/);
  assert.doesNotMatch(layout, /label:\s*"Home"/);
});

test("network selector lives in the nav utility, not the top HUD or overflow", () => {
  const layout = read("src/components/layout/Layout.tsx");
  const selectorUses = layout.match(/<NetworkSelector/g) || [];

  assert.equal(selectorUses.length, 1);
  assert.match(layout, /cm-app-chrome__navutility[\s\S]*<NetworkSelector/);
  assert.doesNotMatch(layout, /cm-app-chrome__hud-item[\s\S]{0,140}<NetworkSelector/);
  assert.doesNotMatch(layout, /cm-app-chrome__hud-popover-title">Network/);
});

test("market agent cards use root open handlers without nested links", () => {
  const market = read("src/pages/market.tsx");
  const card = read("src/components/agent-card.tsx");
  const networks = read("src/lib/networks.ts");

  assert.match(market, /cm-market-agent-canvas/);
  assert.match(market, /onOpen=\{\(\) => setLocation\(agentPageUrl\)\}/);
  assert.doesNotMatch(market, /<Link[\s\S]{0,220}<SharedAgentCard/);
  assert.match(card, /onOpen\?: \(\) => void/);
  assert.match(card, /role=\{onOpen \? "link" : undefined\}/);
  assert.match(card, /variant === "market"/);
  assert.match(card, /cm-agent-card__verified/);
  assert.match(card, /cm-agent-card__network/);
  assert.doesNotMatch(card, /logo\.dev|chainLogoUrl|VITE_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY/);
  assert.match(card, /@\/lib\/networks/);
  // Chain logos live in the shared network module (dashboard filter reuses it).
  assert.match(networks, /"eip155:43113": "\/networks\/avalancheFuji\.jpeg"/);
  assert.match(networks, /"eip155:43114": "\/networks\/avalanche\.jpeg"/);
  assert.match(networks, /"eip155:421614": "\/networks\/arbitrumSepolia\.png"/);
  assert.match(networks, /"eip155:42161": "\/networks\/arbitrum\.png"/);
  assert.match(networks, /"eip155:5042002": "\/networks\/arcTestnet\.jpeg"/);
  assert.match(networks, /"eip155:5042": "\/networks\/arc\.jpeg"/);
  assert.match(networks, /"eip155:1328": "\/networks\/seiTestnet\.jpeg"/);
  assert.match(networks, /"eip155:1329": "\/networks\/sei\.jpeg"/);
  assert.match(networks, /"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "\/networks\/solanaDevnet\.jpeg"/);
  assert.match(networks, /"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "\/networks\/solana\.jpeg"/);
  assert.match(card, /!isMarketCard && apiEndpoint/);
  assert.match(card, /navigator\.clipboard\.writeText\(apiEndpoint\)/);
  assert.match(card, /title=\{apiEndpoint\}/);
  assert.match(card, /return value \? `\/agent\/\$\{value\.slice\(0,\s*5\)\}\.\.\.` : "Unavailable"/);
  assert.doesNotMatch(card, /API_BASE_URL\.replace\([\s\S]{0,120}\/agent\/\$\{value\.slice/);
  assert.doesNotMatch(market, /A2A Endpoint|Creator|Cloneable/);
});

test("shared card and model primitives stay self-contained without internal card scroll", () => {
  const agents = readFileSync(resolve(repo, "packages/theme/src/agents/agents.css"), "utf8");
  const agentCard = readFileSync(resolve(repo, "web/src/styles/agent-card.css"), "utf8");
  const shell = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");
  const playground = read("src/pages/playground.tsx");
  const chips = read("src/components/models/capabilities.tsx");

  assert.doesNotMatch(agentCard, /cm-agent-card--match-chat[\s\S]{0,180}overflow-y:\s*auto/);
  assert.match(agentCard, /cm-agent-card--market/);
  assert.doesNotMatch(agentCard, /cm-agent-card--market-full/);
  assert.doesNotMatch(agentCard, /cm-agent-card--market[\s\S]{0,180}display:\s*none/);
  assert.match(playground, /<CapabilityChips/);
  assert.doesNotMatch(playground, /<select/);
  assert.match(chips, /cm-chip/);
  assert.match(chips, /cm-type-icon/);
  assert.doesNotMatch(chips, /cm-playground__chip-icon/);
  assert.match(chips, /DropdownMenuTrigger/);
  assert.match(chips, /DropdownMenuContent/);
  assert.match(chips, /cm-playground__chip-menu-grid/);
  assert.match(chips, /selected === "all" \? label/);
  assert.match(chips, /function triggerClass/);
  assert.match(chips, /familyCategories/);
  assert.doesNotMatch(chips, /cm-playground__chip-label/);
  assert.doesNotMatch(chips, /DropdownMenuLabel/);
  assert.doesNotMatch(chips, /categoryClass\(selectedCat,\s*variant,\s*true\)/);
  assert.doesNotMatch(chips, /displayProviders|slice\(0,\s*11\)/);
  assert.match(shell, /\.cm-chip,\s*\n\.cm-tool-chip/);
  assert.match(shell, /\.cm-type--text/);
  assert.match(shell, /\.cm-command-panel/);
  assert.match(shell, /\.cm-chat\s*\{/);
  assert.doesNotMatch(shell, /\.cm-playground__/);
});

test("model card owns its responsive styles in the theme module", () => {
  const styles = read("src/styles/index.css");
  const card = read("src/components/models/card.tsx");
  const playground = read("src/pages/playground.tsx");
  const model = readFileSync(resolve(repo, "packages/theme/src/model/model.css"), "utf8");
  const modelIndex = readFileSync(resolve(repo, "packages/theme/src/model/index.tsx"), "utf8");
  const shellIndex = readFileSync(resolve(repo, "packages/theme/src/shell/index.tsx"), "utf8");
  const shellStyles = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");
  const generator = readFileSync(resolve(repo, "packages/theme/scripts/generate-css.ts"), "utf8");

  assert.equal(existsSync(resolve(repo, "packages/theme/src/model/styles.ts")), false);
  assert.doesNotMatch(styles, /\.cm-model-card/);
  assert.match(card, /ModelCard\s+as\s+ModelCardShell/);
  assert.doesNotMatch(card, /ComposeModel/);
  assert.match(modelIndex, /export const modelStyles = /);
  assert.match(model, /\.cm-model-card\s*\{/);
  assert.match(model, /container-name:\s*cm-model/);
  assert.match(model, /container-type:\s*inline-size/);
  assert.match(model, /\.cm-model-card__content\s*\{[\s\S]*height:\s*100%/);
  assert.match(model, /\.cm-model-card__body\s*>?\s*\.cm-model-card__content:first-child:last-child\s*\{[\s\S]*grid-row:\s*1 \/ -1/);
  // max-content tracks + start alignment are the deliberate Chrome fix: plain
  // auto rows collapse into equal slices inside definite-height scroll
  // containers and clip every section (documented in model.css).
  assert.match(model, /\.cm-model-card__details,\s*\n\.cm-model-card__custom-content\s*\{[\s\S]*?grid-auto-rows:\s*max-content/);
  assert.match(model, /\.cm-model-card__details,\s*\n\.cm-model-card__custom-content\s*\{[\s\S]*?height:\s*100%/);
  assert.match(model, /\.cm-model-card__details,\s*\n\.cm-model-card__custom-content\s*\{[\s\S]*?align-content:\s*start/);
  assert.match(model, /--cm-model-cell-min:\s*calc/);
  assert.match(model, /--cm-model-flow-size:\s*calc/);
  assert.match(model, /--cm-model-format-size:\s*calc/);
  assert.match(model, /--cm-model-label-size:\s*calc/);
  assert.match(model, /\.cm-model-card__details\s*\{[\s\S]*?grid-auto-rows:\s*max-content[\s\S]*?align-content:\s*start/);
  assert.doesNotMatch(model, /\.cm-model-card__details\s*\{[\s\S]*?align-content:\s*space-between/);
  assert.match(model, /\.cm-model-card__icon-label\s*\{[\s\S]*width:\s*var\(--cm-model-flow-size\)/);
  assert.match(model, /\.cm-model-card__format-badge\s*\{[\s\S]*width:\s*var\(--cm-model-format-size\)/);
  assert.match(model, /\.cm-model-card__icon-label--section\s*\{[\s\S]*width:\s*var\(--cm-model-section-icon-size\)/);
  assert.match(model, /--cm-model-unit:\s*clamp/);
  assert.match(model, /\.cm-model-card__details \.cm-model-card__kv-grid,[\s\S]*?grid-auto-rows:\s*auto;[\s\S]*?align-content:\s*center/);
  assert.match(model, /\.cm-model-card__details \.cm-model-card__kv-row,[\s\S]*?grid-template-columns:\s*auto auto[\s\S]*?justify-content:\s*center[\s\S]*?min-height:\s*var\(--cm-model-cell-min\)/);
  assert.doesNotMatch(model, /\.cm-model-card__details \.cm-model-card__kv-row,[^}]*height:\s*auto/);
  assert.match(model, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(model, /@container \(max-width:\s*18rem\)/);
  assert.doesNotMatch(model, /@container cm-model \(max-height:\s*44rem\)/);
  assert.doesNotMatch(model, /@container cm-model \(max-height:\s*34rem\)/);
  assert.doesNotMatch(model, /from "\.\.\/entity"/);
  assert.doesNotMatch(model, /<Card/);
  assert.match(modelIndex, /className="cm-model-card__header"/);
  assert.match(model, /grid-template-columns:\s*var\(--cm-model-logo\) minmax\(0,\s*1fr\)/);
  assert.match(model, /grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(modelIndex, /cm-model-card__metric-cell/);
  assert.match(model, /\.cm-model-card__icon-label--section/);
  assert.match(model, /\.cm-model-card__pricing-unit/);
  assert.match(model, /\.cm-model-card__section--capability/);
  assert.match(model, /\.cm-model-card__lane-grid/);
  assert.match(model, /\.cm-model-card__format-badge/);
  assert.match(model, /\.cm-model-card__option-grid/);
  assert.match(model, /\.cm-model-card__option-grid\s*\{[\s\S]*display:\s*grid/);
  assert.match(model, /\.cm-model-card__option-grid\s*\{[\s\S]*repeat\(auto-fit,\s*minmax\(min\(100%,\s*calc\(var\(--cm-model-unit\) \* 7\)\),\s*1fr\)\)/);
  assert.doesNotMatch(model, /\.cm-model-card__option-grid\s*\{[\s\S]{0,220}flex-wrap/);
  assert.match(model, /\.cm-model-card__section--custom/);
  assert.match(modelIndex, /export function ModelCard/);
  assert.match(modelIndex, /export function ModelSection/);
  assert.match(modelIndex, /export function ModelRow/);
  assert.match(modelIndex, /export function ModelPricing/);
  assert.match(card, /title=\{activeTab === "details"/);
  assert.match(card, /icon=\{activeTab === "details" \? \(\(\) => \{/);
  assert.match(card, /getOptionalModelPricingSections/);
  assert.match(card, /optionalPricingSections\.length > 0/);
  assert.match(card, /label=\{<span className="cm-model-card__section-text">Capability<\/span>\}/);
  assert.match(card, /cm-model-card__lane-grid/);
  assert.match(card, /iconLabel\("Input",\s*"input"\)/);
  assert.match(card, /iconLabel\("Output",\s*"output"\)/);
  assert.match(card, /iconLabel\("Price",\s*"price",\s*"section"\)/);
  assert.match(card, /typeIcon\(value,\s*"cm-model-card__type-icon"\)/);
  assert.match(card, /typeIcon\(id,\s*"cm-model-card__format-icon"\)/);
  assert.match(card, /cm-model-card__format-badge/);
  assert.doesNotMatch(card, /<span>\{label\}<\/span>/);
  assert.match(card, /label=\{<span className="cm-model-card__section-text">Context<\/span>\}/);
  assert.match(card, /<ModelPricing key=\{`price-\$\{section\.header\}-\$\{index\}`\} unit=\{section\.unit\}>/);
  assert.match(card, /role="radiogroup"/);
  assert.match(card, /role="radio"/);
  assert.match(card, /definition\.default \?\? definition\.options\[0\]/);
  assert.doesNotMatch(card, /@\/components\/ui\/select|SelectTrigger|SelectContent|SelectItem/);
  assert.match(playground, /definition\.default !== undefined/);
  assert.match(playground, /definition\.options && definition\.options\.length > 0/);
  assert.match(card, /lines=\{2\}/);
  assert.doesNotMatch(card, /modelInfo\?\.modelId/);
  assert.doesNotMatch(card, /<FieldValue value=\{entry\.value\} unit=\{section\.unit\}/);
  assert.match(model, /\.cm-model-card__type-badge/);
  assert.doesNotMatch(model, /cm-model-card__field-unit/);
  assert.match(shellIndex, /const maxWidth = Math\.min\(320,\s*Math\.max\(160,\s*window\.innerWidth - margin \* 2\)\)/);
  assert.match(shellStyles, /max-width:\s*min\(20rem,\s*calc\(100vw - 1rem\)\)/);
  assert.match(shellStyles, /overflow-wrap:\s*anywhere/);
  assert.match(generator, /modelStyles\.trim\(\)\.length === 0/);
});

test("launch recovery pages use content canvases instead of blind clipping", () => {
  const market = read("src/pages/market.tsx");
  const create = read("src/pages/create-agent.tsx");
  const assets = read("src/pages/my-assets.tsx");
  const styles = read("src/styles/index.css");
  const control = read("src/components/control.tsx");
  const agents = readFileSync(resolve(repo, "packages/theme/src/agents/agents.css"), "utf8");
  const agentCard = readFileSync(resolve(repo, "web/src/styles/agent-card.css"), "utf8");
  const marketTheme = readFileSync(resolve(repo, "packages/theme/src/market/market.css"), "utf8");
  const shellTheme = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");
  const cssIndex = readFileSync(resolve(repo, "packages/theme/src/css/index.ts"), "utf8");

  assert.match(market, /variant="market"/);
  assert.doesNotMatch(market, /cm-agent-card--market-full/);
  assert.match(market, /cm-control-rail cm-market-control-rail/);
  assert.match(market, /<SearchFold/);
  assert.match(control, /cm-control-search-fold/);
  assert.doesNotMatch(market, /cm-control-rail cm-control-rail--compact/);
  assert.match(market, /cm-market-row-grid/);
  assert.match(cssIndex, /@import '\.\/market\.css';/);
  assert.match(marketTheme, /\.cm-market-agent-grid,\s*\n\.cm-market-row-grid\s*\{[\s\S]*repeat\(auto-fit,\s*minmax\(min\(100%,\s*var\(--cm-market-min/);
  assert.match(marketTheme, /\.cm-market-control-rail\s*\{[\s\S]*display:\s*flex/);
  assert.doesNotMatch(marketTheme, /cm-market-search-fold|cm-search--market/);
  assert.match(shellTheme, /\.cm-control-search-fold\[data-open="true"\]\s+\.cm-search--fold\s*\{[\s\S]*width:\s*clamp\(13rem/);
  assert.match(marketTheme, /scroll-snap-type:\s*y mandatory/);
  assert.match(marketTheme, /scroll-snap-stop:\s*always/);
  assert.doesNotMatch(styles, /^\.cm-market-agent-grid/m);
  assert.doesNotMatch(marketTheme, /\.cm-market[\s\S]{0,220}repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(styles, /nth-child\(/);
  assert.doesNotMatch(styles, /cm-agent-card--market-full/);
  assert.doesNotMatch(styles, /cm-agent-card(--|__)/);
  assert.match(marketTheme, /--cm-market-card-size:/);
  assert.match(marketTheme, /\.cm-market-agent-grid\s*\{[\s\S]*grid-auto-rows:\s*var\(--cm-market-card-size\)/);
  assert.match(marketTheme, /\.cm-market-agent-slot,\s*\n\.cm-market-row-grid > \*\s*\{[\s\S]*height:\s*var\(--cm-market-card-size\)/);
  assert.match(marketTheme, /\.cm-market-agent-slot,\s*\n\.cm-market-row-grid > \*\s*\{[\s\S]*contain-intrinsic-size:\s*var\(--cm-market-card-size\)/);
  assert.match(agentCard, /\.cm-agent-card--market > \.cm-card__body\s*\{[\s\S]*height:\s*100%/);
  assert.match(agentCard, /\.cm-agent-card--market > \.cm-card__body\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(agentCard, /\.cm-agent-card--match-chat\s*\{[\s\S]*container-name:\s*cm-agent-card[\s\S]*container-type:\s*inline-size/);
  assert.match(agentCard, /\.cm-agent-card--match-chat > \.cm-card__body\s*\{[\s\S]*grid-template-rows:[\s\S]*auto[\s\S]*auto[\s\S]*auto[\s\S]*auto[\s\S]*auto/);
  assert.match(agentCard, /\.cm-agent-card--match-chat > \.cm-card__body\s*\{[\s\S]*align-content:\s*stretch/);
  assert.doesNotMatch(agentCard, /--cm-agent-card-desc/);
  assert.match(agentCard, /\.cm-agent-card--match-chat \.cm-card__metric\s*\{[\s\S]*max-height:\s*var\(--cm-agent-card-metric\)/);
  assert.match(agentCard, /\.cm-agent-card--match-chat \.cm-card__tags-block\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*max-content\)[\s\S]*justify-content:\s*center/);
  assert.match(agentCard, /\.cm-agent-card--match-chat \.cm-agent-card__endpoint-row\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*max-content\) auto[\s\S]*justify-content:\s*center/);
  assert.match(agentCard, /\.cm-agent-card--match-chat \.cm-agent-card__creator\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*max-content\)[\s\S]*justify-content:\s*center/);
  assert.doesNotMatch(agentCard, /\.cm-agent-card--match-chat \.cm-card__tags-block\s*\{[\s\S]*width:\s*fit-content/);
  assert.match(agents, /\.cm-agent-card__identity-meta\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(agents, /\.cm-agent-card__model\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(agents, /\.cm-agent-card__model\s*\{[\s\S]*max-height:\s*none/);
  assert.match(agents, /\.cm-agent-card__model-name\s*\{[\s\S]*text-overflow:\s*ellipsis/);

  assert.match(create, /cm-web-page__canvas cm-workspace-canvas--fade/);
  assert.match(create, /cm-create-builder__pair/);
  assert.doesNotMatch(create, /pb-20/);
  assert.doesNotMatch(create, /NetworkSelector/);
  assert.doesNotMatch(create, /overflow-y-auto max-h-\[100px\]/);

  assert.match(assets, /cm-web-page__canvas cm-workspace-canvas--fade/);
  assert.match(assets, /cm-control-rail/);
  assert.doesNotMatch(assets, /useAgentsByCreator/);
  // Agents tab renders the shared cached catalog snapshot (models-worker
  // parity) — no private fetching, no zero-TTL cache churn.
  assert.match(assets, /useAgentCatalog/);
  assert.match(assets, /toOnchainAgent/);
  assert.doesNotMatch(assets, /AGENTS_URL/);
  assert.doesNotMatch(assets, /staleTime:\s*0/);
  assert.doesNotMatch(assets, /gcTime:\s*0/);
  assert.match(assets, /cm-market-agent-canvas/);
  assert.match(assets, /variant="market"/);
  assert.doesNotMatch(assets, /cm-agent-card--market-full/);
  assert.doesNotMatch(assets, /cm-market-control-rail--unified/);
  assert.match(assets, /<SearchFold/);
  assert.doesNotMatch(assets, /cm-control-rail cm-control-rail--compact/);
  assert.doesNotMatch(assets, /pb-20/);
});

test("fixed page shells keep whole-page canvases locked and move overflow into explicit lists", () => {
  const styles = read("src/styles/index.css");
  const shell = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");
  const agents = read("src/pages/agents.tsx");
  const models = read("src/pages/models.tsx");
  const registry = read("src/pages/registry.tsx");
  const assets = read("src/pages/my-assets.tsx");

  assert.match(styles, /\.cm-web-page__canvas\s*\{[\s\S]*overflow-y:\s*hidden/);
  assert.doesNotMatch(styles, /^\.cm-page-list\s*\{/m);
  assert.doesNotMatch(styles, /^\.cm-page-tab-panel\s*\{/m);
  assert.doesNotMatch(styles, /^\.cm-fold\s*\{/m);
  assert.match(shell, /\.cm-page-list\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(shell, /\.cm-page-tab-panel\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(shell, /\.cm-fold:not\(\[open\]\)\s*>\s*\.cm-fold__body\s*\{[\s\S]*display:\s*none/);
  assert.match(styles, /#000 1\.5%, #000 95%/);
  assert.doesNotMatch(styles, /clamp\(5\.(35|55)rem/);

  assert.match(agents, /cm-page-stack/);
  assert.match(agents, /cm-page-list cm-workspace-canvas--fade/);
  assert.match(models, /cm-page-stack/);
  assert.match(models, /cm-page-list cm-workspace-canvas--fade/);
  assert.match(registry, /cm-page-stack/);
  assert.match(registry, /cm-page-list cm-workspace-canvas--fade/);
  assert.match(assets, /cm-market-workspace/);
  assert.match(assets, /cm-market-tabs/);
  assert.match(assets, /cm-market-tab-panel cm-market-tab-panel--agents/);
  assert.match(assets, /cm-market-tab-panel cm-market-tab-panel--scroll/);
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
  assert.match(networks, /@\/lib\/networks/);
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

  // Composite narrow layout: hero row + two full-width stacked rows whose
  // combined height equals the old shared row, focus-aware areas.
  assert.match(styles, /"main"/);
  assert.match(styles, /"sideA"/);
  assert.match(styles, /"sideB"/);
  assert.match(styles, /grid-template-rows:\s*auto auto minmax\(0,\s*1\.35fr\) minmax\(0,\s*0\.5fr\) minmax\(0,\s*0\.5fr\)/);
  assert.match(styles, /\.cm-dashboard\[data-focus="models"\] \.cm-block\[data-block="models"\]\s*\{\s*grid-area:\s*main/);
  assert.match(styles, /\.cm-dashboard\[data-focus="feed"\] \.cm-block\[data-block="feed"\]\s*\{\s*grid-area:\s*main/);
  assert.doesNotMatch(styles, /repeat\(3, minmax\(10rem/);
  assert.doesNotMatch(styles, /"sideA\s+sideB"/);
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
  // The title never hides — it scales + ellipsizes via the toolbar container.
  assert.match(styles, /\.cm-playground__toolbar-title\s*\{[\s\S]*?font-size:\s*clamp\(0\.7rem,\s*3cqi,\s*1\.12rem\)/);
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
  assert.match(styles, /\.cm-keys-header__title\s*\{[\s\S]*?font-size:\s*clamp\(0\.7rem,\s*3cqi,\s*1\.12rem\)/);

  // Central composition is a contained panel (like .cm-quickstart beside it)
  // with internal list scrolling — never a bare transparent region.
  assert.match(styles, /\.cm-keys-main\s*\{[\s\S]*?border:\s*1px solid hsl\(var\(--primary\)/);
  assert.match(styles, /\.cm-keys-main\s*\{[\s\S]*?backdrop-filter:\s*blur/);
  assert.match(styles, /\.cm-keys-main\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.cm-keys-list\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain/);
});

test("benchmark surfaces show family logos with proportional, non-breaking sizing", () => {
  const explorer = read("src/components/benchmarks/explorer.tsx");
  const comparison = read("src/components/benchmarks/comparison.tsx");
  const scatterplot = read("src/components/benchmarks/scatterplot.tsx");
  const family = read("src/components/benchmarks/family.tsx");
  const models = read("src/lib/models.ts");
  const benchmarks = read("src/styles/benchmarks.css");
  const styles = read("src/styles/index.css");

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
  assert.match(styles, /\.cm-family-icon\s*\{[\s\S]*?flex:\s*0 0 auto[\s\S]*?object-fit:\s*contain/);
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

test("published theme sources keep generic primitives separate from product layouts", () => {
  const shell = readFileSync(resolve(repo, "packages/theme/src/shell/shell.css"), "utf8");
  const agents = readFileSync(resolve(repo, "packages/theme/src/agents/agents.css"), "utf8");
  const agentCard = readFileSync(resolve(repo, "web/src/styles/agent-card.css"), "utf8");
  const market = readFileSync(resolve(repo, "packages/theme/src/market/market.css"), "utf8");

  assert.match(shell, /#000 1\.5%, #000 95%/);
  assert.match(shell, /\.cm-shell-grid/);
  assert.match(shell, /\.cm-shell-split/);
  assert.match(shell, /\.cm-chip/);
  assert.match(shell, /\.cm-command-panel/);
  assert.doesNotMatch(shell, /\.cm-app-chrome/);
  assert.doesNotMatch(shell, /\.cm-playground__/);
  assert.doesNotMatch(shell, /clamp\(5\.(35|55)rem/);
  assert.match(market, /\.cm-page-header/);
  assert.match(market, /\.cm-market-agent-canvas/);
  assert.doesNotMatch(market, /\.cm-playground__/);
  assert.doesNotMatch(market, /\.cm-app-chrome/);
  assert.match(agentCard, /\.cm-agent-card--match-chat,\s*\n\.cm-agent-card--asset\s*\{[\s\S]*height:\s*100%/);
  assert.match(agentCard, /\.cm-agent-card--match-chat\s*\{[\s\S]*container-type:\s*inline-size/);
  assert.doesNotMatch(agentCard, /@container cm-agent-card \(max-height:\s*42rem\)/);
  assert.match(agentCard, /\.cm-agent-card--match-chat > \.cm-card__body\s*\{[\s\S]*align-content:\s*stretch/);
  assert.match(agents, /\.cm-agent-card__identity-meta\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(agents, /\.cm-agent-card__model\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(agents, /\.cm-agent-card__model-name\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(shell, /\.cm-control-search-fold/);
  assert.doesNotMatch(market, /cm-market-search-fold|cm-search--market/);
});
