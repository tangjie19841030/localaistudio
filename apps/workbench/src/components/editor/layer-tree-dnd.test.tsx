import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, type StudioDocument, type Page } from "@studio/schema-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerTree } from "./LayerTree";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

// P1-9 拖拽排序测试。jsdom 没有真实指针与布局，走 dnd-kit KeyboardSensor 的
// 键盘路径：Space 拾起 → 方向键移动（每次 ArrowDown = +25px，与行高对齐）→
// Space 放下。为了让 closestCenter 碰撞检测可算，把每行 treeitem 的
// getBoundingClientRect mock 成 24px 高、按渲染顺序垂直堆叠。
//
// 快速拖拽辅助：renderTree + keyDrag。

const ROW_H = 24;

const deepDoc = (): Page => ({ ...defaultPage("拖拽测试"), rootId: "root",
  nodes: [
    { id: "root", type: "Section", props: { title: "外层", description: "" }, children: ["sec", "btn"] },
    // 容器节点：可作为合法落点
    { id: "sec", type: "Card", props: { title: "卡片", padded: true }, children: ["stat"] },
    // 非容器节点：拖入必须被拒
    { id: "stat", type: "StatCard", props: { label: "GMV", value: "1", delta: "+1%", tone: "brand" }, children: [] },
    { id: "btn", type: "Button", props: { label: "保存", variant: "primary", size: "md" }, children: [] },
  ],


});

/** Vertical stacking rects for every row, keyed by node id text prefix. */
function mockRowRects(): void {
  const rows = Array.from(document.querySelectorAll('[role="treeitem"]')) as HTMLElement[];
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({ top: i * ROW_H, bottom: (i + 1) * ROW_H, left: 0, right: 120, width: 120, height: ROW_H }) as DOMRect;
  });
}

interface KeyDragOpts {
  doc: Page;
  onMove?: ReturnType<typeof vi.fn>;
  arrows: string[]; // "down" | "up" 等，映射到 ArrowDown/ArrowUp
  fromName: RegExp; // 拾起行的可访问名
}

/** Render + keyboard-drag one node by the given arrow sequence. */
async function keyDrag({ doc, onMove, arrows, fromName }: KeyDragOpts) {
  const noop = () => {};
  render(
    <LayerTree
      doc={doc}
      selectedId={null}
      onSelect={noop}
      onRemove={noop}
      onMove={onMove}
    />,
  );
  mockRowRects();
  const row = screen.getByRole("treeitem", { name: fromName });
  row.focus();
  // 拾起：KeyboardSensor setTimeout(0) 后才在 document 上挂 keydown 监听
  fireEvent.keyDown(row, { code: "Space", key: " " });
  await vi.waitFor(() => expect(row).toHaveAttribute("aria-pressed", "true"));
  for (const dir of arrows) {
    const code = dir === "down" ? "ArrowDown" : dir === "up" ? "ArrowUp" : dir === "right" ? "ArrowRight" : "ArrowLeft";
    fireEvent.keyDown(document, { code, key: code });
    await tick(2);
  }
  fireEvent.keyDown(document, { code: "Space", key: " " }); // 放下
  await tick(2);
}

/** Flush pending timers (sensor attaches its keydown listener via setTimeout(0)). */
function tick(times = 1): Promise<void> {
  let p: Promise<void> = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
}

beforeEach(cleanup);
afterEach(cleanup);

describe("LayerTree 拖拽（键盘路径）", () => {
  // 注：jsdom 下 dnd-kit 的 droppable 测量是异步批处理，ArrowUp 的位移
  // 在“下一次” keydown 时才反映到碰撞检测（实测 UP1 仍 over=btn，UP2→stat，UP3→sec）。
  // 因此目标行的箭头次数按“滞后一步”的实测序列选定。

  it("合法目标：拖 Button 到 Card 行 → onMove(id, card, 末位索引)", async () => {
    const onMove = vi.fn();
    // 行序 root(0) sec(1) stat(2) btn(3)；实测 4 次 up 后 over=sec（稳定序列）
    await keyDrag({ doc: deepDoc(), onMove, fromName: /按钮/, arrows: ["up", "up", "up", "up"] });
    // 移入 Card → 追加为其第 2 个子节点（children.length=1 → index 1）
    expect(onMove).toHaveBeenCalledWith("btn", "sec", 1);
  });

  it("非容器目标：拖 Button 到 StatCard 行 → 不触发 onMove", async () => {
    const onMove = vi.fn();
    // 实测 2 次 up 后 over=stat（非容器 StatCard），落下必须被拒
    await keyDrag({ doc: deepDoc(), onMove, fromName: /按钮/, arrows: ["up", "up"] });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("拖入自身后代：拖 Card 到 StatCard 行 → 不触发 onMove", async () => {
    const onMove = vi.fn();
    // sec(中心36) 向下；实测 2 次 down 后 over=stat —— stat 是 sec 的后代，落下必须被拒
    await keyDrag({ doc: deepDoc(), onMove, fromName: /卡片/, arrows: ["down", "down"] });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("未传 onMove：键盘拖拽全流程不炸", async () => {
    const noop = () => {};
    render(
      <LayerTree doc={deepDoc()} selectedId={null} onSelect={noop} onRemove={noop} />,
    );
    mockRowRects();
    const row = screen.getByRole("treeitem", { name: /按钮/ });
    row.focus();
    // 未传 onMove → sensors=[]：拾起不生效（无 aria-pressed），按键全流程无异常
    fireEvent.keyDown(row, { code: "Space", key: " " });
    await tick(2);
    fireEvent.keyDown(document, { code: "ArrowDown", key: "ArrowDown" });
    await tick();
    fireEvent.keyDown(document, { code: "Space", key: " " });
    await tick(2);
    expect(document.querySelectorAll('[role="treeitem"]').length).toBe(4);
    expect(row).not.toHaveAttribute("aria-pressed", "true");
  });
});
