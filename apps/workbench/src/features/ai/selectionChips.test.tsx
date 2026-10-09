import { describe, expect, it } from "vitest";
import {
  defaultPage,
  defaultStudioDocument,
  type NodeRecord,
  type StudioDocument,
} from "@studio/schema-core";
import {
  MAX_CHIPS,
  selectionChips,
  selectionSummary,
  selectedNodes,
  withSelectionPrefix,
} from "./selectionChips";

function node(id: string, type: string, props: Record<string, unknown> = {}): NodeRecord {
  return { id, type, props, children: [] };
}

function docWith(nodes: NodeRecord[]): StudioDocument {
  const doc = defaultStudioDocument("测试");
  doc.pages[0]!.nodes = [...doc.pages[0]!.nodes, ...nodes];
  return doc;
}

describe("selectionChips（W1-A 快捷动作 chips）", () => {
  it("空选中 → 无 chips", () => {
    expect(selectionChips([])).toEqual([]);
  });

  it("按钮 → 改标题/换色调类动作，文本可直接作为指令发送", () => {
    const chips = selectionChips([node("b1", "Button", { label: "提交" })]);
    expect(chips.map((c) => c.label)).toContain("改标题");
    expect(chips.map((c) => c.label)).toContain("换色调");
    for (const chip of chips) {
      expect(chip.text.length).toBeGreaterThan(0);
      expect(chip.text).not.toMatch(/target:|move:|resize:/); // markers stay send-path owned
    }
  });

  it("卡片 → 加阴影/更紧凑类动作", () => {
    const labels = selectionChips([node("c1", "Card", { title: "卡片" })]).map((c) => c.label);
    expect(labels).toContain("加阴影");
    expect(labels).toContain("更紧凑");
  });

  it("未注册类型回退到通用动作（换色调/改文案）", () => {
    const chips = selectionChips([node("x1", "Sparkline")]);
    expect(chips.map((c) => c.label)).toEqual(["换色调", "改文案"]);
  });

  it("多选中以首个节点类型为主，chips 数不超过上限", () => {
    const chips = selectionChips([node("b1", "Button"), node("c1", "Card")]);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(MAX_CHIPS);
    const cardLabels = selectionChips([node("c1", "Card"), node("b1", "Button")]).map((c) => c.label);
    expect(cardLabels).toContain("加阴影"); // primary wins
  });
});

describe("selectionSummary（选中摘要前缀）", () => {
  it("空选中 → null（不加前缀）", () => {
    expect(selectionSummary([])).toBeNull();
    expect(withSelectionPrefix([], "改成警告色")).toBe("改成警告色");
  });

  it("单节点：类型中文名 + 关键 props，一行", () => {
    const summary = selectionSummary([node("s1", "StatCard", { label: "今日活跃", value: "128" })]);
    expect(summary).toBe("指标卡「今日活跃」");
  });

  it("多节点带数量后缀", () => {
    const summary = selectionSummary([
      node("b1", "Button", { label: "提交" }),
      node("b2", "Button", { label: "取消" }),
    ]);
    expect(summary).toBe("按钮「提交」 等 2 个节点");
  });

  it("无关键 props 时只出类型名", () => {
    expect(selectionSummary([node("g1", "Divider")])).toBe("分隔线");
  });

  it("超长 props 截断防 flood（≤ 上限 + 省略号）", () => {
    const long = "长".repeat(300);
    const summary = selectionSummary([node("t1", "Heading", { text: long })]);
    expect(summary).not.toBeNull();
    expect(summary!.endsWith("…")).toBe(true);
    expect(summary!.length).toBeLessThanOrEqual(121);
  });

  it("withSelectionPrefix 拼接为【选中：…】+ 原文", () => {
    const text = withSelectionPrefix([node("b1", "Button", { label: "提交" })], "改大一点");
    expect(text).toBe("【选中：按钮「提交」】改大一点");
  });

  it("前缀不含 target 语法，不影响 modeFor 判定", () => {
    const text = withSelectionPrefix([node("s1", "StatCard")], "生成一个运营工作台");
    expect(text.startsWith("【选中：")).toBe(true);
    expect(text).not.toMatch(/target:[A-Za-z0-9_-]+/);
  });
});

describe("selectedNodes（选中 id → 文档序节点）", () => {
  it("按 id 解析节点，缺失 id 跳过", () => {
    const doc = docWith([node("b1", "Button"), node("c1", "Card")]);
    const nodes = selectedNodes(doc, ["b1", "missing", "c1"]);
    expect(nodes.map((n) => n.id)).toEqual(["b1", "c1"]);
  });

  it("空文档/空选中 → 空数组", () => {
    expect(selectedNodes(null, ["b1"])).toEqual([]);
    expect(selectedNodes(docWith([]), [])).toEqual([]);
  });
});

describe("selectedNodes 跨页（T14 G1）", () => {
  function twoPageDoc(): StudioDocument {
    const doc = defaultStudioDocument("多页");
    doc.pages[0] = {
      ...defaultPage("首页", "page-1"),
      rootId: "root1",
      nodes: [
        { id: "root1", type: "Container", props: {}, children: ["a1"] },
        { id: "a1", type: "Button", props: { label: "页一" }, children: [] },
      ],
    };
    doc.pages.push({
      ...defaultPage("第二页", "page-2"),
      rootId: "root2",
      nodes: [
        { id: "root2", type: "Container", props: {}, children: ["b1"] },
        { id: "b1", type: "Card", props: { title: "页二" }, children: [] },
      ],
    });
    return doc;
  }

  it("pageId=页2 只解析页2节点，页1 id 跳过（不跨页捞）", () => {
    const doc = twoPageDoc();
    expect(selectedNodes(doc, ["b1", "a1"], "page-2").map((n) => n.id)).toEqual(["b1"]);
    expect(selectedNodes(doc, ["a1"], "page-1").map((n) => n.id)).toEqual(["a1"]);
  });

  it("缺省/null pageId → pages[0]（兼容锁）", () => {
    const doc = twoPageDoc();
    expect(selectedNodes(doc, ["a1"]).map((n) => n.id)).toEqual(["a1"]);
    expect(selectedNodes(doc, ["b1"], null)).toEqual([]); // 页2 id 不在 pages[0]
  });
});
