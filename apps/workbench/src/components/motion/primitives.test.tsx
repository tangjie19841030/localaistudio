import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Collapse,
  DrawerPanel,
  ModalSurface,
  OverlayBackdrop,
  PageShell,
  Presence,
  RevealItem,
} from "./primitives";
import {
  STAGGER_CAP,
  modalSurfaceVariants,
  paletteSurfaceVariants,
  staggerDelay,
} from "./presets";

describe("motion presets", () => {
  it("居中模态隐藏态为 scale 0.96 + y 6，命令面板更轻（0.98 / -4）", () => {
    expect(modalSurfaceVariants.hidden).toMatchObject({ opacity: 0, scale: 0.96, y: 6 });
    expect(modalSurfaceVariants.visible).toMatchObject({ opacity: 1, scale: 1, y: 0 });
    expect(paletteSurfaceVariants.hidden).toMatchObject({ scale: 0.98, y: -4 });
  });

  it("stagger 延迟在 6 项后截断", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBeCloseTo(0.06);
    expect(staggerDelay(STAGGER_CAP)).toBeCloseTo(0.12);
    expect(staggerDelay(50)).toBe(staggerDelay(STAGGER_CAP));
  });
});

describe("Presence", () => {
  it("when=false 不渲染，when=true 渲染子节点（jsdom mock 下同步挂载/卸载）", () => {
    const { rerender, container } = render(
      <Presence when={false}>
        <div>抽屉内容</div>
      </Presence>,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <Presence when={true}>
        <div>抽屉内容</div>
      </Presence>,
    );
    expect(screen.getByText("抽屉内容")).toBeInTheDocument();
    rerender(<Presence when={false}>抽屉内容</Presence>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("OverlayBackdrop / ModalSurface / DrawerPanel", () => {
  it("遮罩随 open 挂载，面板内容与点击回调透传", () => {
    const onBackdropClick = () => {};
    const { rerender } = render(
      <OverlayBackdrop open z="z-50" className="bg-black/40" onBackdropClick={onBackdropClick}>
        <ModalSurface>设置内容</ModalSurface>
      </OverlayBackdrop>,
    );
    expect(screen.getByText("设置内容")).toBeInTheDocument();
    expect(screen.getByText("设置内容").parentElement).toHaveClass("fixed", "inset-0", "z-50");
    rerender(<OverlayBackdrop open={false} z="z-50" />);
    // mock 下 AnimatePresence 直通，关闭即卸载
    expect(screen.queryByText("设置内容")).not.toBeInTheDocument();
  });

  it("DrawerPanel 按 side 注入滑动方向 CSS 变量并透传 class", () => {
    const { container, rerender } = render(
      <DrawerPanel side="left" className="bg-rail">
        左抽屉
      </DrawerPanel>,
    );
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside).toHaveClass("bg-rail");
    expect((aside as HTMLElement).style.getPropertyValue("--drawer-from")).toBe("-100%");
    rerender(<DrawerPanel side="right">右抽屉</DrawerPanel>);
    expect((container.querySelector("aside") as HTMLElement).style.getPropertyValue("--drawer-from")).toBe("100%");
  });
});

describe("Collapse", () => {
  it("open 切换决定内容挂载，容器带 overflow-hidden", () => {
    const { rerender, container } = render(
      <Collapse open={true} className="pt-1">
        <p>折叠内容</p>
      </Collapse>,
    );
    expect(screen.getByText("折叠内容")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("overflow-hidden", "pt-1");
    rerender(<Collapse open={false} />);
    expect(screen.queryByText("折叠内容")).not.toBeInTheDocument();
  });
});

describe("RevealItem", () => {
  it("渲染 li 并透传 className/index custom", () => {
    render(
      <ul>
        <RevealItem index={2} variant="rise" className="row">
          版本一
        </RevealItem>
      </ul>,
    );
    const li = screen.getByRole("listitem");
    expect(li).toHaveTextContent("版本一");
    expect(li).toHaveClass("row");
  });
});

describe("PageShell", () => {
  it("按 pageKey 渲染当前页内容", () => {
    const { rerender } = render(<PageShell pageKey="home">首页</PageShell>);
    expect(screen.getByText("首页")).toBeInTheDocument();
    rerender(<PageShell pageKey="project:1">工作台</PageShell>);
    expect(screen.queryByText("首页")).not.toBeInTheDocument();
    expect(screen.getByText("工作台")).toBeInTheDocument();
  });
});
