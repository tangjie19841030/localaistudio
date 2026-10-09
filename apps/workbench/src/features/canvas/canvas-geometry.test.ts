import type { Frame } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import {
  CANVAS_PAGE,
  canvasToScreen,
  clampZoom,
  constrainMove,
  fitViewport,
  HANDLES,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  resizeFrame,
  screenToCanvas,
  zoomAt,
  type CanvasViewport,
} from "./canvasGeometry";

/** Frame literal helper — rotation always explicit (zod output type requires it). */
const F = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

const VP = (zoom = 1, panX = 0, panY = 0): CanvasViewport => ({ zoom, panX, panY });

describe("clampZoom", () => {
  it("0.25 下限 / 4 上限 / 1 不变", () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(0.25)).toBe(0.25);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(4)).toBe(4);
    expect(clampZoom(9)).toBe(4);
  });
  it("非有限值回退为 1", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("screenToCanvas / canvasToScreen", () => {
  it("恒等视口下互为逆变换", () => {
    const vp = VP();
    const pt = { x: 123, y: -45 };
    expect(screenToCanvas(canvasToScreen(pt, vp), vp)).toEqual(pt);
    expect(canvasToScreen(screenToCanvas(pt, vp), vp)).toEqual(pt);
  });
  it("缩放+平移下往返一致（roundtrip）", () => {
    const vp = VP(1.75, -320.5, 88.25);
    const pt = { x: 42, y: -13 };
    const rt1 = screenToCanvas(canvasToScreen(pt, vp), vp);
    const rt2 = canvasToScreen(screenToCanvas(pt, vp), vp);
    expect(rt1.x).toBeCloseTo(pt.x);
    expect(rt1.y).toBeCloseTo(pt.y);
    expect(rt2.x).toBeCloseTo(pt.x);
    expect(rt2.y).toBeCloseTo(pt.y);
  });
  it("canvasToScreen 遵循 screen = canvas*zoom + pan", () => {
    expect(canvasToScreen({ x: 10, y: 20 }, VP(2, 100, -50))).toEqual({ x: 120, y: -10 });
  });
  it("screenToCanvas 遵循 canvas = (screen-pan)/zoom", () => {
    expect(screenToCanvas({ x: 120, y: -10 }, VP(2, 100, -50))).toEqual({ x: 10, y: 20 });
  });
});

describe("zoomAt：光标锚定缩放", () => {
  it("光标下的画布点缩放前后屏幕位置不变", () => {
    const vp = VP(1, 40, -20);
    const cursor = { x: 233, y: 128 };
    const anchor = screenToCanvas(cursor, vp);
    const next = zoomAt(cursor, vp, 1.5);
    const after = canvasToScreen(anchor, next);
    expect(after.x).toBeCloseTo(cursor.x, 9);
    expect(after.y).toBeCloseTo(cursor.y, 9);
    expect(next.zoom).toBe(1.5);
  });
  it("锚定在多个缩放步后仍成立", () => {
    let vp = VP(0.5, 120, 60);
    const cursor = { x: 300, y: 200 };
    const anchor = screenToCanvas(cursor, vp);
    vp = zoomAt(cursor, vp, 1.3);
    vp = zoomAt(cursor, vp, 1.3);
    vp = zoomAt(cursor, vp, 0.5);
    const after = canvasToScreen(anchor, vp);
    expect(after.x).toBeCloseTo(cursor.x, 9);
    expect(after.y).toBeCloseTo(cursor.y, 9);
  });
  it("缩小越过下限时 zoom 钳到 0.25，锚定仍按钳后值计算", () => {
    const vp = VP(0.3, 0, 0);
    const cursor = { x: 90, y: 60 };
    const next = zoomAt(cursor, vp, 0.25);
    expect(next.zoom).toBe(MIN_ZOOM);
    const anchor = screenToCanvas(cursor, vp);
    const after = canvasToScreen(anchor, next);
    expect(after.x).toBeCloseTo(cursor.x, 9);
  });
  it("放大越过上限时 zoom 钳到 4", () => {
    expect(zoomAt({ x: 0, y: 0 }, VP(3.9, 0, 0), 4).zoom).toBe(MAX_ZOOM);
  });
  it("非光标点会随缩放移动（锚定只保证光标点）", () => {
    const vp = VP(1, 0, 0);
    const cursor = { x: 500, y: 0 };
    const next = zoomAt(cursor, vp, 2);
    // 远离光标的点被推离原屏幕位置
    expect(canvasToScreen({ x: 0, y: 0 }, next).x).toBe(-500);
  });
});

describe("panBy", () => {
  it("平移累加，zoom 不变", () => {
    const next = panBy(VP(2, 10, 20), 30, -40);
    expect(next).toEqual({ zoom: 2, panX: 40, panY: -20 });
  });
});

describe("constrainMove：Shift 主轴约束", () => {
  it("横向占优时锁 y", () => {
    expect(constrainMove(50, 4)).toEqual({ dx: 50, dy: 0 });
  });
  it("纵向占优时锁 x", () => {
    expect(constrainMove(3, 40)).toEqual({ dx: 0, dy: 40 });
  });
  it("接近 45 度时取较短分量的等长对角", () => {
    expect(constrainMove(50, 48)).toEqual({ dx: 48, dy: 48 });
    expect(constrainMove(-50, 48)).toEqual({ dx: -48, dy: 48 });
  });
});

describe("resizeFrame：8 手柄", () => {
  it("se 角：右下边缘移动，左上不动", () => {
    const r = resizeFrame(F(100, 100, 200, 100), "se", 30, 20);
    expect(r).toEqual(F(100, 100, 230, 120));
  });
  it("nw 角：左上边缘移动，右下不动", () => {
    const r = resizeFrame(F(100, 100, 200, 100), "nw", -30, -20);
    expect(r).toEqual(F(70, 80, 230, 120));
  });
  it("e 边：仅宽度变化", () => {
    const r = resizeFrame(F(100, 100, 200, 100), "e", 40, 999);
    expect(r).toEqual(F(100, 100, 240, 100));
  });
  it("w 边：仅 x/宽变化", () => {
    const r = resizeFrame(F(100, 100, 200, 100), "w", -40, 999);
    expect(r).toEqual(F(60, 100, 240, 100));
  });
  it("n 边：仅 y/高变化", () => {
    const r = resizeFrame(F(100, 100, 200, 100), "n", 999, -40);
    expect(r).toEqual(F(100, 60, 200, 140));
  });
  it("s 边：仅高度变化", () => {
    const r = resizeFrame(F(100, 100, 200, 100), "s", 999, 40);
    expect(r).toEqual(F(100, 100, 200, 140));
  });
  it("ne/sw 手柄同时作用两轴", () => {
    expect(resizeFrame(F(100, 100, 200, 100), "ne", 30, -20)).toEqual(F(100, 80, 230, 120));
    expect(resizeFrame(F(100, 100, 200, 100), "sw", -30, 20)).toEqual(F(70, 100, 230, 120));
  });
  it("拖过头（负尺寸）钳到 1x1，抓取边停在对面边上", () => {
    const r = resizeFrame(F(100, 100, 200, 100), "se", -500, -500);
    expect(r).toEqual(F(100, 100, 1, 1));
    // 反向拖 w 手柄越过右缘：w=1 且 x=右缘-1
    const w = resizeFrame(F(100, 100, 200, 100), "w", 500, 0);
    expect(w).toEqual(F(299, 100, 1, 100));
  });
  it("rotation 原样保留", () => {
    const r = resizeFrame({ x: 0, y: 0, w: 100, h: 50, rotation: 45 }, "se", 10, 10);
    expect(r.rotation).toBe(45);
  });

  describe("keepRatio（Shift 等比）", () => {
    it("se 拖动保持宽高比（横向主导）", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "se", 50, 5, { keepRatio: true });
      // w 250 → h 125（原比例 2:1），角点向右下扩展
      expect(r.w / r.h).toBeCloseTo(2);
      expect(r).toEqual(F(100, 100, 250, 125));
    });
    it("se 拖动保持宽高比（纵向主导）", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "se", 5, 30, { keepRatio: true });
      // h 130 → w 260
      expect(r.w / r.h).toBeCloseTo(2);
      expect(r).toEqual(F(100, 100, 260, 130));
    });
    it("nw 拖动保持宽高比且锚在右下角", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "nw", -50, -25, { keepRatio: true });
      expect(r.w / r.h).toBeCloseTo(2);
      // 右下角 (300,200) 不动
      expect(r.x + r.w).toBe(300);
      expect(r.y + r.h).toBe(200);
    });
    it("边手柄忽略 keepRatio（无边可比）", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "e", 40, 0, { keepRatio: true });
      expect(r).toEqual(F(100, 100, 240, 100));
    });
    it("等比拖过头时比例仍成立且尺寸 >= 1", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "se", -500, -500, { keepRatio: true });
      expect(r.w).toBeGreaterThanOrEqual(1);
      expect(r.h).toBeGreaterThanOrEqual(1);
      expect(r.w / r.h).toBeCloseTo(2);
    });
  });

  describe("fromCenter（Alt 中心缩放）", () => {
    it("e 手柄：左右两边缘同时外扩", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "e", 40, 0, { fromCenter: true });
      expect(r).toEqual(F(60, 100, 280, 100));
    });
    it("s 手柄：上下两边缘同时移动", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "s", 0, 40, { fromCenter: true });
      expect(r).toEqual(F(100, 60, 200, 180));
    });
    it("nw 手柄：四边中两个方向同时移动", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "nw", -20, -10, { fromCenter: true });
      expect(r).toEqual(F(80, 90, 240, 120));
    });
    it("中心缩放拖反时不越过中心，钳回 1x1", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "e", -500, 0, { fromCenter: true });
      expect(r.w).toBeGreaterThanOrEqual(1);
      expect(r.x + r.w / 2).toBeCloseTo(200); // 中心不动
    });
    it("中心 + 等比：两轴同时缩放且比例成立", () => {
      const r = resizeFrame(F(100, 100, 200, 100), "se", 60, 0, { fromCenter: true, keepRatio: true });
      expect(r.w / r.h).toBeCloseTo(2);
      expect(r.x + r.w / 2).toBeCloseTo(200);
      expect(r.y + r.h / 2).toBeCloseTo(150);
    });
  });

  it("HANDLES 恰为 8 个方位", () => {
    expect(HANDLES).toHaveLength(8);
    expect(HANDLES).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
  });
});

describe("fitViewport：适应画布", () => {
  it("宽受限：页面水平居中", () => {
    const page = CANVAS_PAGE;
    const view = { w: 800, h: 600 };
    const vp = fitViewport(page, view, 60);
    expect(vp.zoom).toBeCloseTo((800 - 120) / 1440);
    const left = canvasToScreen({ x: 0, y: 0 }, vp);
    const right = canvasToScreen({ x: page.w, y: 0 }, vp);
    expect((left.x + right.x) / 2).toBeCloseTo(400);
  });
  it("高受限：页面垂直居中", () => {
    const vp = fitViewport({ x: 0, y: 0, w: 400, h: 900 }, { w: 800, h: 600 }, 60);
    expect(vp.zoom).toBeCloseTo((600 - 120) / 900);
    const top = canvasToScreen({ x: 0, y: 0 }, vp);
    const bottom = canvasToScreen({ x: 0, y: 900 }, vp);
    expect((top.y + bottom.y) / 2).toBeCloseTo(300);
  });
  it("超大视口（缩放超 4）时钳到 4 仍居中", () => {
    const vp = fitViewport({ x: 0, y: 0, w: 100, h: 100 }, { w: 2000, h: 2000 }, 60);
    expect(vp.zoom).toBe(4);
    const center = canvasToScreen({ x: 50, y: 50 }, vp);
    expect(center).toEqual({ x: 1000, y: 1000 });
  });
});
