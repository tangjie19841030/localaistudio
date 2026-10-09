import { describe, expect, it } from "vitest";
import { collectFlowRects, flowHits, measureFlowRect, measureTarget } from "./flowMeasure";

/**
 * Pure flow-measure geometry (Plan C): screen DOMRect -> page-space rect under
 * the canvas viewport transform, plus marquee intersection for measured rects.
 * Zero DOM layout needed — DOMRect inputs are constructed literally.
 */

const R = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe("measureFlowRect（屏幕 → 页面坐标换算）", () => {
  it("无 pan/zoom（zoom=1，原点重合）：rect 原样", () => {
    const out = measureFlowRect(R(24, 88, 200, 100), R(0, 0, 1440, 900), 1);
    expect(out).toEqual({ x: 24, y: 88, w: 200, h: 100 });
  });

  it("pan 抵消：元素与原点同享平移，页面坐标与 pan 无关", () => {
    // viewport pan = (-40, 30) screen px：原点与元素一起移动
    const origin = R(-40, 30, 2880, 1800);
    const el = R(-40 + 48, 30 + 176, 400, 200); // page (24,88) at zoom 2, shifted by pan
    const out = measureFlowRect(el, origin, 2);
    expect(out).toEqual({ x: 24, y: 88, w: 200, h: 100 });
  });

  it("zoom 换算：屏幕尺寸除以 zoom 得页面尺寸", () => {
    const out = measureFlowRect(R(100, 50, 400, 200), R(0, 0, 720, 450), 0.5);
    expect(out).toEqual({ x: 200, y: 100, w: 800, h: 400 });
  });
});

describe("measureTarget（display:contents 标记取 kit 实盒）", () => {
  it("display:contents 元素测其首个元素子（标记自身无盒）", () => {
    const marker = document.createElement("div");
    marker.style.display = "contents";
    const kit = document.createElement("div");
    marker.appendChild(kit);
    document.body.appendChild(marker);
    expect(measureTarget(marker)).toBe(kit);
    marker.remove();
  });

  it("实盒元素测自身（如 NodeSubtree 根包装）", () => {
    const box = document.createElement("div");
    document.body.appendChild(box);
    expect(measureTarget(box)).toBe(box);
    box.remove();
  });
});

describe("collectFlowRects（data-studio-id 扫描）", () => {
  it("只收集带 data-studio-id 的元素，键为 id", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div data-studio-id="root"><div data-studio-id="card"><span>无标记</span></div></div>
    `;
    document.body.appendChild(host);
    const rects = collectFlowRects(host, 1);
    expect([...rects.keys()].sort()).toEqual(["card", "root"]);
    host.remove();
  });
});

describe("flowHits（测得矩形的框选包含判定）", () => {
  const rects = new Map([
    ["a", { x: 0, y: 0, w: 100, h: 100 }],
    ["b", { x: 500, y: 500, w: 100, h: 100 }],
    ["zero", { x: 0, y: 0, w: 0, h: 0 }],
  ]);

  it("相交即命中；不相交不命中；未测量（0 尺寸）永不命中", () => {
    expect(flowHits(rects, { x: 50, y: 50, w: 60, h: 60 })).toEqual(["a"]);
    expect(flowHits(rects, { x: 200, y: 200, w: 100, h: 100 })).toEqual([]);
    expect(flowHits(rects, { x: -10, y: -10, w: 20, h: 20 })).toEqual(["a"]);
  });

  it("贴边不算相交（与 schema-core marquee 同一语义）", () => {
    expect(flowHits(rects, { x: 100, y: 0, w: 50, h: 50 })).toEqual([]);
  });
});
