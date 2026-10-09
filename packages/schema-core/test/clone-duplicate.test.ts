import { describe, expect, it } from "vitest";
import {
  attachPoint,
  cloneSubtree,
  collectSubtreeIds,
  defaultPage,
  duplicateNode,
  getNode,
  insertNode,
  makeNode,
  type Page,
} from "../src/index.js";

function cardParentDoc(): Page {
  const doc = defaultPage("dup");
  const card = makeNode("Card");
  const btn = makeNode("Button");
  const withBtn = { ...card, children: [btn.id] };
  // insertNode: when subtreeNodes is non-empty it is the FULL incoming table
  // (the subtree root MUST be included, or the parent gets a dangling id).
  return insertNode(insertNode(doc, withBtn, doc.rootId, undefined, [withBtn, btn]), makeNode("Section"), doc.rootId);
}

describe("cloneSubtree", () => {
  it("重映射全部 id，子树结构保持一致", () => {
    const doc = cardParentDoc();
    const card = doc.nodes.find((n) => n.type === "Card")!;
    const clone = cloneSubtree(doc, card.id);
    expect(clone.rootId).not.toBe(card.id);
    expect(clone.nodes).toHaveLength(2);
    const root = clone.nodes.find((n) => n.id === clone.rootId)!;
    expect(root.type).toBe("Card");
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).not.toBe(card.children[0]);
    const child = clone.nodes.find((n) => n.id === root.children[0])!;
    expect(child.type).toBe("Button");
  });

  it("未知节点抛 OpError", () => {
    const doc = defaultPage("x");
    expect(() => cloneSubtree(doc, "ghost")).toThrow(/不存在/);
  });
});

describe("duplicateNode", () => {
  it("在原节点后插入同级副本，父容器 children 变长", () => {
    const doc = cardParentDoc();
    const card = doc.nodes.find((n) => n.type === "Card")!;
    const next = duplicateNode(doc, card.id);
    const attach = attachPoint(doc, card.id);
    const parent = getNode(next, attach!.parentId)!;
    expect(parent.children).toHaveLength(3);
    const copyId = parent.children[parent.children.indexOf(card.id) + 1]!;
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(card.id);
    expect(getNode(next, copyId)!.type).toBe("Card");
    expect(collectSubtreeIds(next, copyId)).toHaveLength(2);
  });

  it("根节点不可复制", () => {
    const doc = defaultPage("x");
    expect(() => duplicateNode(doc, doc.rootId)).toThrow(/根节点/);
  });
});
