import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlignMode, DistributeMode } from "./alignOps";
import { AlignBar } from "./AlignBar";

/**
 * AlignBar jsdom wiring (Q1 minimal set): the bar renders the six align
 * actions with accessible names, gates the distribute/group/ungroup entries
 * behind their availability flags, and routes every click to the matching
 * callback. Geometry itself is covered by align-ops.test.ts (pure functions).
 */

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof AlignBar>[0]> = {}) {
  const onAlign = vi.fn<(mode: AlignMode) => void>();
  const onDistribute = vi.fn<(mode: DistributeMode) => void>();
  const onGroup = vi.fn();
  const onUngroup = vi.fn();
  const props = {
    canDistribute: true,
    canGroup: true,
    canUngroup: true,
    onAlign,
    onDistribute,
    onGroup,
    onUngroup,
    ...over,
  };
  render(<AlignBar {...props} />);
  return { onAlign, onDistribute, onGroup, onUngroup };
}

describe("AlignBar 渲染与无障碍", () => {
  it("工具条容器 role=toolbar + aria-label，包含六个对齐按钮", () => {
    setup();
    const bar = screen.getByTestId("canvas-align-bar");
    expect(bar).toHaveAttribute("role", "toolbar");
    expect(bar).toHaveAttribute("aria-label", "对齐与编组");
    for (const label of ["左对齐", "水平居中", "右对齐", "上对齐", "垂直居中", "下对齐"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("分布与编组入口存在（横向/纵向分布、编组、解组）", () => {
    setup();
    expect(screen.getByRole("button", { name: "横向分布" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "纵向分布" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "编组" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "解组" })).toBeTruthy();
  });

  it("canDistribute=false 禁用两个分布按钮；可用时启用", () => {
    setup({ canDistribute: false });
    expect((screen.getByRole("button", { name: "横向分布" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "纵向分布" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    setup({ canDistribute: true });
    expect((screen.getByRole("button", { name: "横向分布" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("canGroup/canUngroup 分别门控编组与解组按钮", () => {
    setup({ canGroup: false, canUngroup: false });
    expect((screen.getByRole("button", { name: "编组" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "解组" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AlignBar 点击回调路由", () => {
  it("六个对齐按钮分别以对应 mode 调 onAlign（每键一次）", () => {
    const { onAlign } = setup();
    const cases: [string, AlignMode][] = [
      ["左对齐", "left"],
      ["水平居中", "center-x"],
      ["右对齐", "right"],
      ["上对齐", "top"],
      ["垂直居中", "center-y"],
      ["下对齐", "bottom"],
    ];
    for (const [label, mode] of cases) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(onAlign).toHaveBeenCalledTimes(1);
      expect(onAlign).toHaveBeenLastCalledWith(mode);
      onAlign.mockClear();
    }
    expect(onAlign).not.toHaveBeenCalled();
  });

  it("分布按钮把 horizontal/vertical 传给 onDistribute", () => {
    const { onDistribute } = setup();
    fireEvent.click(screen.getByRole("button", { name: "横向分布" }));
    fireEvent.click(screen.getByRole("button", { name: "纵向分布" }));
    expect(onDistribute).toHaveBeenNthCalledWith(1, "horizontal");
    expect(onDistribute).toHaveBeenNthCalledWith(2, "vertical");
  });

  it("编组/解组点击走 onGroup/onUngroup（无参回调）", () => {
    const { onGroup, onUngroup } = setup();
    fireEvent.click(screen.getByRole("button", { name: "编组" }));
    fireEvent.click(screen.getByRole("button", { name: "解组" }));
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(onUngroup).toHaveBeenCalledTimes(1);
  });
});
