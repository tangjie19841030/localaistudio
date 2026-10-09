import { describe, expect, it } from "vitest";
import type { Frame, NodeRecord, Page } from "../src/document.js";
import { defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import { autoLayout } from "../src/registry/autoLayout.js";
import { clearPlacement, hasSameFrames, relayoutDocument } from "../src/registry/relayout.js";

const node = (
  id: string,
  type: string,
  children: string[] = [],
  props: Record<string, unknown> = {},
  frame?: Frame,
): NodeRecord => ({ id, type, props, children, ...(frame ? { frame } : {}) });

const frame = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

/** AppShell > Section(stack-v) > [Header, Grid > StatCard ×3, Button] — mirrors auto-layout.test.ts. */
function threeLayerDoc(): Page {
  return {
    id: "page-1",
    name: "重排测试页",
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

const byId = (doc: Page, id: string) => doc.nodes.find((n) => n.id === id)!;

/** Per-id frame map (id -> frame | undefined) for whole-document comparison. */
function framesOf(doc: Page): Map<string, Frame | undefined> {
  return new Map(doc.nodes.map((n) => [n.id, n.frame]));
}

describe("clearPlacement", () => {
  it("移除所有节点的 frame 与 pinned，其余字段保持", () => {
    const source = autoLayout(threeLayerDoc());
    const pinned: Page = {
      ...source,
      nodes: source.nodes.map((n) => (n.id === "btn" ? { ...n, pinned: true } : n)),
    };
    const cleared = clearPlacement(pinned);
    expect(cleared.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
    expect(cleared.name).toBe(pinned.name);
    expect(cleared.rootId).toBe(pinned.rootId);
    expect(cleared.nodes.map((n) => n.id)).toEqual(pinned.nodes.map((n) => n.id));
    // 非定位字段原样保留
    expect(cleared.nodes.find((n) => n.id === "sec")!.children).toEqual(["head", "grid", "btn"]);
  });

  it("无 frame 也无 pinned 时原样返回（引用相同，避免无谓的新对象）", () => {
    const doc = threeLayerDoc();
    expect(clearPlacement(doc)).toBe(doc);
  });

  it("不修改输入文档（不可变契约）", () => {
    const source = autoLayout(threeLayerDoc());
    clearPlacement(source);
    expect(source.nodes.every((n) => n.frame !== undefined)).toBe(true);
  });
});

describe("relayoutDocument", () => {
  it("全无 placement 的文档：no-op（引用相同，仍是 flow）", () => {
    const doc = threeLayerDoc();
    const out = relayoutDocument(doc);
    expect(out).toBe(doc);
    expect(out.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
  });

  it("带遗留 frame 的存量文档：frame 全清，不重新盖章（与 autoLayout 盖章语义相反）", () => {
    const source = threeLayerDoc();
    const manual = frame(900, 700, 200, 120);
    const pre: Page = {
      ...source,
      nodes: source.nodes.map((n) => (n.id === "s1" ? { ...n, frame: manual } : n)),
    };
    const out = relayoutDocument(pre);
    expect(out.nodes.every((n) => n.frame === undefined)).toBe(true);
    // autoLayout 本身会保留已有 frame：对照组证明差异来自清除这一步
    expect(byId(autoLayout(pre), "s1").frame).toEqual(manual);
  });

  it("pinned 节点：重排同时清 pinned 与 frame（整页重置回 flow）", () => {
    const aligned = autoLayout(threeLayerDoc());
    const pinned: Page = {
      ...aligned,
      nodes: aligned.nodes.map((n) => (n.id === "btn" ? { ...n, pinned: true } : n)),
    };
    const out = relayoutDocument(pinned);
    expect(byId(out, "btn").pinned).toBeUndefined();
    expect(byId(out, "btn").frame).toBeUndefined();
    expect(out.nodes.every((n) => n.pinned === undefined && n.frame === undefined)).toBe(true);
    // 输入文档不受影响
    expect(byId(pinned, "btn").pinned).toBe(true);
  });

  it("已 flow 的文档：重排结果逐节点一致（幂等，不动文档即可跳过）", () => {
    const flow = relayoutDocument(autoLayout(threeLayerDoc()));
    const again = relayoutDocument(flow);
    expect(again).toBe(flow);
    expect(framesOf(again)).toEqual(framesOf(flow));
    expect(hasSameFrames(again, flow)).toBe(true);
  });

  it("patch 插入的节点：重排后仍是 flow（不再获得盖章 frame）", () => {
    const aligned = autoLayout(threeLayerDoc());
    const injected: NodeRecord = node("injected", "Card", [], { title: "新插入" });
    const patched: Page = {
      ...aligned,
      nodes: [
        ...aligned.nodes.map((n) => (n.id === "sec" ? { ...n, children: [...n.children, "injected"] } : n)),
        injected,
      ],
    };
    expect(byId(patched, "injected").frame).toBeUndefined();
    const out = relayoutDocument(patched);
    expect(byId(out, "injected").frame).toBeUndefined();
    expect(out.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
  });
});

describe("hasSameFrames", () => {
  it("同一文档（引用相同）恒为 true", () => {
    const doc = autoLayout(threeLayerDoc());
    expect(hasSameFrames(doc, doc)).toBe(true);
  });

  it("frame 全部相同的两份文档为 true（引用不同）", () => {
    const a = autoLayout(threeLayerDoc());
    const b = autoLayout(threeLayerDoc());
    expect(a).not.toBe(b);
    expect(hasSameFrames(a, b)).toBe(true);
  });

  it("任一节点 frame 不同 / 缺失即 false", () => {
    const a = autoLayout(threeLayerDoc());
    const shifted: Page = {
      ...a,
      nodes: a.nodes.map((n) => (n.id === "s1" ? { ...n, frame: { ...n.frame!, x: n.frame!.x + 7 } } : n)),
    };
    expect(hasSameFrames(a, shifted)).toBe(false);
    expect(hasSameFrames(a, threeLayerDoc())).toBe(false); // 对方完全无 frame
  });

  it("pinned 状态不同即 false（no-op 判定覆盖 pinned）", () => {
    const a = autoLayout(threeLayerDoc());
    const pinned: Page = {
      ...a,
      nodes: a.nodes.map((n) => (n.id === "btn" ? { ...n, pinned: true } : n)),
    };
    expect(hasSameFrames(a, pinned)).toBe(false);
    expect(hasSameFrames(pinned, a)).toBe(false);
    expect(hasSameFrames(pinned, { ...pinned, nodes: pinned.nodes.map((n) => ({ ...n })) })).toBe(true);
  });

  it("pinned:false 与缺省 pinned 视为一致（同为 flow）", () => {
    const a = autoLayout(threeLayerDoc());
    const explicitFalse: Page = {
      ...a,
      nodes: a.nodes.map((n) => ({ ...n, pinned: false })),
    };
    expect(hasSameFrames(a, explicitFalse)).toBe(true);
  });

  it("节点集合不同即 false", () => {
    const a = autoLayout(threeLayerDoc());
    const trimmed: Page = { ...a, nodes: a.nodes.filter((n) => n.id !== "btn") };
    expect(hasSameFrames(a, trimmed)).toBe(false);
  });
});
