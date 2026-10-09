import { describe, expect, it } from "vitest";
import type { Frame, NodeRecord, Page } from "../src/document.js";
import { checkPage, defaultTokens, DOCUMENT_VERSION, pageSchema, validateDocument } from "../src/document.js";
import { autoLayout } from "../src/registry/autoLayout.js";
import { OpError, cloneSubtree, duplicateNode, pin, setFrame, unpin } from "../src/registry/documentOps.js";
import { clearPlacement, hasSameFrames, relayoutDocument } from "../src/registry/relayout.js";
import { getNode } from "../src/registry/treeUtils.js";

/**
 * Plan C hybrid positioning: `pinned` is the node-level exemption flag. An
 * un-pinned node is flow and its frame is inert legacy metadata; `pinned +
 * frame` is absolute placement at page coordinates. These tests pin down the
 * schema round-trip, the pin/unpin ops (contract mirrored from setFrame) and
 * the relayout reset semantics.
 */

const frame = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

const node = (
  id: string,
  type: string,
  children: string[] = [],
  extra: Partial<Omit<NodeRecord, "id" | "type" | "children">> = {},
): NodeRecord => ({ id, type, props: {}, children, ...extra });

/** AppShell > Section > [Header, Button]; no frames, no pins. */
function plainDoc(): Page {
  return {
    id: "page-1",
    name: "pin 定位测试页",
    rootId: "app",
    nodes: [
      node("app", "AppShell", ["sec"]),
      node("sec", "Section", ["head", "btn"]),
      node("head", "Header"),
      node("btn", "Button"),
    ],
  };
}

/** Stored P5-era shape: every node framed, no `pinned` key anywhere. */
function legacyFramedDoc(): Page {
  return {
    id: "page-1",
    name: "存量画布文档",
    rootId: "app",
    nodes: [
      node("app", "AppShell", ["sec"], { frame: frame(0, 0, 1440, 900) }),
      node("sec", "Section", ["head", "btn"], { frame: frame(24, 88, 1392, 300) }),
      node("head", "Header", [], { frame: frame(48, 132, 1344, 80) }),
      node("btn", "Button", [], { frame: frame(48, 228, 200, 56) }),
    ],
  };
}

const byId = (doc: Page, id: string) => doc.nodes.find((n) => n.id === id)!;

/** Round-trip through the same JSON path as disk persistence (now doc-level, v2). */
const roundTrip = (doc: Page): Page => validateDocument(JSON.parse(JSON.stringify({ documentVersion: 2 as const, name: doc.name, tokens: defaultTokens(), pages: [doc] }))).pages[0]!;

/** Capture the OpError a failing op throws (asserts it throws at all). */
function caughtOpError(run: () => unknown): OpError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(OpError);
    return error as OpError;
  }
  throw new Error("expected the op to throw OpError");
}

describe("pinned 字段 · 旧文档 round-trip", () => {
  it("旧文档（多节点带 frame，无 pinned）：parse → serialize → parse 不失败、字段原样保留", () => {
    const legacy = legacyFramedDoc();
    expect(legacy.nodes.every((n) => n.pinned === undefined)).toBe(true);

    const parsed = roundTrip(legacy);
    expect(DOCUMENT_VERSION).toBe(2);
    expect(parsed).toEqual(legacy); // frame 逐字段保留，未注入任何默认 pinned
    expect(parsed.nodes.every((n) => n.frame !== undefined)).toBe(true);
    expect(pageSchema.safeParse(parsed).success).toBe(true);
    expect(checkPage(parsed)).toEqual([]);
  });

  it("旧文档（无 frame 无 pinned）：解析后仍无 pinned，DOCUMENT_VERSION 为 1", () => {
    const parsed = roundTrip(plainDoc());
    expect(DOCUMENT_VERSION).toBe(2);
    expect(parsed.nodes.every((n) => n.pinned === undefined && n.frame === undefined)).toBe(true);
    expect(parsed).toEqual(plainDoc());
  });

  it("带 pinned 的文档：round-trip 后 pinned 与 frame 均不丢（strip 模式不剥该键）", () => {
    const pinned = pin(legacyFramedDoc(), "btn", frame(-40, 700, 220, 56));
    const parsed = roundTrip(pinned);
    expect(getNode(parsed, "btn")!.pinned).toBe(true);
    expect(getNode(parsed, "btn")!.frame).toEqual(frame(-40, 700, 220, 56));
    expect(getNode(parsed, "sec")!.pinned).toBeUndefined(); // 未 pinned 节点不被写入默认值
    expect(parsed).toEqual(pinned);
  });

  it("pinned 非布尔值在形状层被拒绝", () => {
    const doc = plainDoc();
    doc.nodes[3]!.pinned = "yes" as unknown as boolean;
    expect(pageSchema.safeParse(doc).success).toBe(false);
  });

  it("pinned 与 frame 相互独立：pin 无 frame 可解析，frame 无 pin 可解析", () => {
    const doc = plainDoc();
    doc.nodes[3]!.pinned = true; // 半损坏/手写文档：有标记无几何
    expect(pageSchema.safeParse(doc).success).toBe(true);
    expect(roundTrip(doc)).toEqual(doc);

    const legacy = legacyFramedDoc(); // 存量：有几何无标记
    expect(pageSchema.safeParse(legacy).success).toBe(true);
    expect(legacy.nodes.every((n) => n.pinned === undefined && n.frame !== undefined)).toBe(true);
  });
});

describe("pin", () => {
  it("一次调用同时落 pinned=true 与 frame（页面级绝对坐标，负坐标合法）", () => {
    const manual = frame(-120.5, 780, 200, 56);
    const next = pin(plainDoc(), "btn", manual);
    expect(getNode(next, "btn")!.pinned).toBe(true);
    expect(getNode(next, "btn")!.frame).toEqual(manual);
    expect(checkPage(next)).toEqual([]);
  });

  it("不可变：原 doc 无 pinned/frame，未触碰节点保持引用相等", () => {
    const doc = plainDoc();
    const next = pin(doc, "btn", frame(10, 20, 30, 40));
    expect(next).not.toBe(doc);
    expect(next.nodes).not.toBe(doc.nodes);
    expect(getNode(next, "btn")).not.toBe(getNode(doc, "btn"));
    expect(getNode(next, "app")).toBe(getNode(doc, "app")); // 引用相等
    expect(getNode(next, "sec")).toBe(getNode(doc, "sec"));
    expect(getNode(doc, "btn")!.pinned).toBeUndefined();
    expect(getNode(doc, "btn")!.frame).toBeUndefined();
  });

  it("幂等：同 frame pin 两次结果等值；再次 pin 覆盖旧 frame", () => {
    const doc = plainDoc();
    const once = pin(doc, "btn", frame(10, 20, 30, 40));
    const twice = pin(once, "btn", frame(10, 20, 30, 40));
    expect(twice).toEqual(once);
    const moved = pin(once, "btn", frame(99, 88, 77, 66));
    expect(getNode(moved, "btn")!.frame).toEqual(frame(99, 88, 77, 66));
    expect(getNode(moved, "btn")!.pinned).toBe(true);
  });

  it("非法 frame 抛 OpError，原 doc 不变（w/h ≥ 1，rotation 0-360）", () => {
    const doc = plainDoc();
    for (const bad of [
      frame(0, 0, 0, 10),
      frame(0, 0, 10, 0.5),
      { x: 0, y: 0, w: 10, h: 10, rotation: 361 },
      { x: 0, y: 0, w: 10, h: 10, rotation: -1 },
    ]) {
      expect(() => pin(doc, "btn", bad)).toThrow(OpError);
    }
    expect(getNode(doc, "btn")!.pinned).toBeUndefined();
    expect(getNode(doc, "btn")!.frame).toBeUndefined();
  });

  it("未知节点抛 OpError（pin 不允许隐式建节点）", () => {
    expect(() => pin(plainDoc(), "ghost", frame(0, 0, 10, 10))).toThrow(OpError);
    expect(() => pin(plainDoc(), "ghost", frame(0, 0, 10, 10))).toThrow(/不存在/);
  });
});

describe("unpin", () => {
  it("一次调用同时清 pinned 与 frame，其余字段保持", () => {
    const pinned = pin(legacyFramedDoc(), "btn", frame(900, 700, 220, 56));
    const next = unpin(pinned, "btn");
    expect(getNode(next, "btn")!.pinned).toBeUndefined();
    expect(getNode(next, "btn")!.frame).toBeUndefined();
    expect(getNode(next, "btn")!.props).toEqual(pinned.nodes.find((n) => n.id === "btn")!.props);
    expect(next.nodes.map((n) => n.id)).toEqual(pinned.nodes.map((n) => n.id));
    expect(checkPage(next)).toEqual([]);
  });

  it("已是 flow 的节点：幂等（重复 unpin 等值，不残留键）", () => {
    const doc = plainDoc();
    const next = unpin(doc, "head");
    expect(getNode(next, "head")!.pinned).toBeUndefined();
    expect(getNode(next, "head")!.frame).toBeUndefined();
    expect(unpin(next, "head")).toEqual(next);
  });

  it("不可变：原 doc 保留 pinned+frame，未触碰节点保持引用相等", () => {
    const pinned = pin(plainDoc(), "btn", frame(10, 20, 30, 40));
    const next = unpin(pinned, "btn");
    expect(getNode(pinned, "btn")!.pinned).toBe(true);
    expect(getNode(pinned, "btn")!.frame).toEqual(frame(10, 20, 30, 40));
    expect(getNode(next, "app")).toBe(getNode(pinned, "app"));
  });

  it("未知节点抛 OpError", () => {
    const doc = plainDoc();
    expect(() => unpin(doc, "ghost")).toThrow(OpError);
    expect(() => unpin(doc, "ghost")).toThrow(/不存在/);
  });
});

describe("pin/unpin 错误契约（与 setFrame 同构）", () => {
  it("节点不存在：错误类、name 与 message 与 setFrame 完全一致", () => {
    const doc = plainDoc();
    const fromSetFrame = caughtOpError(() => setFrame(doc, "ghost", frame(0, 0, 10, 10)));
    const fromPin = caughtOpError(() => pin(doc, "ghost", frame(0, 0, 10, 10)));
    const fromUnpin = caughtOpError(() => unpin(doc, "ghost"));
    expect(fromSetFrame.name).toBe("OpError");
    expect(fromPin.message).toBe(fromSetFrame.message);
    expect(fromPin.reason).toBe(fromSetFrame.reason);
    expect(fromUnpin.message).toBe(fromSetFrame.message);
  });

  it("非法 frame：走同一 zod 校验路径，message 与 setFrame 一致", () => {
    const doc = plainDoc();
    const bad = { x: 0, y: 0, w: 0, h: 10, rotation: 0 };
    const fromSetFrame = caughtOpError(() => setFrame(doc, "btn", bad));
    const fromPin = caughtOpError(() => pin(doc, "btn", bad));
    expect(fromPin.message).toBe(fromSetFrame.message);
    expect(fromPin.message).toContain("frame 校验失败");
  });
});

describe("relayout · 整页重置回 flow", () => {
  it("带 pinned 节点的文档：重排后 pins 与 frames 全清，树结构不变", () => {
    const doc = pin(autoLayout(legacyFramedDoc()), "btn", frame(900, 700, 220, 56));
    expect(byId(doc, "btn").pinned).toBe(true);
    expect(doc.nodes.every((n) => n.frame !== undefined)).toBe(true);

    const next = relayoutDocument(doc);
    expect(next.nodes.every((n) => n.pinned === undefined)).toBe(true);
    expect(next.nodes.every((n) => n.frame === undefined)).toBe(true);
    expect(next.nodes.map((n) => n.id)).toEqual(doc.nodes.map((n) => n.id));
    expect(next.name).toBe(doc.name);
    expect(checkPage(next)).toEqual([]);
  });

  it("存量文档（未 pinned 带遗留 frame）：重排清 frame 且不重新盖章", () => {
    const legacy = autoLayout(legacyFramedDoc());
    const next = relayoutDocument(legacy);
    expect(next.nodes.every((n) => n.frame === undefined && n.pinned === undefined)).toBe(true);
    // 对照组：autoLayout 会原样保留已有 frame（重排不再走盖章路径）
    expect(autoLayout(legacy).nodes.every((n) => n.frame !== undefined)).toBe(true);
  });

  it("已 flow 对齐的文档：重排为 no-op（返回引用相同），hasSameFrames 判 same（不脏标记）", () => {
    const flow = relayoutDocument(legacyFramedDoc());
    const again = relayoutDocument(flow);
    expect(again).toBe(flow);
    expect(hasSameFrames(again, flow)).toBe(true);
  });

  it("pinned 但无 frame 的边界：重排后 pinned 一并清除", () => {
    const doc = plainDoc();
    doc.nodes[3]!.pinned = true; // 手写/半损坏文档：有 pin 无 geometry
    expect(clearPlacement(doc).nodes.every((n) => n.pinned === undefined)).toBe(true);
    expect(relayoutDocument(doc).nodes.every((n) => n.pinned === undefined)).toBe(true);
  });

  it("无 placement 的文档：clearPlacement 原样返回（引用相同，避免无谓新对象）", () => {
    const doc = plainDoc();
    expect(clearPlacement(doc)).toBe(doc);
    expect(relayoutDocument(doc)).toBe(doc);
  });
});

describe("pinned 穿越既有 ops 的字段往返", () => {
  it("cloneSubtree：副本保留 pinned 与 frame（不再静默退回 flow）", () => {
    const pinned = pin(plainDoc(), "btn", frame(-40, 700, 220, 56));
    const clone = cloneSubtree(pinned, "btn");
    const root = clone.nodes.find((n) => n.id === clone.rootId)!;
    expect(root.pinned).toBe(true);
    expect(root.frame).toEqual(frame(-40, 700, 220, 56));
    // frame 是深拷贝：副本与原件不共享对象
    expect(root.frame).not.toBe(byId(pinned, "btn").frame);
  });

  it("cloneSubtree：未 pinned 节点不注入 pinned（复制不凭空造豁免）", () => {
    const clone = cloneSubtree(plainDoc(), "head");
    expect(clone.nodes[0]!.pinned).toBeUndefined();
    expect(clone.nodes[0]!.frame).toBeUndefined();
  });

  it("cloneSubtree：子树内 pinned 后代同样保留（跨层级枚举完整）", () => {
    const pinned = pin(plainDoc(), "btn", frame(10, 20, 30, 40));
    const clone = cloneSubtree(pinned, "sec"); // sec > [head, btn]
    expect(clone.nodes).toHaveLength(3);
    const btnCopy = clone.nodes.find((n) => n.type === "Button")!;
    expect(btnCopy.id).not.toBe("btn");
    expect(btnCopy.pinned).toBe(true);
    expect(btnCopy.frame).toEqual(frame(10, 20, 30, 40));
    const headCopy = clone.nodes.find((n) => n.type === "Header")!;
    expect(headCopy.pinned).toBeUndefined();
  });

  it("duplicateNode：副本 pinned 保留，frame 带 16px 层叠偏移（画布可见区分）", () => {
    const pinned = pin(plainDoc(), "btn", frame(100, 200, 220, 56));
    const next = duplicateNode(pinned, "btn");
    const parent = byId(next, "sec");
    const copyId = parent.children[parent.children.indexOf("btn") + 1]!;
    const copy = byId(next, copyId);
    expect(copy.id).not.toBe("btn");
    expect(copy.pinned).toBe(true);
    expect(copy.frame).toEqual(frame(116, 216, 220, 56));
    // 原件不受影响：副本是独立节点
    expect(byId(next, "btn").frame).toEqual(frame(100, 200, 220, 56));
    expect(byId(next, "btn").pinned).toBe(true);
    expect(checkPage(next)).toEqual([]);
  });

  it("unpin → duplicate 的组合：副本同样不带 pinned/frame", () => {
    const flow = unpin(pin(plainDoc(), "btn", frame(100, 200, 220, 56)), "btn");
    const next = duplicateNode(flow, "btn");
    const parent = byId(next, "sec");
    const copy = byId(next, parent.children[parent.children.indexOf("btn") + 1]!);
    expect(copy.pinned).toBeUndefined();
    expect(copy.frame).toBeUndefined();
  });
});
