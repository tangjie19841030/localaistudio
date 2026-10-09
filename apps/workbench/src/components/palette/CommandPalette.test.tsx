import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("open=false 不渲染", () => {
    const { container } = render(
      <CommandPalette open={false} onClose={() => {}} commands={[]} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("过滤命令；Enter 执行高亮项并关闭", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={[
          { id: "a", title: "保存文档", group: "文档", run },
          { id: "b", title: "插入 卡片", group: "插入", run: () => {} },
        ]}
      />,
    );
    const input = screen.getByLabelText("搜索命令");
    await user.type(input, "保存");
    expect(screen.getByRole("option", { name: /保存文档/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /插入 卡片/ })).toBeNull();
    await user.keyboard("{Enter}");
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc 关闭（焦点在搜索框时）", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={[]} />);
    screen.getByLabelText("搜索命令").focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
