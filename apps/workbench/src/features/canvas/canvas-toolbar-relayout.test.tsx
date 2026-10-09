import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultPage, defaultTokens, defaultStudioDocument, relayoutDocument, type NodeRecord, type Page, type StudioDocument } from "@studio/schema-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface } from "./CanvasSurface";

/**
 * 重排画布按钮接线（jsdom 级）：按钮存在于画布工具条、二次点击才执行、
 * 执行时提交一次 applyOp 且结果是整篇文档重置回 flow（frame 与 pin 全清）。
 *
 * T19 v2 fixtures: the surface takes the ACTIVE page (`doc: Page`) + tokens;
 * applyOp is doc-level so ops are evaluated against a single-page StudioDocument.
 */

afterEach(cleanup);

const F = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });

/** 存量画布文档：带遗留 frame，其中 sec 被手工 pin（自由定位豁免）。 */
function docWithLooseNode(): Page {
  const nodes: NodeRecord[] = [
    { id: "app", type: "AppShell", props: {}, children: ["sec"], frame: F(0, 0, 1440, 900) },
    { id: "sec", type: "Section", props: {}, children: ["loose"], frame: F(24, 88, 1392, 300), pinned: true },
    { id: "loose", type: "Card", props: { title: "补丁插入" }, children: [] },
  ];
  return { ...defaultPage("重排接线"), rootId: "app", nodes };
}

/** T19: store holds the whole doc; op fns are evaluated against it. */
function docAsStoreDoc(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}

/** Typed op spy: applyOp receives the document transform as its only argument. */
function opSpy() {
  return vi.fn((fn: (d: ReturnType<typeof docAsStoreDoc>) => ReturnType<typeof docAsStoreDoc>) => {
    void fn;
    return true;
  });
}

function setup() {
  const doc = docWithLooseNode();
  const applyOp = opSpy();
  render(
    <CanvasSurface doc={doc} tokens={defaultTokens()} selectedId={null} onSelect={vi.fn()} applyOp={applyOp} />,
  );
  return { doc, applyOp };
}

describe("画布工具条 · 重排画布", () => {
  it("工具条含重排按钮，初始未进入确认态", () => {
    setup();
    const button = screen.getByTestId("canvas-relayout");
    expect(button).toHaveTextContent("重排画布");
    expect(button).not.toHaveAttribute("data-armed");
  });

  it("首次点击只进入确认态（按钮文案与 data-armed 变化），不提交 applyOp", () => {
    const { applyOp } = setup();
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    const button = screen.getByTestId("canvas-relayout");
    expect(button).toHaveAttribute("data-armed", "true");
    expect(button).toHaveTextContent("确认重排");
    expect(applyOp).not.toHaveBeenCalled();
  });

  it("二次点击提交一次 applyOp：整篇文档回 flow（frame 与 pin 全清）", () => {
    const { doc, applyOp } = setup();
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    expect(applyOp).toHaveBeenCalledTimes(1);
    const op = applyOp.mock.calls[0]![0];
    const result = op(docAsStoreDoc(doc));
    expect(result.pages[0]!.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
    expect(result.pages[0]).toEqual(relayoutDocument(doc));
  });

  it("已对齐文档：二次点击也不提交（无脏标记）", () => {
    const aligned = relayoutDocument(docWithLooseNode());
    const applyOp = opSpy();
    render(
      <CanvasSurface doc={aligned} tokens={defaultTokens()} selectedId={null} onSelect={vi.fn()} applyOp={applyOp} />,
    );
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    expect(applyOp).not.toHaveBeenCalled();
  });

  it("按钮不吞画布指针手势（点击重排不改变选中）", () => {
    const onSelect = vi.fn();
    const doc = docWithLooseNode();
    render(
      <CanvasSurface
        doc={doc}
        tokens={defaultTokens()}
        selectedId="sec"
        onSelect={onSelect}
        applyOp={vi.fn(() => true)}
        // 注入页面级 flow 矩形：重排按钮在内容层之外，这里保证画布命中检测
        // 只依赖注入的 rect（jsdom 无布局）。
        flowRects={new Map([["app", { x: 0, y: 0, w: 1440, h: 900 }]])}
      />,
    );
    fireEvent.pointerDown(screen.getByTestId("canvas-relayout"), { button: 0 });
    fireEvent.pointerUp(screen.getByTestId("canvas-relayout"), { button: 0 });
    fireEvent.click(screen.getByTestId("canvas-relayout"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
