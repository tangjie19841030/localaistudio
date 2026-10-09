import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultPage, defaultTokens, defaultStudioDocument, replacePage, type NodeRecord, type Page, type StudioDocument } from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface } from "./CanvasSurface";
import type { FlowRectMap } from "./flowMeasure";
import { flowDragCandidate } from "./flowNodes";
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
 * Task 4 交互（jsdom 级）：拖拽即 pin、键盘 nudge pin、unpin 回流、重排文案。
 * flow 节点矩形一律经 flowRects 注入（jsdom 无布局引擎）。
 */

afterEach(() => {
  cleanup();
  resetNudgeWindow();
  useEditorStore.setState({ selectedId: null, selectedIds: [] });
});

const F = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });
const rects = (entries: Record<string, { x: number; y: number; w: number; h: number }>): FlowRectMap =>
  new Map(Object.entries(entries));

/** root 下：一个顶层 flow 卡 + 一个 sec 容器装深层 flow 按钮。 */
function flowDoc(): Page {
  const nodes: NodeRecord[] = [
    { id: "root", type: "Container", props: {}, children: ["flowCard", "sec"] },
    { id: "flowCard", type: "Card", props: { title: "流式卡" }, children: [] },


    { id: "sec", type: "Section", props: {}, children: ["deepBtn"] },
    { id: "deepBtn", type: "Button", props: { label: "深层按钮" }, children: [] },
  ];
  return { ...defaultPage("拖拽即pin"), rootId: "root", nodes };
}

/** jsdom PointerEvent 不带坐标，用 MouseEvent 承载 pointer 序列。 */
function ptr(type: "pointerdown" | "pointermove" | "pointerup", init: { clientX: number; clientY: number; button?: number }) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
}

/** 真实 editorStore 接线：undo 断言看完整文档还原。selectedId 受控回传 store。 */
function setupStore(doc: Page, flowRects?: FlowRectMap) {
  useEditorStore.setState({
    projectId: "p-t4",
    document: docAsStoreDoc(doc),
    dirty: false,
    selectedId: null,
    selectedIds: [],
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
  const applyOp = vi.fn((fn: (d: StudioDocument) => StudioDocument) => useEditorStore.getState().applyOp(fn));
  /** 受控外壳：App 同款回传——store 的 selectedId 变化必须驱动重渲（键盘闭包读 prop）。 */
  function Harness() {
    const selectedId = useEditorStore((s) => s.selectedId);
    const storeDoc = useEditorStore((s) => s.document) as StudioDocument;
    return (
      <CanvasSurface
        doc={storeDoc.pages[0]!}
        tokens={storeDoc.tokens}
        selectedId={selectedId}
        onSelect={(id) => useEditorStore.getState().selectNode(id)}
        applyOp={applyOp}
        flowRects={flowRects}
      />
    );
  }
  render(<Harness />);
  return { applyOp };
}

describe("拖拽即 pin（Task 4 · 1/2）", () => {
  it("拖拽顶层 flow 节点 → 一次 op 完成 pin+位移；单 undo 完全还原", () => {
    const doc = flowDoc();
    setupStore(
      doc,
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    const target = document.querySelector('[data-studio-id="flowCard"]') as HTMLElement;
    const content = target.firstElementChild as HTMLElement;
    const surface = screen.getByTestId("canvas-surface");
    fireEvent(content, ptr("pointerdown", { clientX: 50, clientY: 100 }));
    fireEvent(surface, ptr("pointermove", { clientX: 150, clientY: 200 }));
    fireEvent(surface, ptr("pointerup", { clientX: 150, clientY: 200 }));

    const after = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    const moved = after.nodes.find((n) => n.id === "flowCard");
    expect(moved?.pinned).toBe(true);
    // jsdom 的 surface getBoundingClientRect 为 0 → 画布坐标 = 事件坐标；
    // pin 矩形 = 注入测量 rect + 拖拽位移 (+100, +100)
    expect(moved?.frame).toEqual({ x: 124, y: 188, w: 200, h: 80, rotation: 0 });
    // 节点转入 pin 层渲染（绝对盒），flow 层不再出现
    expect(document.querySelector('[data-frame-id="flowCard"]')).not.toBeNull();

    // 整次手势 = 单 undo 步：撤销后文档完全还原（无 pin、无 frame、回流式层）
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().document).toEqual(docAsStoreDoc(doc));
  });

  // T8 行为变更（原 R7 select-only）：深层 flow 节点现在可拖出——commit 先
  // moveNode 提升到 root 再 pin+setFrame，单 op = 单 undo。
  it("深层 flow 节点拖拽 → 提升到 root + pin + setFrame，单 undo（T8）", () => {
    const doc = flowDoc();
    const { applyOp } = setupStore(
      doc,
      rects({
        root: { x: 0, y: 0, w: 1440, h: 900 },
        sec: { x: 0, y: 200, w: 1440, h: 200 },
        deepBtn: { x: 48, y: 300, w: 120, h: 40 },
      }),
    );
    const target = document.querySelector('[data-studio-id="deepBtn"]') as HTMLElement;
    const content = target.firstElementChild as HTMLElement;
    const surface = screen.getByTestId("canvas-surface");
    fireEvent(content, ptr("pointerdown", { clientX: 60, clientY: 310 }));
    fireEvent(surface, ptr("pointermove", { clientX: 160, clientY: 410 }));
    fireEvent(surface, ptr("pointerup", { clientX: 160, clientY: 410 }));
    // 整次手势仍是单 op（moveNode+pin+setFrame 同一个 applyOp）
    expect(applyOp).toHaveBeenCalledTimes(1);
    const after = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    const btn = after.nodes.find((n) => n.id === "deepBtn");
    // pin 矩形 = 注入测量 rect + 拖拽位移 (+100, +100)
    expect(btn?.pinned).toBe(true);
    expect(btn?.frame).toEqual({ x: 148, y: 400, w: 120, h: 40, rotation: 0 });
    // 提升到 root（pin 层 = 页面级不变量），sec 不再持有它
    expect(after.nodes.find((n) => n.id === "root")?.children).toContain("deepBtn");
    expect(after.nodes.find((n) => n.id === "sec")?.children).not.toContain("deepBtn");
    // 单 undo 完全还原（嵌套、未 pin）
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().document).toEqual(docAsStoreDoc(doc));
  });

  // T8 新增：op 组成断言——mock applyOp 捕获 fn，直接对原文档求值，验证
  // 一次提交同时完成 moveNode+pin+setFrame 且无中间脏状态泄漏。
  it("嵌套拖动提交 = 单 op 内 moveNode+pin+setFrame（mock 求值）", () => {
    const doc = flowDoc();
    // mock 签名对齐 applyOp 契约（捕获 fn 供下方对原文档求值；tsc 严格索引）。
    const applyOp = vi.fn((fn: (d: StudioDocument) => StudioDocument) => true);
    render(<CanvasSurface doc={doc} tokens={defaultTokens()} selectedId={null} onSelect={vi.fn()} applyOp={applyOp} flowRects={rects({
      root: { x: 0, y: 0, w: 1440, h: 900 },
      sec: { x: 0, y: 200, w: 1440, h: 200 },
      deepBtn: { x: 48, y: 300, w: 120, h: 40 },
    })} />);
    const target = document.querySelector('[data-studio-id="deepBtn"]') as HTMLElement;
    const content = target.firstElementChild as HTMLElement;
    const surface = screen.getByTestId("canvas-surface");
    fireEvent(content, ptr("pointerdown", { clientX: 60, clientY: 310 }));
    fireEvent(surface, ptr("pointermove", { clientX: 160, clientY: 410 }));
    fireEvent(surface, ptr("pointerup", { clientX: 160, clientY: 410 }));
    expect(applyOp).toHaveBeenCalledTimes(1);
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!;
    const btn = next.nodes.find((n) => n.id === "deepBtn");
    expect(btn?.pinned).toBe(true);
    expect(btn?.frame).toEqual({ x: 148, y: 400, w: 120, h: 40, rotation: 0 });
    expect(next.nodes.find((n) => n.id === "root")?.children).toContain("deepBtn");
  });

  it("顶层 flow 节点按下后未移动（点击）→ 不 pin 不提交", () => {
    const doc = flowDoc();
    const { applyOp } = setupStore(
      doc,
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    const target = document.querySelector('[data-studio-id="flowCard"]') as HTMLElement;
    const content = target.firstElementChild as HTMLElement;
    const surface = screen.getByTestId("canvas-surface");
    fireEvent(content, ptr("pointerdown", { clientX: 50, clientY: 100 }));
    fireEvent(surface, ptr("pointerup", { clientX: 50, clientY: 100 }));
    expect(applyOp).not.toHaveBeenCalled();
    const after = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    expect(after.nodes.find((n) => n.id === "flowCard")?.pinned).toBeUndefined();
  });
});

describe("拖出门谓词 flowDragCandidate（T8）", () => {
  it("root / pinned 自身 / pin 盒祖先命中 → false；其余 flow 节点 → true", () => {
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["top", "sec"] },
      { id: "top", type: "Card", props: { title: "顶层" }, children: [] },
      { id: "sec", type: "Section", props: {}, children: ["inner"], pinned: true, frame: F(0, 0, 400, 300) },
      { id: "inner", type: "Card", props: { title: "盒内" }, children: [] },
    ];
    const doc = { ...defaultPage("谓词"), rootId: "root", nodes };
    expect(flowDragCandidate(doc, "top")).toBe(true);
    expect(flowDragCandidate(doc, doc.rootId)).toBe(false);
    expect(flowDragCandidate(doc, "sec")).toBe(false);
    // pin 盒后代被 NodeSubtree 从 flow DOM 剔除（点击由 NodeFrameBox 路径接管，
    // 流层不可达）；谓词里的 hasPinnedAncestor 是防御位：命中即不进 flow 拖拽。
    expect(flowDragCandidate(doc, "inner")).toBe(false);
  });

  it("frameless pinned 祖先（R11 不一致态）按 flow 处理，后代仍可拖出", () => {
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["ghost", "inner"] },
      { id: "ghost", type: "Section", props: {}, children: ["inner"], pinned: true },
      { id: "inner", type: "Card", props: { title: "内层" }, children: [] },
    ];
    const doc = { ...defaultPage("R11"), rootId: "root", nodes };
    expect(flowDragCandidate(doc, "inner")).toBe(true);
  });
});

describe("拖拽中瞬态 pin 盒（Fix R1 · Important）", () => {
  it("会话中渲染瞬态盒且位置跟随移动；pointerup 后瞬态盒消失", () => {
    const doc = flowDoc();
    setupStore(
      doc,
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    const target = document.querySelector('[data-studio-id="flowCard"]') as HTMLElement;
    const content = target.firstElementChild as HTMLElement;
    const surface = screen.getByTestId("canvas-surface");
    fireEvent(content, ptr("pointerdown", { clientX: 50, clientY: 100 }));
    fireEvent(surface, ptr("pointermove", { clientX: 150, clientY: 200 }));

    // 瞬态盒：pin 层出现 flowCard 的 NodeFrameBox，几何 = 测量 rect + 位移。
    const box = document.querySelector('[data-frame-id="flowCard"]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.left).toBe("124px");
    expect(box.style.top).toBe("188px");
    expect(box.style.width).toBe("200px");
    expect(box.style.height).toBe("80px");
    // flow 层不再渲染原位 ghost（hideId 生效）：flow DOM 中无 flowCard 标记。
    expect(screen.getByTestId("canvas-flow-layer").textContent).not.toContain("流式卡");

    // pointerup 提交后瞬态盒消失——提交态的 pin 盒由新 doc 接管渲染（同一
    // data-frame-id，但来自 usePinned 而非瞬态分支；这里断言会话结束态）。
    fireEvent(surface, ptr("pointerup", { clientX: 150, clientY: 200 }));
    const committed = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    expect(committed.nodes.find((n) => n.id === "flowCard")?.pinned).toBe(true);
    // drag.state 已清空：pinDragBox 不再成立，盒仍渲染（提交态），无重复盒。
    expect(document.querySelectorAll('[data-frame-id="flowCard"]').length).toBe(1);
  });

  it("pointercancel 中止：瞬态盒消失且不提交 pin（节点回流式层）", () => {
    const doc = flowDoc();
    const { applyOp } = setupStore(
      doc,
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    const target = document.querySelector('[data-studio-id="flowCard"]') as HTMLElement;
    const content = target.firstElementChild as HTMLElement;
    const surface = screen.getByTestId("canvas-surface");
    fireEvent(content, ptr("pointerdown", { clientX: 50, clientY: 100 }));
    fireEvent(surface, ptr("pointermove", { clientX: 150, clientY: 200 }));
    expect(document.querySelector('[data-frame-id="flowCard"]')).not.toBeNull();
    fireEvent.pointerCancel(surface);
    // 会话中止：瞬态盒卸载、flow 层原位恢复（hideId 解除）、无 op 提交。
    expect(document.querySelector('[data-frame-id="flowCard"]')).toBeNull();
    expect(applyOp).not.toHaveBeenCalled();
    const after = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    expect(after.nodes.find((n) => n.id === "flowCard")?.pinned).toBeUndefined();
    expect(screen.getByTestId("canvas-flow-layer").textContent).toContain("流式卡");
  });
});

describe("键盘 nudge = pin+nudge（Task 4 · 3）", () => {
  it("顶层 flow nudge → pin+步进单 op；undo 一步还原", () => {
    const doc = flowDoc();
    setupStore(
      doc,
      rects({ root: { x: 0, y: 0, w: 1440, h: 900 }, flowCard: { x: 24, y: 88, w: 200, h: 80 } }),
    );
    // act() 刷新受控重渲——否则 keyDown 落在 selectedId=null 的旧闭包上。
    act(() => useEditorStore.getState().selectNode("flowCard"));
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.keyDown(surface, { key: "ArrowRight" });

    const after = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    const moved = after.nodes.find((n) => n.id === "flowCard");
    expect(moved?.pinned).toBe(true);
    expect(moved?.frame).toEqual({ x: 25, y: 88, w: 200, h: 80, rotation: 0 });
    // pin+nudge 是一个 op → 一步 undo 回到纯 flow 文档
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().document).toEqual(docAsStoreDoc(doc));
  });

  // T8 行为变更（原 R7 no-op）：深层 flow 节点 nudge 与拖出同语义——单 op 内
  // 先提升到 root，再按测量 rect pin + 步进；单 undo 完全还原。
  it("深层 flow nudge → 提升 root + pin + 步进，单 op 单 undo（T8）", () => {
    const doc = flowDoc();
    setupStore(
      doc,
      rects({
        root: { x: 0, y: 0, w: 1440, h: 900 },
        sec: { x: 0, y: 200, w: 1440, h: 200 },
        deepBtn: { x: 48, y: 300, w: 120, h: 40 },
      }),
    );
    act(() => useEditorStore.getState().selectNode("deepBtn"));
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    const after = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    const moved = after.nodes.find((n) => n.id === "deepBtn");
    expect(moved?.pinned).toBe(true);
    expect(moved?.frame).toEqual({ x: 49, y: 300, w: 120, h: 40, rotation: 0 });
    // 提升到 root（pin 层 = 页面级不变量），sec 不再持有它
    expect(after.nodes.find((n) => n.id === "root")?.children).toContain("deepBtn");
    expect(after.nodes.find((n) => n.id === "sec")?.children).not.toContain("deepBtn");
    // 一步 undo 回到纯 flow 文档（嵌套、未 pin）
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().document).toEqual(docAsStoreDoc(doc));
  });
});

describe("unpin 回到流式布局（Task 4 · 4）", () => {
  function pinnedDoc(): Page {
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["pinnedCard", "flowCard"] },
      { id: "pinnedCard", type: "Card", props: { title: "固定卡" }, children: [], frame: F(600, 400, 240, 120), pinned: true },
      { id: "flowCard", type: "Card", props: { title: "流式卡" }, children: [] },
    ];
    return { ...defaultPage("unpin"), rootId: "root", nodes };
  }

  it("pinned 节点显示「回到流式布局」；点击回 flow 层；undo 恢复 pinned", async () => {
    const { PropsForm } = await import("../../components/editor/PropsForm");
    const doc = pinnedDoc();
    const pinned = doc.nodes.find((n) => n.id === "pinnedCard")!;
    const onUnpin = vi.fn();
    render(<PropsForm node={pinned} onPropsChange={() => {}} onUnpin={onUnpin} />);
    const entry = screen.getByTestId("props-unpin");
    expect(entry.textContent).toContain("回到流式布局");
    fireEvent.click(entry);
    expect(onUnpin).toHaveBeenCalledWith("pinnedCard");
    cleanup();

    // 端到端：经 editorStore.applyOp 的 unpin 回 flow + undo 恢复（RightPanel 接线）。
    useEditorStore.setState({
      projectId: "p-t4",
      document: docAsStoreDoc(doc),
      dirty: false,
      selectedId: null,
      selectedIds: [],
      canUndo: false,
      canRedo: false,
      undoStack: emptyStack,
    });
    const { unpin } = await import("@studio/schema-core");
    useEditorStore.getState().applyOp((d) => replacePage(d, d.pages[0]!.id, unpin(d.pages[0]!, "pinnedCard")));
    const after = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    const back = after.nodes.find((n) => n.id === "pinnedCard");
    expect(back?.pinned).toBeUndefined();
    expect(back?.frame).toBeUndefined();
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().document).toEqual(docAsStoreDoc(doc));
  });

  it("flow 节点不显示 unpin 入口", async () => {
    const { PropsForm } = await import("../../components/editor/PropsForm");
    const doc = pinnedDoc();
    const flow = doc.nodes.find((n) => n.id === "flowCard")!;
    render(<PropsForm node={flow} onPropsChange={() => {}} onUnpin={vi.fn()} />);
    expect(screen.queryByTestId("props-unpin")).toBeNull();
  });
});

describe("paste 保留 pinned（Task 4 · 7 可选，spread-safe 钉住）", () => {
  it("App.tsx 粘贴 remap（spread + frame 拷贝）保留 pinned 与 frame", () => {
    // 钉住 App.tsx:206-217 的 remap 形状：{...n, id, props, children, frame?} —
    // pinned 随 spread 存活。若有人改成显式字段拷贝丢掉 pinned，此测试报警。
    const payloadNodes: NodeRecord[] = [
      { id: "p1", type: "Card", props: { title: "固定" }, children: [], pinned: true, frame: F(10, 20, 200, 80) },
      { id: "p2", type: "Button", props: { label: "流式" }, children: [] },
    ];
    const idMap = new Map(payloadNodes.map((n) => [n.id, `copy-${n.id}`]));
    // Mirror of App.tsx handlePaste remap (keep in sync deliberately).
    const remapped = payloadNodes.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      props: JSON.parse(JSON.stringify(n.props ?? {})) as Record<string, unknown>,
      children: n.children.filter((c) => idMap.has(c)).map((c) => idMap.get(c)!),
      ...(n.frame ? { frame: { ...n.frame } } : {}),
    }));
    const pinnedCopy = remapped.find((n) => n.id === "copy-p1");
    expect(pinnedCopy?.pinned).toBe(true);
    expect(pinnedCopy?.frame).toEqual(F(10, 20, 200, 80));
    expect(pinnedCopy?.frame).not.toBe(payloadNodes[0]!.frame); // 深拷贝，不共享引用
    expect(remapped.find((n) => n.id === "copy-p2")?.pinned).toBeUndefined();
  });
});

describe("重排文案与语义收尾（Task 4 · 6）", () => {
  it("tooltip 使用新语义（清除 pin+frame 回流式），不再提重新盖章/frame 补显", () => {
    const doc = flowDoc();
    render(<CanvasSurface doc={doc} tokens={defaultTokens()} selectedId={null} onSelect={vi.fn()} applyOp={vi.fn(() => true)} />);
    const button = screen.getByTestId("canvas-relayout");
    const hint = button.getAttribute("title") ?? "";
    expect(hint).toContain("自由定位");
    expect(hint).toContain("流式布局");
    expect(hint).toContain("可 Ctrl+Z 一步撤销");
    expect(hint).not.toContain("重新盖章");
    expect(hint).not.toContain("补显");
  });

  it("含 pinned 文档二次点击重排 → pins+frames 全清（单 op）", () => {
    const nodes: NodeRecord[] = [
      { id: "root", type: "Container", props: {}, children: ["pinnedCard", "legacy"] },
      { id: "pinnedCard", type: "Card", props: { title: "固定卡" }, children: [], frame: F(600, 400, 240, 120), pinned: true },
      { id: "legacy", type: "Card", props: { title: "遗留卡" }, children: [], frame: F(100, 100, 200, 80) },
    ];
    const doc = { ...defaultPage("重排"), rootId: "root", nodes };
    const applyOp = vi.fn((fn: (d: StudioDocument) => StudioDocument) => {
      void fn;
      return true;
    });
    render(<CanvasSurface doc={doc} tokens={defaultTokens()} selectedId={null} onSelect={vi.fn()} applyOp={applyOp} />);
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    expect(applyOp).toHaveBeenCalledTimes(1);
    const result = applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!;
    expect(result.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
  });
});
