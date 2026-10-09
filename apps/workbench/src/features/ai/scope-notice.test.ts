import { describe, expect, it } from "vitest";
import { scopeChip, scopeTraceLine, withScopeTrace } from "./scopeNotice";

/**
 * T14 §5 C group: pure models for the scope chip (G2) and the per-turn scope
 * trace (G3). Copy values mirror the pre-existing chip wording — the panel
 * only wires state into these functions.
 */
describe("scopeChip（G2 scope chip 纯模型）", () => {
  it("C1 三分支：多选 / 单选 / 零选", () => {
    const multi = scopeChip(3, "Card", "card-12345678");
    expect(multi.kind).toBe("partial");
    expect(multi.label).toBe("局部 · 3 个节点");
    expect(multi.hint.length).toBeGreaterThan(0);

    const single = scopeChip(1, "StatCard", "stat-abcdef12");
    expect(single.kind).toBe("partial");
    expect(single.label).toBe("局部 · StatCard stat-abc");

    const whole = scopeChip(0, null, null);
    expect(whole.kind).toBe("whole");
    expect(whole.label).toBe("整页生成（未选中节点）");
    expect(whole.hint.length).toBeGreaterThan(0);
  });

  it("C1b 单选无类型时回退「节点」占位", () => {
    expect(scopeChip(1, null, "nodetype9").label).toBe("局部 · 节点 nodetype");
  });

  it("C2 trace 行：单选 / 多选 / 零选（null=不污染全页气泡）", () => {
    expect(scopeTraceLine(1)).toBe("（本次对话针对选中的这个元素）");
    expect(scopeTraceLine(3)).toBe("（本次对话针对选中的 3 个元素）");
    expect(scopeTraceLine(0)).toBeNull();
  });

  it("C3 withScopeTrace：null 直通、有 trace 时追加", () => {
    expect(withScopeTrace("改成警告色", null)).toBe("改成警告色");
    expect(withScopeTrace("改成警告色", "（本次对话针对选中的这个元素）")).toBe(
      "改成警告色（本次对话针对选中的这个元素）",
    );
  });
});
