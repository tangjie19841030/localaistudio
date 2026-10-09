import { executeTransaction, type CommandInvocation, type DocumentEnvelope, type SelectionScope } from "@studio/studio-core";
import type { ToolKit } from "@studio/studio-core";
import type { ToolkitCall, ToolkitStep } from "./mock-toolkit.js";
import type { SendEvent } from "./routes.js";
import { SCOPE_VANISHED_MESSAGE, type ScopeHealer } from "./scope-heal.js";
import { allowedCommandIds } from "./toolkit-scope.js";

/**
 * Pre-execution of one model-proposed batch against a scratch envelope: alias
 * repair, capability gate, executeTransaction, and the tool-call/tool-result
 * frames. Shared by the pipeline loop (mock path) and the SDK driver.
 */

/** Field-name aliases models habitually use instead of the declared ones. */
const ARG_ALIASES: Record<string, Record<string, string>> = {
  // generic "id" → the domain-specific key the command actually declares
  "id": { "slide.add": "slideId", "slide.duplicate": "newSlideId", "object.add": "objectId" },
  "afterSlideId": { "slide.add": "index" },
  "notes": { "slide.rename": "title" },
};

/** Near-miss keys models send; each maps to {commandId: canonicalKey}. */
export function repairCommandArgs(commandId: string, args: Record<string, unknown>): Record<string, unknown> | null {
  let repaired: Record<string, unknown> | null = null;
  for (const [alias, targets] of Object.entries(ARG_ALIASES)) {
    if (!(alias in args)) continue;
    const canonical = targets[commandId];
    if (!canonical || canonical in args) continue;
    repaired ??= { ...args };
    repaired[canonical] = repaired[alias];
    delete repaired[alias];
  }
  return repaired;
}

function buildInvocation(call: ToolkitCall, scope: SelectionScope): CommandInvocation {
  return {
    invocationId: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    id: call.commandId,
    args: call.args,
    source: "ai",
    scope,
  };
}

/** Gate: emits the tool-result failure frame when not admitted; null = pass. */
function gateCall(commandId: string, allowed: Set<string>, send: SendEvent): ToolkitStep | null {
  if (allowed.has(commandId)) return null;
  const message = `命令 ${commandId} 不在当前范围允许的工具内`;
  void send({ type: "tool-result", name: commandId, ok: false, message });
  return { commandId, ok: false, message };
}

/** executeTransaction + step build + tool-result frame; envelope present on success. */
function execCall(
  toolkit: ToolKit,
  call: ToolkitCall,
  envelope: DocumentEnvelope,
  scope: SelectionScope,
  send: SendEvent,
): { step: ToolkitStep; envelope?: DocumentEnvelope } {
  const result = executeTransaction(toolkit, envelope, [buildInvocation(call, scope)]);
  const step: ToolkitStep = result.ok
    ? {
        commandId: call.commandId,
        ok: true,
        message: result.commands[0]?.result.summary ?? "已执行",
        invocationId: result.commands[0]?.invocation.invocationId,
        args: call.args,
      }
    : { commandId: call.commandId, ok: false, message: result.error.message };
  void send({ type: "tool-result", name: call.commandId, ok: step.ok, message: step.message });
  return result.ok ? { step, envelope: result.envelope } : { step };
}

/** Execute one batch; emits tool-call/tool-result frames and advances the scratch envelope. */
export function runBatch(
  toolkit: ToolKit,
  calls: ToolkitCall[],
  envelope: DocumentEnvelope,
  scope: SelectionScope,
  allowed: Set<string>,
  send: SendEvent,
  healer?: ScopeHealer,
): { steps: ToolkitStep[]; envelope: DocumentEnvelope; okCount: number; fatal?: string; scope: SelectionScope } {
  let current = envelope;
  const steps: ToolkitStep[] = [];
  let okCount = 0;
  let effectiveScope = scope;
  for (const call of calls) {
    if (healer) {
      // A run can delete its own frozen scope target (selected placeholder →
      // remove → add replacement). Heal before EVERY command; if healing can
      // no longer place the scope, abort — feeding the adapter's "目标不存在"
      // back to the model just burns the step budget (live repro).
      const healed = healer.heal(current);
      if (!healed) {
        void send({ type: "tool-result", name: call.commandId, ok: false, message: SCOPE_VANISHED_MESSAGE });
        steps.push({ commandId: call.commandId, ok: false, message: SCOPE_VANISHED_MESSAGE });
        return { steps, envelope: current, okCount, fatal: SCOPE_VANISHED_MESSAGE, scope: effectiveScope };
      }
      effectiveScope = healed;
    }
    void send({ type: "tool-call", name: call.commandId, args: call.args });
    // A healed scope widening selection → container also admits the
    // container-only commands; recompute the gate against the healed scope.
    const effectiveAllowed = healer ? allowedCommandIds(toolkit, effectiveScope) : allowed;
    const gated = gateCall(call.commandId, effectiveAllowed, send);
    if (gated) {
      steps.push(gated);
      continue;
    }
    const { step, envelope: advanced } = execCall(toolkit, call, current, effectiveScope, send);
    if (advanced) {
      current = advanced;
      okCount += 1;
    }
    steps.push(step);
  }
  return { steps, envelope: current, okCount, scope: effectiveScope };
}
