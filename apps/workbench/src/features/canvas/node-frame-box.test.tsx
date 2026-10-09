import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, type NodeRecord, type Page, defaultTokens } from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFrameBox } from "./NodeFrameBox";
import { useEditorStore } from "../../state/editorStore";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

/**
 * Overflow badge wiring (P5-2 fix). jsdom runs no layout engine, so scroll /
 * client metrics are stubbed on the prototype for the duration of each test:
 * the box measures after every commit (frame geometry / document change) and
 * the badge must reflect that measurement.
 */

afterEach(() => {
  cleanup();
  restoreMetrics();
});

type Metrics = { clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number };

const METRIC_KEYS: (keyof Metrics)[] = ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight"];
const original = new Map<keyof Metrics, PropertyDescriptor | undefined>();

/** Stub padding-box and scroll metrics for every element in this test. */
function mockMetrics(m: Metrics): void {
  for (const key of METRIC_KEYS) {
    if (!original.has(key)) original.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => m[key] });
  }


}

function restoreMetrics(): void {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
  original.clear();
}

/** One framed node (Nav-like tall content) + one clean framed node. */
function fitsDoc(): Page {
  const nodes: NodeRecord[] = [
    { id: "root", type: "Container", props: {}, children: [] },
    { id: "navBox", type: "Card", props: { title: "导航", padded: true }, children: [], frame: { x: 40, y: 40, w: 200, h: 48, rotation: 0 } },
    { id: "cardB", type: "Card", props: { title: "卡片B", padded: true }, children: [], frame: { x: 400, y: 40, w: 200, h: 160, rotation: 0 } },
  ];
  return { ...defaultPage("溢出测试"), rootId: "root", nodes };
}

function renderBox(nodeId: string) {
  const doc = fitsDoc();
  const node = doc.nodes.find((n) => n.id === nodeId)!;
  render(
    <NodeFrameBox tokens={defaultTokens()}
      doc={doc}
      nodeId={nodeId}
      frame={node.frame!}
      selected={false}
      onSelect={vi.fn()}
      onDragStart={vi.fn()}
    />,
  );
}

describe("NodeFrameBox 溢出标记", () => {
  it("内容盒裁剪溢出（overflow: hidden），不再污染兄弟节点", () => {
    mockMetrics({ clientWidth: 200, clientHeight: 48, scrollWidth: 200, scrollHeight: 240 });
    renderBox("navBox");
    const box = document.querySelector('[data-frame-id="navBox"]') as HTMLElement;
    const content = box.firstElementChild as HTMLElement;
    expect(content.style.overflow).toBe("hidden");
  });

  it("内容超出 frame 时打标记：data-overflow=true + 徽标", () => {
    mockMetrics({ clientWidth: 200, clientHeight: 48, scrollWidth: 200, scrollHeight: 240 });
    renderBox("navBox");
    const box = document.querySelector('[data-frame-id="navBox"]') as HTMLElement;
    expect(box).toHaveAttribute("data-overflow", "true");
    expect(box.querySelector('[data-testid="canvas-frame-overflow"]')).not.toBeNull();
    expect(box.textContent).toContain("溢出");
  });

  it("内容不超出时不打标记（无 data-overflow、无徽标）", () => {
    mockMetrics({ clientWidth: 200, clientHeight: 160, scrollWidth: 200, scrollHeight: 158 });
    renderBox("cardB");
    const box = document.querySelector('[data-frame-id="cardB"]') as HTMLElement;
    expect(box).not.toHaveAttribute("data-overflow");
    expect(box.querySelector('[data-testid="canvas-frame-overflow"]')).toBeNull();
    expect(box.textContent).not.toContain("溢出");
  });

  it("1px 内的亚像素差不算溢出（缩放取整不误报）", () => {
    mockMetrics({ clientWidth: 200, clientHeight: 160, scrollWidth: 200, scrollHeight: 161 });
    renderBox("cardB");
    expect(document.querySelector('[data-frame-id="cardB"]')).not.toHaveAttribute("data-overflow");
  });

  it("横向溢出同样标记（scrollWidth 超宽）", () => {
    mockMetrics({ clientWidth: 200, clientHeight: 160, scrollWidth: 260, scrollHeight: 160 });
    renderBox("cardB");
    expect(document.querySelector('[data-frame-id="cardB"]')).toHaveAttribute("data-overflow", "true");
  });

  it("未布局元素（client/scroll 全 0）不误报", () => {
    mockMetrics({ clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0 });
    renderBox("cardB");
    expect(document.querySelector('[data-frame-id="cardB"]')).not.toHaveAttribute("data-overflow");
  });

  it("选中时手柄与溢出标记共存（互不遮蔽）", () => {
    mockMetrics({ clientWidth: 200, clientHeight: 48, scrollWidth: 200, scrollHeight: 240 });
    const doc = fitsDoc();
    render(
      <NodeFrameBox tokens={defaultTokens()} doc={doc} nodeId="navBox" frame={doc.nodes[1]!.frame!} selected onSelect={vi.fn()} onDragStart={vi.fn()} />,
    );
    const box = screen.getByTestId("canvas-frame-navBox");
    expect(box.querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(box).toHaveAttribute("data-overflow", "true");
  });

  it("文档/几何变化后重新测量：放大到内容高度即撤下标记", () => {
    mockMetrics({ clientWidth: 200, clientHeight: 48, scrollWidth: 200, scrollHeight: 240 });
    const doc = fitsDoc();
    const props = { doc, nodeId: "navBox", selected: false, onSelect: vi.fn(), onDragStart: vi.fn() };
    const { rerender } = render(<NodeFrameBox tokens={defaultTokens()} {...props} frame={doc.nodes[1]!.frame!} />);
    expect(document.querySelector('[data-frame-id="navBox"]')).toHaveAttribute("data-overflow", "true");
    // 手柄放大到内容高度：新几何 + 新文档引用 → 重新测量 → 标记消失
    mockMetrics({ clientWidth: 200, clientHeight: 240, scrollWidth: 200, scrollHeight: 240 });
    rerender(<NodeFrameBox tokens={defaultTokens()} {...props} doc={{ ...doc }} frame={{ x: 40, y: 40, w: 200, h: 240, rotation: 0 }} />);
    expect(document.querySelector('[data-frame-id="navBox"]')).not.toHaveAttribute("data-overflow");
  });
});

describe("旋转手柄（T13 E1-E3）", () => {
  /** 两个 pin box：孤立盒（可旋转）+ 含 pinned 成员的组容器（不可旋转）。 */
  function rotDoc(): Page {
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["pinA", "grp"] },
      { id: "pinA", type: "Card", props: { title: "可旋转", padded: true }, children: [], frame: { x: 40, y: 40, w: 200, h: 120, rotation: 0 }, pinned: true },
      { id: "grp", type: "Container", props: { maxWidth: "full" }, children: ["m1"], frame: { x: 300, y: 40, w: 300, h: 200, rotation: 0 }, pinned: true },
      { id: "m1", type: "Card", props: { title: "成员", padded: true }, children: [], frame: { x: 320, y: 60, w: 120, h: 80, rotation: 0 }, pinned: true },
    ];
    return { ...defaultPage("旋转门槛"), rootId: "root", nodes };
  }

  function renderSelected(nodeId: string) {
    const doc = rotDoc();
    const node = doc.nodes.find((n) => n.id === nodeId)!;
    const onDragStart = vi.fn();
    render(
      <NodeFrameBox tokens={defaultTokens()} doc={doc} nodeId={nodeId} frame={node.frame!} selected onSelect={vi.fn()} onDragStart={onDragStart} />,
    );
    return { onDragStart };
  }

  it("E1: eligible 单选 pin box 渲染旋转手柄；组（有 pin 后代）不渲染", () => {
    renderSelected("pinA");
    expect(document.querySelector('[data-rot-handle="pinA"]')).not.toBeNull();
    cleanup();
    renderSelected("grp");
    expect(document.querySelector('[data-rot-handle="grp"]')).toBeNull();
  });

  it("E2（通道）: 旋转手柄 pointerdown 走 onDragStart(id, \"rot\") 既有通道", () => {
    const { onDragStart } = renderSelected("pinA");
    fireEvent.pointerDown(document.querySelector('[data-rot-handle="pinA"]') as HTMLElement);
    expect(onDragStart).toHaveBeenCalledWith("pinA", "rot", expect.anything());
  });

  it("E3: 多选（store selectedIds>1）无旋转手柄，resize 手柄不受影响", () => {
    useEditorStore.setState({ selectedId: "pinA", selectedIds: ["pinA", "m1"] });
    renderSelected("pinA");
    expect(document.querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(document.querySelector('[data-rot-handle="pinA"]')).toBeNull();
    useEditorStore.setState({ selectedId: null, selectedIds: [] });
  });
});
