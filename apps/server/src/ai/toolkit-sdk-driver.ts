import type { DocumentEnvelope, SelectionScope, ToolKit } from "@studio/studio-core";
import type { ZodTypeAny } from "zod";
import type { ProjectAssetInfo } from "../toolkits/ppt/assets.js";
import type { ToolkitCall, ToolkitDriver, ToolkitDriverInput, ToolkitInternalState, ToolkitStep } from "./mock-toolkit.js";
import type { SendEvent } from "./routes.js";
import type { ScopeHealer } from "./scope-heal.js";
import { runBatch, repairCommandArgs } from "./toolkit-batch.js";
import { buildToolkitSystemPrompt } from "./toolkit-prompt.js";
import { aiToolsForScope, allowedCommandIds, commandMeta, scopeChanged } from "./toolkit-scope.js";

/**
 * Toolkit driver for the openai-compat path: rebuilds zod tools per round from
 * the toolkit's aiTools for the effective scope, runs the generateText loop,
 * and stashes the round's internal state (scratch envelope, steps, fatal,
 * healed scope) for the outer pipeline loop.
 */

interface SdkState {
  scratch: DocumentEnvelope | null;
  steps: ToolkitStep[];
  fatal: string | undefined;
  lastScope: SelectionScope | undefined;
  internal: ToolkitInternalState | undefined;
  // Per-round abort: fatal scope loss or a selection→container widening ends
  // the generateText call immediately (otherwise the model burns up to 8
  // steps against a tool schema that can't express the widened commands).
  roundAbort: AbortController | null;
}

/** Everything a driver round needs, shared through one object. */
interface SdkCtx {
  model: unknown;
  toolkit: ToolKit;
  send: SendEvent;
  healer?: ScopeHealer;
  meta: Map<string, { title: string; riskLevel: string }>;
  assets: ProjectAssetInfo[];
  z: typeof import("zod").z;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateText: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stepCountIs: any;
  st: SdkState;
}

/** Merge AbortSignals without relying on AbortSignal.any (Node 18-safe). */
function combineSignals(...signals: (AbortSignal | undefined)[]): { signal: AbortSignal; abort: () => void } {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return { signal: controller.signal, abort: () => controller.abort() };
}

/** Field-name alias repair applied per call (shared by execute + repair hook). */
function repairCalls<T extends { commandId: string; args?: unknown }>(commands: T[]): T[] {
  return commands.map((call) => {
    if (call.args && typeof call.args === "object" && !Array.isArray(call.args)) {
      const fixed = repairCommandArgs(call.commandId, call.args as Record<string, unknown>);
      if (fixed) return { ...call, args: fixed } as T;
    }
    return call;
  });
}

/** onStepEnd hook: forward non-empty text as a chat delta and retain it locally. */
function makeStepTextForwarder(send: SendEvent, onText: (text: string) => void) {
  return (event: { text?: string }) => {
    if (typeof event.text === "string" && event.text !== "") {
      onText(event.text);
      void send({ delta: event.text });
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function repairToolCallJson({ toolCall }: { toolCall: any }) {
  const parsed: { commands?: { commandId: string; args?: Record<string, unknown> }[] } =
    typeof toolCall.input === "string" ? JSON.parse(toolCall.input) : (toolCall.input ?? {});
  // Strict schema rejection costs a full model round-trip before the
  // model even sees the error; alias repair fixes the recurring near-miss
  // (id→slideId) locally in the same step, free of charge.
  const commands = repairCalls(parsed.commands ?? []);
  return { ...toolCall, input: JSON.stringify({ ...parsed, commands }) };
}

function buildCommandSchema(z: SdkCtx["z"], toolkit: ToolKit, allowed: Set<string>): ZodTypeAny {
  // Per-command arg contracts, discriminated on commandId: the model SEES the
  // exact fields of every command in the tool's JSON Schema, instead of
  // guessing names against a loose record (live glm-5.3-flash runs burned
  // whole step budgets calling slide.add with `id`/`afterSlideId`).
  const commandOptions = toolkit.commands
    .filter((c) => allowed.has(c.id))
    .map((c) => z.object({ commandId: z.literal(c.id), args: c.parameters }));
  const [firstOption, ...restOptions] = commandOptions;
  if (!firstOption) {
    throw new Error("当前范围没有可用命令，无法构建 AI 工具");
  }
  // zod v3's discriminatedUnion generic wants a literal tuple; a runtime-built
  // array from the toolkit registry can't satisfy it statically. The options
  // ARE ZodObjects discriminated on commandId — the double cast only appeases tsc.
  return restOptions.length
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (z.discriminatedUnion("commandId", commandOptions as unknown as any) as unknown as ZodTypeAny)
    : firstOption;
}

// Progressive (P7.3): each SDK tool call = one user-visible batch. Push
// the successful commands NOW as an auto-apply partial frame — the
// client lands them live; the final done dedupes by invocationId.
// The frame carries the healed scope so local replay uses the same
// reach (selection target deleted mid-round → container).
async function emitSdkPartialDone(
  send: SendEvent,
  meta: Map<string, { title: string; riskLevel: string }>,
  okSteps: ToolkitStep[],
  batch: { steps: ToolkitStep[]; scope: SelectionScope },
  forScope: SelectionScope,
  stepsLength: number,
): Promise<void> {
  await send({
    done: true,
    text: `已完成一批（${okSteps.length} 条命令）`,
    commands: okSteps.map((s2, i) => ({
      invocationId: s2.invocationId ?? `sdk-${stepsLength}-${i}`,
      commandId: s2.commandId,
      title: meta.get(s2.commandId)?.title ?? s2.commandId,
      riskLevel: meta.get(s2.commandId)?.riskLevel ?? "low",
      args: s2.args ?? {},
      summary: s2.message,
    })),
    ...(scopeChanged(forScope, batch.scope) ? { scope: batch.scope } : {}),
    partial: true,
  });
}

/** The zod tool's execute body: guard → repair → runBatch → state advance → summary. */
function makeToolExecuteHandler(params: {
  toolkit: ToolKit;
  forScope: SelectionScope;
  allowed: Set<string>;
  send: SendEvent;
  healer?: ScopeHealer;
  meta: Map<string, { title: string; riskLevel: string }>;
  st: SdkState;
}): (payload: { commands: ToolkitCall[] }) => Promise<string> {
  return async (payload) => {
    const { toolkit, forScope, allowed, send, healer, meta, st } = params;
    if (!st.scratch) return "文档尚未就绪";
    // Alias repair (id→slideId …) runs BEFORE validation would have a
    // chance to reject; a schema-strict call that still misses lands in
    // the repair hook below and fails loudly there instead.
    const repaired = repairCalls(payload.commands as ToolkitCall[]);
    const batch = runBatch(toolkit, repaired, st.scratch, forScope, allowed, send, healer);
    st.steps.push(...batch.steps.map((s2) => ({ ...s2 })));
    st.scratch = batch.envelope;
    if (scopeChanged(forScope, batch.scope)) st.lastScope = batch.scope;
    if (batch.fatal) {
      st.fatal = batch.fatal;
      st.roundAbort?.abort(); // stop the model loop on a dead scope
    } else if (forScope.kind !== batch.scope.kind) {
      // Reach widened mid-round (selection → container): the zod tool
      // union for this round can't express container-only commands, so
      // end the round; the outer loop rebuilds tools with the new reach.
      st.roundAbort?.abort();
    }
    const okSteps = batch.steps.filter((s2) => s2.ok);
    if (okSteps.length > 0) {
      await emitSdkPartialDone(send, meta, okSteps, batch, forScope, st.steps.length);
    }
    if (batch.fatal) return `【中止】${batch.fatal}`;
    const failures = batch.steps.filter((s2) => !s2.ok);
    return failures.length > 0
      ? `部分命令失败：${failures.map((f) => f.message).join("；")}`
      : `已执行 ${batch.steps.length} 条命令：${batch.steps.map((s2) => s2.message).join("；")}`;
  };
}

// Tools are (re)built per round against the CURRENT effective scope: a
// selection scope whose target the run deletes heals to container scope,
// and the next model round must SEE the container-level commands in its
// schemas instead of being silently gated by the old selection set.
function buildTools(
  z: SdkCtx["z"],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any,
  toolkit: ToolKit,
  forScope: SelectionScope,
  send: SendEvent,
  healer: ScopeHealer | undefined,
  meta: Map<string, { title: string; riskLevel: string }>,
  st: SdkState,
): { tools: Record<string, unknown>; allowed: Set<string> } {
  const allowed = allowedCommandIds(toolkit, forScope);
  const commandSchemas = buildCommandSchema(z, toolkit, allowed);
  const tools: Record<string, unknown> = {};
  for (const ai of aiToolsForScope(toolkit, forScope)) {
    const toolName = ai.id.replace(/\./g, "_");
    tools[toolName] = tool({
      description: `${ai.title}。commands 数组中每个元素为 {commandId, args}，commandId 限定为：${ai.commandIds.join("、")}`,
      inputSchema: z.object({
        commands: z.array(commandSchemas).min(1),
      }),
      execute: makeToolExecuteHandler({ toolkit, forScope, allowed, send, healer, meta, st }),
    });
  }
  return { tools, allowed };
}

/** generateText options for one round (conditional onStepEnd/instructions spreads kept). */
function buildGenerateOptions(
  ctx: SdkCtx,
  tools: Record<string, unknown>,
  roundSignal: AbortSignal,
  systemText: string,
  messages: ToolkitDriverInput["messages"],
  onStepText: (text: string) => void,
) {
  return {
    model: ctx.model,
    tools,
    stopWhen: ctx.stepCountIs(8),
    // Stream each step's text to the chat bubble (same contract as the UI
    // SDK driver): a silent model round-trip is what reads as "dead".
    ...(ctx.send ? { onStepEnd: makeStepTextForwarder(ctx.send, onStepText) } : {}),
    abortSignal: roundSignal,
    ...(systemText ? { instructions: systemText } : {}),
    experimental_repairToolCall: repairToolCallJson,
    messages: messages.filter((m) => m.role !== "system"),
  };
}

/** One model round: reset round state, build tools, generateText, stash internals. */
async function runSdkRound(ctx: SdkCtx, input: ToolkitDriverInput): Promise<ToolkitCall[]> {
  const st = ctx.st;
  st.scratch = input.envelope;
  st.steps = [];
  st.fatal = undefined;
  const { tools } = buildTools(ctx.z, ctx.tool, ctx.toolkit, input.scope, ctx.send, ctx.healer, ctx.meta, st);
  const systemText = buildToolkitSystemPrompt(ctx.toolkit, input.envelope, input.scope, ctx.assets);
  st.roundAbort = new AbortController();
  const roundSignal = combineSignals(input.signal, st.roundAbort.signal).signal;
  let resultText = "";
  let streamedText = "";
  try {
    const result = await ctx.generateText(
      buildGenerateOptions(ctx, tools, roundSignal, systemText, input.messages, (text) => {
        streamedText += text;
      }),
    );
    // ai@7 generateText: result.text is the concatenated text across ALL steps.
    // If the model finishes a round without emitting tool calls AND without
    // any text (e.g. reasoning models that burn the budget on chain-of-thought
    // and finish empty, or coding models that return only tool_calls then end),
    // the old code surfaced the fixed "AI 认为无需修改（未产生命令）" notice —
    // indistinguishable from a deliberate empty change set (T30). Capture the
    // text here so endOfRound can flag a "model returned nothing" round as a
    // real failure instead of pretending the model had nothing to say.
    resultText = typeof result?.text === "string" ? result.text : "";
  } catch (err) {
    // User/transport cancellation propagates; our own round-stop abort
    // (fatal scope / scope widening) is an expected, silent round end.
    if (input.signal?.aborted) throw err;
    if (!(err instanceof Error && err.name === "AbortError")) throw err;
  } finally {
    st.roundAbort = null;
  }
  // Empty-round detector: zero successful steps AND zero streamed text. The
  // outer loop will treat this as a fatal round and the client sees an error
  // frame instead of "无需修改" — the previous behavior hid provider-level
  // misconfigurations (wrong model name, dead base URL, missing tool schema)
  // behind the neutral notice.
  if (st.steps.length === 0 && resultText.trim() === "" && streamedText.trim() === "" && !input.signal?.aborted) {
    st.fatal = "模型本轮未返回任何工具调用或说明文本（可能模型未理解当前选择范围，或网络/凭证异常）。请重试或调整描述后重发。";
  }
  st.internal = {
    steps: [...st.steps],
    envelope: st.scratch,
    ...(st.fatal ? { fatal: st.fatal } : {}),
    ...(st.lastScope ? { scope: st.lastScope } : {}),
  } as ToolkitInternalState;
  return [];
}

function takeInternalState(st: SdkState): ToolkitInternalState | undefined {
  const out = st.internal;
  st.internal = undefined;
  return out;
}

/** Build a toolkit driver from the AI SDK model (openai-compat path). */
export async function buildToolkitSdkDriver(
  model: unknown,
  toolkit: ToolKit,
  scope: SelectionScope,
  send: SendEvent,
  healer?: ScopeHealer,
  assets: ProjectAssetInfo[] = [],
): Promise<ToolkitDriver> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { generateText, tool, stepCountIs } = (await import("ai")) as any;
  const { z } = await import("zod");
  const st: SdkState = { scratch: null, steps: [], fatal: undefined, lastScope: undefined, internal: undefined, roundAbort: null };
  const ctx: SdkCtx = { model, toolkit, send, healer, meta: commandMeta(toolkit), assets, z, generateText, tool, stepCountIs, st };
  return {
    takeInternal: () => takeInternalState(st),
    next: (input) => runSdkRound(ctx, input),
  };
}
