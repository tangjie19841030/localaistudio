import { describe, expect, it } from "vitest";
import {
  angleBetween,
  normalizeRotation,
  rotationFromGesture,
  snappedAngle,
} from "./frameRotation";

/**
 * §5 用例 C：旋转纯几何。四象限角度、15° 吸附、[0,360) 归一、手势组合。
 */

describe("frameRotation（T13 · C）", () => {
  it("C1 角度四象限：右 0、下 90、左 ±180、上 -90（屏幕顺时针为正）", () => {
    const c = { x: 0, y: 0 };
    expect(angleBetween(c, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(angleBetween(c, { x: 0, y: 10 })).toBeCloseTo(90);
    expect(angleBetween(c, { x: -10, y: 0 })).toBeCloseTo(180);
    expect(angleBetween(c, { x: 0, y: -10 })).toBeCloseTo(-90);
    // 偏移中心：指针在中心左下方 → 第三象限（90~180 之间）
    expect(angleBetween({ x: 100, y: 100 }, { x: 90, y: 110 })).toBeCloseTo(135);
  });

  it("C2 15° 吸附：14.9→15、-7→0、376/360 边界由归一兜底", () => {
    expect(snappedAngle(14.9)).toBe(15);
    expect(snappedAngle(-7)).toBe(0);
    expect(snappedAngle(22.4)).toBe(15);
    expect(snappedAngle(22.6)).toBe(30);
    // 自定义步长 & 非法输入回退
    expect(snappedAngle(50, 45)).toBe(45);
    expect(snappedAngle(NaN)).toBe(NaN);
    expect(snappedAngle(10, 0)).toBe(10);
  });

  it("C3 归一化：-10→350、370→10、360→0、720→0，非有限回 0", () => {
    expect(normalizeRotation(-10)).toBe(350);
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(720)).toBe(0);
    expect(normalizeRotation(-360)).toBe(0);
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(Infinity)).toBe(0);
  });

  it("C4 手势 base+swept：顺扫加角、逆扫减角、Shift 吸附、结果落在 [0,360)", () => {
    // 起点 0°，指针扫到 30°，base 10 → 40
    expect(rotationFromGesture(0, 30, 10, false)).toBe(40);
    // 逆扫：起点 30° → 当前 -20°，swept = -50，base 10 → -40 → 归一 320
    expect(rotationFromGesture(30, -20, 10, false)).toBe(320);
    // 继续逆扫到 -80°：swept = -110，base 10 → -100 → 归一 260
    expect(rotationFromGesture(30, -80, 10, false)).toBe(260);
    // Shift 吸附在组合之后：base 0 + swept 44.9 → 45
    expect(rotationFromGesture(0, 44.9, 0, true)).toBe(45);
    // 不吸附时同一采样保留小数
    expect(rotationFromGesture(0, 44.9, 0, false)).toBeCloseTo(44.9);
  });
});
