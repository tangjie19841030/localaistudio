import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  clearNodeBreakpoints,
  setSvgParser,
  updateNodeBreakpoints,
  updateProps,
  type NodeRecord,
  type Page,
} from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeQuickEdit } from "./NodeQuickEdit";
import type { Viewport } from "./PreviewSurface";

setSvgParser((s) => new DOMParser().parseFromString(s, "image/svg+xml").documentElement);

vi.mock("@studio/schema-core", async () => {
  const actual = await vi.importActual<typeof import("@studio/schema-core")>("@studio/schema-core");
  return {
    ...actual,
    updateProps: vi.fn(actual.updateProps),
    updateNodeBreakpoints: vi.fn(actual.updateNodeBreakpoints),
    clearNodeBreakpoints: vi.fn(actual.clearNodeBreakpoints),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pageWith(node: NodeRecord): Page {
  return { id: "page-1", name: "测试页", rootId: node.id, nodes: [node] };
}

function gridPage(extra: Partial<NodeRecord> = {}): Page {
  return pageWith({
    id: "grid",
    type: "Grid",
    props: { columns: 3, gap: 4 },
    children: [],
    ...extra,
  });
}

function renderPanel(page: Page, viewport: Viewport = "desktop") {
  const onApplyPageOp = vi.fn((fn: (current: Page) => Page) => true);
  const onClose = vi.fn();
  render(
    <NodeQuickEdit
      page={page}
      selectedId="grid"
      viewport={viewport}
      onApplyPageOp={onApplyPageOp}
      onClose={onClose}
    />,
  );
  return { onApplyPageOp, onClose };
}

describe("NodeQuickEdit", () => {
  it("选中节点时显示面板，关闭按钮触发 onClose", async () => {
    const { onClose } = renderPanel(gridPage());
    expect(screen.getByRole("complementary", { name: "快捷编辑" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭快捷编辑" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("desktop 编辑基础 props 时通过 updateProps 回写", () => {
    const page = gridPage();
    const { onApplyPageOp } = renderPanel(page);
    fireEvent.change(screen.getByLabelText("columns"), { target: { value: "4" } });

    const op = onApplyPageOp.mock.calls.at(-1)?.[0];
    expect(op).toBeTypeOf("function");
    const next = op!(page);
    expect(updateProps).toHaveBeenCalledWith(page, "grid", expect.objectContaining({ columns: 4, gap: 4 }));
    expect(next.nodes[0]!.props).toEqual({ columns: 4, gap: 4 });
  });

  it.each(["tablet", "mobile"] as const)("%s 编辑差异时通过 updateNodeBreakpoints 回写", (viewport) => {
    const page = gridPage();
    const { onApplyPageOp } = renderPanel(page, viewport);
    fireEvent.change(screen.getByLabelText(`${viewport}.columns`), { target: { value: "2" } });

    const op = onApplyPageOp.mock.calls.at(-1)?.[0];
    const next = op!(page);
    expect(updateNodeBreakpoints).toHaveBeenCalledWith(page, "grid", viewport, { columns: 2 });
    expect(next.nodes[0]!.breakpoints?.[viewport]).toEqual({ columns: 2 });
  });

  it("tablet 清除差异时通过 clearNodeBreakpoints 回写", () => {
    const page = gridPage({ breakpoints: { tablet: { columns: 2 } } });
    const { onApplyPageOp } = renderPanel(page, "tablet");
    fireEvent.click(screen.getByRole("button", { name: "清除平板差异" }));

    const op = onApplyPageOp.mock.calls.at(-1)?.[0];
    op!(page);
    expect(clearNodeBreakpoints).toHaveBeenCalledWith(page, "grid", "tablet");
  });

  it("非白名单类型不显示断点字段和清除入口", () => {
    const page = pageWith({ id: "grid", type: "Button", props: { label: "保存" }, children: [] });
    renderPanel(page, "tablet");
    expect(screen.queryByLabelText("tablet.label")).toBeNull();
    expect(screen.queryByRole("button", { name: "清除平板差异" })).toBeNull();
  });

  it("pinned 节点不显示可写断点字段", () => {
    renderPanel(gridPage({ pinned: true }), "tablet");
    expect(screen.queryByLabelText("tablet.columns")).toBeNull();
    expect(screen.queryByRole("button", { name: "清除平板差异" })).toBeNull();
    expect(screen.getByText("pinned 节点不支持断点差异。")).toBeInTheDocument();
  });

  it("面板中没有 AI 入口", () => {
    renderPanel(gridPage());
    expect(screen.queryByText(/AI/)).toBeNull();
  });
});
