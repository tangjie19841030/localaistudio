import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  defaultStudioDocument,
  defaultTokens,
  frameStyleSource,
  setSvgParser,
  type Frame,
  type NodeRecord,
  type Page,
} from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCodegenStore } from "../state/codegenStore";
import { useEditorStore } from "../state/editorStore";
import { ProjectPreview } from "./ProjectPreview";
import { PreviewSurface } from "./PreviewSurface";
import { SchemaRenderer } from "./SchemaRenderer";

// W5: the jsdom test env has no global SvgBox parser binding (main.tsx owns the
// app binding) — bind the DOMParser adapter once for this suite.
setSvgParser((s) => new DOMParser().parseFromString(s, "image/svg+xml").documentElement);

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

afterEach(cleanup);

/** Build a doc from a node table; ids are referenced by children arrays. */
function docFrom(rootId: string, nodes: NodeRecord[]): Page {
  return { id: "page-1", name: "测试页", rootId, nodes };
}

const shellDoc = (): Page =>
  docFrom("shell", [
    { id: "shell", type: "AppShell", props: { title: "运营台", sidebar: false }, children: ["head", "sec"] },
    { id: "head", type: "Header", props: { title: "页面标题", subtitle: "" }, children: [] },
    { id: "sec", type: "Section", props: { title: "区块标题", description: "" }, children: ["stat", "btn"] },
    { id: "stat", type: "StatCard", props: { label: "GMV", value: "1,200", delta: "+12%", tone: "brand" }, children: [] },
    { id: "btn", type: "Button", props: { label: "新建活动", variant: "primary", size: "md" }, children: [] },


  ]);

/** P3-4: mode props default for schema-preview assertions. */
const MODE_PROPS = {
  projectId: "00000000-0000-4000-8000-000000000000",
  mode: "schema" as const,
  onModeChange: () => {},
};

describe("SchemaRenderer", () => {
  it("渲染 kit 组件文本：Header 标题、StatCard label/value、Button label", () => {
    render(<SchemaRenderer tokens={defaultTokens()} doc={shellDoc()} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole("heading", { name: "页面标题" })).toBeInTheDocument();
    expect(screen.getByText("GMV")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建活动" })).toBeInTheDocument();
  });

  it("AppShell 根节点注入 tokens（CSS 变量出现在 AppShell 根元素 style 上）", () => {
    render(<SchemaRenderer tokens={defaultTokens()} doc={shellDoc()} selectedId={null} onSelect={() => {}} />);
    const shell = document.querySelector('[data-node-id="shell"]') as HTMLElement;
    expect(shell).not.toBeNull();
    const appRoot = shell.querySelector('[data-component="AppShell"]') as HTMLElement;
    expect(appRoot.style.getPropertyValue("--studio-color-brand")).toBe(defaultTokens().color.brand);
  });

  it("非 AppShell 根也注入 tokens CSS 变量（外层包裹 div）", () => {
    const doc = docFrom("card", [
      { id: "card", type: "Card", props: { title: "卡", padded: true }, children: [] },
    ]);
    render(<SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId={null} onSelect={() => {}} />);
    const card = document.querySelector('[data-node-id="card"]') as HTMLElement;
    // walk up until an ancestor carries the css vars
    let el: HTMLElement | null = card;
    let found = "";
    while (el && !found) {
      found = el.style.getPropertyValue("--studio-color-brand");
      el = el.parentElement;
    }
    expect(found).toBe(defaultTokens().color.brand);
  });

  it("点击 StatCard 命中最近的 data-node-id 并回调该节点 id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SchemaRenderer tokens={defaultTokens()} doc={shellDoc()} selectedId={null} onSelect={onSelect} />);
    await user.click(screen.getByText("GMV"));
    expect(onSelect).toHaveBeenCalledWith("stat");
  });

  it("未知 type 渲染灰色占位不抛错", () => {
    const doc = docFrom("ghost-root", [
      { id: "ghost-root", type: "Mystery", props: {}, children: [] },
    ]);
    render(<SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/未知组件 Mystery/)).toBeInTheDocument();
  });

  it("选中节点带视觉标记（描边类）", () => {
    render(<SchemaRenderer tokens={defaultTokens()} doc={shellDoc()} selectedId="stat" onSelect={() => {}} />);
    const stat = document.querySelector('[data-node-id="stat"]') as HTMLElement;
    expect(stat.className).toContain("outline");
  });
});

describe("PreviewSurface", () => {
  it("视口切换按钮 aria-pressed 反映当前档位；宽度切到档位值", async () => {
    const user = userEvent.setup();
    const onViewportChange = vi.fn();
    render(
      <PreviewSurface tokens={defaultTokens()}
        doc={shellDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="desktop"
        onViewportChange={onViewportChange}
        {...MODE_PROPS}
      />,
    );
    const desktop = screen.getByRole("button", { name: "桌面" });
    const tablet = screen.getByRole("button", { name: "平板" });
    const mobile = screen.getByRole("button", { name: "手机" });
    expect(desktop).toHaveAttribute("aria-pressed", "true");
    expect(tablet).toHaveAttribute("aria-pressed", "false");

    await user.click(tablet);
    expect(onViewportChange).toHaveBeenCalledWith("tablet");

    // width applies when the controlled viewport prop changes
    cleanup();
    render(
      <PreviewSurface tokens={defaultTokens()}
        doc={shellDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="tablet"
        onViewportChange={onViewportChange}
        {...MODE_PROPS}
      />,
    );
    expect(screen.getByTestId("preview-frame")).toHaveStyle({ width: "1024px" });
  });

  it("点击预览内组件透传 onSelect", () => {
    const onSelect = vi.fn();
    render(
      <PreviewSurface tokens={defaultTokens()}
        doc={shellDoc()}
        selectedId={null}
        onSelect={onSelect}
        viewport="mobile"
        onViewportChange={() => {}}
        {...MODE_PROPS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新建活动" }));
    expect(onSelect).toHaveBeenCalledWith("btn");
  });
});

describe("ProjectPreview 视口联动", () => {
  it("运行中的 iframe 壳按设备档位收窄（手机 390 / 桌面 1440）", () => {
    useCodegenStore.setState({ previewState: "running", previewPort: 4173 });
    const { rerender } = render(<ProjectPreview projectId="p1" viewport="mobile" />);
    expect(screen.getByTestId("project-preview-shell")).toHaveStyle({ width: "390px" });

    rerender(<ProjectPreview projectId="p1" viewport="desktop" />);
    expect(screen.getByTestId("project-preview-shell")).toHaveStyle({ width: "1440px" });
    useCodegenStore.setState({ previewState: "idle", previewPort: null });
  });
});

describe("SchemaRenderer pin 渲染（三视图像素级一致）", () => {
  const FRAME: Frame = { x: 120, y: 64, w: 320, h: 180, rotation: 0 };

  /** Codegen's frame style (emitters.frameStyleSource) parsed into the CSS
   *  values React applies: numeric literals become px, strings verbatim. */
  function codegenStyle(frame: Frame): Record<string, string> {
    const src = frameStyleSource(frame, 0, 0);
    const body = src.slice(src.indexOf("{") + 1, src.lastIndexOf("}"));
    const out: Record<string, string> = {};
    for (const part of body.split(",")) {
      // CSS body always carries "prop: value" — both halves exist (strict
      // noUncheckedIndexedAccess needs the assertions).
      const [k, v] = part.split(":").map((s) => s.trim()) as [string, string];
      const key = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      out[key] = v.startsWith('"') ? v.slice(1, -1) : `${v}px`;
    }
    return out;
  }

  const pinnedDoc = (frame: Frame): Page =>
    docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["pin"] },
      { id: "pin", type: "Card", props: { title: "钉住" }, children: [], pinned: true, frame },
    ]);

  it("pinned && frame 节点渲染 absolute wrapper，定位样式与 codegen 等价", () => {
    render(<SchemaRenderer tokens={defaultTokens()} doc={pinnedDoc(FRAME)} selectedId={null} onSelect={() => {}} />);
    const wrapper = document.querySelector('[data-studio-id="pin"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    const expected = codegenStyle(FRAME);
    expect(wrapper.style.position).toBe(expected.position);
    expect(wrapper.style.left).toBe(expected.left);
    expect(wrapper.style.top).toBe(expected.top);
    expect(wrapper.style.width).toBe(expected.width);
    expect(wrapper.style.height).toBe(expected.height);
    expect(wrapper.style.transform).toBe("");
    // containing block: the page root is positioned (codegen relativeRootWrap)
    const pageRoot = document.querySelector(".min-h-full") as HTMLElement;
    expect(pageRoot.style.position).toBe("relative");
  });

  it("rotation 非 0 时 transform 与 codegen 一致", () => {
    const frame: Frame = { ...FRAME, rotation: 30 };
    render(<SchemaRenderer tokens={defaultTokens()} doc={pinnedDoc(frame)} selectedId={null} onSelect={() => {}} />);
    const wrapper = document.querySelector('[data-studio-id="pin"]') as HTMLElement;
    expect(wrapper.style.transform).toBe(codegenStyle(frame).transform);
  });

  it("未 pin 的 frame 节点走原流程，不生成 absolute wrapper", () => {
    const doc = docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["flow"] },
      { id: "flow", type: "Card", props: { title: "流" }, children: [], frame: FRAME },
    ]);
    render(<SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId={null} onSelect={() => {}} />);
    expect(document.querySelector('[data-studio-id="flow"]')).toBeNull();
    const pageRoot = document.querySelector(".min-h-full") as HTMLElement;
    expect(pageRoot.style.position).toBe("");
  });
});

/**
 * W3-A mirror of packages/schema-core/test/codegen-nav.test.ts: the SAME
 * fixture shape (page 首页 with a Button whose action targets page-2, page 关于)
 * asserted on the renderer side. codegen must emit
 * `window.location.hash = "#/关于"` for that node; here the click must call
 * onNavigate("page-2") — one contract, two sides.
 */
describe("SchemaRenderer W3-A：action 点击 → onNavigate", () => {
  const navDoc = (): Page =>
    docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["go", "plain"] },
      {
        id: "go",
        type: "Button",
        props: { label: "去关于页", variant: "primary", size: "md" },
        children: [],
        action: { type: "navigate", pageId: "page-2" },
      },
      { id: "plain", type: "Button", props: { label: "普通按钮", variant: "secondary", size: "md" }, children: [] },
    ]);

  it("带 action 的节点点击只调 onNavigate(pageId)，不调 onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onNavigate = vi.fn();
    render(
      <SchemaRenderer
        tokens={defaultTokens()}
        doc={navDoc()}
        selectedId={null}
        onSelect={onSelect}
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "去关于页" }));
    expect(onNavigate).toHaveBeenCalledWith("page-2");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("无 action 的节点点击仍走 onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onNavigate = vi.fn();
    render(
      <SchemaRenderer
        tokens={defaultTokens()}
        doc={navDoc()}
        selectedId={null}
        onSelect={onSelect}
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "普通按钮" }));
    expect(onSelect).toHaveBeenCalledWith("plain");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("未传 onNavigate 时 action 点击退化为 onSelect，不抛错", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SchemaRenderer tokens={defaultTokens()} doc={navDoc()} selectedId={null} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "去关于页" }));
    expect(onSelect).toHaveBeenCalledWith("go");
  });
});

describe("PreviewSurface W3-A：schema 分支接 setActivePage", () => {
  it("点击带 action 的节点切换 editorStore.activePageId", () => {
    const doc = docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["go"] },
      {
        id: "go",
        type: "Button",
        props: { label: "去关于页", variant: "primary", size: "md" },
        children: [],
        action: { type: "navigate", pageId: "page-2" },
      },
    ]);
    const about: Page = { id: "page-2", name: "关于", rootId: "r2", nodes: [{ id: "r2", type: "Container", props: {}, children: [] }] };
    useEditorStore.setState({
      document: { documentVersion: 2, name: "导航演示", tokens: defaultTokens(), pages: [doc, about] },
      activePageId: "page-1",
      selectedId: null,
    });
    render(
      <PreviewSurface tokens={defaultTokens()}
        doc={doc}
        selectedId={null}
        onSelect={() => {}}
        viewport="desktop"
        onViewportChange={() => {}}
        {...MODE_PROPS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "去关于页" }));
    expect(useEditorStore.getState().activePageId).toBe("page-2");
    useEditorStore.setState({ document: null, activePageId: null });
  });
});

describe("SchemaRenderer 回归（E2E 发现的崩溃）", () => {
  it("非根位置的 AppShell 也注入 tokens，不崩溃", () => {
    // 根是 Container，AppShell 挂在它下面——renderKitNode 曾只给根 AppShell 传 tokens
    const doc = docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["shell"] },
      { id: "shell", type: "AppShell", props: { title: "内嵌外壳", sidebar: false }, children: [] },
    ]);
    render(<SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId="shell" onSelect={() => {}} />);
    expect(screen.getByText("内嵌外壳")).toBeInTheDocument();
    const shell = document.querySelector('[data-node-id="shell"]') as HTMLElement;
    const appRoot = shell.querySelector('[data-component="AppShell"]') as HTMLElement;
    expect(appRoot.style.getPropertyValue("--studio-color-brand")).toBe(defaultTokens().color.brand);
  });

  it("子节点渲染不产生 React key 警告", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SchemaRenderer tokens={defaultTokens()} doc={shellDoc()} selectedId={null} onSelect={() => {}} />);
    const keyWarnings = spy.mock.calls.filter((c) => String(c[0]).includes("unique \"key\" prop"));
    expect(keyWarnings).toEqual([]);
    spy.mockRestore();
  });
});

/**
 * W4-A mirror of packages/schema-core/test/codegen-breakpoints.test.ts: the
 * SAME parity fixture (Grid columns base 3 / tablet 2 / mobile 1, Stack gap
 * base 4 / mobile 2). P1/P2 assert the identical literal the codegen side
 * asserts — `repeat(2, minmax(0,1fr))` on both sides is the parity lock.
 */
describe("SchemaRenderer W4-A：断点覆盖三视图", () => {
  const bpDoc = (): Page =>
    docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["grid-1", "stack-1"] },
      {
        id: "grid-1",
        type: "Grid",
        props: { columns: 3, gap: 4 },
        children: ["card-1"],
        breakpoints: { tablet: { columns: 2 }, mobile: { columns: 1 } },
      },
      { id: "card-1", type: "Card", props: { title: "格内", padded: true }, children: [] },
      {
        id: "stack-1",
        type: "Stack",
        props: { gap: 4, align: "stretch" },
        children: [],
        breakpoints: { mobile: { gap: 2 } },
      },
    ]);

  const gridEl = () => document.querySelector('[data-component="Grid"]') as HTMLElement;

  it("P3 不传 viewport（默认 desktop）：渲染 base 列数，行为与 W4 前一致", () => {
    render(<SchemaRenderer tokens={defaultTokens()} doc={bpDoc()} selectedId={null} onSelect={() => {}} />);
    expect(gridEl().style.gridTemplateColumns).toBe("repeat(3, minmax(0,1fr))");
    expect(gridEl().style.gap).toBe("16px");
  });

  it("P3 显式 viewport=desktop 与不传等价", () => {
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={bpDoc()} selectedId={null} onSelect={() => {}} viewport="desktop" />,
    );
    expect(gridEl().style.gridTemplateColumns).toBe("repeat(3, minmax(0,1fr))");
  });

  it("P1 viewport=tablet：Grid 解析为 tablet 覆盖（与 codegen CSS 同值字符串）", () => {
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={bpDoc()} selectedId={null} onSelect={() => {}} viewport="tablet" />,
    );
    expect(gridEl().style.gridTemplateColumns).toBe("repeat(2, minmax(0,1fr))");
    // 未被 tablet 覆盖的键保持 base
    expect(gridEl().style.gap).toBe("16px");
  });

  it("P2 viewport=mobile：Grid 1 列 + Stack gap 覆盖生效", () => {
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={bpDoc()} selectedId={null} onSelect={() => {}} viewport="mobile" />,
    );
    expect(gridEl().style.gridTemplateColumns).toBe("repeat(1, minmax(0,1fr))");
    const stack = document.querySelector('[data-component="Stack"]') as HTMLElement;
    expect(stack.style.gap).toBe("8px");
  });

  it("渲染不写回 node.props（store 不可变）", () => {
    const doc = bpDoc();
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId={null} onSelect={() => {}} viewport="mobile" />,
    );
    expect(doc.nodes[1]!.props).toEqual({ columns: 3, gap: 4 });
    expect(doc.nodes[1]!.breakpoints).toEqual({ tablet: { columns: 2 }, mobile: { columns: 1 } });
  });

  it("P4 非白名单键/坏值被静默丢弃，不崩且回落 base", () => {
    const doc = docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["btn"] },
      {
        id: "btn",
        type: "Button",
        props: { label: "按钮", variant: "primary", size: "md" },
        children: [],
        breakpoints: { tablet: { label: "非法" } } as never,
      },
    ]);
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId={null} onSelect={() => {}} viewport="tablet" />,
    );
    expect(screen.getByRole("button", { name: "按钮" })).toBeInTheDocument();
  });

  it("P5 pinned 节点带覆盖：预览仍解析覆盖不崩（校验层负责报互斥）", () => {
    const doc = docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["grid-1"] },
      {
        id: "grid-1",
        type: "Grid",
        props: { columns: 3, gap: 4 },
        children: [],
        breakpoints: { mobile: { columns: 2 } },
        pinned: true,
        frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
      },
    ]);
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId={null} onSelect={() => {}} viewport="mobile" />,
    );
    expect(gridEl().style.gridTemplateColumns).toBe("repeat(2, minmax(0,1fr))");
    expect(document.querySelector('[data-studio-id="grid-1"]')).not.toBeNull();
  });
});

describe("PreviewSurface W4-A：schema 分支透传 viewport", () => {
  const bpDoc = (): Page =>
    docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["grid-1"] },
      {
        id: "grid-1",
        type: "Grid",
        props: { columns: 3, gap: 4 },
        children: [],
        breakpoints: { mobile: { columns: 1 } },
      },
    ]);

  it("viewport=mobile 时 schema 预览按覆盖渲染；切回 desktop 回 base", () => {
    const { rerender } = render(
      <PreviewSurface tokens={defaultTokens()}
        doc={bpDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="mobile"
        onViewportChange={() => {}}
        {...MODE_PROPS}
      />,
    );
    const grid = document.querySelector('[data-component="Grid"]') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(0,1fr))");

    rerender(
      <PreviewSurface tokens={defaultTokens()}
        doc={bpDoc()}
        selectedId={null}
        onSelect={() => {}}
        viewport="desktop"
        onViewportChange={() => {}}
        {...MODE_PROPS}
      />,
    );
    expect((document.querySelector('[data-component="Grid"]') as HTMLElement).style.gridTemplateColumns).toBe(
      "repeat(3, minmax(0,1fr))",
    );
  });
});

describe("PreviewSurface 快捷编辑面板", () => {
  const quickEditDoc = (): Page =>
    docFrom("grid", [
      { id: "grid", type: "Grid", props: { columns: 3, gap: 4 }, children: [] },
    ]);

  function renderSurface(mode: "schema" | "project" | "canvas", selectedId: string | null = "grid") {
    return render(
      <PreviewSurface
        tokens={defaultTokens()}
        doc={quickEditDoc()}
        projectId="00000000-0000-4000-8000-000000000000"
        selectedId={selectedId}
        onSelect={() => {}}
        viewport="desktop"
        onViewportChange={() => {}}
        mode={mode}
        onModeChange={() => {}}
      />,
    );
  }

  it("Schema 单视口选中节点时显示；关闭并清除选中后消失", () => {
    useEditorStore.setState({ selectedId: "grid" });
    const { rerender } = renderSurface("schema");
    expect(screen.getByTestId("node-quick-edit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭快捷编辑" }));
    expect(useEditorStore.getState().selectedId).toBeNull();
    rerender(
      <PreviewSurface
        tokens={defaultTokens()}
        doc={quickEditDoc()}
        projectId="00000000-0000-4000-8000-000000000000"
        selectedId={null}
        onSelect={() => {}}
        viewport="desktop"
        onViewportChange={() => {}}
        mode="schema"
        onModeChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("node-quick-edit")).toBeNull();
    useEditorStore.setState({ selectedId: null });
  });

  it("三视口 strip 不渲染快捷面板", async () => {
    const user = userEvent.setup();
    renderSurface("schema");
    expect(screen.getByTestId("node-quick-edit")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "三视口" }));
    expect(screen.queryByTestId("node-quick-edit")).toBeNull();
  });

  it("project 和 canvas 分支不渲染快捷面板", () => {
    let result = renderSurface("project");
    expect(result.queryByTestId("node-quick-edit")).toBeNull();
    cleanup();
    result = renderSurface("canvas");
    expect(result.queryByTestId("node-quick-edit")).toBeNull();
  });
});

/**
 * W5 SvgBox renderer side of the three-view parity matrix. The codegen twin
 * assertions live in packages/schema-core/test/codegen-svgbox.test.ts — both
 * sides lock the SAME literal substring of serializeSvgElement output (the
 * open tag of the serialized circle) — that shared literal is the parity lock.
 */
describe("SchemaRenderer W5：SvgBox 矢量旁路", () => {
  // Parity fixture: the SAME source string is used by codegen-svgbox.test.ts.
  const SVG_SOURCE =
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  // serializeSvgElement output: viewBox first, remaining attrs in key order.
  const CIRCLE_SUBSTR = '<circle cx="12" cy="12" fill="none" r="10" stroke="currentColor" stroke-width="2"';

  const svgDoc = (props: Record<string, unknown>, extra: Partial<NodeRecord> = {}): Page =>
    docFrom("root", [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: ["svg-1"] },
      { id: "svg-1", type: "SvgBox", props, children: [], ...extra },
    ]);

  const box = () => document.querySelector('[data-component="SvgBox"]') as HTMLElement;

  it("合法 source：innerHTML 注入序列化产物，data-studio-id 指回节点", () => {
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={svgDoc({ source: SVG_SOURCE, alt: "" })} selectedId={null} onSelect={() => {}} />,
    );
    expect(box().getAttribute("data-studio-id")).toBe("svg-1");
    expect(box().innerHTML).toContain(CIRCLE_SUBSTR);
    // whitelist normalization is visible in the DOM: attr order re-sorted
    expect(box().querySelector("circle")?.getAttribute("r")).toBe("10");
  });

  it("parity 锁：DOM 产物与 codegen-svgbox.test 断言同一 serializeSvgElement 子串", () => {
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={svgDoc({ source: SVG_SOURCE, alt: "" })} selectedId={null} onSelect={() => {}} />,
    );
    expect(box().innerHTML).toContain('<svg viewBox="0 0 24 24">');
    expect(box().innerHTML).toContain(CIRCLE_SUBSTR);
  });

  it("非法 source（含 script）：灰占位不崩，不注入 innerHTML", () => {
    render(
      <SchemaRenderer
        tokens={defaultTokens()}
        doc={svgDoc({ source: '<svg onload="alert(1)"><script>alert(1)</script></svg>', alt: "" })}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("SVG 源码无效")).toBeInTheDocument();
    expect(document.querySelector('[data-component="SvgBox"]')).toBeNull();
  });

  it("空 source：占位降级", () => {
    render(<SchemaRenderer tokens={defaultTokens()} doc={svgDoc({ source: "", alt: "" })} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("SVG 源码无效")).toBeInTheDocument();
  });

  it("viewport=mobile 不干扰：SvgBox 不在断点白名单，base source 照常渲染", () => {
    const doc = svgDoc({ source: SVG_SOURCE, alt: "" }, { breakpoints: { mobile: { source: "<svg><circle/></svg>" } } as never });
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={doc} selectedId={null} onSelect={() => {}} viewport="mobile" />,
    );
    expect(box().innerHTML).toContain(CIRCLE_SUBSTR);
  });

  it("点击 SvgBox 仍选中节点（wrapper 命中语义不变）", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SchemaRenderer tokens={defaultTokens()} doc={svgDoc({ source: SVG_SOURCE, alt: "" })} selectedId={null} onSelect={onSelect} />,
    );
    await user.click(box());
    expect(onSelect).toHaveBeenCalledWith("svg-1");
  });
});
