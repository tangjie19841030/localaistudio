import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BottomDock } from "./BottomDock";

const LABELS = ["Diff", "运行日志", "本地质检", "版本历史"] as const;

describe("BottomDock 无障碍页签模式", () => {
  it("tab 与 tabpanel 通过 id/aria 双向关联", () => {
    render(<BottomDock versionPanel={<div>版本面板</div>} />);
    const diff = screen.getByRole("tab", { name: "Diff" });
    expect(diff).toHaveAttribute("id", "dock-tab-diff");
    expect(diff).toHaveAttribute("aria-controls", "dock-panel-diff");

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "dock-panel-diff");
    expect(panel).toHaveAttribute("aria-labelledby", "dock-tab-diff");
    expect(panel).toHaveAttribute("tabindex", "0");
  });

  it("roving tabindex：仅选中页签可 Tab 聚焦", () => {
    render(<BottomDock versionPanel={<div>版本面板</div>} />);
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("tabindex", "0");
    for (const label of ["运行日志", "本地质检", "版本历史"]) {
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("tabindex", "-1");
    }
  });

  it("方向键切换页签并移动焦点（含环绕）", async () => {
    const user = userEvent.setup();
    render(<BottomDock versionPanel={<div data-testid="version-body">版本面板</div>} />);
    const first = screen.getByRole("tab", { name: "Diff" });
    first.focus();

    await user.keyboard("{ArrowRight}");
    const logs = screen.getByRole("tab", { name: "运行日志" });
    expect(logs).toHaveFocus();
    expect(logs).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "dock-panel-logs");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("aria-selected", "true");

    // 左环绕：第一个 -> 最后一个
    await user.keyboard("{ArrowLeft}");
    const last = screen.getByRole("tab", { name: "版本历史" });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("version-body")).toBeInTheDocument();

    // 右环绕：最后一个 -> 第一个
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveFocus();
  });

  it("Home/End 跳到首尾页签", async () => {
    const user = userEvent.setup();
    render(<BottomDock versionPanel={<div>版本面板</div>} />);
    screen.getByRole("tab", { name: "Diff" }).focus();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "版本历史" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "版本历史" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("aria-selected", "true");
  });

  it("任一时刻只有一个 tabpanel，且四个页签均可点击选中", async () => {
    const user = userEvent.setup();
    render(<BottomDock versionPanel={<div>版本面板</div>} />);
    for (const label of LABELS) {
      await user.click(screen.getByRole("tab", { name: label }));
      expect(screen.getByRole("tab", { name: label, selected: true })).toBeInTheDocument();
      expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    }
  });

  it("tabpanel 内部滚动，避免内容溢出遮挡下方区域", () => {
    render(<BottomDock versionPanel={<div>版本面板</div>} />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.className).toContain("min-h-0");
    expect(panel.className).toContain("overflow-y-auto");
  });
});

describe("BottomDock visualPanel 插槽", () => {
  it("注入 visualPanel 时在本地质检页渲染", async () => {
    const user = userEvent.setup();
    render(
      <BottomDock
        versionPanel={<div>版本面板</div>}
        visualPanel={<div data-testid="injected-visual-panel">本地质检内容</div>}
      />,
    );
    expect(screen.queryByTestId("injected-visual-panel")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "本地质检" }));
    expect(screen.getByTestId("injected-visual-panel")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "dock-panel-shots");
  });

  it("未注入 visualPanel 时本地质检页回退到占位文案", async () => {
    const user = userEvent.setup();
    render(<BottomDock versionPanel={<div>版本面板</div>} />);
    await user.click(screen.getByRole("tab", { name: "本地质检" }));
    expect(screen.getByText(/将在对应阶段接入/)).toBeInTheDocument();
  });

  it("visualPanel 不影响运行日志页", async () => {
    const user = userEvent.setup();
    render(
      <BottomDock
        versionPanel={<div>版本面板</div>}
        visualPanel={<div data-testid="injected-visual-panel">本地质检内容</div>}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "运行日志" }));
    expect(screen.queryByTestId("injected-visual-panel")).toBeNull();
    expect(screen.getByText(/暂无运行日志/)).toBeInTheDocument();
  });
});
