import { act, cleanup, renderHook } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, pin, relayoutDocument, type NodeRecord, type Page, type StudioDocument } from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RELAYOUT_CONFIRM_MS, useRelayout } from "./useRelayout";
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
 * 重排画布 wiring (Plan C): two-click confirmation, single applyOp per reset,
 * and the no-op guard for an already-flow document (no undo entry, no dirty
 * flag). The reset math itself is schema-core's relayout test.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const F = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });

/** Legacy P5-era doc: frames stamped everywhere, one node unplaced. */
function framedDoc(): Page {
  const nodes: NodeRecord[] = [
    { id: "app", type: "AppShell", props: {}, children: ["sec"], frame: F(0, 0, 1440, 900) },
    { id: "sec", type: "Section", props: {}, children: ["btn", "loose"], frame: F(24, 88, 1392, 300) },
    { id: "btn", type: "Button", props: { label: "按钮" }, children: [], frame: F(48, 120, 200, 56) },
    { id: "loose", type: "Card", props: { title: "补丁插入" }, children: [] },


  ];
  return { ...defaultPage("重排测试"), rootId: "app", nodes };
}

/** Doc in the post-reset shape: every node flow (no frame, no pin). */
function alignedDoc(): Page {
  return relayoutDocument(framedDoc());
}

/** Typed op spy: applyOp receives the document transform as its only argument. */
function opSpy() {
  return vi.fn((fn: (d: StudioDocument) => StudioDocument) => {
    void fn;
    return true;
  });
}

function setup(doc: Page) {
  const applyOp = opSpy();
  const view = renderHook(() => useRelayout(doc, applyOp));
  return { applyOp, view };
}

describe("useRelayout（重排画布按钮）", () => {
  it("首次点击只进入确认态，不触发 applyOp", () => {
    const { applyOp, view } = setup(framedDoc());
    act(() => view.result.current.request());
    expect(view.result.current.armed).toBe(true);
    expect(applyOp).not.toHaveBeenCalled();
  });

  it("二次点击执行重排：全部 frame 与 pin 被清（整页重置回 flow），一步 applyOp", () => {
    const doc = pin(framedDoc(), "btn", F(900, 700, 200, 56));
    const { applyOp, view } = setup(doc);
    act(() => view.result.current.request());
    act(() => view.result.current.request());
    expect(applyOp).toHaveBeenCalledTimes(1);
    expect(view.result.current.armed).toBe(false);
    const op = applyOp.mock.calls[0]![0];
    const next = op(docAsStoreDoc(doc)).pages[0]!; // (whole doc op)
    expect(next.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
    // 提交的 op 是纯替换：不读入参、不改入参 —— editorStore 压进撤销栈的
    // 旧文档因此原样保留，undo 一步即回到重排前的 placement。
    expect(op(docAsStoreDoc(relayoutDocument(doc)))).toEqual(docAsStoreDoc(next));
    expect(doc.nodes.find((n) => n.id === "btn")!.pinned).toBe(true);
    expect(doc.nodes.find((n) => n.id === "btn")!.frame).toEqual(F(900, 700, 200, 56));
    expect(doc.nodes.find((n) => n.id === "loose")!.frame).toBeUndefined();
  });

  it("应用的是整篇文档重置结果：手工 pin/frame 一并清除（不再重新盖章）", () => {
    const base = framedDoc();
    // 手工把 btn 拖到 (900, 700) 并 pin：整页重置必须清掉这个豁免
    const doc = pin(base, "btn", F(900, 700, 200, 56));
    const { applyOp, view } = setup(doc);
    act(() => view.result.current.request());
    act(() => view.result.current.request());
    const next = applyOp.mock.calls[0]![0](docAsStoreDoc(doc)).pages[0]!;
    const btn = next.nodes.find((n) => n.id === "btn")!;
    expect(btn.frame).toBeUndefined();
    expect(btn.pinned).toBeUndefined();
    expect(next).toEqual(relayoutDocument(doc));
  });

  it("文档已与重置结果一致时：不产生 applyOp（不脏标记 / 不占撤销栈）", () => {
    const doc = alignedDoc();
    const { applyOp, view } = setup(doc);
    act(() => view.result.current.request());
    act(() => view.result.current.request());
    expect(applyOp).not.toHaveBeenCalled();
  });

  it("确认窗口超时后自动解除，不会误触执行", () => {
    vi.useFakeTimers();
    const { applyOp, view } = setup(framedDoc());
    act(() => view.result.current.request());
    expect(view.result.current.armed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(RELAYOUT_CONFIRM_MS + 10);
    });
    expect(view.result.current.armed).toBe(false);
    // 超时后再点一次只重新进入确认态
    act(() => view.result.current.request());
    expect(applyOp).not.toHaveBeenCalled();
  });
});

describe("重排 × editorStore（undo 一步恢复原状）", () => {
  it("二次确认经真实 applyOp 提交：全篇回 flow + dirty，Ctrl+Z 一步回到原文档", () => {
    const doc = pin(framedDoc(), "btn", F(900, 700, 200, 56));
    useEditorStore.setState({
      projectId: "p-relayout",
      document: docAsStoreDoc(doc),
      dirty: false,
      selectedId: null,
      selectedIds: [],
      canUndo: false,
      canRedo: false,
      undoStack: emptyStack,
    });
    const view = renderHook(() => useRelayout(doc, (fn) => useEditorStore.getState().applyOp(fn)));
    act(() => view.result.current.request());
    act(() => view.result.current.request());

    const laidOut = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    expect(laidOut.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
    expect(useEditorStore.getState().dirty).toBe(true);

    // undo 一步：回到重排前的文档（原 pin/frame 原样，无 frame 节点仍无 frame）
    expect(useEditorStore.getState().undo()).toBe(true);
    const restored = (useEditorStore.getState().document as StudioDocument).pages[0]!;
    expect(restored.nodes.find((n) => n.id === "btn")!.pinned).toBe(true);
    expect(restored.nodes.find((n) => n.id === "btn")!.frame).toEqual(F(900, 700, 200, 56));
    expect(restored.nodes.find((n) => n.id === "loose")!.frame).toBeUndefined();
    expect(useEditorStore.getState().canUndo).toBe(false);
  });
});
