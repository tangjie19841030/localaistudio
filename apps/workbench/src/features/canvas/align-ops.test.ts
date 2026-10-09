import { defaultPage, defaultStudioDocument, type NodeRecord, type Page } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import {
  alignBounds,
  alignFrames,
  alignTargets,
  applyFrameSet,
  distributeFrames,
} from "./alignOps";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

/**
 * §5 用例 A：对齐/分布纯几何 + 单事务应用。
 */

const F = (x: number, y: number, w: number, h: number, rotation = 0) => ({ x, y, w, h, rotation });
const PAGE = { x: 0, y: 0, w: 1440, h: 900 };

function pinDoc(frames: Record<string, { x: number; y: number; w: number; h: number }>): Page {
  const rootChildren = ["root"];
  void rootChildren;
  const nodes: NodeRecord[] = [
    { id: "root", type: "Container", props: {}, children: Object.keys(frames) },
    ...Object.entries(frames).map(([id, f]) => ({
      id,
      type: "Card",
      props: { title: id },
      children: [],
      pinned: true,
      frame: F(f.x, f.y, f.w, f.h),
    })),


  ];
  return { ...defaultPage("对齐"), rootId: "root", nodes };
}

describe("alignTargets / alignBounds（T13 · A2/A5）", () => {
  it("A5 flow id / 非选中节点被过滤；只收选中集合内的 pin box", () => {
    const doc = pinDoc({ a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 300, y: 200, w: 80, h: 60 } });
    // legacy frame on a flow node is inert → filtered
    const withFlow: Page = {
      ...doc,
      nodes: [...doc.nodes, { id: "flowCard", type: "Card", props: { title: "流" }, children: [], frame: F(10, 10, 50, 40) }],
    };
    const targets = alignTargets(withFlow, ["a", "flowCard", "b", "ghost"]);
    expect([...targets.keys()]).toEqual(["a", "b"]);
  });

  it("A2 单选 → bounds = 页面；多选 → 选区包围盒（含负坐标）", () => {
    const doc = pinDoc({
      a: { x: -50, y: -20, w: 100, h: 50 },
      b: { x: 300, y: 200, w: 80, h: 60 },
      c: { x: 120, y: 60, w: 40, h: 40 },
    });
    const two = alignTargets(doc, ["a", "b"]);
    expect(alignBounds(two, PAGE)).toEqual({ x: -50, y: -20, w: 430, h: 280 });
    const one = alignTargets(doc, ["a"]);
    expect(alignBounds(one, PAGE)).toEqual(PAGE);
    const empty = alignTargets(doc, []);
    expect(alignBounds(empty, PAGE)).toEqual(PAGE);
  });
});

describe("alignFrames（T13 · A1）", () => {
  it("A1 六模式 bbox 数学：x/y 各三模式，w/h/rotation 不变", () => {
    const doc = pinDoc({
      a: { x: 0, y: 0, w: 100, h: 50 },
      b: { x: 300, y: 200, w: 80, h: 60 },
    });
    const targets = alignTargets(doc, ["a", "b"]);
    const bounds = alignBounds(targets, PAGE); // {x:0,y:0,w:380,h:260}
    const wA = 100, hA = 50, wB = 80, hB = 60;
    expect(alignFrames(targets, "left", bounds).get("b")).toMatchObject({ x: 0, w: wB, h: hB });
    expect(alignFrames(targets, "right", bounds).get("a")).toMatchObject({ x: 380 - wA });
    expect(alignFrames(targets, "center-x", bounds).get("a")).toMatchObject({ x: (380 - wA) / 2 });
    expect(alignFrames(targets, "top", bounds).get("b")).toMatchObject({ y: 0 });
    expect(alignFrames(targets, "bottom", bounds).get("a")).toMatchObject({ y: 260 - hA });
    expect(alignFrames(targets, "center-y", bounds).get("b")).toMatchObject({ y: (260 - hB) / 2 });
    // rotation/w/h 原样带入
    const rotated = pinDoc({ a: { x: 0, y: 0, w: 100, h: 50 } });
    const rt = alignTargets(rotated, ["a"]);
    const rf = alignFrames(rt, "left", PAGE).get("a")!;
    expect(rf).toEqual({ x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    // 空目标 → 空 map
    expect(alignFrames(new Map(), "left", PAGE).size).toBe(0);
  });
});

describe("distributeFrames（T13 · A3/A4）", () => {
  it("A3 横向分布：3 个不同宽度，gap 相等，首尾不动", () => {
    const doc = pinDoc({
      a: { x: 0, y: 0, w: 100, h: 50 },
      b: { x: 250, y: 0, w: 50, h: 50 },
      c: { x: 500, y: 0, w: 100, h: 50 },
    });
    const targets = alignTargets(doc, ["a", "b", "c"]);
    const bounds = alignBounds(targets, PAGE); // span 0..600
    // Σsize = 250，gap = (600 - 250) / 2 = 175
    const out = distributeFrames(targets, "horizontal", bounds);
    expect(out.get("a")).toMatchObject({ x: 0 });
    expect(out.get("c")).toMatchObject({ x: 500 });
    expect(out.get("b")).toMatchObject({ x: 275 }); // 0 + 100 + 175；325 + 175 = 500 与 c 无缝衔接
    // 纵向同构
    const docV = pinDoc({
      a: { x: 0, y: 0, w: 50, h: 40 },
      b: { x: 0, y: 300, w: 50, h: 60 },
      c: { x: 0, y: 500, w: 50, h: 100 },
    });
    const tv = alignTargets(docV, ["a", "b", "c"]);
    const outV = distributeFrames(tv, "vertical", alignBounds(tv, PAGE));
    // Σh=200，gap = (600-200)/2 = 200；b → 0+40+200 = 240；240+60+200=500=c 无缝
    expect(outV.get("b")).toMatchObject({ y: 240 });
  });

  it("A4 目标 < 3 → 空 map", () => {
    const doc = pinDoc({
      a: { x: 0, y: 0, w: 100, h: 50 },
      b: { x: 300, y: 200, w: 80, h: 60 },
    });
    const targets = alignTargets(doc, ["a", "b"]);
    expect(distributeFrames(targets, "horizontal", PAGE).size).toBe(0);
    expect(distributeFrames(targets, "vertical", PAGE).size).toBe(0);
  });
});

describe("applyFrameSet（T13 · A6/A7/A8）", () => {
  it("A6 单 doc 一次成形 + rotation 保留 + 幂等", () => {
    const doc = pinDoc({
      a: { x: 0, y: 0, w: 100, h: 50 },
      b: { x: 300, y: 200, w: 80, h: 60 },
    });
    const frames = new Map([
      ["a", F(500, 400, 100, 50, 30)],
      ["b", F(700, 400, 80, 60)],
    ]);
    const next = applyFrameSet(doc, frames);
    expect(next.nodes.find((n) => n.id === "a")!.frame).toEqual(F(500, 400, 100, 50, 30));
    expect(next.nodes.find((n) => n.id === "b")!.frame).toEqual(F(700, 400, 80, 60));
    // 幂等：再应用一次结果不变
    const twice = applyFrameSet(next, frames);
    expect(twice).toEqual(next);
  });

  it("A7 目标带 pin 后代时后代同 delta 平移", () => {
    const doc = pinDoc({ a: { x: 0, y: 0, w: 300, h: 200 } });
    // a 下挂一个 pin 后代 child
    const withChild: Page = {
      ...doc,
      nodes: [
        ...doc.nodes,
        { id: "child", type: "Card", props: { title: "子" }, children: [], pinned: true, frame: F(50, 60, 80, 40) },
      ],
    };
    withChild.nodes.find((n) => n.id === "a")!.children = ["child"];
    const next = applyFrameSet(withChild, new Map([["a", F(1000, 500, 300, 200)]]));
    // 后代同 delta (+1000, +500)
    expect(next.nodes.find((n) => n.id === "child")!.frame).toEqual(F(1050, 560, 80, 40));
  });

  it("A8 移动后组祖先 frame 被 refresh（组框随成员收紧）", () => {
    const doc = pinDoc({ a: { x: 100, y: 100, w: 200, h: 120 }, b: { x: 400, y: 260, w: 160, h: 90 } });
    // 先构造一个组
    const groupNodes = (d: Page) => {
      const union = { x: 100, y: 100, w: 460, h: 250, rotation: 0 };
      const gid = "grp1";
      let next: Page = {
        ...d,
        nodes: [
          ...d.nodes,
          { id: gid, type: "Container", props: { maxWidth: "full" }, children: ["a", "b"], pinned: true, frame: union },
        ],
      };
      next.nodes.find((n) => n.id === "root")!.children = ["grp1"];
      return { doc: next, groupId: gid };
    };
    const { doc: grouped, groupId } = groupNodes(doc);
    void groupNodes;
    // 成员 b 外移 200px：经 applyFrameSet 移动 → 组框 refresh 到新 union
    const next = applyFrameSet(grouped, new Map([["b", F(600, 260, 160, 90)]]));
    const group = next.nodes.find((n) => n.id === groupId)!;
    expect(group.frame).toEqual({ x: 100, y: 100, w: 660, h: 250, rotation: 0 });
  });
});
