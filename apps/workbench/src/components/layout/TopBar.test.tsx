import { render, screen } from "@testing-library/react";
import { TopBar, type TopBarProps } from "./TopBar";

const noop = () => {};

const BASE_PROPS: TopBarProps = {
  projectName: "响应式工作台",
  documentName: "一份需要在窄屏仍可操作的文档",
  dirty: true,
  saving: false,
  error: "保存失败：服务端返回了一个很长的错误原因，应该完整换行展示。",
  canUndo: true,
  canRedo: true,
  onUndo: noop,
  onRedo: noop,
  onDocumentNameChange: noop,
  onSave: noop,
  onBack: noop,
  onOpenSettings: noop,
  onOpenPalette: noop,
};

describe("TopBar 窄屏布局", () => {
  it.each([320, 360])(
    "%ipx 时把动作行放到身份行下方，并保留所有入口与状态",
    (width) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      render(<TopBar {...BASE_PROPS} />);

      expect(screen.getByRole("banner")).toBeInTheDocument();
      expect(screen.getByTestId("topbar-main-row")).toHaveClass("min-h-12", "flex-wrap");

      const actionRow = screen.getByTestId("topbar-action-row");
      expect(actionRow).toHaveClass("basis-full", "max-w-full", "flex-wrap", "md:basis-auto");

      expect(screen.getByRole("button", { name: "返回项目列表" })).toBeInTheDocument();
      expect(screen.getByLabelText("文档名称")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "命令面板" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重做" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /主题：/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("未保存更改");
      expect(screen.getByRole("alert")).toHaveTextContent(BASE_PROPS.error!);
    },
  );
});
