import type { DocumentEnvelope, SelectionScope } from "@studio/studio-core";
import type { ToolkitDriver, ToolkitStep } from "./mock-toolkit.js";
import type { SendEvent } from "./routes.js";
import type { runBatch } from "./toolkit-batch.js";
import { scopeChanged } from "./toolkit-scope.js";

/**
 * Loop helpers for the toolkit pipeline (T79b split): plan-item projection,
 * round adoption, per-batch stop decision, progressive partial frames and the
 * terminal frames. Split out of toolkit-pipeline.ts so both files stay under
 * the 400-line hard line; behavior is unchanged.
 */

export const MAX_STEPS = 24;
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Human-facing terminal copy for scope violations. The raw adapter error
 * ("命令超出当前范围: imp-s16-text325") must stay byte-identical in the
 * tool-result so the MODEL can self-correct, but as a toast it only reads as
 * "invalid_json 原始响应：…" (T79 live repro: the fifth patch turn aborted with
 * a cryptic toast). The error FRAME CODE stays "invalid_json"; only the
 * user-facing copy changes.
 */
const SCOPE_OUTSIDE_TERMINAL =
  "AI 尝试修改了选中范围之外的目标（%IDS%），已中止。请在画布上选中要修改的对象后重试，或改用整页范围重发。";
const SCOPE_LOCKED_TERMINAL =
  "AI 尝试修改了已锁定的目标（%IDS%），已中止。请先解锁对应对象/幻灯片，或重新选择要修改的对象后再试。";

/** Rewrite a scope-violation terminal message into actionable user copy; other errors pass through. */
export function humanizeScopeError(message: string): string {
  const outside = message.match(/命令超出当前范围:\s*([^\s；;]+)/);
  if (outside) return SCOPE_OUTSIDE_TERMINAL.replace("%IDS%", outside[1]!);
  const locked = message.match(/目标已锁定:\s*([^\s；;]+)/);
  if (locked) return SCOPE_LOCKED_TERMINAL.replace("%IDS%", locked[1]!);
  return message;
}

/** Serializable command plan element carried on the done frame. */
export interface ToolkitCommandPlanItem {
  invocationId: string;
  commandId: string;
  title: string;
  riskLevel: string;
  args: unknown;
  summary: string;
}

/** Terminal result of one scoped loop run (one chat turn). */
export type ToolkitLoopResult = {
  ok: boolean;
  envelope: DocumentEnvelope;
  commands: ToolkitCommandPlanItem[];
  error?: string;
  finalDoneSent?: boolean;
  scope: SelectionScope;
};

/** Mutable progress shared by the loop helpers. */
export interface LoopState {
  current: DocumentEnvelope;
  effectiveScope: SelectionScope;
  stepCount: number;
  consecutiveFailures: number;
  lastFailureMessage: string;
}

export function toPlanItem(
  meta: Map<string, { title: string; riskLevel: string }>,
  step: ToolkitStep,
  fallbackIndex: number,
): ToolkitCommandPlanItem {
  return {
    invocationId: step.invocationId ?? `ai-${fallbackIndex}`,
    commandId: step.commandId,
    title: meta.get(step.commandId)?.title ?? step.commandId,
    riskLevel: meta.get(step.commandId)?.riskLevel ?? "low",
    args: step.args ?? {},
    summary: step.message,
  };
}

/** Adopt the SDK driver's stashed internal state and decide the round outcome. */
export function endOfRound(
  driver: ToolkitDriver,
  executed: ToolkitCommandPlanItem[],
  meta: Map<string, { title: string; riskLevel: string }>,
  st: LoopState,
): ToolkitLoopResult {
  const internal = driver.takeInternal?.();
  if (internal) {
    if (internal.scope) st.effectiveScope = internal.scope;
    // Scope died mid-round inside generateText (runBatch healed to null):
    // no args the model could choose would recover it — abort.
    if (internal.fatal) {
      return { ok: false, envelope: internal.envelope, commands: executed, error: internal.fatal, scope: st.effectiveScope };
    }
    const failed = internal.steps.find((step) => !step.ok);
    if (failed) st.lastFailureMessage = failed.message;
    // Only SUCCESSFUL steps join the replayable plan — a failed step (bad
    // args, missing target) is already fed back to the model as a tool
    // result; putting it on the confirm card just offers the user a
    // command that can never apply.
    for (const step of internal.steps.filter((s) => s.ok)) {
      executed.push(toPlanItem(meta, step, executed.length));
    }
    st.current = internal.envelope;
    st.stepCount += internal.steps.length;
    // SDK drivers run their FULL multi-step loop (stepCountIs) inside one
    // generateText call: an internal state means the model finished its
    // turn, so the run ends here (mirrors the original driver contract).
  }
  if (executed.length === 0 && st.lastFailureMessage) {
    // Terminal copy only: the model already saw the raw step.message verbatim.
    return { ok: false, envelope: st.current, commands: executed, error: humanizeScopeError(st.lastFailureMessage), scope: st.effectiveScope };
  }
  return { ok: true, envelope: st.current, commands: executed, scope: st.effectiveScope };
}

/** Progressive partial done frame for one successful batch (auto-applied client-side). */
export function emitBatchPartial(
  send: SendEvent,
  meta: Map<string, { title: string; riskLevel: string }>,
  batch: ReturnType<typeof runBatch>,
  st: LoopState,
  originalScope: SelectionScope,
): void {
  // Progressive application (P7.3): push every successful batch to the
  // client IMMEDIATELY as an auto-apply chunk — the user watches slides /
  // blocks appear one batch at a time instead of staring at a spinner for
  // the whole run. The client applies these without confirmation. The
  // frame carries the EFFECTIVE scope (healed selection→container when
  // the run deleted its own target) so local replay uses the same reach.
  void send({
    done: true,
    text: `已完成第 ${Math.ceil(st.stepCount / MAX_STEPS)} 个批次（${batch.steps.filter((s) => s.ok).length} 条命令）`,
    commands: batch.steps.filter((s) => s.ok).map((step, i) => ({
      invocationId: step.invocationId ?? `ai-${st.stepCount}-${i}`,
      commandId: step.commandId,
      title: meta.get(step.commandId)?.title ?? step.commandId,
      riskLevel: meta.get(step.commandId)?.riskLevel ?? "low",
      args: step.args ?? {},
      summary: step.message,
    })),
    ...(scopeChanged(originalScope, batch.scope) ? { scope: batch.scope } : {}),
    partial: true,
  });
}

/** Push batch steps onto the plan, update failure streak, emit partial frame; result = stop loop. */
export function applyBatch(
  batch: ReturnType<typeof runBatch>,
  executed: ToolkitCommandPlanItem[],
  meta: Map<string, { title: string; riskLevel: string }>,
  st: LoopState,
  send: SendEvent,
  originalScope: SelectionScope,
): ToolkitLoopResult | undefined {
  for (const step of batch.steps) {
    if (step.ok) executed.push(toPlanItem(meta, step, executed.length));
  }
  if (batch.okCount > 0) {
    st.consecutiveFailures = 0;
    emitBatchPartial(send, meta, batch, st, originalScope);
    return undefined;
  }
  st.consecutiveFailures += 1;
  const lastError = batch.steps.find((s) => !s.ok)?.message ?? "";
  st.lastFailureMessage = lastError;
  if (st.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return { ok: false, envelope: st.current, commands: executed, error: humanizeScopeError(`连续 ${MAX_CONSECUTIVE_FAILURES} 步失败，已中止：${lastError}`), scope: st.effectiveScope };
  }
  return undefined;
}

/** Terminal frames: finalDoneSent → non-partial done; failure → single error; else plan done. */
export async function sendTerminal(
  send: SendEvent,
  originalScope: SelectionScope,
  result: ToolkitLoopResult,
  modelDelta = "",
): Promise<void> {
  if (result.finalDoneSent) {
    // Budget exhaustion still needs one non-partial terminal frame. Earlier
    // successful batches were streamed as partial frames; this one closes the
    // client's request and carries the full replayable command list.
    await send({
      done: true,
      text: result.error ?? `步数预算（${MAX_STEPS}）耗尽，已完成部分仍可保留`,
      commands: result.commands,
      ...(scopeChanged(originalScope, result.scope) ? { scope: result.scope } : {}),
      partial: false,
    });
    return;
  }
  if (!result.ok) {
    // Successful batches were already delivered as partial frames. A failed
    // run therefore ends with one error frame; sending a later done frame would
    // let the client overwrite the visible failure with a confirm/notice state.
    await send({ error: "invalid_json", raw: result.error ?? "工具调用失败" });
    return;
  }
  await send({
    done: true,
    // Zero commands but the model explained itself in streamed deltas? Surface
    // that explanation instead of the old blanket "无需修改" — the fixed copy
    // used to swallow real answers like "请先上传视频资产" (T30 空命令终帧).
    text: result.commands.length > 0
      ? `规划：AI 助手完成本次修改，共 ${result.commands.length} 条命令。${result.error ? "（" + result.error + "）" : ""}${result.commands.map((c) => c.summary).join("；")}`
      : modelDelta.trim() !== ""
        ? modelDelta.trim()
        : "AI 认为无需修改（未产生命令）。",
    commands: result.commands,
    ...(scopeChanged(originalScope, result.scope) ? { scope: result.scope } : {}),
    partial: false,
  });
}
