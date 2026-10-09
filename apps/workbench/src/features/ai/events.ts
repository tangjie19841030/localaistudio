import type { ChatEvent } from "../../api/client";
import type { AiPhase, PendingPlan } from "./types";

/** UI model of the in-flight stage row (drives MessageList's stage line). */
export interface StageState {
  id: string;
  label: string;
  round?: number;
}

export interface ProgressState {
  step: number;
  total: number;
}

/**
 * Visibility-frame reducer: stage / progress / heartbeat / verify-round events
 * map to a zustand state patch. Pure — no store access, so it is trivially
 * unit-testable. Returns null for frames this reducer does not own (terminal
 * events and tool frames stay in the store's own chain).
 */
export function visibilityPatch(ev: ChatEvent): Record<string, unknown> | null {
  if ("type" in ev) {
    switch (ev.type) {
      case "stage":
        return { stage: { id: ev.id, label: ev.label, ...(ev.round ? { round: ev.round } : {}) } };
      case "progress":
        return { progress: { step: ev.step, total: ev.total } };
      case "heartbeat":
        return { lastFrameAt: Date.now() };
      case "verify-round":
        // Auto-repair round of the server's document verify loop (verifyLoop.ts):
        // restate it as a human-readable in-flight stage.
        return {
          stage: { id: "verify", label: `文档校验未通过，自动修复中（第 ${ev.round} 轮）`, round: ev.round },
        };
      default:
        // tool-call / tool-result: owned by the tool-line chain, not visibility.
        return null;
    }
  }
  return null;
}

/** Terminal visibility reset: no stage/progress row may outlive the turn. */
const visibilityReset = (): Record<string, unknown> => ({
  stage: null,
  progress: null,
});

/**
 * Attach the visibility reset to a terminal patch (done/error/canceled/notice
 * reducers). Guaranteed-fresh lastFrameAt: terminal frames always advance the
 * stall clock, so a stalled warning cannot linger on a finished turn.
 */
export function withReset(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...patch, ...visibilityReset(), lastFrameAt: Date.now() };
}

// Terminal-state patch builders (moved out of aiStore to keep it under the
// 400-line budget). Same contract as before: a zustand set() patch.

export function toAwaitingConfirm(plan: PendingPlan, violations: string[] | null) {
  return withReset({
    phase: "awaiting-confirm" as const,
    pendingPlan: plan,
    violations,
    error: null,
    notice: null,
  });
}

export function toError(message: string) {
  return withReset({ phase: "error" as const, error: message, notice: null, pendingPlan: null });
}

/** Neutral terminal state: model finished with an empty change set. */
export function toNotice(message: string) {
  return withReset({ phase: "idle" as const, notice: message, error: null, pendingPlan: null });
}
