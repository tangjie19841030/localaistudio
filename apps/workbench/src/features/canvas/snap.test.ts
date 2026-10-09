import type { Frame, Rect, SnapGuide, SnapResult } from "@studio/schema-core";
import { frameRects, snapCandidates } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import { clampInsidePage, clampedFrame, fitZoom, MIN_VISIBLE, recompute, type MovingSet } from "./useSnap";

/**
 * Snap orchestration unit tests. The geometry itself (threshold candidate
 * selection, strongest-axis pick) is already covered by schema-core; here we
 * prove the drag-side wiring: exclusions, per-node composites, clamping and
 * the transient-frame override all behave.
 */

const F = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

function snapDoc(...entries: { id: string; frame: Frame; pinned?: boolean }[]) {
  return {
    id: "page-1",
    name: "t",
    rootId: "root",
    nodes: [
      { id: "root", type: "Container", props: {}, children: [] },
      // Plan C: only pinned frames are snap targets; the default pinned:true
      // mirrors every existing case (a drag only ever involves pinned nodes).
      ...entries.map((e) => ({
        id: e.id,
        type: "Card",
        props: {},
        children: [],
        frame: e.frame,
        pinned: e.pinned ?? true,
      })),
    ],
  };
}

describe("recompute：拖动主框的吸附计算", () => {
  it("无其他节点时 delta 为 0 且不产生吸附线", () => {
    const doc = snapDoc({ id: "a", frame: F(0, 0, 100, 60) });
    const moving: MovingSet = new Map([["a", F(10, 10, 100, 60)]]);
    const r = recompute(doc, moving, 6);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([]);
  });

  it("移动集内的节点不参与吸附（排除自身）", () => {
    const doc = snapDoc(
      { id: "a", frame: F(0, 0, 100, 60) },
      { id: "b", frame: F(0, 100, 100, 60) },
    );
    // b 与 a 当前正好 y=100 完全对齐（左边缘同 x=0）——排除自身后不应吸附
    const moving: MovingSet = new Map([["a", F(0, 100, 100, 60)]]);
    const r = recompute(doc, moving, 6);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });

  it("距其他节点左边缘 3px 时吸附校正 dx=-3 并给出 x 轴吸附线", () => {
    const doc = snapDoc(
      { id: "a", frame: F(0, 0, 100, 60) },
      { id: "b", frame: F(200, 200, 120, 80) },
    );
    const moving: MovingSet = new Map([["a", F(203, 240, 100, 60)]]);
    const r = recompute(doc, moving, 6);
    expect(r.dx).toBe(-3);
    expect(r.guides.some((g) => g.axis === "x" && g.at === 200)).toBe(true);
  });

  it("多选拖动：任一成员吸附到 anchor 时整组取该轴校正", () => {
    const doc = snapDoc(
      { id: "a", frame: F(0, 0, 60, 40) },
      { id: "b", frame: F(200, 0, 60, 40) },
      { id: "anchor", frame: F(400, 0, 60, 40) },
    );
    const moving: MovingSet = new Map([
      ["a", F(2, 500, 60, 40)],
      ["b", F(403, 500, 60, 40)],
    ]);
    const r = recompute(doc, moving, 6);
    // b 左边缘 403 距 anchor 左边缘 400 差 3px → 组 dx=-3
    expect(r.dx).toBe(-3);
    expect(r.guides.some((g) => g.axis === "x" && g.at === 400)).toBe(true);
  });

  it("实时帧（transient 覆盖）参与吸附计算", () => {
    const doc = snapDoc(
      { id: "a", frame: F(0, 0, 100, 60) },
      { id: "b", frame: F(0, 100, 100, 60) },
    );
    const transient: MovingSet = new Map([["b", F(0, 4, 100, 60)]]);
    const r = recompute(doc, transient, 6);
    expect(r.dy).toBe(-4);
  });

  it("threshold 归一：缩放下阈值按 zoom 换算", () => {
    const doc = snapDoc(
      { id: "a", frame: F(0, 0, 100, 60) },
      { id: "b", frame: F(500, 0, 100, 60) },
    );
    const moving: MovingSet = new Map([["a", F(508, 0, 100, 60)]]);
    // zoom=0.5 → 屏 6px = 画布 12px，508 距 500 差 8 应命中
    expect(recompute(doc, moving, 6 / 0.5).dx).toBe(-8);
    // zoom=2 → 屏 6px = 画布 3px，8px 偏差不该命中
    expect(recompute(doc, moving, 6 / 2).dx).toBe(0);
  });

  it("未 pinned 的遗留 frame 不是吸附目标（惰性元数据不吸住拖框）", () => {
    const doc = snapDoc(
      { id: "a", frame: F(0, 0, 100, 60) },
      { id: "ghost", frame: F(200, 200, 120, 80), pinned: false },
    );
    const moving: MovingSet = new Map([["a", F(203, 240, 100, 60)]]);
    const r = recompute(doc, moving, 6);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([]);
  });
});

describe("clampedFrame：越界拖动夹取", () => {
  it("超出页面右边界时 w 夹到可见下限（schema-core clampFrame 语义）", () => {
    expect(clampedFrame(F(1500, 0, 100, 60), { x: 0, y: 0, w: 1440, h: 900 })).toEqual(F(1500, 0, 8, 60));
  });
  it("页内不动", () => {
    expect(clampedFrame(F(100, 100, 200, 100), { x: 0, y: 0, w: 1440, h: 900 })).toEqual(F(100, 100, 200, 100));
  });
});

describe("clampInsidePage：T20 编辑期越界钳制", () => {
  const page = { x: 0, y: 0, w: 1440, h: 900 };

  it("页内完全在页面内的框：x/y/w/h 原样返回", () => {
    expect(clampInsidePage(F(100, 100, 200, 100), page)).toEqual(F(100, 100, 200, 100));
  });

  it("移动超右边界：右沿被钳到 pageRight（x 拉回 + w 收缩）", () => {
    // x=1500, w=200 → 位置钳到 x=1432；之后 x+w=1632 仍溢出 → w 收到 8
    const f = clampInsidePage(F(1500, 100, 200, 100), page);
    expect(f.x + f.w).toBe(1440);
    expect(f.x).toBe(1432);
  });

  it("移动超下边界：底沿被钳到 pageBottom", () => {
    // y=1000, h=100 → 位置钳到 y=892；y+h=992 仍溢出 → h 收到 8
    const f = clampInsidePage(F(100, 1000, 200, 100), page);
    expect(f.y + f.h).toBe(900);
    expect(f.y).toBe(892);
  });

  it("移动超左边界：x 被拉到 page.x", () => {
    const f = clampInsidePage(F(-50, 100, 200, 100), page);
    expect(f.x).toBe(0);
  });

  it("移动超出页面上边界：y 被拉到 page.y", () => {
    const f = clampInsidePage(F(100, -50, 200, 100), page);
    expect(f.y).toBe(0);
  });

  it("四角同时越界（完全拖出右下）：右沿/底沿都被钳到 page 边", () => {
    const f = clampInsidePage(F(2000, 2000, 200, 100), page);
    expect(f.x + f.w).toBe(1440);
    expect(f.y + f.h).toBe(900);
  });

  it("拖动让框完全在页内右沿附近 + 边缘越界 1px：仍保持原始 w（不收缩）", () => {
    // x=1240, w=200 → 右沿=1440 正好贴边；x 不需位移，w 也不需收缩
    const f = clampInsidePage(F(1240, 100, 200, 100), page);
    expect(f.x).toBe(1240);
    expect(f.w).toBe(200);
  });

  it("缩放越过左边界：x 拉回保证至少 MIN_VISIBLE px 在页面内", () => {
    // 模拟 nw 手柄被猛拉到 x=-300, w=500 → 右沿=200<1440，无需收缩 w；x 钳到 0
    const f = clampInsidePage(F(-300, 100, 500, 100), page);
    expect(f.x).toBe(0);
    expect(f.w).toBe(500);
  });

  it("缩放既越过左又越过右：左 x 钳位 + 右 w 收缩", () => {
    // x=-100, w=1700 → 左 x 钳 0；右沿=1700 仍溢出 → w 收到 1440
    const f = clampInsidePage(F(-100, 100, 1700, 100), page);
    expect(f.x).toBe(0);
    expect(f.x + f.w).toBe(1440);
  });

  it("页内尺寸未溢出时不收缩 w/h（不破坏缩放交互）", () => {
    const f = clampInsidePage(F(100, 100, 200, 100), page);
    expect(f.w).toBe(200);
    expect(f.h).toBe(100);
  });

  it("rotation 原样保留", () => {
    const f = clampInsidePage({ x: -50, y: 100, w: 200, h: 100, rotation: 45 }, page);
    expect(f.rotation).toBe(45);
    expect(f.x).toBe(0);
  });
});

describe("fitZoom：适应画布缩放值", () => {
  it("宽受限取宽向比例", () => {
    expect(fitZoom(1440, 900, { w: 800, h: 600 }, 60)).toBeCloseTo((800 - 120) / 1440);
  });
  it("高受限取高向比例", () => {
    expect(fitZoom(400, 900, { w: 800, h: 600 }, 60)).toBeCloseTo((600 - 120) / 900);
  });
  it("超限夹到 4", () => {
    expect(fitZoom(100, 100, { w: 2000, h: 2000 }, 60)).toBe(4);
  });
});
