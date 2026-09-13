import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const packageLock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
const programsUrl = new URL("../src/lib/programs.ts", import.meta.url);
const programsSource = readFileSync(programsUrl, "utf8");
const contractsSource = readFileSync(new URL("../src/lib/contracts.ts", import.meta.url), "utf8");
const shareSource = readFileSync(new URL("../src/lib/share.ts", import.meta.url), "utf8");
const shareDialogSource = readFileSync(new URL("../src/components/share.tsx", import.meta.url), "utf8");
const pinataSource = readFileSync(new URL("../src/lib/pinata.ts", import.meta.url), "utf8");
const createAgentSource = readFileSync(new URL("../src/pages/create-agent.tsx", import.meta.url), "utf8");
const composeSource = readFileSync(new URL("../src/pages/compose.tsx", import.meta.url), "utf8");
const swigSource = readFileSync(new URL("../src/lib/svm/swig.ts", import.meta.url), "utf8");

function firstSharePayload(source: string): string {
  return source.match(/saveMintSuccessForShare\(\{[\s\S]*?\n\s*\}\);/)?.[0] ?? "";
}

test("web package metadata keeps the SDK as a publishable semver dependency", () => {
  assert.doesNotMatch(packageJson, /"@compose-market\/sdk"\s*:\s*"(?:file:|link:|workspace:|local:)/);
  assert.doesNotMatch(packageLock, /"@compose-market\/sdk"\s*:\s*"(?:file:|link:|workspace:|local:)/);
});

test("web program adapter replaces the removed blockchain module and imports SDK builders", () => {
  assert.equal(existsSync(new URL("../src/lib/blockchain.ts", import.meta.url)), false);
  assert.equal(existsSync(programsUrl), true);
  assert.match(programsSource, /from "@compose-market\/sdk\/blockchain"/);
  assert.match(programsSource, /buildIdentityMintInstruction/);
  assert.match(programsSource, /buildMarketMintWorkflowInstruction/);
  assert.match(programsSource, /buildMarketCreateRfaInstruction/);
  assert.match(programsSource, /decodeIdentityRegistryAccount/);
  assert.match(programsSource, /decodeMarketRegistryAccount/);
  assert.match(createAgentSource, /from "@\/lib\/programs"/);
  assert.match(composeSource, /from "@\/lib\/programs"/);
});

test("web program adapter is app-local transport glue, not an SDK account factory", () => {
  assert.doesNotMatch(programsSource, /\/api\/svm\/account|\/api\/svm\/approve/);
  assert.doesNotMatch(programsSource, /createAccount\(|account factory|sponsor/i);
  assert.match(programsSource, /sdk\.svm\.feePayer\(\)/);
  assert.match(programsSource, /sdk\.svm\.relay\(/);
  assert.match(programsSource, /buildSwigInstructionTransaction/);
});

test("create-agent no longer fakes Solana deployment as chainId zero", () => {
  assert.doesNotMatch(createAgentSource, /selectedChainId\s*=\s*isEvmNetwork\(selectedNetwork\)\s*\?\s*evmChainId\(selectedNetwork\)\s*:\s*0/);
  assert.doesNotMatch(createAgentSource, /chainId\s*=\s*selectedChainId\s*\|\|\s*0/);
  assert.match(createAgentSource, /network:\s*selectedNetwork/);
  assert.match(createAgentSource, /buildSolanaMintAgentInstruction/);
  assert.match(createAgentSource, /relaySolanaManowarInstructions/);
  assert.match(createAgentSource, /getAgentFactoryContractForChain/);
});

test("compose workflow mint supports EVM contracts and Solana programs through selected network", () => {
  assert.doesNotMatch(composeSource, /selectedChainId\s*=\s*isEvmNetwork\(selectedNetwork\)\s*\?\s*evmChainId\(selectedNetwork\)\s*:\s*0/);
  assert.doesNotMatch(composeSource, /paymentChainId\s*=\s*isEvmNetwork\(paymentNetwork\)\s*\?\s*evmChainId\(paymentNetwork\)\s*:\s*0/);
  assert.match(composeSource, /buildSolanaMintWorkflowInstruction/);
  assert.match(composeSource, /fetchSolanaAgentAccount/);
  assert.match(composeSource, /relaySolanaManowarInstructions/);
  assert.match(composeSource, /getWorkflowContractForChain/);
});

test("new metadata writes use network as the primary deployment identity", () => {
  assert.match(createAgentSource, /network:\s*selectedNetwork/);
  assert.match(composeSource, /network:\s*selectedNetwork/);
  assert.doesNotMatch(pinataSource, /chain\?:\s*number/);
  assert.doesNotMatch(createAgentSource, /chain:\s*chainId/);
  assert.doesNotMatch(composeSource, /chain:\s*selectedChainId/);
  assert.doesNotMatch(createAgentSource, /chain:\s*0/);
  assert.doesNotMatch(composeSource, /chain:\s*0/);
});

test("share state is network-native and not EVM chainId-shaped", () => {
  assert.match(shareSource, /network:\s*NetworkId/);
  assert.doesNotMatch(shareSource, /chainId/);
  assert.match(shareDialogSource, /getChainByNetwork\(network\)/);
  assert.doesNotMatch(shareDialogSource, /CHAIN_CONFIG|chainId/);
  assert.doesNotMatch(firstSharePayload(createAgentSource), /chainId/);
  assert.doesNotMatch(firstSharePayload(composeSource), /chainId/);
});

test("hash helpers preserve Solidity chainId semantics and support network identifiers", () => {
  assert.match(contractsSource, /typeof chainId === "string"/);
  assert.match(contractsSource, /\["string", "uint256", "string"\]/);
  assert.match(contractsSource, /\["string", "string", "string"\]/);
  assert.match(contractsSource, /deploymentAddress\.startsWith\("0x"\)/);
});

test("generic Swig wrapper can wrap SDK-built Manowar program instructions", () => {
  assert.match(swigSource, /buildSwigInstructionTransaction/);
  assert.match(swigSource, /Swig-wrapped Solana instructions must include explicit accounts and data/);
  assert.match(swigSource, /getSignInstructions/);
  assert.match(swigSource, /getEvmPersonalSignPrefix/);
});
