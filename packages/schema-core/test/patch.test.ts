import { describe, expect, it } from "vitest";
import type { NodeRecord, Page, StudioDocument } from "../src/document.js";
import { checkPage, defaultPage, defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import { makeNode } from "../src/registry/documentOps.js";
import {
  applyPatch,
  checkScope,
  patchOpSchema,
  planScope,
  type PatchOp,
} from "../src/registry/patch.js";

const node = (id: string, type: string, children: string[] = [], props: Record<string, unknown> = {}): NodeRecord => ({
  id,
  type,
  props,
  children,
});

/** root -> s1 -> s2 三层 Stack 容器 + root 下的叶子 t1。 */
function buildDoc(): Page {
  return {
    id: "page-1",
    name: "patch 测试",
    rootId: "root",
    nodes: [
      node("root", "Stack", ["s1", "t1"]),
      node("s1", "Stack", ["s2"]),
      node("s2", "Stack"),
      node("t1", "Text", [], { content: "正文", muted: false }),
    ],
  };
}

function getNode(doc: Page, id: string): NodeRecord | undefined {
  return doc.nodes.find((n) => n.id === id);
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

describe("patchOpSchema", () => {
  it("五种 op 合法样例通过", () => {
    const valid: PatchOp[] = [
      { op: "tokens.set", path: ["color", "brand"], value: "#123456" },
      { op: "node.add", node: makeNode("Card", "c1"), parentId: "root" },
      { op: "node.remove", id: "s2" },
      { op: "node.update", id: "t1", props: { content: "新正文" } },
      { op: "node.move", id: "s2", parentId: "root", index: 0 },
    ];
    for (const op of valid) {
      expect(patchOpSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);
    }
  });

  it("未知 op 拒绝", () => {
    expect(patchOpSchema.safeParse({ op: "node.rename", id: "s2" }).success).toBe(false);
  });

  it("tokens.set 非法 path 拒绝", () => {
    // tokens.set 只接受两段 family/key 路径
    expect(patchOpSchema.safeParse({ op: "tokens.set", path: ["color"], value: "#123456" }).success).toBe(false);
    expect(patchOpSchema.safeParse({ op: "tokens.set", path: "color.brand", value: "#123456" }).success).toBe(false);
    expect(patchOpSchema.safeParse({ op: "tokens.set", path: ["typo", "unit"], value: 4 }).success).toBe(false);
  });

  it("node.add 缺 node 拒绝", () => {
    expect(patchOpSchema.safeParse({ op: "node.add", parentId: "root" }).success).toBe(false);
  });

  it("node.add 带子树节点表通过", () => {
    const op: PatchOp = {
      op: "node.add",
      node: node("sec", "Section", ["inner"]),
      parentId: "root",
      index: 0,
      subtreeNodes: [node("sec", "Section", ["inner"]), node("inner", "Text")],
    };
    expect(patchOpSchema.safeParse(op).success).toBe(true);
  });

  it("node.remove 缺 id 拒绝；node.update 缺 props 拒绝", () => {
    expect(patchOpSchema.safeParse({ op: "node.remove" }).success).toBe(false);
    expect(patchOpSchema.safeParse({ op: "node.update", id: "t1" }).success).toBe(false);
  });
});

describe("applyPatch 成功", () => {
  it("tokens.set + node.add + node.update 组合应用后状态正确", () => {
    const doc = buildDoc();
    const ops: PatchOp[] = [
      { op: "tokens.set", path: ["color", "brand"], value: "#ABCDEF" },
      { op: "node.add", node: makeNode("Badge", "b1"), parentId: "s1" },
      { op: "node.update", id: "t1", props: { content: "改过的正文", muted: true } },
    ];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, ops);

    expect(result.errors).toEqual([]);
    expect(result.applied).toEqual(ops);
    expect(result.doc).not.toBe(doc);
    expect(result.doc.tokens.color.brand).toBe("#ABCDEF");
    expect(getNode(result.doc.pages[0]!, "s1")!.children).toEqual(["s2", "b1"]);
    expect(getNode(result.doc.pages[0]!, "t1")!.props).toEqual({ content: "改过的正文", muted: true });
    expect(checkPage(result.doc.pages[0]!)).toEqual([]);
    // 原 doc 不被修改
    expect(checkPage(doc)).toEqual([]);
    expect(getNode(doc, "s1")!.children).toEqual(["s2"]);
    expect(getNode(doc, "t1")!.props).toEqual({ content: "正文", muted: false });
  });

  it("空 ops 返回等值 doc 与空清单", () => {
    const doc = buildDoc();
    const ctx = docOf(doc);
    const result = applyPatch(ctx, []);
    expect(result.doc).toEqual(ctx);
    expect(result.applied).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("applyPatch 原子性", () => {
  it("第三个 op 失败 → 原 doc 引用相等、applied 空、errors 含 op[2]", () => {
    const doc = buildDoc();
    const ops: PatchOp[] = [
      { op: "tokens.set", path: ["spacing", "unit"], value: 8 },
      { op: "node.update", id: "t1", props: { content: "会被回滚", muted: false } },
      { op: "node.add", node: makeNode("Card", "c9"), parentId: "ghost" }, // 父节点不存在
    ];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, ops);

    expect(result.doc).toBe(ctx); // 全或无：原 doc 原样返回
    expect(result.applied).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("op[2]");
    expect(result.errors[0]).toContain("node.add");
    expect(result.errors[0]).toContain("父节点");
    expect(getNode(doc, "t1")!.props).toEqual({ content: "正文", muted: false });
  });

  it("首个 op 失败也收集错误且不应用后续", () => {
    const doc = buildDoc();
    const ops: PatchOp[] = [
      { op: "node.remove", id: "ghost" },
      { op: "tokens.set", path: ["color", "brand"], value: "#ABCDEF" },
    ];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, ops);
    expect(result.doc).toBe(ctx);
    expect(result.applied).toEqual([]);
    expect(result.errors[0]).toContain("op[0]");
    expect(result.errors[0]).toContain("不存在");
    expect(ctx.tokens.color.brand).toBe("#0F766E");
  });

  it("props 校验失败也归一化进 errors（原 doc 不变）", () => {
    const doc = buildDoc();
    const badOps = [
      { op: "node.update", id: "t1", props: { content: 123, muted: false } },
    ] as unknown as PatchOp[];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, badOps);
    expect(result.doc).toBe(ctx);
    expect(result.applied).toEqual([]);
    expect(result.errors[0]).toContain("op[0]");
    expect(result.errors[0]).toContain("node.update");
  });
});

describe("planScope", () => {
  it("混合 ops 审计出全部节点 ID 与 token 路径", () => {
    const ops: PatchOp[] = [
      { op: "tokens.set", path: ["color", "brand"], value: "#123456" },
      { op: "tokens.set", path: ["spacing", "unit"], value: 8 },
      {
        op: "node.add",
        node: node("sec", "Section", ["inner"]),
        parentId: "root",
        subtreeNodes: [node("sec", "Section", ["inner"]), node("inner", "Text")],
      },
      { op: "node.remove", id: "s2" },
      { op: "node.update", id: "t1", props: {} },
      { op: "node.move", id: "s2", parentId: "root" },
    ];
    const scope = planScope(ops);

    // add 审计顺序按任务定义：node.id → parentId → subtree ids，首次出现去重
    expect(scope.nodeIds).toEqual(["sec", "root", "inner", "s2", "t1"]);
    expect(scope.tokenPaths).toEqual(["color.brand", "spacing.unit"]);
  });

  it("node.add 无子树时审计 node.id 与 parentId；无重复", () => {
    const ops: PatchOp[] = [
      { op: "node.add", node: makeNode("Card", "c1"), parentId: "root" },
      { op: "node.update", id: "c1", props: {} },
      { op: "node.update", id: "root", props: {} },
    ];
    const scope = planScope(ops);
    expect(scope.nodeIds).toEqual(["c1", "root"]);
    expect(scope.tokenPaths).toEqual([]);
  });

  it("空 ops 返回空范围", () => {
    expect(planScope([])).toEqual({ nodeIds: [], tokenPaths: [] });
  });
});

describe("checkScope", () => {
  const ops: PatchOp[] = [
    { op: "tokens.set", path: ["color", "brand"], value: "#123456" },
    { op: "node.update", id: "t1", props: {} },
  ];

  it("allowed 含全部目标 → 空清单", () => {
    expect(checkScope(ops, { nodeIds: ["t1"], allowAllTokens: true })).toEqual([]);
  });

  it("节点不在 allowed → 违规", () => {
    const violations = checkScope(
      [
        { op: "node.update", id: "t1", props: {} },
        { op: "node.remove", id: "s2" },
      ],
      { nodeIds: ["t1"] },
    );
    expect(violations).toEqual(["节点 s2 超出修改范围"]);
  });

  it("allowed 省略 nodeIds → 任何节点都违规（只读）", () => {
    const violations = checkScope([{ op: "node.update", id: "t1", props: {} }], { allowAllTokens: true });
    expect(violations).toEqual(["节点 t1 超出修改范围"]);
  });

  it("无 allowed → 全违规", () => {
    const violations = checkScope(ops, {});
    expect(violations).toEqual(["节点 t1 超出修改范围", "token color.brand 不在允许范围"]);
  });

  it("allowAllTokens 默认 false → tokens.set 违规", () => {
    const violations = checkScope(ops, { nodeIds: ["t1"] });
    expect(violations).toEqual(["token color.brand 不在允许范围"]);
  });

  it("多节点多 token 违规按序罗列", () => {
    const violations = checkScope(
      [
        { op: "tokens.set", path: ["radius", "card"], value: 8 },
        { op: "node.move", id: "s1", parentId: "root" },
      ],
      { nodeIds: [] },
    );
    // move 的 id 与 parentId 都在审计范围内
    expect(violations).toEqual([
      "节点 s1 超出修改范围",
      "节点 root 超出修改范围",
      "token radius.card 不在允许范围",
    ]);
  });

  it("空 ops 恒空清单", () => {
    expect(checkScope([], {})).toEqual([]);
  });

  it("node.add 只审计允许范围内的父容器，新节点 id 由插入操作生成", () => {
    const violations = checkScope(
      [{ op: "node.add", node: makeNode("Text", "generated-child"), parentId: "s1" }],
      { nodeIds: ["s1"] },
    );
    expect(violations).toEqual([]);
  });

  it("node.add 父容器越界仍然拒绝，即使新节点 id 不在范围内", () => {
    const violations = checkScope(
      [{ op: "node.add", node: makeNode("Text", "generated-child"), parentId: "outside" }],
      { nodeIds: ["s1"] },
    );
    expect(violations).toEqual(["节点 outside 超出修改范围"]);
  });
});

describe("patchOpSchema setFrame", () => {
  it("合法 setFrame 通过；省略 rotation 通过（默认 0 注入）", () => {
    const full = { op: "setFrame", nodeId: "t1", frame: { x: 10, y: 20, w: 100, h: 50, rotation: 30 } };
    const parsed = patchOpSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { frame: { rotation: number } }).frame.rotation).toBe(30);
    }
    const noRotation = patchOpSchema.safeParse({ op: "setFrame", nodeId: "t1", frame: { x: 0, y: 0, w: 10, h: 10 } });
    expect(noRotation.success).toBe(true);
    if (noRotation.success) {
      expect((noRotation.data as { frame: { rotation: number } }).frame.rotation).toBe(0);
    }
  });

  it("frame 形状非法拒绝（w<1、rotation 361、缺字段、缺 nodeId）", () => {
    expect(patchOpSchema.safeParse({ op: "setFrame", nodeId: "t1", frame: { x: 0, y: 0, w: 0.5, h: 10 } }).success).toBe(false);
    expect(patchOpSchema.safeParse({ op: "setFrame", nodeId: "t1", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 361 } }).success).toBe(false);
    expect(patchOpSchema.safeParse({ op: "setFrame", nodeId: "t1", frame: { x: 0, w: 10, h: 10 } }).success).toBe(false);
    expect(patchOpSchema.safeParse({ op: "setFrame", frame: { x: 0, y: 0, w: 10, h: 10 } }).success).toBe(false);
  });
});

describe("applyPatch setFrame", () => {
  it("应用 setFrame 后节点带上 frame，原 doc 不变", () => {
    const doc = buildDoc();
    const ops: PatchOp[] = [{ op: "setFrame", nodeId: "t1", frame: { x: 320, y: 80, w: 120, h: 60, rotation: 0 } }];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, ops);

    expect(result.errors).toEqual([]);
    expect(result.applied).toEqual(ops);
    expect(result.doc).not.toBe(doc);
    expect(getNode(result.doc.pages[0]!, "t1")!.frame).toEqual({ x: 320, y: 80, w: 120, h: 60, rotation: 0 });
    expect(getNode(doc, "t1")!.frame).toBeUndefined();
    expect(checkPage(result.doc.pages[0]!)).toEqual([]);
  });

  it("与非法兄弟 op 组合 → 全或无：原 doc 原样返回、errors 含 op 序号", () => {
    const doc = buildDoc();
    const ops: PatchOp[] = [
      { op: "setFrame", nodeId: "t1", frame: { x: 1, y: 2, w: 10, h: 10, rotation: 0 } },
      { op: "node.add", node: makeNode("Card", "c9"), parentId: "ghost" }, // 父节点不存在
    ];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, ops);

    expect(result.doc).toBe(ctx);
    expect(result.applied).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("op[1]");
    expect(result.errors[0]).toContain("node.add");
    expect(getNode(doc, "t1")!.frame).toBeUndefined();
  });

  it("setFrame 自身校验失败（rotation 361）→ 归一化进 errors", () => {
    const doc = buildDoc();
    const badOps = [
      { op: "setFrame", nodeId: "t1", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 361 } },
    ] as unknown as PatchOp[];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, badOps);
    expect(result.doc).toBe(ctx);
    expect(result.applied).toEqual([]);
    expect(result.errors[0]).toContain("op[0]");
    expect(result.errors[0]).toContain("setFrame");
  });

  it("setFrame 未知节点 → errors 含「不存在」", () => {
    const doc = buildDoc();
    const ops: PatchOp[] = [{ op: "setFrame", nodeId: "ghost", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 } }];
    const ctx = docOf(doc);
    const result = applyPatch(ctx, ops);
    expect(result.doc).toBe(ctx);
    expect(result.errors[0]).toContain("op[0]");
    expect(result.errors[0]).toContain("不存在");
  });
});

describe("setFrame 的 scope 门禁", () => {
  it("planScope 审计 setFrame 的 nodeId", () => {
    const ops: PatchOp[] = [{ op: "setFrame", nodeId: "t1", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 } }];
    expect(planScope(ops)).toEqual({ nodeIds: ["t1"], tokenPaths: [] });
  });

  it("allowed 含该节点 → 无违规；不含 → 节点级写违规", () => {
    const ops: PatchOp[] = [{ op: "setFrame", nodeId: "t1", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 } }];
    expect(checkScope(ops, { nodeIds: ["t1"] })).toEqual([]);
    expect(checkScope(ops, { nodeIds: ["s1"] })).toEqual(["节点 t1 超出修改范围"]);
  });

  it("allowed 省略 nodeIds → 任何 setFrame 都违规（只读）", () => {
    const ops: PatchOp[] = [{ op: "setFrame", nodeId: "t1", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 } }];
    expect(checkScope(ops, {})).toEqual(["节点 t1 超出修改范围"]);
  });
});
