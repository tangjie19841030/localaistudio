import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultTokens, setSvgParser, type NodeRecord, type Page } from "@studio/schema-core";
import { afterEach, describe, expect, it } from "vitest";
import { useCodegenStore } from "../state/codegenStore";
import { PreviewSurface } from "./PreviewSurface";
import { ViewportStrip } from "./ViewportStrip";

// jsdom has no global SvgBox parser binding (main.tsx owns the app binding).
setSvgParser((s: string) => new DOMParser().parseFromString(s, "image/svg+xml").documentElement);

afterEach(() => {
  cleanup();
  useCodegenStore.setState({ previewState: "idle", previewPort: null });
});

/** Build a page from a node table; ids are referenced by children arrays. */
function docFrom(rootId: string, nodes: NodeRecord[]): Page {
  return { id: "page-1", name: "测试页", rootId, nodes };
}

/** W4-A parity fixture: Grid columns base 3 / tablet 2 / mobile 1 (same shape
 *  as preview.test.tsx breakpoint suite). */
const bpDoc = (): Page =>
  docFrom("root", [
    { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["grid-1", "btn"] },
    {
      id: "grid-1",
      type: "Grid",
      props: { columns: 3, gap: 4 },
      children: ["card-1"],
      breakpoints: { tablet: { columns: 2 }, mobile: { columns: 1 } },
    },
    { id: "card-1", type: "Card", props: { title: "格内", padded: true }, children: [] },
    { id: "btn", type: "Button", props: { label: "新建活动", variant: "primary", size: "md" }, children: [] },
  ]);

const MODE_PROPS = {
  projectId: "00000000-0000-4000-8000-000000000000",
  mode: "schema" as const,
  onModeChange: () => {},
};

describe("ViewportStrip B1：三列渲染同一 doc", () => {
  it("三个 pane（desktop/tablet/mobile）各带 testid、label 与 DEVICE_PAGE 宽度", () => {
    render(<ViewportStrip page={bpDoc()} tokens={defaultTokens()} />);
    const desktop = screen.getByTestId("viewport-pane-desktop");
    const tablet = screen.getByTestId("viewport-pane-tablet");
    const mobile = screen.getByTestId("viewport-pane-mobile");
    expect(desktop).toHaveTextContent("桌面 1440px");
    expect(tablet).toHaveTextContent("平板 1024px");
    expect(mobile).toHaveTextContent("手机 390px");
    // Same document renders in all three columns: three copies of its content.
    expect(screen.getAllByText("格内")).toHaveLength(3);
    // Every column carries a Grid, and each paper keeps the true preset
    // viewport width before scaling (mobile paper is exactly 390px).
    expect(desktop.querySelector('[data-component="Grid"]')).not.toBeNull();
    expect(tablet.querySelector('[data-component="Grid"]')).not.toBeNull();
    expect(mobile.querySelector('[data-component="Grid"]')).not.toBeNull();
    expect(mobile.querySelector('[data-testid="viewport-paper"]') as HTMLElement).toHaveStyle({ width: "390px" });
  });
});

describe("ViewportStrip B2：各列按自身 viewport 解析断点", () => {
  const gridIn = (name: string) =>
    screen.getByTestId(`viewport-pane-${name}`).querySelector('[data-component="Grid"]') as HTMLElement;

  it("desktop=3 列 / tablet=2 列 / mobile=1 列（W4-A overlay 逐列生效）", () => {
    render(<ViewportStrip page={bpDoc()} tokens={defaultTokens()} />);
    expect(gridIn("desktop").style.gridTemplateColumns).toBe("repeat(3, minmax(0,1fr))");
    expect(gridIn("tablet").style.gridTemplateColumns).toBe("repeat(2, minmax(0,1fr))");
    expect(gridIn("mobile").style.gridTemplateColumns).toBe("repeat(1, minmax(0,1fr))");
  });
});

describe("ViewportStrip B3：只读（selectedId=null，列内无编辑入口）", () => {
  it("点击任何节点都不产生选中标记，且列内无 input/textarea/contenteditable", () => {
    render(<ViewportStrip page={bpDoc()} tokens={defaultTokens()} />);
    const strip = screen.getByTestId("viewport-strip");
    const wrappers = Array.from(strip.querySelectorAll("[data-node-id]"));
    expect(wrappers.length).toBeGreaterThan(0);
    for (const w of wrappers) {
      fireEvent.click(w);
      expect((w as HTMLElement).className).not.toContain("outline");
    }
    // No editing chrome inside the strip (document-rendered buttons are content,
    // not editor entries — form/editable fields are the edit-entry surface).
    expect(strip.querySelectorAll('input, textarea, [contenteditable="true"]')).toHaveLength(0);
  });
});

describe("PreviewSurface B4：单视口/三视口切换", () => {
  const surface = (mode: "schema" | "project" | "canvas" = "schema", onModeChange = () => {}) =>
    render(
      <PreviewSurface
        tokens={defaultTokens()}
        doc={bpDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="mobile"
        onViewportChange={() => {}}
        mode={mode}
        onModeChange={onModeChange}
        projectId={MODE_PROPS.projectId}
      />,
    );

  it("默认单列；切到三视口后 strip 替换 preview-frame，互斥可来回切", async () => {
    const user = userEvent.setup();
    surface();
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("viewport-strip")).toBeNull();

    await user.click(screen.getByRole("button", { name: "三视口" }));
    expect(screen.queryByTestId("preview-frame")).toBeNull();
    expect(screen.getByTestId("viewport-strip")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "单视口" }));
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("viewport-strip")).toBeNull();
  });

  it("切到 project/canvas 模式不渲染 strip，原分支行为不变（strip 仅属 schema 分支）", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PreviewSurface
        tokens={defaultTokens()}
        doc={bpDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="mobile"
        onViewportChange={() => {}}
        mode="schema"
        onModeChange={() => {}}
        projectId={MODE_PROPS.projectId}
      />,
    );
    await user.click(screen.getByRole("button", { name: "三视口" }));
    expect(screen.getByTestId("viewport-strip")).toBeInTheDocument();

    // project branch: exactly one iframe shell, no strip
    useCodegenStore.setState({ previewState: "running", previewPort: 4173 });
    rerender(
      <PreviewSurface
        tokens={defaultTokens()}
        doc={bpDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="mobile"
        onViewportChange={() => {}}
        mode="project"
        onModeChange={() => {}}
        projectId={MODE_PROPS.projectId}
      />,
    );
    expect(screen.queryByTestId("viewport-strip")).toBeNull();
    expect(screen.getAllByTestId("project-preview-shell")).toHaveLength(1);

    // canvas branch: canvas surface only
    rerender(
      <PreviewSurface
        tokens={defaultTokens()}
        doc={bpDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="mobile"
        onViewportChange={() => {}}
        mode="canvas"
        onModeChange={() => {}}
        projectId={MODE_PROPS.projectId}
      />,
    );
    expect(screen.queryByTestId("viewport-strip")).toBeNull();
    expect(screen.getByTestId("canvas-surface")).toBeInTheDocument();
  });
});
