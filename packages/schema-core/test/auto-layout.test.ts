import { describe, expect, it } from "vitest";
import type { Frame, NodeRecord, Page, StudioDocument } from "../src/document.js";
import { defaultTokens, DOCUMENT_VERSION } from "../src/document.js";

/** Wrap a page fixture into a minimal single-page StudioDocument (tool ctx). */
function ctxDocOf(page: Page): StudioDocument {
  return {
    documentVersion: DOCUMENT_VERSION,
    name: page.name,
    tokens: defaultTokens(),
    pages: [page],
  };
}
import { AUTO_LAYOUT_PAGE, autoLayout } from "../src/registry/autoLayout.js";
import { frameRects, type Rect } from "../src/registry/canvasLayout.js";
import { toolByName } from "../src/agent/tools.js";

const node = (id: string, type: string, children: string[] = [], props: Record<string, unknown> = {}, frame?: Frame): NodeRecord => ({
  id,
  type,
  props,
  children,
  ...(frame ? { frame } : {}),
});

const frame = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

const rectOf = (f: Frame): Rect => ({ x: f.x, y: f.y, w: f.w, h: f.h });

/** 严格相交（贴边不算）。 */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** AppShell > Section(stack-v) > [Header, Grid(grid) > [StatCard ×3], Button] 全无 frame。 */
function threeLayerDoc(): Page {
  return {
    id: "page-1",
    name: "自动布局测试页",
    rootId: "app",
    nodes: [
      node("app", "AppShell", ["sec"]),
      node("sec", "Section", ["head", "grid", "btn"]),
      node("head", "Header"),
      node("grid", "Grid", ["s1", "s2", "s3"]),
      node("s1", "StatCard"),
      node("s2", "StatCard"),
      node("s3", "StatCard"),
      node("btn", "Button"),
    ],
  };
}

const get = (doc: Page, id: string) => doc.nodes.find((n) => n.id === id)!.frame!;

describe("autoLayout", () => {
  it("全无 frame 的三层树：所有节点获得 frame，兄弟矩形不相交，全部落在 root 扩展边界内", () => {
    const out = autoLayout(threeLayerDoc());
    for (const n of out.nodes) expect(n.frame, n.id).toBeDefined();
    // root 基础为整页 1440×900（内容多时高度向上扩，不缩）
    const root = get(out, "app");
    expect(root.x).toBe(0);
    expect(root.y).toBe(0);
    expect(root.w).toBe(AUTO_LAYOUT_PAGE.w);
    expect(root.h).toBeGreaterThanOrEqual(AUTO_LAYOUT_PAGE.h);
    // 同父兄弟不相交
    const ids = ["sec"];
    const secKids = ["head", "grid", "btn"];
    const gridKids = ["s1", "s2", "s3"];
    const pairwise = (kids: string[]): void => {
      for (let i = 0; i < kids.length; i += 1) {
        for (let j = i + 1; j < kids.length; j += 1) {
          const a = rectOf(get(out, kids[i]!));
          const b = rectOf(get(out, kids[j]!));
          expect(overlaps(a, b), `${kids[i]} vs ${kids[j]}`).toBe(false);
        }
      }
    };
    pairwise(ids);
    pairwise(secKids);
    pairwise(gridKids);
    // 所有节点都在 root（含高度扩展）内
    for (const n of out.nodes) {
      expect(inside(rectOf(n.frame!), rectOf(root)), n.id).toBe(true);
    }
    // shell 语义：首个子节点顶部 = root 顶 + 64 顶栏 + 24 内边距
    expect(get(out, "sec").y).toBe(SHELL_TOP + 24);
  });

  it("叶子按类别取默认高、按父内容宽取宽（StatCard data=240；grid 单列宽=父内容宽）", () => {
    const out = autoLayout(threeLayerDoc());
    const grid = get(out, "grid");
    const colW = (grid.w - 48 - 16) / 2; // grid 内容宽（w−左右 padding）两列减列间距
    expect(get(out, "s1").h).toBe(240); // StatCard 属 data
    expect(get(out, "s1").w).toBe(colW);
    expect(get(out, "s2").x).toBe(grid.x + 24 + colW + 16); // 第二列右移一列
    expect(get(out, "s3").y).toBeGreaterThan(get(out, "s1").y); // 第三张换行
    expect(get(out, "btn").h).toBe(56); // Button 属 form
    expect(get(out, "head").h).toBe(64); // Header 属 layout
  });

  it("已有 frame 的节点原样保留（含 rotation），无 frame 的补齐；不改入参", () => {
    const source = threeLayerDoc();
    const manual: Frame = { x: 500, y: 300, w: 180, h: 90, rotation: 45 };
    const mixed: Page = {
      ...source,
      nodes: source.nodes.map((n) => (n.id === "btn" ? { ...n, frame: manual } : n)),
    };
    const frozen = JSON.parse(JSON.stringify(mixed)) as Page;
    const out = autoLayout(mixed);
    expect(get(out, "btn")).toEqual(manual); // 逐字段相等，含 rotation
    expect(get(out, "head")).toBeDefined(); // 其余节点补齐
    for (const id of ["app", "sec", "head", "grid", "s1", "s2", "s3"]) {
      expect(out.nodes.find((n) => n.id === id)!.frame, id).toBeDefined();
    }
    expect(mixed).toEqual(frozen); // 入参未被修改
  });

  it("幂等：第二次 autoLayout 不改变任何 frame", () => {
    const once = autoLayout(threeLayerDoc());
    const twice = autoLayout(once);
    expect(twice.nodes).toEqual(once.nodes);
    // 已全有 frame 的文档：内容等价（引用可不同）
    const mixedSource = threeLayerDoc();
    const allFramed = autoLayout({
      ...mixedSource,
      nodes: mixedSource.nodes.map((n) => ({ ...n, frame: frame(10, 20, 300, 100) })),
    });
    expect(autoLayout(allFramed).nodes).toEqual(allFramed.nodes);
  });

  it("root 已有 frame 时以其 x/y/w 为基准，h 初始 900 起步", () => {
    const source = threeLayerDoc();
    const doc: Page = {
      ...source,
      nodes: source.nodes.map((n) => (n.id === "app" ? { ...n, frame: frame(100, 60, 800, 400) } : n)),
    };
    const out = autoLayout(doc);
    const root = get(out, "app");
    expect(root).toEqual(frame(100, 60, 800, 400)); // root frame 原样保留
    // 子树从 root 内容区起排（页面绝对坐标：x+24，shell 再加 64 顶栏）
    expect(get(out, "sec").x).toBe(100 + 24);
    expect(get(out, "sec").y).toBe(60 + 64 + 24);
    expect(get(out, "sec").w).toBe(800 - 48);
  });

  it("空 children 容器：最小高度 = 上下 padding 之和（48）", () => {
    const doc: Page = {
      id: "page-1",
      name: "空容器",
      rootId: "r",
      nodes: [
        node("r", "Section", ["empty", "t"]),
        node("empty", "Card", []),
        node("t", "Text"),
      ],
    };
    const out = autoLayout(doc);
    expect(get(out, "empty").h).toBe(48); // 24 top + 24 bottom，零内容
    expect(get(out, "empty").w).toBeGreaterThan(0);
  });

  it("未知类型叶子按防御默认（h=80），带 children 的非容器叶子按容器处理", () => {
    const doc: Page = {
      id: "page-1",
      name: "防御分支",
      rootId: "r",
      nodes: [
        node("r", "Container", ["odd", "weird"]),
        node("odd", "NotAComponent"),
        node("weird", "Button", ["inner"]),
        node("inner", "Text"),
      ],
    };
    const out = autoLayout(doc);
    expect(get(out, "odd").h).toBe(80); // 未知类别默认
    // Button 有 children → 按容器处理：子节点获得 frame，自身为容器高度
    expect(out.nodes.find((n) => n.id === "inner")!.frame).toBeDefined();
    expect(get(out, "weird").h).toBeGreaterThanOrEqual(48);
    expect(out.nodes.some((n) => !n.frame)).toBe(false);
  });

  it("返回新对象：root 引用相同但 nodes 数组为新（不可变契约）", () => {
    const doc = threeLayerDoc();
    const out = autoLayout(doc);
    expect(out).not.toBe(doc);
    expect(out.rootId).toBe(doc.rootId);
    expect(out.rootId).toBe(doc.rootId);
    expect(doc.nodes.every((n) => n.frame === undefined)).toBe(true); // 原文档仍无 frame
  });
});

const SHELL_TOP = 64;

/** propose_document 集成：generate 路径提交无 frame 文档后全部节点有 frame。 */
describe("propose_document × autoLayout（集成）", () => {
  it("经工具提交的无 frame 文档 → 返回 doc 所有节点有 frame，message 提示已自动布局", () => {
    const tool = toolByName("propose_document")!;
    const ctxPage = threeLayerDoc();
    const result = tool.execute({ document: ctxPage }, { page: ctxPage, doc: ctxDocOf(ctxPage) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resultPage = result.doc.pages[0]!;
    for (const n of resultPage.nodes) expect(n.frame, n.id).toBeDefined();
    expect(frameRects(resultPage).size).toBe(resultPage.nodes.length);
    expect(result.message).toContain("自动布局");
  });

  it("已带 frame 的提案 → frame 原样保留，不被重排", () => {
    const tool = toolByName("propose_document")!;
    const manual: Frame = { x: 77, y: 88, w: 200, h: 120, rotation: 30 };
    const source = threeLayerDoc();
    const pre: Page = {
      ...source,
      nodes: source.nodes.map((n) => (n.id === "s1" ? { ...n, frame: manual } : n)),
    };
    const result = tool.execute({ document: pre }, { page: pre, doc: ctxDocOf(pre) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0]!.nodes.find((n) => n.id === "s1")!.frame).toEqual(manual);
  });

  it("Grid columns=3 → 三列等宽布局，不与两列假设混淆", () => {
    const doc: Page = {
      id: "page-1",
      name: "三列栅格页",
      rootId: "app",
      nodes: [
        node("app", "AppShell", ["grid"]),
        node("grid", "Grid", ["a", "b", "c"], { columns: 3, gap: 4 }),
        node("a", "Card"),
        node("b", "Card"),
        node("c", "Card"),
      ],
    };
    const out = autoLayout(doc);
    const a = get(out, "a");
    const b = get(out, "b");
    const c = get(out, "c");
    expect(b.x).toBeGreaterThan(a.x + a.w);
    expect(c.x).toBeGreaterThan(b.x + b.w);
    expect(a.w).toBe(b.w);
    expect(b.w).toBe(c.w);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
  });
});

