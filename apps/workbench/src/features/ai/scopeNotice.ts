/**
 * T14 G2/G3: pure models for the AI scope chip and the per-turn scope trace.
 * Extracted from AiChatPanel so the copy is testable without rendering; the
 * panel only wires state into these functions. No store / React imports.
 * Copy mirrors the existing chip wording (design §3.3 — values unchanged).
 */

/** One rendered row of the scope chip (mirrors existing copy, now testable). */
export interface ScopeChipModel {
  /** "partial" = selection-scoped, "whole" = whole-page fallback. */
  kind: "partial" | "whole";
  /** Main label, e.g. "局部 · 3 个节点" / "整页生成（未选中节点）". */
  label: string;
  /** Tooltip explaining the scope semantics (incl. the clear affordance). */
  hint: string;
}

const PARTIAL_HINT = "范围跟随画布选中；点 ✕ 清除后恢复整页范围";
const WHOLE_HINT = "未选中节点，请求将作用于整页";

/**
 * Scope chip model for the UI branch. `selectionCount` is the ACTIVE-PAGE
 * resolved selection size (stale ids already dropped by selectedNodes), so a
 * stale selection naturally degrades to the whole-page chip (G1).
 */
export function scopeChip(
  selectionCount: number,
  primaryTitle: string | null,
  primaryId: string | null,
): ScopeChipModel {
  if (selectionCount > 1) {
    return { kind: "partial", label: `局部 · ${selectionCount} 个节点`, hint: PARTIAL_HINT };
  }
  if (selectionCount === 1) {
    const id8 = primaryId?.slice(0, 8) ?? "";
    const suffix = id8 ? ` ${id8}` : "";
    return {
      kind: "partial",
      label: `局部 · ${primaryTitle ?? "节点"}${suffix}`,
      hint: PARTIAL_HINT,
    };
  }
  return { kind: "whole", label: "整页生成（未选中节点）", hint: WHOLE_HINT };
}

/**
 * The line recording THIS turn's scope on the user bubble (G3).
 * Single: "（本次对话针对选中的这个元素）" / multi: "（…选中的 N 个元素）".
 * null when whole-document — whole-page turns stay unpolluted.
 */
export function scopeTraceLine(selectionCount: number): string | null {
  if (selectionCount === 1) return "（本次对话针对选中的这个元素）";
  if (selectionCount > 1) return `（本次对话针对选中的 ${selectionCount} 个元素）`;
  return null;
}

/**
 * Display text with the trace line appended. Format helper only: per the
 * CustomEvent bypass (design §3.4 / §8-Q6) the trace never enters
 * ChatLogMessage.text, so this must NOT be fed into the outbound send text.
 */
export function withScopeTrace(displayText: string, trace: string | null): string {
  return trace ? `${displayText}${trace}` : displayText;
}
