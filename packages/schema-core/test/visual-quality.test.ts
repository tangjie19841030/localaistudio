import { describe, expect, it } from "vitest";
import { defaultPage, defaultTokens, visualQualityIssues, type Page, type Tokens } from "../src/index.js";

const TOKENS = defaultTokens();

function withNodes(nodes: Page["nodes"]): Page {
  return { ...defaultPage("质量检查"), nodes, rootId: "root" };
}

/** Token override helper: pages no longer carry tokens (doc-level, T19). */
function withTokens(base: Page, patch: (tokens: Tokens) => Tokens): Tokens {
  return patch(TOKENS);
}

describe("visualQualityIssues", () => {
  it("rejects a flat root with too many leaf nodes", () => {
    const nodes = [
      { id: "root", type: "Container", props: {}, children: ["a", "b", "c", "d", "e"] },
      ...["a", "b", "c", "d", "e"].map((id) => ({ id, type: "Text", props: { content: id }, children: [] })),
    ];
    expect(visualQualityIssues(withNodes(nodes), TOKENS).some((issue) => issue.startsWith("根节点直接平铺了 5 个内容节点"))).toBe(true);
  });

  it("rejects empty containers", () => {
    const doc = withNodes([{ id: "root", type: "Container", props: {}, children: ["stack"] }, { id: "stack", type: "Stack", props: {}, children: [] }]);
    expect(visualQualityIssues(doc, TOKENS).some((issue) => issue.includes('容器节点 "stack" (Stack) 为空'))).toBe(true);
  });

  it("rejects low text contrast", () => {
    const doc = withNodes([{ id: "root", type: "Container", props: {}, children: [] }]);
    const tokens = withTokens(doc, (tk) => ({ ...tk, color: { ...tk.color, text: "#FFFFFF", surface: "#FDFDFD" } }));
    expect(visualQualityIssues(doc, tokens).some((issue) => issue.includes("正文文字与页面背景对比度过低"))).toBe(true);
  });

  it("accepts healthy default tokens without brand false positives", () => {
    const doc = withNodes([{ id: "root", type: "Container", props: {}, children: [] }]);
    expect(visualQualityIssues(doc, TOKENS)).toHaveLength(0);
  });

  it("rejects a black/white/gray brand", () => {
    for (const gray of ["#808080", "#1A1A1A", "#FFFFFF", "#F5F5F5"]) {
      const doc = withNodes([{ id: "root", type: "Container", props: {}, children: [] }]);
      const tokens = { ...TOKENS, color: { ...TOKENS.color, brand: gray } };
      expect(visualQualityIssues(doc, tokens).some((issue) => issue.includes("黑白灰")), gray).toBe(true);
    }
  });

  it("rejects a brand identical to the text color, but allows saturated dark brands", () => {
    const same = withNodes([{ id: "root", type: "Container", props: {}, children: [] }]);
    const sameTokens = withTokens(same, (tk) => ({ ...tk, color: { ...tk.color, brand: "#172033" } }));
    expect(visualQualityIssues(same, sameTokens).some((issue) => issue.includes("几乎相同"))).toBe(true);

    const distinct = withNodes([{ id: "root", type: "Container", props: {}, children: [] }]);
    const distinctTokens = withTokens(distinct, (tk) => ({ ...tk, color: { ...tk.color, brand: "#1D4ED8" } }));
    expect(visualQualityIssues(distinct, distinctTokens)).toHaveLength(0);
  });
});
