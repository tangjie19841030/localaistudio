import { describe, expect, it } from "vitest";
import type { NodeRecord, Page, StudioDocument } from "../src/document.js";
import { checkPage, defaultPage, defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import { getComponentDef } from "../src/registry/componentDefs.js";
import {
  insertNode,
  makeNode,
  moveNode,
  newNodeId,
  OpError,
  removeNode,
  renameDocument,
  setFrame,
  setNodeLocked,
  setToken,
  type TokenPath,
  updateProps,
} from "../src/registry/documentOps.js";

const node = (id: string, type: string, children: string[] = [], props: Record<string, unknown> = {}): NodeRecord => ({
  id,
  type,
  props,
  children,
});

/** root -> s1 -> s2 三层，全部 Stack 容器。 */
function buildDoc(): Page {
  return {
    id: "page-1",
    name: "操作测试",
    rootId: "root",
    nodes: [
      node("root", "Stack", ["s1"]),
      node("s1", "Stack", ["s2"]),
      node("s2", "Stack"),
    ],
  };
}

/** All assertions must hold for every successful op result (page or whole doc). */
function assertValid(next: Page | StudioDocument): void {
  const page = "pages" in next ? next.pages[0]! : next;
  expect(checkPage(page)).toEqual([]);
}


/** Wrap a page fixture into a minimal single-page StudioDocument. */
function docOf(page: Page): StudioDocument {
  return {
    documentVersion: DOCUMENT_VERSION,
    name: page.name,
    tokens: defaultTokens(),
    pages: [page],
  };
}

describe("newNodeId / makeNode", () => {
  it("newNodeId 带 n_ 前缀且唯一", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = newNodeId();
      expect(id.startsWith("n_")).toBe(true);
      expect(id.length).toBe(10); // n_ + 8 chars
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });

  it("makeNode 用 registry 默认 props", () => {
    const n = makeNode("StatCard");
    expect(n.type).toBe("StatCard");
    expect(n.children).toEqual([]);
    expect(n.props).toEqual(getComponentDef("StatCard")!.defaultProps);
    expect(n.id.startsWith("n_")).toBe(true);
  });

  it("makeNode 可指定 id；未知 type 抛 OpError", () => {
    const n = makeNode("Button", "fixed-id");
    expect(n.id).toBe("fixed-id");
    expect(() => makeNode("NotAThing")).toThrow(OpError);
  });
});

describe("insertNode", () => {
  it("默认追加到末尾，checkPage 通过", () => {
    const next = insertNode(buildDoc(), makeNode("Card"), "s1");
    assertValid(next);
    expect(getNode(next, "s1")!.children).toEqual(["s2", ...next.nodes.filter((n) => n.id.startsWith("n_")).map((n) => n.id)]);
  });

  it("指定下标插入；越界钳制到末尾", () => {
    const doc = buildDoc();
    const card = makeNode("Card", "c1");
    const next = insertNode(doc, card, "s1", 0);
    expect(getNode(next, "s1")!.children).toEqual(["c1", "s2"]);

    const next2 = insertNode(doc, makeNode("Card", "c2"), "s1", 99);
    expect(getNode(next2, "s1")!.children).toEqual(["s2", "c2"]);
  });

  it("父节点不存在抛 OpError", () => {
    expect(() => insertNode(buildDoc(), makeNode("Card"), "ghost")).toThrow(OpError);
  });

  it("父节点非容器抛 OpError", () => {
    const doc = buildDoc();
    const text = makeNode("Text", "t1");
    const doc2 = insertNode(doc, text, "s1");
    expect(() => insertNode(doc2, makeNode("Card"), "t1")).toThrow(OpError);
  });

  it("重复 ID 抛 OpError", () => {
    const doc = buildDoc();
    expect(() => insertNode(doc, node("s2", "Stack"), "root")).toThrow(OpError);
  });

  it("node 携带子树节点时一并插入（children 引用必须存在）", () => {
    const doc = buildDoc();
    const subtree: NodeRecord[] = [
      node("sec", "Section", ["inner"]),
      node("inner", "Text"),
    ];
    const next = insertNode(doc, subtree[0]!, "root", 0, subtree);
    assertValid(next);
    expect(getNode(next, "root")!.children).toEqual(["sec", "s1"]);
    expect(getNode(next, "inner")).toBeDefined();
  });

  it("node.children 引用不存在节点抛 OpError（悬空引用）", () => {
    const doc = buildDoc();
    const bad: NodeRecord[] = [node("sec", "Section", ["missing"])];
    expect(() => insertNode(doc, bad[0]!, "root", 0, bad)).toThrow(OpError);
  });

  it("不可变：原 doc 不被修改（冻结入参不抛 TypeError）", () => {
    const doc = buildDoc();
    deepFreeze(doc);
    const next = insertNode(doc, makeNode("Card", "c9"), "s1");
    expect(getNode(next, "s1")!.children).toEqual(["s2", "c9"]);
    expect(getNode(doc, "s1")!.children).toEqual(["s2"]);
  });
});

describe("removeNode", () => {
  it("删除子树并从父 children 移除", () => {
    const next = removeNode(buildDoc(), "s1");
    assertValid(next);
    expect(getNode(next, "s1")).toBeUndefined();
    expect(getNode(next, "s2")).toBeUndefined();
    expect(getNode(next, "root")!.children).toEqual([]);
  });

  it("删除叶子节点", () => {
    const next = removeNode(buildDoc(), "s2");
    assertValid(next);
    expect(getNode(next, "s1")!.children).toEqual([]);
  });

  it("删除根抛 OpError；未知节点抛 OpError", () => {
    expect(() => removeNode(buildDoc(), "root")).toThrow(OpError);
    expect(() => removeNode(buildDoc(), "ghost")).toThrow(OpError);
  });

  it("不可变：冻结入参不抛", () => {
    const doc = buildDoc();
    deepFreeze(doc);
    const next = removeNode(doc, "s1");
    expect(next.nodes.map((n) => n.id)).toEqual(["root"]);
  });
});

describe("updateProps", () => {
  it("props 补丁与现有 props 合并（只传一个字段不抹掉其它字段）", () => {
    const doc = buildDoc();
    const withBase = updateProps(doc, "s2", { gap: 8, align: "center" });
    expect(getNode(withBase, "s2")!.props).toEqual({ gap: 8, align: "center" });
    // Partial patch: gap changes, align survives (real repro: a color-only
    // patch used to reset every other prop to its default).
    const next = updateProps(withBase, "s2", { gap: 2 });
    expect(getNode(next, "s2")!.props).toEqual({ gap: 2, align: "center" });
    assertValid(next);
  });

  it("非法 props 抛 OpError，含 zod 摘要", () => {
    expect(() => updateProps(buildDoc(), "s2", { gap: 99, align: "center" })).toThrow(OpError);
    let caught: OpError | undefined;
    try {
      updateProps(buildDoc(), "s2", { gap: 5, align: "left" });
    } catch (e) {
      expect(e).toBeInstanceOf(OpError);
      caught = e as OpError;
    }
    expect(caught, "非法枚举 align 应抛 OpError").toBeDefined();
    expect(caught!.reason).toContain("align");
  });

  it("未知节点抛 OpError", () => {
    expect(() => updateProps(buildDoc(), "ghost", {})).toThrow(OpError);
  });

  it("不可变：冻结入参不抛", () => {
    const doc = buildDoc();
    deepFreeze(doc);
    const next = updateProps(doc, "s2", { gap: 1, align: "start" });
    expect(getNode(next, "s2")!.props).toEqual({ gap: 1, align: "start" });
  });
});

describe("moveNode", () => {
  it("跨容器移动到指定下标", () => {
    const doc = {
      ...buildDoc(),
      nodes: [...buildDoc().nodes, node("s3", "Stack")],
    };
    doc.nodes.find((n) => n.id === "root")!.children.push("s3");
    const next = moveNode(doc, "s2", "s3", 0);
    assertValid(next);
    expect(getNode(next, "s3")!.children).toEqual(["s2"]);
    expect(getNode(next, "s1")!.children).toEqual([]);
  });

  it("移入自身或自身后代抛 OpError", () => {
    expect(() => moveNode(buildDoc(), "root", "s1", 0)).toThrow(OpError);
    expect(() => moveNode(buildDoc(), "s1", "s2", 0)).toThrow(OpError);
  });

  it("目标非容器抛 OpError；目标不存在抛 OpError；移动未知节点抛 OpError", () => {
    const doc = insertNode(buildDoc(), makeNode("Text", "t1"), "s1");
    expect(() => moveNode(doc, "s2", "t1", 0)).toThrow(OpError);
    expect(() => moveNode(doc, "s2", "ghost", 0)).toThrow(OpError);
    expect(() => moveNode(doc, "ghost", "s1", 0)).toThrow(OpError);
  });

  it("index 省略追加末尾，越界钳制", () => {
    const next = moveNode(buildDoc(), "s2", "root");
    assertValid(next);
    expect(getNode(next, "root")!.children).toEqual(["s1", "s2"]);
    expect(getNode(next, "s1")!.children).toEqual([]);
    const next2 = moveNode(next, "s2", "root", 99);
    expect(getNode(next2, "root")!.children).toEqual(["s1", "s2"]);
  });

  it("不可变：冻结入参不抛", () => {
    const doc = buildDoc();
    deepFreeze(doc);
    const next = moveNode(doc, "s2", "root");
    expect(getNode(doc, "s1")!.children).toEqual(["s2"]);
    expect(getNode(next, "root")!.children).toEqual(["s1", "s2"]);
  });
});

describe("setToken", () => {
  it("color 走 hex 规则", () => {
    const next = setToken(docOf(buildDoc()), ["color", "brand"], "#123456");
    expect(next.tokens.color.brand).toBe("#123456");
    assertValid(next);
    expect(() => setToken(docOf(buildDoc()), ["color", "brand"], "teal")).toThrow(OpError);
    expect(() => setToken(docOf(buildDoc()), ["color", "brand"], "#12345")).toThrow(OpError);
  });

  it("radius 0-64，spacing 1-24，font 非空", () => {
    expect(setToken(docOf(buildDoc()), ["radius", "card"], 0).tokens.radius.card).toBe(0);
    expect(setToken(docOf(buildDoc()), ["radius", "control"], 64).tokens.radius.control).toBe(64);
    expect(() => setToken(docOf(buildDoc()), ["radius", "card"], 65)).toThrow(OpError);
    expect(setToken(docOf(buildDoc()), ["spacing", "unit"], 1).tokens.spacing.unit).toBe(1);
    expect(setToken(docOf(buildDoc()), ["spacing", "unit"], 24).tokens.spacing.unit).toBe(24);
    expect(() => setToken(docOf(buildDoc()), ["spacing", "unit"], 25)).toThrow(OpError);
    expect(() => setToken(docOf(buildDoc()), ["font", "sans"], "")).toThrow(OpError);
    expect(setToken(docOf(buildDoc()), ["font", "sans"], "Arial").tokens.font.sans).toBe("Arial");
  });

  it("非法 color key 抛 OpError", () => {
    // Deliberately invalid path — cast is the point: runtime must guard AI patch input.
    const badPath = ["color", "sparkle"] as unknown as TokenPath;
    expect(() => setToken(docOf(buildDoc()), badPath, "#123456")).toThrow(OpError);
    expect(() => setToken(docOf(buildDoc()), badPath, "#123456")).toThrow(/未知的颜色 token 键/);
    const badFamily = ["typo", "unit"] as unknown as TokenPath;
    expect(() => setToken(docOf(buildDoc()), badFamily, 4)).toThrow(OpError);
  });

  it("不可变：冻结入参不抛", () => {
    const doc = docOf(buildDoc());
    deepFreeze(doc);
    const next = setToken(doc, ["color", "brand"], "#ABCDEF");
    expect(doc.tokens.color.brand).toBe("#0F766E");
    expect(next.tokens.color.brand).toBe("#ABCDEF");
  });
});

describe("renameDocument", () => {
  it("trim 后合法改名", () => {
    const next = renameDocument(docOf(buildDoc()), "  新名字  ");
    expect(next.name).toBe("新名字");
    assertValid(next);
  });

  it("空串与超 80 字符抛 OpError", () => {
    expect(() => renameDocument(docOf(buildDoc()), "   ")).toThrow(OpError);
    expect(() => renameDocument(docOf(buildDoc()), "a".repeat(81))).toThrow(OpError);
    expect(renameDocument(docOf(buildDoc()), "a".repeat(80)).name).toBe("a".repeat(80));
  });
});

describe("setNodeLocked", () => {
  it("locks and unlocks a node without mutating the source document", () => {
    const document = buildDoc();
    const locked = setNodeLocked(document, "s2", true);
    expect(getNode(locked, "s2")?.locked).toBe(true);
    expect(getNode(document, "s2")?.locked).toBeUndefined();

    const unlocked = setNodeLocked(locked, "s2", false);
    expect(getNode(unlocked, "s2")?.locked).toBeUndefined();
  });

  it("rejects unknown nodes", () => {
    expect(() => setNodeLocked(buildDoc(), "ghost", true)).toThrow(OpError);
  });
});

describe("setFrame", () => {
  const frame = { x: -120.5, y: 80, w: 320, h: 160, rotation: 0 };

  it("给已有节点设置 frame；负坐标合法；rotation 为 0 时保留", () => {
    const next = setFrame(buildDoc(), "s2", frame);
    assertValid(next);
    expect(getNode(next, "s2")!.frame).toEqual(frame);
  });

  it("未知节点抛 OpError（frame 不允许隐式建节点）", () => {
    expect(() => setFrame(buildDoc(), "ghost", { x: 0, y: 0, w: 10, h: 10, rotation: 0 })).toThrow(OpError);
    expect(() => setFrame(buildDoc(), "ghost", { x: 0, y: 0, w: 10, h: 10, rotation: 0 })).toThrow(/不存在/);
  });

  it("非法 frame 抛 OpError（w 0.5 / h 0 / rotation 361 / rotation -1），原 doc 不变", () => {
    const doc = buildDoc();
    expect(() => setFrame(doc, "s2", { x: 0, y: 0, w: 0.5, h: 10, rotation: 0 })).toThrow(OpError);
    expect(() => setFrame(doc, "s2", { x: 0, y: 0, w: 10, h: 0, rotation: 0 })).toThrow(OpError);
    expect(() => setFrame(doc, "s2", { x: 0, y: 0, w: 10, h: 10, rotation: 361 })).toThrow(OpError);
    expect(() => setFrame(doc, "s2", { x: 0, y: 0, w: 10, h: 10, rotation: -1 })).toThrow(OpError);
    expect(getNode(doc, "s2")!.frame).toBeUndefined();
  });

  it("幂等：同一 frame 设两次结果等值", () => {
    const doc = buildDoc();
    const once = setFrame(doc, "s2", frame);
    const twice = setFrame(once, "s2", frame);
    expect(twice).toEqual(once);
    expect(getNode(twice, "s2")!.frame).toEqual(getNode(once, "s2")!.frame);
  });

  it("不可变：新 nodes 数组与新节点对象，未触碰节点保持引用相等", () => {
    const doc = buildDoc();
    const next = setFrame(doc, "s2", frame);
    expect(next).not.toBe(doc);
    expect(next.nodes).not.toBe(doc.nodes);
    expect(getNode(next, "s2")).not.toBe(getNode(doc, "s2"));
    expect(getNode(next, "root")).toBe(getNode(doc, "root")); // 引用相等
    expect(getNode(next, "s1")).toBe(getNode(doc, "s1"));
    expect(getNode(doc, "s2")!.frame).toBeUndefined();
  });

  it("旋转角合法边界 0/360 通过；覆盖旧 frame", () => {
    const doc = buildDoc();
    const withFrame = setFrame(doc, "s2", { x: 0, y: 0, w: 10, h: 10, rotation: 360 });
    expect(getNode(withFrame, "s2")!.frame!.rotation).toBe(360);
    const zeroed = setFrame(withFrame, "s2", { x: 1, y: 1, w: 20, h: 20, rotation: 0 });
    expect(getNode(zeroed, "s2")!.frame).toEqual({ x: 1, y: 1, w: 20, h: 20, rotation: 0 });
  });

  it("不可变：冻结入参不抛", () => {
    const doc = buildDoc();
    deepFreeze(doc);
    const next = setFrame(doc, "s2", frame);
    expect(getNode(next, "s2")!.frame).toEqual(frame);
  });
});

/** Freeze doc deeply so any in-place mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function getNode(doc: Page, id: string): NodeRecord | undefined {
  return doc.nodes.find((n) => n.id === id);
}
