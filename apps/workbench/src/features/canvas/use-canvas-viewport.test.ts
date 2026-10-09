import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { zoomAt } from "./canvasGeometry";
import { INITIAL_VIEWPORT, useCanvasViewport } from "./useCanvasViewport";

/** State-transition tests for the viewport hook; the math is covered in
 * canvas-geometry.test.ts — here we assert the wiring (one call = one state). */

describe("useCanvasViewport", () => {
  beforeEach(() => {
    // renderHook remounts fresh state per test (no shared store involved).
  });

  it("初始视口为 zoom=1 / pan=0", () => {
    const { result } = renderHook(() => useCanvasViewport());
    expect(result.current.viewport).toEqual(INITIAL_VIEWPORT);
  });

  it("zoomAtCursor 在光标处锚定缩放", () => {
    const { result } = renderHook(() => useCanvasViewport());
    const cursor = { x: 200, y: 100 };
    act(() => result.current.zoomAtCursor(cursor, 2));
    const vp = result.current.viewport;
    expect(vp.zoom).toBe(2);
    // 光标下的画布点屏幕位置不变：canvas*zoom+pan == cursor
    const canvas = { x: (200 - 0) / 1, y: (100 - 0) / 1 };
    expect(canvas.x * vp.zoom + vp.panX).toBeCloseTo(200);
    expect(canvas.y * vp.zoom + vp.panY).toBeCloseTo(100);
  });

  it("panByDelta 平移累加且不动 zoom", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.panByDelta(30, -20));
    act(() => result.current.panByDelta(10, 5));
    expect(result.current.viewport).toEqual({ zoom: 1, panX: 40, panY: -15 });
  });

  it("缩放钳制在下限 0.25", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.zoomAtCursor({ x: 0, y: 0 }, 0.1));
    expect(result.current.viewport.zoom).toBe(0.25);
  });

  it("fitToRect 计算居中适应视口", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.fitToRect({ x: 0, y: 0, w: 1440, h: 900 }, { w: 800, h: 600 }, 60));
    const vp = result.current.viewport;
    expect(vp.zoom).toBeCloseTo(680 / 1440);
    // 页面水平居中：左右屏幕边缘关于 400 对称
    expect(0 * vp.zoom + vp.panX).toBeCloseTo((800 - 1440 * vp.zoom) / 2);
  });

  it("setViewport 直接替换视口（重置路径）", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.zoomAtCursor({ x: 50, y: 50 }, 3));
    act(() => result.current.setViewport(INITIAL_VIEWPORT));
    expect(result.current.viewport).toEqual(INITIAL_VIEWPORT);
  });

  it("与纯函数 zoomAt 结果一致（hook 只做状态包装）", () => {
    const { result } = renderHook(() => useCanvasViewport());
    const cursor = { x: 123, y: 45 };
    const expected = zoomAt(cursor, INITIAL_VIEWPORT, 1.5);
    act(() => result.current.zoomAtCursor(cursor, 1.5));
    expect(result.current.viewport).toEqual(expected);
  });
});
