import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultPage, defaultTokens, type NodeRecord, type Page } from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface } from "./CanvasSurface";
import { CANVAS_PAGE } from "./canvasGeometry";
import { useEditorStore } from "../../state/editorStore";

/**
 * jsdom WIRING tests only (Plan C): two-layer render — pinned nodes are
 * absolute NodeFrameBox boxes, unpinned nodes render as flow DOM (their legacy
 * frames are inert and never used for positioning). Real pointer-drag physics
 * (gesture deltas, snap firing, undo-per-gesture) belongs to the p5 E2E spec
 * — jsdom cannot simulate pointer capture + multi-event geometry faithfully.
 *
 * T19 v2 fixtures: CanvasSurface takes the ACTIVE page (`doc: Page`) plus
 * document-level tokens.
 */

afterEach(() => {
  cleanup();
  useEditorStore.setState({ selectedId: null, selectedIds: [] });
});

const F = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });

/** Two pinned boxes + one legacy-framed (unpinned → flow) node. */
function canvasDoc(): Page {
  const nodes: NodeRecord[] = [
    { id: "root", type: "Container", props: {}, children: ["cardA", "cardB", "legacy"] },
    { id: "cardA", type: "Card", props: { title: "卡片A", padded: true }, children: [], frame: F(100, 120, 260, 160), pinned: true },
    { id: "cardB", type: "Card", props: { title: "卡片B", padded: true }, children: [], frame: F(500, 300, 220, 140), pinned: true },
    { id: "legacy", type: "Card", props: { title: "遗留卡", padded: true }, children: [], frame: F(900, 700, 200, 100) },
  ];
  return { ...defaultPage("画布测试"), rootId: "root", nodes };
}

function setup(selectedId: string | null = null) {
  const doc = canvasDoc();
  const onSelect = vi.fn();
  const applyOp = vi.fn(() => true);
  render(
    <CanvasSurface doc={doc} tokens={defaultTokens()} selectedId={selectedId} onSelect={onSelect} applyOp={applyOp} />,
  );
  return { doc, onSelect, applyOp };
}

describe("CanvasSurface 接线（jsdom 级）", () => {
  it("渲染画布容器（role=application + aria-label=画布 + 可聚焦）", () => {
    setup();
    const surface = screen.getByTestId("canvas-surface");
    expect(surface).toHaveAttribute("role", "application");
    expect(surface).toHaveAttribute("aria-label", "画布");
    expect(surface).toHaveAttribute("tabindex", "0");
  });

  it("pinned 节点渲染为绝对定位盒，位置来自 frame 坐标", () => {
    setup();
    const a = document.querySelector('[data-frame-id="cardA"]') as HTMLElement;
    expect(a).not.toBeNull();
    expect(a.style.left).toBe("100px");
    expect(a.style.top).toBe("120px");
    expect(a.style.width).toBe("260px");
    expect(a.style.height).toBe("160px");
    const b = document.querySelector('[data-frame-id="cardB"]') as HTMLElement;
    expect(b.style.left).toBe("500px");
    expect(b.style.top).toBe("300px");
  });

  it("未 pinned 的带 frame 节点不出现在 pin 层（遗留 frame 是惰性元数据）", () => {
    setup();
    expect(document.querySelector('[data-frame-id="legacy"]')).toBeNull();
  });

  it("画布上仍渲染节点子树内容（pin 盒与 flow 层同组件）", () => {
    setup();
    const a = document.querySelector('[data-frame-id="cardA"]') as HTMLElement;
    expect(a.textContent).toContain("卡片A");
    expect(screen.getByTestId("canvas-flow-layer").textContent).toContain("遗留卡");
  });

  it("点击空白画布清除选中（onSelect(null)）", () => {
    const { onSelect } = setup("cardA");
    useEditorStore.setState({ selectedId: "cardA", selectedIds: ["cardA"] });
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(surface, { button: 0, clientX: 5, clientY: 5 });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("点击节点盒触发选中回调；空白拖动不误触发 applyOp", () => {
    const { onSelect, applyOp } = setup();
    const box = document.querySelector('[data-frame-id="cardA"]') as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 150, clientY: 150 });
    expect(onSelect).toHaveBeenCalledWith("cardA");
    fireEvent.pointerUp(box, { button: 0, clientX: 150, clientY: 150 });
    // 点击（无位移）不提交任何 op
    expect(applyOp).not.toHaveBeenCalled();
  });

  it("z 序按 nodes 数组序渲染（先者底层，DOM 顺序一致）", () => {
    setup();
    const boxes = [...document.querySelectorAll("[data-frame-id]")];
    expect(boxes.map((b) => b.getAttribute("data-frame-id"))).toEqual(["cardA", "cardB"]);
  });

  it("选中节点显示 8 个手柄；未选节点无手柄", () => {
    setup("cardA");
    const a = document.querySelector('[data-frame-id="cardA"]') as HTMLElement;
    expect(a.querySelectorAll("[data-handle]")).toHaveLength(8);
    const b = document.querySelector('[data-frame-id="cardB"]') as HTMLElement;
    expect(b.querySelectorAll("[data-handle]")).toHaveLength(0);
  });

  it("工具条显示 zoom 百分比（默认 100%）", () => {
    setup();
    expect(screen.getByTestId("canvas-zoom").textContent).toBe("100%");
  });
});

describe("拖拽中止（Esc / pointercancel）", () => {
  it("对照：无中止的拖拽在 pointerup 提交一次 applyOp", () => {
    const { applyOp } = setup("cardA");
    const surface = screen.getByTestId("canvas-surface");
    const box = document.querySelector('[data-frame-id="cardA"]') as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(surface, { clientX: 250, clientY: 150 });
    fireEvent.pointerUp(surface, { button: 0, clientX: 250, clientY: 150 });
    expect(applyOp).toHaveBeenCalledTimes(1);
  });

  it("拖拽进行中按 Escape 中止：不 commit、不产生 applyOp", () => {
    const { applyOp } = setup("cardA");
    const surface = screen.getByTestId("canvas-surface");
    const box = document.querySelector('[data-frame-id="cardA"]') as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(surface, { clientX: 250, clientY: 150 });
    fireEvent.keyDown(surface, { key: "Escape" });
    fireEvent.pointerUp(surface, { button: 0, clientX: 250, clientY: 150 });
    expect(applyOp).not.toHaveBeenCalled();
  });

  it("pointercancel 不提交半途手势：拖拽中断后 pointerup 也不 commit", () => {
    const { applyOp } = setup("cardA");
    const surface = screen.getByTestId("canvas-surface");
    const box = document.querySelector('[data-frame-id="cardA"]') as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(surface, { clientX: 250, clientY: 150 });
    fireEvent.pointerCancel(surface, { clientX: 250, clientY: 150 });
    fireEvent.pointerUp(surface, { button: 0, clientX: 250, clientY: 150 });
    expect(applyOp).not.toHaveBeenCalled();
  });

  it("非拖拽时的 Escape 不被画布消费（正常冒泡）", () => {
    setup();
    const surface = screen.getByTestId("canvas-surface");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    const seen: string[] = [];
    surface.parentElement!.addEventListener("keydown", (e) => seen.push((e as KeyboardEvent).key));
    surface.dispatchEvent(escape);
    // 画布未 preventDefault、未吞掉事件
    expect(escape.defaultPrevented).toBe(false);
    expect(seen).toEqual(["Escape"]);
  });
});

describe("滚轮缩放 × 页面尺寸（zoom 双重缩放回归）", () => {
  /** 真实 wheel 事件：jsdom 的 WheelEvent 构造器填充 deltaY/clientX/clientY。 */
  function wheelAt(surface: HTMLElement, clientX: number, clientY: number, deltaY: number) {
    fireEvent(
      surface,
      new WheelEvent("wheel", {
        deltaY,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /** 从内容层 transform 解析真实 zoom（toolbar 显示的是四舍五入值，不可用作精确断言）。 */
  function contentZoom(): number {
    const t = (screen.getByTestId("canvas-page-content") as HTMLElement).style.transform;
    const m = /^scale\(([\d.]+)\)$/.exec(t);
    if (!m) throw new Error(`unexpected transform: ${t}`);
    return Number(m[1]);
  }

  it("zoom<1：canvas-page 固定逻辑尺寸（width/height 不乘 zoom）", () => {
    setup();
    const surface = screen.getByTestId("canvas-surface") as HTMLElement;
    const page = screen.getByTestId("canvas-page") as HTMLElement;
    // 初始 zoom=1，页面宽高即 CANVAS_PAGE
    expect(page.style.width).toBe(`${CANVAS_PAGE.w}px`);
    expect(page.style.height).toBe(`${CANVAS_PAGE.h}px`);
    // 滚轮向下 → zoom 缩小（真实 wheel 全链路，非直接设 viewport）
    wheelAt(surface, 400, 400, 100);
    wheelAt(surface, 400, 400, 100);
    const zoom = contentZoom();
    expect(zoom).toBeLessThan(1);
    // 回归核心：页面尺寸仍为固定逻辑尺寸，绝不乘 zoom
    expect(page.style.width).toBe(`${CANVAS_PAGE.w}px`);
    expect(page.style.height).toBe(`${CANVAS_PAGE.h}px`);
    // 页面自身无 transform；缩放只在内容层
    expect(page.style.transform).toBe("");
    expect((screen.getByTestId("canvas-page-content") as HTMLElement).style.transform).toBe(`scale(${zoom})`);
  });

  it("zoom<1：白纸与 flow 内容视觉宽一致 = CANVAS_PAGE.w * zoom（非 zoom^2）", () => {
    setup();
    const surface = screen.getByTestId("canvas-surface") as HTMLElement;
    const page = screen.getByTestId("canvas-page") as HTMLElement;
    wheelAt(surface, 400, 400, 100);
    const zoom = contentZoom();
    expect(zoom).toBeLessThan(1);
    // 白纸：canvas-page-content 是唯一视觉缩放，bg 随 scale(zoom) 变成 1440*zoom
    const content = screen.getByTestId("canvas-page-content") as HTMLElement;
    expect(content.style.transform).toBe(`scale(${zoom})`);
    expect(content.style.transformOrigin).toBe("top left");
    // 页面固定尺寸 + 单次 scale → 视觉白纸宽 = CANVAS_PAGE.w * zoom
    const visualPaperW = Number.parseFloat(page.style.width) * zoom;
    expect(visualPaperW).toBeCloseTo(CANVAS_PAGE.w * zoom, 5);
    // flow 内容在同一 content 层内，视觉宽同样 = 1440*zoom（不二次缩放）
    const flow = screen.getByTestId("canvas-flow-layer") as HTMLElement;
    expect(flow.parentElement).toBe(content);
  });

  it("评审阻塞项：overlay wrapper 必须 pointer-events-none，且覆盖范围 = 1440*zoom", () => {
    setup();
    const surface = screen.getByTestId("canvas-surface") as HTMLElement;
    const page = screen.getByTestId("canvas-page") as HTMLElement;
    const content = screen.getByTestId("canvas-page-content") as HTMLElement;
    const overlay = screen.getByTestId("canvas-overlay-layer") as HTMLElement;
    // wrapper 是 canvas-page 的直接子层，渲染在内容层之后（视觉上盖住整纸）
    expect(overlay.parentElement).toBe(page);
    expect(content.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 核心回归：wrapper 必须放行点击到下层 flow/pin 交互
    expect(overlay.className).toContain("pointer-events-none");
    // 默认 zoom=1：wrapper 覆盖固定页面整纸
    expect(overlay.style.width).toBe(`${CANVAS_PAGE.w}px`);
    expect(overlay.style.height).toBe(`${CANVAS_PAGE.h}px`);
    // 滚轮缩小后：wrapper 保持 1440*zoom 屏幕范围（containing block 语义不变，非 zoom^2）
    wheelAt(surface, 400, 400, 100);
    wheelAt(surface, 400, 400, 100);
    const zoom = contentZoom();
    expect(zoom).toBeLessThan(1);
    expect(overlay.style.width).toBe(`${CANVAS_PAGE.w * zoom}px`);
    expect(overlay.style.height).toBe(`${CANVAS_PAGE.h * zoom}px`);
  });
});
