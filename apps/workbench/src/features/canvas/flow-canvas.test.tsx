import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, defaultTokens, type NodeRecord, type Page, type StudioDocument } from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface } from "./CanvasSurface";
import { groupNodes } from "./canvasGroupOps";
import type { FlowRectMap } from "./flowMeasure";
import { resetNudgeWindow } from "./useCanvasKeyboard";
import { useEditorStore } from "../../state/editorStore";
import { emptyStack } from "../../state/undoStack";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

/** T19: the store holds a WHOLE doc; tests pass a single-page fixture. */
function docAsStoreDoc(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}




/**
 * Plan C 双模式画布（jsdom 级）：flow DOM 层 + pinned 绝对盒层。
 * jsdom 无布局引擎，flow 节点的页面矩形一律经 flowRects 注入断言
 * （measureFlowRect 的 pan/zoom 换算在 flow-measure.test.ts 单独覆盖）。
 */

afterEach(() => {
  cleanup();
  useEditorStore.setState({ selectedId: null, selectedIds: [] });
});

const F = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });
const rects = (entries: Record<string, { x: number; y: number; w: number; h: number }>): FlowRectMap =>
  new Map(Object.entries(entries));

/**
 * jsdom 的 PointerEvent 构造器忽略 clientX/clientY（MouseEvent 才填）。
 * 画布坐标换算依赖真实坐标，所以用 MouseEvent 承载 pointerdown/move/up。
 */
function ptr(type: "pointerdown" | "pointermove" | "pointerup", init: { clientX: number; clientY: number; button?: number }) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
}

/** 混合文档：root 下 pinned 盒 + 未 pinned 卡（遗留 frame）+ 深层 flow 节点。 */
function hybridDoc(): Page {
  const nodes: NodeRecord[] = [
    { id: "root", type: "Container", props: {}, children: ["pinnedCard", "flowCard", "sec"] },
    { id: "pinnedCard", type: "Card", props: { title: "固定卡" }, children: [], frame: F(600, 400, 240, 120), pinned: true },
    { id: "flowCard", type: "Card", props: { title: "流式卡" }, children: [], frame: F(100, 100, 200, 80) },
    { id: "sec", type: "Section", props: {}, children: ["deepBtn"] },
    { id: "deepBtn", type: "Button", props: { label: "深层按钮" }, children: [] },
  ];
  return { ...defaultPage("双模式"), rootId: "root", nodes };
}

function setup(doc: Page, flowRects?: FlowRectMap, selectedId: string | null = null) {
  const onSelect = vi.fn();
  const applyOp = vi.fn(() => true);
  render(<CanvasSurface doc={doc} tokens={defaultTokens()} selectedId={selectedId} onSelect={onSelect} applyOp={applyOp} flowRects={flowRects} />);
  return { onSelect, applyOp };
}

/** 真实 editorStore 接线（框选断言看 store 终态，顺带覆盖 selectNodes 同步）。 */
function setupStore(doc: Page, flowRects?: FlowRectMap) {
  useEditorStore.setState({
    projectId: "p-flow",
    document: docAsStoreDoc(doc),
    dirty: false,
    selectedId: null,
    selectedIds: [],
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
  const applyOp = vi.fn((fn: (d: StudioDocument) => StudioDocument) => useEditorStore.getState().applyOp(fn));
  render(
    <CanvasSurface
      doc={doc} tokens={defaultTokens()}
      selectedId={useEditorStore.getState().selectedId}
      onSelect={(id) => useEditorStore.getState().selectNode(id)}
      applyOp={applyOp}
      flowRects={flowRects}
    />,
  );
  return { applyOp };
}

describe("双层渲染（Task 3 · 1/2/3）", () => {
  it("同一文档：pinned 渲染为绝对盒，未 pinned 渲染为 flow DOM", () => {
    setup(hybridDoc());
    expect(document.querySelector('[data-frame-id="pinnedCard"]')).not.toBeNull();
    const flow = screen.getByTestId("canvas-flow-layer");
    expect(flow.textContent).toContain("流式卡");
    expect(document.querySelector('[data-frame-id="flowCard"]')).toBeNull();
  });

  it("存量文档全 flow：未 pinned 带 frame 节点的 frame 不用于定位", () => {
    const { rerender } = render(
      <CanvasSurface tokens={defaultTokens()} doc={hybridDoc()} selectedId={null} onSelect={vi.fn()} applyOp={vi.fn(() => true)} />,
    );
    // flow 层 DOM 无绝对定位 style（frame 不泄漏为 left/top/width）
    const flowEl = screen.getByTestId("canvas-flow-layer");
    const studioEls = [...flowEl.querySelectorAll("[data-studio-id]")] as HTMLElement[];
    expect(studioEls.length).toBeGreaterThan(0);
    for (const el of studioEls) {
      expect(el.style.left).toBe("");
      expect(el.style.top).toBe("");
    }
    rerender(<div />);
  });

  it("pinned 子节点从 flow 子树剔除、进 pin 层；z 序 = doc.nodes 序", () => {
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["host", "z2"] },
      { id: "host", type: "Section", props: {}, children: ["innerPin"] },
      { id: "z2", type: "Card", props: { title: "上层卡" }, children: [], frame: F(50, 50, 100, 60), pinned: true },
      { id: "innerPin", type: "Card", props: { title: "内嵌固定" }, children: [], frame: F(700, 500, 120, 80), pinned: true },
    ];
    const doc = { ...defaultPage("嵌套 pin"), rootId: "root", nodes };
    setup(doc);
    // innerPin 只出现在 pin 层，flow 子树里没有它的文本
    expect(document.querySelector('[data-frame-id="innerPin"]')).not.toBeNull();
    expect(screen.getByTestId("canvas-flow-layer").textContent).not.toContain("内嵌固定");
    // pin 层 z 序 = nodes 序（z2 在 nodes 中先于 innerPin）
    const boxes = [...document.querySelectorAll("[data-frame-id]")];
    expect(boxes.map((b) => b.getAttribute("data-frame-id"))).toEqual(["z2", "innerPin"]);
  });
});

describe("flow 节点选择（Task 3 · 4/5/8）", () => {
  it("点击 flow 节点：data-studio-id 命中选中，选中框按注入 rect 绘制", () => {
    const { onSelect } = setup(
      hybridDoc(),
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    const target = document.querySelector('[data-studio-id="flowCard"]') as HTMLElement;
    // 事件落在 kit 内容上（display:contents 标记本身不产生盒子）→ 最近
    // data-studio-id 祖先命中 flowCard。jsdom PointerEvent 不带坐标，但
    // gapHitId 对 NaN 指针点回退为命中节点本身（等同「点在节点盒内」）。
    const content = target.firstElementChild as HTMLElement;
    fireEvent.pointerDown(content, { button: 0 });
    expect(onSelect).toHaveBeenCalledWith("flowCard");

    // 选中后（受控 selectedId 由调用方回传，这里直接重渲模拟）
    cleanup();
    setup(
      hybridDoc(),
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
      "flowCard",
    );
    const box = screen.getByTestId("canvas-flow-selection") as HTMLElement;
    // 注入的 rect 是页面坐标；选中框绘制在 zoom 内容层内（同一坐标系）
    expect(box.style.left).toBe("24px");
    expect(box.style.top).toBe("88px");
    expect(box.style.width).toBe("200px");
    expect(box.style.height).toBe("80px");
    expect(box).not.toHaveAttribute("data-flow-locked");
  });

  // T8 行为变更（原「不可拖拽 pin」锁定徽标）：深层 flow 节点现在可拖出，
  // 选中框与顶层一致（实线 ring），不再带 data-flow-locked 锁定标示。
  it("深层 flow 节点选中不再带锁定徽标（T8 可拖出，data-flow-locked 移除）", () => {
    setup(
      hybridDoc(),
      rects({ deepBtn: { x: 48, y: 300, w: 120, h: 40 } }),
      "deepBtn",
    );
    const box = screen.getByTestId("canvas-flow-selection") as HTMLElement;
    expect(box).not.toHaveAttribute("data-flow-locked");
    expect(box.textContent).not.toContain("流式");
  });

  it("文档引用变化触发重测：新注入 rect 立即驱动选中框", () => {
    const doc = hybridDoc();
    const { rerender } = render(
      <CanvasSurface
        doc={doc} tokens={defaultTokens()}
        selectedId="flowCard"
        onSelect={vi.fn()}
        applyOp={vi.fn(() => true)}
        flowRects={rects({ flowCard: { x: 24, y: 88, w: 200, h: 80 } })}
      />,
    );
    expect((screen.getByTestId("canvas-flow-selection") as HTMLElement).style.top).toBe("88px");
    // 文档更新（新引用）→ 布局变化 → 新测量结果
    const next = { ...doc, name: "双模式 v2" };
    rerender(
      <CanvasSurface tokens={defaultTokens()}
        doc={next}
        selectedId="flowCard"
        onSelect={vi.fn()}
        applyOp={vi.fn(() => true)}
        flowRects={rects({ flowCard: { x: 24, y: 220, w: 200, h: 96 } })}
      />,
    );
    const box = screen.getByTestId("canvas-flow-selection") as HTMLElement;
    expect(box.style.top).toBe("220px");
    expect(box.style.height).toBe("96px");
  });
});

describe("框选（Task 3 · 6）", () => {
  it("pinned 用 frame、flow 用注入 rect 做包含判定", () => {
    const doc = hybridDoc();
    setupStore(
      doc,
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    const surface = screen.getByTestId("canvas-surface");
    // 扫过 pinned 盒 (600,400,240,120) 与 flow 卡 (24,88,200,80)；事件落在
    // 页面空白处（canvas-page 元素上，非 flow 内容）。
    const page = screen.getByTestId("canvas-page");
    fireEvent(page, ptr("pointerdown", { clientX: 0, clientY: 0 }));
    fireEvent(surface, ptr("pointermove", { clientX: 900, clientY: 600 }));
    fireEvent(surface, ptr("pointerup", { clientX: 900, clientY: 600 }));
    const selected = useEditorStore.getState().selectedIds;
    expect(selected).toContain("pinnedCard");
    expect(selected).toContain("flowCard");
  });

  it("flow 命中剔除 pinned 后代：pinned 只按 frame 命中一次", () => {
    const doc = hybridDoc();
    setupStore(
      doc,
      // 注入把 pinnedCard 也放进 flow rects（不可能的真实情形：pinned 不在
      // flow DOM 里）——框选必须按 isFlowNode 过滤，不能重复/误选。
      rects({
        root: { x: 0, y: 0, w: 1440, h: 900 },
        pinnedCard: { x: 10, y: 10, w: 50, h: 50 },
        flowCard: { x: 24, y: 88, w: 200, h: 80 },
      }),
    );
    const surface = screen.getByTestId("canvas-surface");
    const page = screen.getByTestId("canvas-page");
    // 只扫左上角：flow rect 里的 pinnedCard 位置被扫到，但其 frame 在 (600,400)
    fireEvent(page, ptr("pointerdown", { clientX: 0, clientY: 0 }));
    fireEvent(surface, ptr("pointermove", { clientX: 300, clientY: 300 }));
    fireEvent(surface, ptr("pointerup", { clientX: 300, clientY: 300 }));
    const selected = useEditorStore.getState().selectedIds;
    expect(selected).toContain("flowCard");
    expect(selected).not.toContain("pinnedCard");
  });
});

/** 键盘用例公共接线：受控 selectedId + 捕获 transform 的 mock applyOp。 */
function setupKeyboard(doc: Page, selectedId: string, flowRects?: FlowRectMap) {
  const onSelect = vi.fn();
  // applyOp receives the document transform (editorStore.applyOp contract).
  const applyOp = vi.fn((fn: (d: StudioDocument) => StudioDocument) => {
    void fn;
    return true;
  });
  useEditorStore.setState({ selectedId, selectedIds: [selectedId] });
  render(
    <CanvasSurface doc={doc} tokens={defaultTokens()} selectedId={selectedId} onSelect={onSelect} applyOp={applyOp} flowRects={flowRects} />,
  );
  return { onSelect, applyOp, surface: screen.getByTestId("canvas-surface") };
}

describe("键盘：Delete / nudge 的 flow 语义（Fix R1 · Important 1）", () => {
  it("Delete 选中 flow 节点 → 提交一次 removeNode op（节点从文档消失）", () => {
    const doc = hybridDoc();
    const { applyOp, onSelect, surface } = setupKeyboard(doc, "flowCard");
    fireEvent.keyDown(surface, { key: "Delete" });
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!;
    expect(next.nodes.some((n) => n.id === "flowCard")).toBe(false);
    expect(next.nodes.some((n) => n.id === "pinnedCard")).toBe(true); // 只删选中
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("顶层 flow 节点 nudge → pin+nudge 单步提交（Task 4）", () => {
    const doc = hybridDoc();
    // 顶层 flow 节点（root 直接子节点）：方向键先按测量 rect pin，再走步进。
    const { applyOp, surface } = setupKeyboard(
      doc,
      "flowCard",
      rects({ flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!;
    const moved = next.nodes.find((n) => n.id === "flowCard");
    expect(moved?.pinned).toBe(true);
    expect(moved?.frame).toEqual({ x: 25, y: 88, w: 200, h: 80, rotation: 0 });
  });

  // T8 行为变更（原 R7 no-op）：深层 flow 节点 nudge 与拖出同语义——单 op 内
  // 先提升到 root，再按测量 rect pin + 步进（pin 层保持页面级不变量）。
  it("深层 flow 节点 nudge → 提升 root + pin + 步进，单 op（T8）", () => {
    const doc = hybridDoc();
    const { applyOp, surface } = setupKeyboard(
      doc,
      "deepBtn",
      rects({ deepBtn: { x: 48, y: 300, w: 120, h: 40 } }),
    );
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!;
    const moved = next.nodes.find((n) => n.id === "deepBtn");
    expect(moved?.pinned).toBe(true);
    expect(moved?.frame).toEqual({ x: 49, y: 300, w: 120, h: 40, rotation: 0 });
    // 提升到 root：sec 不再持有它
    expect(next.nodes.find((n) => n.id === "root")?.children).toContain("deepBtn");
    expect(next.nodes.find((n) => n.id === "sec")?.children).not.toContain("deepBtn");
  });

  it("frameless pinned（R11 不一致态）按 flow 渲染且 Delete 可删", () => {
    // pin(id,frame) 总是同时落 frame——此态正常路径不可达，防御性归一为 flow。
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["ghostPin"] },
      { id: "ghostPin", type: "Card", props: { title: "残缺 pin" }, children: [], pinned: true },
    ];
    const doc = { ...defaultPage("R11"), rootId: "root", nodes };
    const { applyOp, surface } = setupKeyboard(doc, "ghostPin");
    // 渲染在 flow 层（无 pin 盒）
    expect(document.querySelector('[data-frame-id="ghostPin"]')).toBeNull();
    expect(screen.getByTestId("canvas-flow-layer").textContent).toContain("残缺 pin");
    // Delete 走 flow 删除
    fireEvent.keyDown(surface, { key: "Delete" });
    expect(applyOp).toHaveBeenCalledTimes(1);
    expect(applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!.nodes.some((n) => n.id === "ghostPin")).toBe(false);
  });
});

describe("间隙点击不清选中（Fix R1 · Important 2）", () => {
  it("canvasHit 真实分支：注入 rect 内容器 padding/兄弟间距的点击不清选中", () => {
    const doc = hybridDoc();
    const onSelect = vi.fn();
    render(
      <CanvasSurface
        doc={doc} tokens={defaultTokens()}
        selectedId="flowCard"
        onSelect={onSelect}
        applyOp={vi.fn(() => true)}
        // 模拟生产测量结果：root 容器覆盖整页，flowCard 只占一角。
        // (400,400) 落在 root 的 padding/兄弟间距里——视觉上仍在 flow 文档内。
        flowRects={rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } })}
      />,
    );
    // 事件落在 canvas-page（非 flow 内容、非 FlowLayer stopPropagation 分支），
    // 走 surface 的 canvasHit 判定。
    const page = screen.getByTestId("canvas-page");
    fireEvent(page, ptr("pointerdown", { clientX: 400, clientY: 400 }));
    expect(onSelect).not.toHaveBeenCalledWith(null);
  });

  it("对照：页面空白（所有 flow rect 之外）的点击仍清选中", () => {
    const doc = hybridDoc();
    const onSelect = vi.fn();
    render(
      <CanvasSurface
        doc={doc} tokens={defaultTokens()}
        selectedId="flowCard"
        onSelect={onSelect}
        applyOp={vi.fn(() => true)}
        // root 只覆盖上半页（内容自然高 < 页面高）
        flowRects={rects({ root: { x: 0, y: 0, w: 1440, h: 300 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } })}
      />,
    );
    const page = screen.getByTestId("canvas-page");
    fireEvent(page, ptr("pointerdown", { clientX: 400, clientY: 800 }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("编组 / 组移动 / 组 nudge（T13 E7/E8/E9）", () => {
  /** 两个 root 直接子 pin box：union bbox = (100,100,460,320)。 */
  function groupDoc(): Page {
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["pinA", "pinB"] },
      { id: "pinA", type: "Card", props: { title: "甲" }, children: [], frame: F(100, 100, 200, 80), pinned: true },
      { id: "pinB", type: "Card", props: { title: "乙" }, children: [], frame: F(400, 300, 160, 120), pinned: true },
    ];
    return { ...defaultPage("编组"), rootId: "root", nodes };
  }

  /** 组 id 是算子内铸造的（grp_*），按结构特征发现。 */
  function groupIdOf(doc: Page): string {
    const group = doc.nodes.find((n) => n.id !== doc.rootId && n.type === "Container" && n.pinned === true);
    expect(group).toBeDefined();
    return group!.id;
  }

  it("E7: Ctrl+G 编组 → 组 Container+pin+union bbox、nodes 先于成员、选择变为组", () => {
    const doc = groupDoc();
    const { applyOp, surface } = setupKeyboard(doc, "pinA");
    // act 包裹：双选 store 更新同步提交，keydown 闭包读到最新 selectedIds。
    act(() => useEditorStore.setState({ selectedId: "pinA", selectedIds: ["pinA", "pinB"] }));
    fireEvent.keyDown(surface, { key: "g", ctrlKey: true });
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!;
    const groupId = groupIdOf(next);
    const group = next.nodes.find((n) => n.id === groupId)!;
    expect(group.pinned).toBe(true);
    expect(group.frame).toEqual({ x: 100, y: 100, w: 460, h: 320, rotation: 0 });
    expect(group.children).toEqual(expect.arrayContaining(["pinA", "pinB"]));
    // z 序：组排在其首个成员之前（组盒不盖成员命中）
    expect(next.nodes.findIndex((n) => n.id === groupId)).toBeLessThan(next.nodes.findIndex((n) => n.id === "pinA"));
    // 选择跟随结果（真实 store selectNodes 接线）
    expect(useEditorStore.getState().selectedIds).toEqual([groupId]);
  });

  it("E7b: Ctrl+Shift+G 解组 → 成员回 root 原样 frame、组删除、选择变为成员", () => {
    const grouped = groupNodes(groupDoc(), ["pinA", "pinB"])!;
    const { applyOp, surface } = setupKeyboard(grouped.doc, grouped.groupId);
    fireEvent.keyDown(surface, { key: "G", ctrlKey: true, shiftKey: true });
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(grouped.doc)).pages[0]!;
    expect(next.nodes.some((n) => n.id === grouped.groupId)).toBe(false);
    expect(next.nodes.find((n) => n.id === "root")?.children).toEqual(expect.arrayContaining(["pinA", "pinB"]));
    expect(next.nodes.find((n) => n.id === "pinA")?.frame).toEqual(F(100, 100, 200, 80));
    expect(useEditorStore.getState().selectedIds).toEqual(expect.arrayContaining(["pinA", "pinB"]));
  });

  it("E8: 拖组 box → 成员同位移（组携带 pin 后代，movingSet 扩展）", () => {
    const grouped = groupNodes(groupDoc(), ["pinA", "pinB"])!;
    const { applyOp, surface } = setupKeyboard(grouped.doc, grouped.groupId);
    fireEvent(document.querySelector(`[data-frame-id="${grouped.groupId}"]`) as HTMLElement, ptr("pointerdown", { clientX: 200, clientY: 200 }));
    fireEvent(surface, ptr("pointermove", { clientX: 250, clientY: 240 }));
    fireEvent(surface, ptr("pointerup", { clientX: 250, clientY: 240 }));
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(grouped.doc)).pages[0]!;
    // (+50,+40) 整组平移：成员与组框同 delta（组框 refresh 后 = 平移后 union）
    expect(next.nodes.find((n) => n.id === "pinA")?.frame).toEqual({ x: 150, y: 140, w: 200, h: 80, rotation: 0 });
    expect(next.nodes.find((n) => n.id === "pinB")?.frame).toEqual({ x: 450, y: 340, w: 160, h: 120, rotation: 0 });
    expect(next.nodes.find((n) => n.id === grouped.groupId)?.frame).toEqual({ x: 150, y: 140, w: 460, h: 320, rotation: 0 });
  });

  it("E9: nudge 组 = 组+成员同位移，一次 applyOp（一个撤销条目）", () => {
    resetNudgeWindow();
    const grouped = groupNodes(groupDoc(), ["pinA", "pinB"])!;
    const { applyOp, surface } = setupKeyboard(grouped.doc, grouped.groupId);
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(grouped.doc)).pages[0]!;
    expect(next.nodes.find((n) => n.id === "pinA")?.frame).toEqual({ x: 101, y: 100, w: 200, h: 80, rotation: 0 });
    expect(next.nodes.find((n) => n.id === "pinB")?.frame).toEqual({ x: 401, y: 300, w: 160, h: 120, rotation: 0 });
    expect(next.nodes.find((n) => n.id === grouped.groupId)?.frame).toEqual({ x: 101, y: 100, w: 460, h: 320, rotation: 0 });
  });
});
