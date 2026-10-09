import type { StudioDocument, ToolScope } from "@studio/schema-core";
import { STUDIO_TOOLS } from "@studio/schema-core";
import type { ChatMessage } from "./provider.js";
import { STAGE_LABELS, type ChatRequestBody, type SendEvent } from "./routes.js";
import { DEFAULT_MAX_STEPS, runAgentLoop, type AgentLoopResult, type LoopEvent, type ToolDriver } from "./agentLoop.js";
import { runVerifyLoop } from "./verifyLoop.js";
import { pickPage, splicePageBack } from "./pageSelection.js";
import { doneFromGenerateLoop, doneFromLoopOps, scopeFor, type LoopPipelineDeps } from "./loop-epilogue.js";

/**
 * Agent-loop SSE pipeline (P6-2), extracted from routes.ts to keep that file
 * under the 400-line limit. Executes the driver's tool batches through the
 * StudioTool registry, streams tool-call/tool-result frames, and converts the
 * final loop doc back into the SAME done/error/violation SSE contract the
 * legacy text path emitted (workbench parsers unchanged).
 *
 * T54 split: orchestration lives here; frame text construction in
 * ./loop-frames.js; terminal-state assembly in ./loop-epilogue.js. The two
 * re-exports below keep the historical import path stable for existing tests.
 * T60 (W3-B): the generate branch runs 1..N independent rounds from the SAME
 * start doc — round 1 is the primary `document`, optional `variants: 2|3`
 * differentiated rounds ride the done frame as additive `alternatives`.
 */

export type { LoopPipelineDeps } from "./loop-epilogue.js";
export { humanStreamText } from "./loop-frames.js";
export { planTextWithIssues } from "./loop-frames.js";

function toolsForMode(mode: ChatRequestBody["mode"]): readonly import("@studio/schema-core").StudioTool[] {
  return mode === "generate" ? STUDIO_TOOLS : STUDIO_TOOLS.filter((tool) => tool.name !== "propose_document");
}

/** W3-B differentiation prompt (design §2.4), appended after the original user
 *  message for every variant round; round 3 adds an extra direction nudge. */
const DIVERSITY_PROMPT =
  "请给出一个与已有方案明显不同的设计方案：更换整体布局结构与视觉风格（不同的栅格组织、不同的色彩体系与信息层级），保持产品目标不变，不要复用已有方案的结构。";

function variantMessages(messages: ChatMessage[], round: number): ChatMessage[] {
  const note = round >= 3 ? `${DIVERSITY_PROMPT}再换一个方向。` : DIVERSITY_PROMPT;
  return [...messages, { role: "system", content: note }];
}

/** One generate round (T60): agent loop on the page view, then the verify ring.
 *  Returns undefined when the round was interrupted (request cancel or the
 *  scaled timeout) — the caller decides between canceled (first round) and
 *  discard (variant round); a loop error comes back via result.error. */
async function runGenerateOnce(input: {
  messages: ChatMessage[];
  driver: ToolDriver;
  pageView: StudioDocument;
  scope: ToolScope | undefined;
  signal: AbortSignal;
  send: SendEvent;
  onEvent: (ev: LoopEvent) => void;
}): Promise<{ result: AgentLoopResult; doc: StudioDocument; issues: string[] | null } | undefined> {
  const result = await runAgentLoop({
    messages: input.messages,
    doc: input.pageView,
    scope: input.scope,
    driver: input.driver,
    tools: STUDIO_TOOLS,
    signal: input.signal,
    onEvent: input.onEvent,
  });
  if (input.signal.aborted) return undefined;
  if (result.error) return { result, doc: result.doc, issues: null };
  // Auto-verification ring (P6-3): failures are fed back for up to 2 repair
  // rounds; a valid candidate passes round 0 with ZERO extra frames.
  const verified = await runVerifyLoop({
    messages: input.messages,
    doc: result.doc,
    driver: input.driver,
    signal: input.signal,
    onEvent: (ev) => {
      if (ev.type === "delta") void input.send({ delta: ev.text });
      else if (ev.type === "verify-round") {
        // Verify stage + the loop's own announcement frame (additive; the
        // workbench ignores unknown type fields until it consumes them).
        void input.send({ type: "stage", id: "verify", label: STAGE_LABELS.verify, round: ev.round });
        void input.send(ev);
      } else if ("type" in ev) void input.send(ev);
    },
  });
  if (input.signal.aborted) return undefined;
  return { result, doc: verified.doc, issues: verified.issues };
}

/** Generate-mode pipeline (T60 W3-B): round 1 is the primary candidate
 *  (`document`); variants 2..N run differentiated rounds from the SAME start
 *  doc and become `alternatives`. A failed variant round is skipped (no error
 *  frame, later rounds still run); a timeout/interrupt returns the completed
 *  candidates early; an interrupted FIRST round keeps the canceled path. */
async function runGenerateFlow(input: {
  body: ChatRequestBody;
  messages: ChatMessage[];
  driver: ToolDriver;
  startDoc: StudioDocument;
  pageView: StudioDocument;
  index: number;
  pageId: string;
  scope: ToolScope | undefined;
  signal: AbortSignal;
  send: SendEvent;
  onEvent: (ev: LoopEvent) => void;
}): Promise<void> {
  const round = (messages: ChatMessage[]) => runGenerateOnce({ ...input, messages });
  const first = await round(input.messages);
  if (!first) {
    await input.send({ canceled: true });
    return;
  }
  if (first.result.error) {
    await input.send({ error: "invalid_json", raw: first.result.error });
    return;
  }
  // T21 §3.6: splice the verified target page back — done frame = whole doc.
  const primary = splicePageBack(input.startDoc, input.index, first.doc.pages[0]!);
  const alternatives: StudioDocument[] = [];
  for (let k = 2; k <= (input.body.variants ?? 1); k += 1) {
    if (input.signal.aborted) break; // timeout/interrupt: return completed candidates
    try {
      const alt = await round(variantMessages(input.messages, k));
      if (!alt) break; // interrupted mid-round: discard and early-return
      alternatives.push(splicePageBack(input.startDoc, input.index, alt.doc.pages[0]!));
    } catch {
      continue; // failed round: skip silently, later rounds still run
    }
  }
  await doneFromGenerateLoop(
    input.send,
    { ...first.result, doc: primary },
    first.issues,
    input.pageId,
    // alternatives only ride on done when the request asked for variants.
    input.body.variants === undefined ? undefined : alternatives,
  );
}

export async function runLoopPipeline(
  deps: LoopPipelineDeps,
  body: ChatRequestBody,
  controller: AbortController,
  send: SendEvent,
  driver: ToolDriver,
  messages: ChatMessage[],
  startDoc: StudioDocument,
): Promise<void> {
  // Marker seam: the deterministic mock's ensure-inserts attach under the doc
  // root, so rootId must be in the loop's allowed set for those inserts (the
  // marker's own op stays fully scope-audited). When the request carries NO
  // scope at all, the loop runs unscoped — matching the legacy pipeline, where
  // a scopeless patch was compliant for any node.
  // T21 §3.6: the loop runs on a single-page VIEW (request pageId, default pages[0]).
  const { page, index } = pickPage(startDoc, body.pageId ?? null);
  const pageView = { ...startDoc, pages: [page] };
  const loopScope = scopeFor(body, pageView);
  // Visibility frames (pipeline-layer instrumentation; the loops stay pure):
  //  - stage/model: one per driver round-trip (driver.next wrapper — also sees
  //                  the verify loop's re-entries, which call the same driver)
  //  - progress:    after every executed tool step (cumulative, budget-capped)
  let executedSteps = 0;
  const sendProgress = (): void => {
    void send({
      type: "progress",
      step: executedSteps,
      total: DEFAULT_MAX_STEPS,
      label: `已执行 ${executedSteps} 步工具调用`,
    });
  };
  const emitWithStages = (ev: LoopEvent): void => {
    if (ev.type === "delta") {
      void send({ delta: ev.text });
      return;
    }
    if (ev.type === "tool-call") {
      executedSteps += 1;
      sendProgress();
      void send(ev);
      return;
    }
    void send(ev);
  };
  const tracedDriver: ToolDriver = {
    ...driver,
    async next(input) {
      // Announce BEFORE each model round-trip: this is the exact instant the
      // request re-enters the model — the long-silent window this frame exists
      // for. The SDK driver also streams per-step text via onTextDelta, which
      // routes.ts already wired into `send({delta})`.
      void send({ type: "stage", id: "model", label: STAGE_LABELS.model });
      return driver.next(input);
    },
  };
  // W3-B: the generate timeout scales with the variant count (240s per round);
  // patch keeps its fixed budget. Generate rounds observe the combined signal
  // so the timeout actually interrupts (first-round timeout -> canceled, §2.6).
  const variantCount = body.mode === "generate" ? body.variants ?? 1 : 1;
  const timeoutMs = body.mode === "patch" ? 90_000 : 240_000 * variantCount;
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(new Error("请求超时")), timeoutMs);
  const loopSignal = controller.signal;
  const combinedCtrl = new AbortController();
  loopSignal.addEventListener("abort", () => combinedCtrl.abort(loopSignal.reason), { once: true });
  timeoutCtrl.signal.addEventListener("abort", () => combinedCtrl.abort(timeoutCtrl.signal.reason), { once: true });
  // Abort replay: a cancel that fired BEFORE this wiring (during the request's
  // own fs reads) never triggers the once-listener above — propagate it now,
  // restoring the direct controller.signal visibility the loop used to have.
  if (loopSignal.aborted) combinedCtrl.abort(loopSignal.reason);
  if (body.mode === "generate") {
    await runGenerateFlow({
      body,
      messages,
      driver: tracedDriver,
      startDoc,
      pageView,
      index,
      pageId: page.id,
      scope: loopScope,
      signal: combinedCtrl.signal,
      send,
      onEvent: emitWithStages,
    });
    clearTimeout(timeoutId);
    return;
  }
  const result: AgentLoopResult = await runAgentLoop({
    messages,
    doc: pageView,
    scope: loopScope,
    driver: tracedDriver,
    tools: toolsForMode(body.mode),
    signal: controller.signal,
    onEvent: emitWithStages,
    maxSteps: body.mode === "patch" ? 12 : undefined,
  });
  if (controller.signal.aborted) {
    await send({ canceled: true });
    return;
  }
  if (result.error) {
    // Consecutive-failure budget: badjson-compatible terminal error frame.
    await send({ error: "invalid_json", raw: result.error });
    return;
  }
  await doneFromLoopOps(deps, body, send, result, messages);
}
