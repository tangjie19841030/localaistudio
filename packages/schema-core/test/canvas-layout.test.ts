import { describe, expect, it } from "vitest";
import type { Frame, NodeRecord, Page } from "../src/document.js";
import { defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import {
  clampFrame,
  frameRects,
  hitTest,
  marquee,
  MIN_FRAME_SIZE,
  type Rect,
  snapCandidates,
  zOrder,
} from "../src/registry/canvasLayout.js";

const node = (id: string, type: string, frame?: Frame): NodeRecord => ({
  id,
  type,
  props: {},
  children: [],
  frame,
});

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const frame = (x: number, y: number, w: number, h: number, rotation = 0): Frame => ({ x, y, w, h, rotation });

/** root + 三个可选带 frame 的节点；base(false) 全部无 frame。 */
function canvasDoc(withFrames: boolean): Page {
  return {
    id: "page-1",
    name: "画布测试",
    rootId: "root",
    nodes: [
      node("root", "Stack"),
      node("a", "Card", withFrames ? frame(0, 0, 100, 50) : undefined),
      node("b", "Card", withFrames ? frame(200, 100, 80, 40) : undefined),
      node("c", "Text", withFrames ? frame(-50, -20, 30, 30) : undefined),
    ],
  };
}

describe("frameRects", () => {
  it("空文档 → 空 Map", () => {
    expect(frameRects({ ...canvasDoc(false), nodes: [] })).toEqual(new Map());
  });

  it("只收集带 frame 的节点；无 frame 节点被忽略", () => {
    const rects = frameRects(canvasDoc(true));
    expect(rects.size).toBe(3);
    expect(rects.get("a")).toEqual(rect(0, 0, 100, 50));
    expect(rects.get("c")).toEqual(rect(-50, -20, 30, 30)); // 负坐标合法
    expect(frameRects(canvasDoc(false)).size).toBe(0);
  });
});

describe("zOrder", () => {
  it("等于 nodes 数组顺序（靠前在下层）", () => {
    expect(zOrder(canvasDoc(true))).toEqual(["root", "a", "b", "c"]);
    expect(zOrder(canvasDoc(false))).toEqual(["root", "a", "b", "c"]);
  });

  it("空文档 → 空数组", () => {
    expect(zOrder({ ...canvasDoc(true), nodes: [] })).toEqual([]);
  });
});

describe("clampFrame", () => {
  it("越界 w/h 夹到边界内，x/y 保持不动", () => {
    const clamped = clampFrame(frame(50, 60, 200, 300), rect(0, 0, 100, 100));
    expect(clamped.x).toBe(50);
    expect(clamped.y).toBe(60);
    expect(clamped.w).toBe(50); // 右边界 100
    expect(clamped.h).toBe(40); // 下边界 100
    expect(clamped.rotation).toBe(0);
  });

  it("不越界的 frame 原样返回（值相等，新引用）", () => {
    const f = frame(10, 10, 20, 20, 45);
    const clamped = clampFrame(f, rect(0, 0, 1000, 1000));
    expect(clamped).toEqual(f);
    expect(clamped).not.toBe(f);
  });

  it("完全画在边界外的 frame 夹到可见下限 MIN_FRAME_SIZE（不移动位置）", () => {
    const clamped = clampFrame(frame(500, 500, 40, 40), rect(0, 0, 100, 100));
    expect(clamped.x).toBe(500);
    expect(clamped.y).toBe(500);
    expect(clamped.w).toBe(MIN_FRAME_SIZE);
    expect(clamped.h).toBe(MIN_FRAME_SIZE);
  });

  it("拖出右缘不产生 1px 残骸：x 越过页右缘时保持可见宽度", () => {
    // frame.x=1500 已越过 1440 宽页面的右缘 → 旧实现 maxW=Math.max(1, 负数)=1
    // 会把 commit 后的节点压成 1px；现在保持 MIN_FRAME_SIZE 下限。
    const clamped = clampFrame(frame(1500, 0, 100, 60), rect(0, 0, 1440, 900));
    expect(clamped.x).toBe(1500); // 自由画布：位置不动
    expect(clamped.w).toBe(MIN_FRAME_SIZE); // 不小于可见下限
    expect(clamped.h).toBe(60); // y 未越界，高度原样
  });
});

describe("snapCandidates", () => {
  it("左边缘对左边缘（阈值内）给出 dx 修正与吸附线", () => {
    const result = snapCandidates(rect(5, 0, 50, 50), [rect(0, 0, 100, 100)]);
    expect(result.dx).toBe(-5);
    expect(result.dy).toBe(0); // y 起点本就对齐 0 → delta 0
    // x guide: 垂直方向覆盖两 rect（moving 底 50、other 底 100 → to=100）
    expect(result.guides).toContainEqual({ axis: "x", at: 0, from: 0, to: 100 });
  });

  it("中心对中心吸附", () => {
    // centers: 40+25=65 vs 20+50=70 → dx = 5（|5| ≤ 6 命中）
    const result = snapCandidates(rect(40, 0, 50, 50), [rect(20, 0, 100, 100)]);
    expect(result.dx).toBe(5);
  });

  it("阈值外无吸附 → dx/dy 为 0、guides 为空", () => {
    const result = snapCandidates(rect(200, 200, 50, 50), [rect(0, 0, 100, 100)], 6);
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("默认阈值 6：差 6 吸附、差 7 不吸附", () => {
    expect(snapCandidates(rect(6, 0, 50, 50), [rect(0, 0, 100, 100)]).dx).toBe(-6);
    expect(snapCandidates(rect(7, 0, 50, 50), [rect(0, 0, 100, 100)]).dx).toBe(0);
  });

  it("同轴多候选取 |delta| 最小的（最强吸附胜出）", () => {
    // moving(48,300)：x 轴唯一在阈值内的是 r2 left 50（差 2）；
    // y=300 远离所有 others → 无 y 吸附，guides 只有 1 条。
    const result = snapCandidates(rect(48, 300, 20, 20), [rect(0, 0, 30, 30), rect(50, 50, 40, 40), rect(60, 200, 20, 20)]);
    expect(result.dx).toBe(2);
    expect(result.dy).toBe(0);
    expect(result.guides.length).toBe(1);
    expect(result.guides[0]!.axis).toBe("x");
    expect(result.guides[0]!.at).toBe(50);
  });

  it("自定义阈值生效（阈值 20 时差 15 也吸附）", () => {
    expect(snapCandidates(rect(15, 0, 50, 50), [rect(0, 0, 100, 100)], 20).dx).toBe(10);
  });

  it("空 others → 无吸附", () => {
    expect(snapCandidates(rect(0, 0, 10, 10), [])).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("y 轴独立吸附：顶边吸附到别的矩形底边（跨边对齐）修正 dy", () => {
    // moving 顶边 104 对 other 底边 100 → delta -4 命中；x 起点同为 0 → dx 0。
    const result = snapCandidates(rect(0, 104, 50, 50), [rect(0, 0, 100, 100)]);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(-4);
    expect(result.guides).toEqual([{ axis: "y", at: 100, from: 0, to: 100 }]);
  });

  it("两条 guide 同时存在（x 与 y 各自命中）", () => {
    const result = snapCandidates(rect(3, 5, 50, 50), [rect(0, 0, 100, 100)]);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(-5);
    expect(result.guides).toEqual([
      { axis: "x", at: 0, from: 0, to: 100 },
      { axis: "y", at: 0, from: 0, to: 100 },
    ]);
  });
});

describe("hitTest", () => {
  it("命中带 frame 的节点返回其 id", () => {
    expect(hitTest(canvasDoc(true), { x: 10, y: 10 })).toBe("a");
    expect(hitTest(canvasDoc(true), { x: 220, y: 110 })).toBe("b");
    expect(hitTest(canvasDoc(true), { x: -40, y: -10 })).toBe("c"); // 负坐标区域
  });

  it("空白点返回 null；无 frame 节点永远不命中", () => {
    expect(hitTest(canvasDoc(true), { x: 150, y: 150 })).toBeNull();
    expect(hitTest(canvasDoc(false), { x: 10, y: 10 })).toBeNull();
  });

  it("两个重叠 frame 命中数组中靠后的（最顶层）", () => {
    const doc: Page = {
      ...canvasDoc(true),
      nodes: [
        node("root", "Stack"),
        node("bottom", "Card", frame(0, 0, 100, 100)),
        node("top", "Card", frame(10, 10, 100, 100)),
      ],
    };
    expect(hitTest(doc, { x: 50, y: 50 })).toBe("top"); // 两者都覆盖
    expect(hitTest(doc, { x: 5, y: 5 })).toBe("bottom"); // 只有 bottom 覆盖
  });

  it("边界上的点：左/上边命中，右/下边不命中（半开区间）", () => {
    const doc: Page = {
      ...canvasDoc(true),
      nodes: [node("root", "Stack"), node("solo", "Card", frame(0, 0, 100, 50))],
    };
    expect(hitTest(doc, { x: 0, y: 0 })).toBe("solo");
    expect(hitTest(doc, { x: 100, y: 50 })).toBeNull();
  });
});

describe("marquee", () => {
  it("交集即入选：部分相交也算，完全在外的不算", () => {
    const doc: Page = {
      ...canvasDoc(true),
      nodes: [
        node("root", "Stack"),
        node("inside", "Card", frame(10, 10, 100, 100)), // 完整包含
        node("partial", "Card", frame(90, 10, 100, 100)), // 部分相交
        node("outside", "Card", frame(500, 500, 50, 50)), // 完全在外
      ],
    };
    expect(marquee(doc, rect(0, 0, 100, 100))).toEqual(["inside", "partial"]);
  });

  it("要求相交而非包含：大框完整套住的小节点选中，只蹭边的边缘相交也选中", () => {
    const doc: Page = {
      ...canvasDoc(true),
      nodes: [
        node("root", "Stack"),
        node("small", "Card", frame(40, 40, 20, 20)),
        node("big", "Card", frame(0, 0, 300, 300)),
      ],
    };
    // sel 只与 small 相交（big 覆盖整个 sel 但也相交）
    const hits = marquee(doc, rect(45, 45, 10, 10));
    expect(hits).toContain("small");
    expect(hits).toContain("big"); // 相交即可，不要求包含
  });

  it("仅边线相切不算相交", () => {
    const doc: Page = {
      ...canvasDoc(true),
      nodes: [node("root", "Stack"), node("edge", "Card", frame(100, 0, 50, 50))],
    };
    expect(marquee(doc, rect(0, 0, 100, 50))).toEqual([]); // x: [0,100) 与 [100,150) 相切
  });

  it("无 frame 的节点被忽略；空文档返回空数组", () => {
    expect(marquee(canvasDoc(false), rect(-1000, -1000, 2000, 2000))).toEqual([]);
    expect(marquee({ ...canvasDoc(true), nodes: [] }, rect(0, 0, 10, 10))).toEqual([]);
  });
});
