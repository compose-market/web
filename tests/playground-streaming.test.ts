import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const playgroundSource = readFileSync(new URL("../src/pages/playground.tsx", import.meta.url), "utf8");
const agentSource = readFileSync(new URL("../src/pages/agent.tsx", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../src/pages/workflow.tsx", import.meta.url), "utf8");
const multimodalPath = new URL("../src/lib/multimodal.ts", import.meta.url);
const timelinePath = new URL("../src/components/tool-timeline.tsx", import.meta.url);
const blurPath = new URL("../src/components/blur.tsx", import.meta.url);
const streamSource = readFileSync(new URL("../src/hooks/use-stream.ts", import.meta.url), "utf8");
const chatHookSource = readFileSync(new URL("../src/hooks/use-chat.ts", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../src/components/chat.tsx", import.meta.url), "utf8");
const outputSource = readFileSync(new URL("../src/components/output.tsx", import.meta.url), "utf8");
const receiptSource = readFileSync(new URL("../src/components/receipt-indicator.tsx", import.meta.url), "utf8");
const missionSource = readFileSync(new URL("../src/components/mission-control.tsx", import.meta.url), "utf8");
const themeStreamSource = readFileSync(new URL("../../packages/theme/src/stream/index.tsx", import.meta.url), "utf8");
const themeStreamStyles = readFileSync(new URL("../../packages/theme/src/stream/stream.css", import.meta.url), "utf8");

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("playground uses model streams without terminal runners or synthetic running activity", () => {
  assert.equal(existsSync(multimodalPath), false);
  assert.match(playgroundSource, /streamer\.runResponses\(/);
  assert.match(playgroundSource, /stream:\s*true/);
  assert.doesNotMatch(playgroundSource, /runInference|inferenceMessage|Running \$\{/);
  assert.doesNotMatch(playgroundSource, /sdk\.inference\.videos\.generate\(|responses\.create\(|images\.generate\(|waitUntilDone\(/);
});

test("web routes model and activity events through separate dispatch paths", () => {
  assert.equal(existsSync(timelinePath), false);
  assert.equal(existsSync(blurPath), false);
  assert.match(streamSource, /function dispatchModel/);
  assert.match(streamSource, /function dispatchActivity/);
  assert.match(streamSource, /event\.domain === "model"/);
  assert.match(streamSource, /applyAssistantModelEvent/);
  assert.match(streamSource, /applyAssistantActivityEvent/);
  assert.doesNotMatch(streamSource, /applyAssistantStreamEvent|StreamEvent|createStreamTree|reduceStreamTree/);
  assert.doesNotMatch(chatSource, /function StreamTreeView|message\.stream|StreamTree/);
  assert.doesNotMatch(agentSource, /ToolTimeline/);
  assert.doesNotMatch(playgroundSource, /ToolTimeline/);
  assert.doesNotMatch(workflowSource, /ToolTimeline/);
});

test("chat renders ordered blocks instead of a fixed stream tree order", () => {
  const messageBody = section(chatSource, "function MessageItemInner", "export const MessageItem");
  assert.match(chatHookSource, /export type MessageBlock/);
  assert.match(chatHookSource, /blocks\?: MessageBlock\[\]/);
  assert.match(messageBody, /message\.blocks\?\.map\(renderBlock\)/);
  assert.match(messageBody, /block\.type === "text"/);
  assert.match(messageBody, /block\.type === "reasoning"/);
  assert.match(messageBody, /block\.type === "plan"/);
  assert.match(messageBody, /block\.type === "activity"/);
  assert.match(messageBody, /block\.type === "asset"/);
  assert.ok(messageBody.indexOf('block.type === "plan"') < messageBody.indexOf('block.type === "activity"'));
  assert.ok(messageBody.indexOf('block.type === "activity"') < messageBody.indexOf('block.type === "asset"'));
  assert.doesNotMatch(messageBody, /StreamTreeView|Thinking stream/);
});

test("activity folds render real activity state and hide traces by default", () => {
  assert.match(missionSource, /ActivityState/);
  assert.match(missionSource, /isVisibleNode/);
  assert.match(missionSource, /node\.kind === "trace"/);
  assert.match(missionSource, /node\.kind === "plan"/);
  assert.match(missionSource, /node\.kind === "message"/);
  assert.match(streamSource, /if \(event\.type === "activity\.trace"\) return/);
  assert.doesNotMatch(missionSource, /kind="debug"|status="info"/);
});

test("direct model output stays on text, reasoning, and asset surfaces", () => {
  const artifactBlock = section(chatSource, "function ArtifactBlock", "function artifactTitle");
  const messageItem = section(chatSource, "function MessageItemInner", "export const MessageItem");
  assert.match(streamSource, /event\.type === "model\.text\.delta"/);
  assert.match(streamSource, /event\.type === "model\.reasoning\.delta"/);
  assert.match(streamSource, /event\.type === "model\.asset"/);
  assert.match(streamSource, /function artifactFromModelEvent/);
  assert.match(messageItem, /title="Thinking"/);
  assert.match(artifactBlock, /partial/);
  assert.match(artifactBlock, /progress/);
  assert.match(artifactBlock, /SharedStreamMedia/);
  assert.match(themeStreamStyles, /cm-stream-media--partial/);
  assert.doesNotMatch(streamSource, /artifactFrames|emitArtifact|function artifactFromEvent/);
  assert.doesNotMatch(chatSource, /DirectModelDetails|Model stream|Model activity/);
});

test("generated media hydrate and render as normal chat assets", () => {
  const artifactBlock = section(chatSource, "function ArtifactBlock", "function artifactTitle");
  const mediaBranch = section(artifactBlock, "if (mediaKind)", "if (item.artifactType === \"embedding\")");
  assert.match(streamSource, /function hydrateArtifact/);
  assert.match(chatHookSource, /upsertAssistantArtifact/);
  assert.match(chatHookSource, /type: "asset", artifactId/);
  assert.doesNotMatch(streamSource, /imageUrl:\s*outputItemUrl|audioUrl:\s*outputItemUrl|videoUrl:\s*outputItemUrl/);
  assert.doesNotMatch(mediaBranch, /SharedStreamNode/);
  assert.match(artifactBlock, /SharedStreamMedia/);
  assert.match(artifactBlock, /Download/);
  assert.match(artifactBlock, /MediaPreview/);
  assert.match(outputSource, /SharedStreamMedia kind="image"/);
});

test("artifact merges never clobber hydrated fields with undefined follow-up frames", () => {
  const upsert = section(chatHookSource, "const upsertAssistantArtifact", "function artifactKey");
  assert.match(upsert, /Object\.entries\(artifact\)\.filter\(\(\[, value\]\) => value !== undefined\)/);
  assert.match(upsert, /\.\.\.patch, id: artifacts\[idx\]\.id/);
  assert.doesNotMatch(upsert, /\.\.\.artifact, id: artifacts\[idx\]\.id/);
});

test("mission control roots never duplicate between declared roots and orphan re-roots", () => {
  const roots = section(missionSource, "const visited = new Set<string>();", "const groupedRoots");
  assert.match(roots, /const rootIds = new Set\(roots\.map\(\(n\) => n\.id\)\)/);
  assert.match(roots, /rootIds\.has\(n\.id\)/);
});

test("embedding artifacts render as foldable vectors without fake artifact status chrome", () => {
  const artifactBlock = section(chatSource, "function ArtifactBlock", "function artifactTitle");
  const embeddingBlock = section(chatSource, "function EmbeddingBlock", "function shortId");
  const embeddingArtifact = section(chatSource, "function EmbeddingArtifact", "function embeddingShape");
  assert.match(artifactBlock, /item\.artifactType === "embedding"/);
  assert.match(chatSource, /function embeddingVector/);
  assert.match(chatSource, /Copy raw embedding/);
  assert.match(chatSource, /dimensions/);
  assert.match(streamSource, /embedding:\s*embedding\(asset\.embedding/);
  assert.match(streamSource, /view\.embedding/);
  assert.doesNotMatch(embeddingBlock, /kind="artifact"|status="completed"/);
  assert.doesNotMatch(embeddingArtifact, /kind="artifact"|status=\{item\.status\}/);
});

test("plan review and failures are product blocks, not backend stream events", () => {
  const planReview = section(chatSource, "function InlinePlanGate", "function ArtifactBlock");
  assert.match(planReview, /SharedPlanGate/);
  assert.match(missionSource, /PlanVersionCarousel/);
  assert.match(missionSource, /planTasks\(activePlan\)/);
  assert.match(streamSource, /function planFromActivityEvent/);
  assert.match(chatHookSource, /type: "notice"/);
  assert.match(chatHookSource, /export function noticeId/);
  assert.match(streamSource, /noticeId\("error", message\)/);
  assert.match(streamSource, /chat\.failAssistant\(assistantId,\s*message\)/);
  assert.match(chatSource, /class MessageBoundary/);
  assert.doesNotMatch(streamSource, /content:\s*`Error:/);
  assert.doesNotMatch(agentSource, /content:\s*`Error:/);
  assert.doesNotMatch(playgroundSource, /content:\s*`Error:/);
  assert.doesNotMatch(workflowSource, /content:\s*`Error:/);
});

test("receipt and budget stay side channels, not quality stream blocks", () => {
  const dispatchModel = section(streamSource, "function dispatchModel", "function dispatchActivity");
  const dispatchActivity = section(streamSource, "function dispatchActivity", "function nextBlock");
  assert.doesNotMatch(dispatchModel, /onReceipt|onBudget/);
  assert.doesNotMatch(dispatchActivity, /onReceipt|onBudget/);
  assert.match(streamSource, /sdk\.events\.on\("receipt"/);
  assert.match(streamSource, /sdk\.events\.on\("budget"/);
  assert.match(receiptSource, /event\.receipt\.finalAmountWei/);
  assert.match(receiptSource, /receipt\?\.txHash/);
});

test("realtime responses keep one paid stream while opening and append follow-up input", () => {
  const realtimeRunner = section(streamSource, "const runRealtimeResponses", "const runResponses");
  const responsesRunner = section(streamSource, "const runResponses", "const appendResponses");
  assert.ok(
    realtimeRunner.indexOf("openingRef.current.set(model, opening)") <
    realtimeRunner.indexOf("sdk.inference.responses.stream"),
  );
  assert.match(realtimeRunner, /settle\.resolve\?\.\(active\)/);
  assert.match(responsesRunner, /const opening = model \? openingRef\.current\.get\(model\) : undefined/);
  assert.match(responsesRunner, /const pending = openingRef\.current\.get\(model\)/);
  assert.match(responsesRunner, /await append\(args, ready\)/);
});

test("realtime responses abort active and pending streams on page close", () => {
  const lifecycle = section(streamSource, "const closeRealtime = useCallback", "const runAgent");
  const realtimeRunner = section(streamSource, "const runRealtimeResponses", "const runResponses");
  assert.match(realtimeRunner, /const controller = new AbortController\(\)/);
  assert.match(realtimeRunner, /const opening: OpeningResponse = \{ promise: started, controller, cleanup \}/);
  assert.match(realtimeRunner, /signal: controller\.signal/);
  assert.match(lifecycle, /for \(const item of opening\)/);
  assert.match(lifecycle, /for \(const item of live\)/);
  assert.match(lifecycle, /abort\(item\.controller\)/);
  assert.match(lifecycle, /sdk\.inference\.responses\.cancel\(item\.responseId, item\.options\)/);
  assert.match(lifecycle, /window\.addEventListener\("beforeunload", unload\)/);
  assert.match(lifecycle, /window\.addEventListener\("pagehide", unload\)/);
  assert.match(lifecycle, /window\.removeEventListener\("beforeunload", unload\)/);
  assert.match(lifecycle, /window\.removeEventListener\("pagehide", unload\)/);
  assert.match(lifecycle, /cancelStandardResponses\(\)/);
  assert.match(lifecycle, /closeRealtime\(true\)/);
  assert.doesNotMatch(lifecycle, /visibilitychange/);
});

test("partial realtime audio chunks do not hydrate by fetching the response", () => {
  const dispatchModel = section(streamSource, "function dispatchModel", "function dispatchActivity");
  assert.match(dispatchModel, /item\.partial !== true && !item\.url && item\.responseId/);
  assert.doesNotMatch(chatSource, /hiddenArtifact/);
});

test("stopping realtime audio terminalizes web presentation immediately", () => {
  const realtimeState = section(chatHookSource, "const stopRealtimeArtifacts", "const setRealtimeSession");
  const liveAudio = section(chatSource, "function LiveAudio", "function DirectMedia");
  const dispatchModel = section(streamSource, "function dispatchModel", "function dispatchActivity");
  assert.match(chatHookSource, /stoppedRealtimeResponsesRef/);
  assert.match(chatHookSource, /artifact\.partial === true[\s\S]{0,180}stoppedRealtimeResponsesRef\.current\.has/);
  assert.match(realtimeState, /partial:\s*false/);
  assert.match(realtimeState, /status:\s*"stopped"/);
  assert.match(realtimeState, /phase:\s*"idle"/);
  assert.match(liveAudio, /const closePlayback = useCallback/);
  assert.ok(liveAudio.indexOf("closePlayback();") < liveAudio.indexOf("onStopRealtime?.();"));
  assert.match(chatSource, /raw === "stopped"/);
  assert.match(chatSource, /!stopped && <Loader2/);
  assert.match(dispatchModel, /event\.type === "model\.done"[\s\S]{0,220}stopRealtimeArtifacts/);
  assert.match(dispatchModel, /event\.type === "model\.done"[\s\S]{0,260}onDone\?\.\(\)/);
  assert.match(playgroundSource, /onDone:\s*\(\) => setStreaming\(false\)/);
});

test("ordinary responses stop presenting as live while payment finalizes and remain cancellable", () => {
  const responsesRunner = section(streamSource, "const runResponses", "const appendResponses");
  const dispatchModel = section(streamSource, "function dispatchModel", "function dispatchActivity");
  assert.match(streamSource, /const responseControllerRef = useRef<AbortController \| null>/);
  assert.match(streamSource, /const cancelResponses = useCallback/);
  assert.match(responsesRunner, /const controller = new AbortController\(\)/);
  assert.match(responsesRunner, /signal: controller\.signal/);
  assert.match(dispatchModel, /event\.type === "model\.status" && phase === "finalizing_payment"[\s\S]{0,120}clearActivityStateUnlessError/);
  assert.doesNotMatch(dispatchModel, /event\.type === "model\.status" && phase === "finalizing_payment"[\s\S]{0,180}onDone/);
  assert.doesNotMatch(streamSource, /event\.type === "model\.text\.done"[\s\S]{0,400}onDone/);
  assert.match(playgroundSource, /streamer\.cancelResponses\(\)/);
});

test("theme stream nodes keep raw kind and status out of visible chrome by default", () => {
  const nodeSource = section(themeStreamSource, "export function StreamNode", "export interface MissionControlPanelProps");
  assert.match(nodeSource, /data-kind=\{kind\}/);
  assert.match(nodeSource, /data-status=\{status\}/);
  assert.match(themeStreamSource, /badges\?: React\.ReactNode/);
  assert.match(nodeSource, /\{badges\}/);
  assert.doesNotMatch(nodeSource, /cm-stream-node__kind/);
  assert.doesNotMatch(nodeSource, /cm-stream-node__status/);
});

test("chat scroll preserves manual inspection during live updates", () => {
  assert.match(chatHookSource, /stickToBottomRef\.current = true/);
  assert.match(chatHookSource, /addEventListener\("wheel", markUserScroll/);
  assert.match(chatHookSource, /addEventListener\("touchmove", markUserScroll/);
  assert.match(chatSource, /New messages/);
});
