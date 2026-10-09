import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@studio/ppt-toolkit";
import { describe, expect, it } from "vitest";
import {
  clampRect,
  clampedRectField,
  dataToScreen,
  fitScale,
  movedRect,
  resizedRect,
  screenToData,
} from "./geometry";

const view = { scale: 0.5, offsetX: 100, offsetY: 50 };

describe("geometry 纯函数", () => {
  it("screenToData：屏幕坐标减偏移除缩放", () => {
    expect(screenToData(view, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(screenToData(view, 200, 150)).toEqual({ x: 200, y: 200 });
    expect(screenToData({ scale: 2, offsetX: 0, offsetY: 0 }, 100, 60)).toEqual({ x: 50, y: 30 });
  });

  it("dataToScreen：数据尺寸乘缩放", () => {
    expect(dataToScreen(view, 1280, 720)).toEqual({ w: 640, h: 360 });
    expect(dataToScreen({ scale: 1, offsetX: 0, offsetY: 0 }, 100, 40)).toEqual({ w: 100, h: 40 });
  });

  it("fitScale：16:9 等比缩放并留边距", () => {
    // usable = container - 2*margin：1376x816 减 48*2 → 1280x720 → 正好 1
    expect(fitScale(1376, 816, 48)).toBeCloseTo(1);
    // 窄容器按宽受限
    expect(fitScale(400, 2000, 0)).toBeCloseTo(400 / SLIDE_WIDTH);
    // 矮容器按高受限
    expect(fitScale(2000, 400, 0)).toBeCloseTo(400 / SLIDE_HEIGHT);
  });

  it("movedRect：拖动增量换算并 clamp 在画布内", () => {
    const rect = { x: 100, y: 80, w: 600, h: 80 };
    // +40 屏幕像素 = +80 数据像素（scale 0.5）
    expect(movedRect(view, rect, 40, 0)).toEqual({ x: 180, y: 80, w: 600, h: 80 });
    // 拖出边界被 clamp（x 最大 1280-600=680）
    const far = movedRect(view, rect, 5000, 0);
    expect(far.x).toBe(SLIDE_WIDTH - 600);
    expect(far.y).toBe(80);
  });

  it("resizedRect：东南角拉大、西北角缩小并 clamp", () => {
    const rect = { x: 100, y: 100, w: 200, h: 100 };
    // se 拖 +20 屏幕 = +40 数据
    expect(resizedRect(view, rect, "se", 20, 10)).toEqual({ x: 100, y: 100, w: 240, h: 120 });
    // nw 拖 +10 屏幕：手柄向右下移动 → x/y 增、w/h 减（+20 数据）
    const nw = resizedRect(view, rect, "nw", 10, 10);
    expect(nw).toEqual({ x: 120, y: 120, w: 180, h: 80 });
    // 拖到画布外 clamp 到边界内
    const huge = resizedRect(view, rect, "se", 100000, 100000);
    expect(huge.w).toBe(SLIDE_WIDTH - huge.x);
    expect(huge.h).toBe(SLIDE_HEIGHT - huge.y);
    // w 拖成负数时 clamp 保底尺寸
    const tiny = resizedRect(view, rect, "e", -100000, 0);
    expect(tiny.w).toBeGreaterThanOrEqual(1);
  });

  it("clampRect：越界与非法值归位", () => {
    expect(clampRect({ x: -50, y: -10, w: 2000, h: 100 })).toEqual({ x: 0, y: 0, w: 1280, h: 100 });
    // y 越界 clamp；x 在范围内保持
    expect(clampRect({ x: 1000, y: 700, w: 100, h: 100 })).toEqual({ x: 1000, y: 620, w: 100, h: 100 });
  });

  it("clampedRectField：属性面板单字段 clamp（x 不越过 1280-w）", () => {
    const rect = { x: 100, y: 100, w: 200, h: 100 };
    expect(clampedRectField(rect, "x", 99999)).toEqual({ x: 1080, y: 100, w: 200, h: 100 });
    expect(clampedRectField(rect, "y", -5)).toEqual({ x: 100, y: 0, w: 200, h: 100 });
    expect(clampedRectField(rect, "w", 99999)).toEqual({ x: 100, y: 100, w: 1180, h: 100 });
    expect(clampedRectField(rect, "h", 0)).toEqual({ x: 100, y: 100, w: 200, h: 1 });
  });
});
