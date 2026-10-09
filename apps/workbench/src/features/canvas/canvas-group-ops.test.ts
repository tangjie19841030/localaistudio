import { defaultPage, defaultStudioDocument, type NodeRecord, type Page } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import {
  groupNodes,
  isCanvasGroup,
  refreshGroupFrames,
  rotateEligible,
  ungroupNode,
} from "./canvasGroupOps";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

/**
 * §5 用例 B：编组/解组/组框重算/结构谓词。全部断言 doc JSON。
 */

const F = (x: number, y: number, w: number, h: number, rotation = 0) => ({ x, y, w, h, rotation });

function pinDoc(): Page {
  const nodes: NodeRecord[] = [
    { id: "root", type: "Container", props: {}, children: ["a", "b", "flowCard"] },
    { id: "a", type: "Card", props: { title: "卡A" }, children: [], pinned: true, frame: F(100, 100, 200, 120) },
    { id: "b", type: "Card", props: { title: "卡B" }, children: [], pinned: true, frame: F(400, 260, 160, 90) },
    { id: "flowCard", type: "Card", props: { title: "流式卡" }, children: [] },
  ];
  return { ...defaultPage("编组"), rootId: "root", nodes };
}

describe("isCanvasGroup（T13 · B1）", () => {
  it("真例：Container + pinned + frame + 全 pin-box 直接子节点", () => {


    const doc = pinDoc();
    const grouped = groupNodes(doc, ["a", "b"]);
    expect(grouped).not.toBeNull();
    expect(isCanvasGroup(grouped!.doc, grouped!.groupId)).toBe(true);
    // 成员自身不是组（非 Container）
    expect(isCanvasGroup(doc, "a")).toBe(false);
  });

  it("假例：flow 子节点混入 / 非 Container / 未 pin / 空 children", () => {
    let doc = pinDoc();
    // Container 但含 flow 子节点 → 假
    doc = {
      ...doc,
      nodes: [
        ...doc.nodes,
        { id: "mix", type: "Container", props: { maxWidth: "full" }, children: ["a", "flowCard"], pinned: true, frame: F(0, 0, 800, 500) },
      ],
    };
    expect(isCanvasGroup(doc, "mix")).toBe(false);
    // 非容器 pin box → 假
    expect(isCanvasGroup(doc, "b")).toBe(false);
    // 未 pin 的 Container（root）→ 假
    expect(isCanvasGroup(doc, "root")).toBe(false);
    // 空 children Container → 假
    doc = { ...doc, nodes: [...doc.nodes, { id: "empty", type: "Container", props: { maxWidth: "full" }, children: [], pinned: true, frame: F(0, 0, 100, 100) }] };
    expect(isCanvasGroup(doc, "empty")).toBe(false);
  });
});

describe("groupNodes（T13 · B2/B3）", () => {
  it("产出：Container+pinned+frame=union bbox、成员 reparent、组 nodes 序先于首个成员", () => {
    const doc = pinDoc();
    const result = groupNodes(doc, ["a", "b"])!;
    const next = result.doc;
    const group = next.nodes.find((n) => n.id === result.groupId)!;
    expect(group.type).toBe("Container");
    expect(group.pinned).toBe(true);
    expect(group.frame).toEqual(F(100, 100, 460, 250)); // union bbox
    expect(group.children).toEqual(["a", "b"]);
    expect(group.props.maxWidth).toBe("full");
    // 组在 nodes 数组中排在其第一个成员 a 之前（z 序：组框渲染在成员框之下）
    const idxGroup = next.nodes.findIndex((n) => n.id === result.groupId);
    const idxA = next.nodes.findIndex((n) => n.id === "a");
    expect(idxGroup).toBeLessThan(idxA);
    // 成员 frame 保持页坐标原样
    expect(next.nodes.find((n) => n.id === "a")!.frame).toEqual(F(100, 100, 200, 120));
    // root children 只剩 flowCard
    expect(next.nodes.find((n) => n.id === "root")!.children).toEqual(["flowCard", result.groupId]);
  });

  it("前置不满足 → null：<2 成员 / 成员非 root-child / 含 flow 节点 / 重复 id", () => {
    const doc = pinDoc();
    expect(groupNodes(doc, ["a"])).toBeNull();
    expect(groupNodes(doc, [])).toBeNull();
    // b 在某 pin 容器下 → 非 root-child（这里直接把 a 挪进临时容器验证）
    const nested: Page = {
      ...doc,
      nodes: [
        ...doc.nodes,
        { id: "nest", type: "Container", props: { maxWidth: "full" }, children: ["b"], pinned: true, frame: F(0, 0, 900, 600) },
      ],
    };
    nested.nodes.find((n) => n.id === "root")!.children = ["a", "nest", "flowCard"];
    expect(groupNodes(nested, ["a", "b"])).toBeNull();
    // flow 节点不可编组
    expect(groupNodes(doc, ["a", "flowCard"])).toBeNull();
    // 重复 id 只算一个成员
    expect(groupNodes(doc, ["a", "a"])).toBeNull();
  });
});

describe("groupNodes 逆序选择（T13 · B7）", () => {
  it("选择序 [b, a] ≠ 数组序 [a, b]：组仍插在数组序首个成员之前（z 序回归）", () => {
    const doc = pinDoc();
    // nodes array order is [a, b] but the user selected b first, then a.
    // The group must land before the FIRST member in ARRAY order (a), not
    // before the selection-order head (b) — otherwise the group box would
    // sit on top of a and cover its pointer hit-testing.
    const result = groupNodes(doc, ["b", "a"])!;
    const next = result.doc;
    const idxGroup = next.nodes.findIndex((n) => n.id === result.groupId);
    const idxA = next.nodes.findIndex((n) => n.id === "a");
    const idxB = next.nodes.findIndex((n) => n.id === "b");
    // Group precedes ALL members (array-order semantics, not selection order)
    expect(idxGroup).toBeLessThan(idxA);
    expect(idxGroup).toBeLessThan(idxB);
    // Members keep page-absolute frames and stay after the group
    expect(next.nodes.find((n) => n.id === "a")!.frame).toEqual(F(100, 100, 200, 120));
    expect(next.nodes.find((n) => n.id === "b")!.frame).toEqual(F(400, 260, 160, 90));
  });
});

describe("ungroupNode（T13 · B4/B5）", () => {
  it("成员回 root（追加）、组删除、成员 frame 原样", () => {
    const doc = pinDoc();
    const { doc: grouped, groupId } = groupNodes(doc, ["a", "b"])!;
    const next = ungroupNode(grouped, groupId)!;
    const root = next.nodes.find((n) => n.id === "root")!;
    expect(root.children).toEqual(["flowCard", "a", "b"]);
    expect(next.nodes.find((n) => n.id === groupId)).toBeUndefined();
    expect(next.nodes.find((n) => n.id === "a")!.frame).toEqual(F(100, 100, 200, 120));
    expect(next.nodes.find((n) => n.id === "a")!.pinned).toBe(true);
  });

  it("非 group id → null（含普通 pin box 与不存在 id）", () => {
    const doc = pinDoc();
    expect(ungroupNode(doc, "a")).toBeNull();
    expect(ungroupNode(doc, "nope")).toBeNull();
  });
});

describe("refreshGroupFrames（T13 · B6）", () => {
  it("成员外移后组框收紧到 union bbox；rotation 保留；空 union 不 NaN", () => {
    const doc = pinDoc();
    const { doc: grouped, groupId } = groupNodes(doc, ["a", "b"])!;
    // 成员 b 外移 200px
    const moved = grouped.nodes.map((n) =>
      n.id === "b" ? { ...n, frame: F(600, 260, 160, 90) } : n,
    );
    const refreshed = refreshGroupFrames({ ...grouped, nodes: moved }, ["b"]);
    const group = refreshed.nodes.find((n) => n.id === groupId)!;
    expect(group.frame).toEqual(F(100, 100, 660, 250));
    // rotation 保留：手动给组加旋转再 refresh
    const rotated = refreshed.nodes.map((n) =>
      n.id === groupId ? { ...n, frame: { ...n.frame!, rotation: 45 } } : n,
    );
    const again = refreshGroupFrames({ ...grouped, nodes: rotated }, ["a"]);
    expect(again.nodes.find((n) => n.id === groupId)!.frame!.rotation).toBe(45);
    // 非 pin 后代的移动不触发 NaN：移动 flowCard（不在任何组内）→ 文档原样
    const safe = refreshGroupFrames(grouped, ["flowCard"]);
    expect(safe.nodes.find((n) => n.id === groupId)!.frame).toEqual(F(100, 100, 460, 250));
  });
});

describe("rotateEligible（T13 · §3.4 门槛）", () => {
  it("裸 pin box → true；组/含 pin 后代的 pin box → false；flow/未知 id → false", () => {
    const doc = pinDoc();
    expect(rotateEligible(doc, "a")).toBe(true);
    const { doc: grouped, groupId } = groupNodes(doc, ["a", "b"])!;
    expect(rotateEligible(grouped, groupId)).toBe(false);
    // 含 pin 后代的 pin box：嵌套一个 pin 子节点
    const nested: Page = {
      ...grouped,
      nodes: [
        ...grouped.nodes,
        { id: "nest", type: "Container", props: { maxWidth: "full" }, children: ["a"], pinned: true, frame: F(0, 0, 900, 600) },
      ],
    };
    nested.nodes.find((n) => n.id === "root")!.children = ["nest", "b", "flowCard", groupId];
    expect(rotateEligible(nested, "nest")).toBe(false);
    expect(rotateEligible(nested, "b")).toBe(true);
    expect(rotateEligible(nested, "flowCard")).toBe(false);
    expect(rotateEligible(nested, "unknown")).toBe(false);
  });
});
