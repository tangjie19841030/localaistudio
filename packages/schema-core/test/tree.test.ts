import { describe, expect, it } from "vitest";
import type { NodeRecord, Page } from "../src/document.js";
import { defaultPage, defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import {
  attachPoint,
  collectSubtreeIds,
  depthOf,
  getNode,
  getPath,
  isAncestor,
} from "../src/registry/treeUtils.js";

/** 3-layer tree: root -> a,b -> a1,a2 (under a), b1 (under b). */
function buildTree(): Page {
  const node = (id: string, children: string[] = []): NodeRecord => ({
    id,
    type: "Stack",
    props: {},
    children,
  });
  return {
    id: "page-1",
    name: "树测试",
    rootId: "root",
    nodes: [
      node("root", ["a", "b"]),
      node("a", ["a1", "a2"]),
      node("b", ["b1"]),
      node("a1"),
      node("a2"),
      node("b1"),
    ],
  };
}

/** Tree plus a detached node (in nodes table but not reachable from rootId). */
function buildDetached(): Page {
  const doc = buildTree();
  doc.nodes.push({ id: "lonely", type: "Text", props: {}, children: ["ghost-child"] });
  doc.nodes.push({ id: "ghost-child", type: "Text", props: {}, children: [] });
  return doc;
}

/** Pathological doc: x and y point at each other (cycle). */
function buildCyclic(): Page {
  const doc = defaultPage("循环");
  doc.nodes = [
    { id: "root", type: "Stack", props: {}, children: ["x"] },
    { id: "x", type: "Stack", props: {}, children: ["y"] },
    { id: "y", type: "Stack", props: {}, children: ["x"] },
  ];
  return doc;
}

describe("treeUtils 基础查询", () => {
  it("getNode 命中与未命中", () => {
    const doc = buildTree();
    expect(getNode(doc, "a1")?.type).toBe("Stack");
    expect(getNode(doc, "nope")).toBeUndefined();
  });

  it("getPath 返回根到节点的 ID 路径", () => {
    const doc = buildTree();
    expect(getPath(doc, "root")).toEqual(["root"]);
    expect(getPath(doc, "a")).toEqual(["root", "a"]);
    expect(getPath(doc, "a2")).toEqual(["root", "a", "a2"]);
    expect(getPath(doc, "b1")).toEqual(["root", "b", "b1"]);
  });

  it("getPath 对未知/游离节点返回 undefined", () => {
    const doc = buildDetached();
    expect(getPath(doc, "nope")).toBeUndefined();
    // 游离节点在 nodes 表中但不在树上——不算有效路径
    expect(getPath(doc, "lonely")).toBeUndefined();
    expect(getPath(doc, "ghost-child")).toBeUndefined();
  });

  it("collectSubtreeIds 含自身与全部后代", () => {
    const doc = buildTree();
    expect(collectSubtreeIds(doc, "a")).toEqual(["a", "a1", "a2"]);
    expect(collectSubtreeIds(doc, "root")).toEqual(["root", "a", "a1", "a2", "b", "b1"]);
    expect(collectSubtreeIds(doc, "b1")).toEqual(["b1"]);
  });

  it("collectSubtreeIds 对不存在节点返回空数组、游离节点只含自身链外节点", () => {
    const doc = buildDetached();
    expect(collectSubtreeIds(doc, "nope")).toEqual([]);
    // 游离节点不在树上，子树收集只沿其 children 展开（不碰树上节点）
    expect(collectSubtreeIds(doc, "lonely")).toEqual(["lonely", "ghost-child"]);
  });

  it("isAncestor 判定祖先关系", () => {
    const doc = buildTree();
    expect(isAncestor(doc, "root", "a")).toBe(true);
    expect(isAncestor(doc, "root", "a2")).toBe(true);
    expect(isAncestor(doc, "a", "a2")).toBe(true);
    expect(isAncestor(doc, "a", "b")).toBe(false);
    expect(isAncestor(doc, "a1", "a")).toBe(false);
    expect(isAncestor(doc, "a1", "a1")).toBe(false);
    expect(isAncestor(doc, "nope", "a")).toBe(false);
    expect(isAncestor(doc, "a", "nope")).toBe(false);
  });

  it("depthOf 根为 0，逐层递增", () => {
    const doc = buildTree();
    expect(depthOf(doc, "root")).toBe(0);
    expect(depthOf(doc, "a")).toBe(1);
    expect(depthOf(doc, "a1")).toBe(2);
    expect(depthOf(doc, "b1")).toBe(2);
    expect(depthOf(doc, "nope")).toBeUndefined();
    expect(depthOf(doc, "lonely")).toBeUndefined();
  });

  it("attachPoint 返回父与下标", () => {
    const doc = buildTree();
    expect(attachPoint(doc, "root")).toBeUndefined();
    expect(attachPoint(doc, "a")).toEqual({ parentId: "root", index: 0 });
    expect(attachPoint(doc, "b")).toEqual({ parentId: "root", index: 1 });
    expect(attachPoint(doc, "a2")).toEqual({ parentId: "a", index: 1 });
    expect(attachPoint(doc, "nope")).toBeUndefined();
  });
});

describe("游离与病态文档防护", () => {
  it("游离节点不参与路径/深度计算", () => {
    const doc = buildDetached();
    // 树上节点查询不受游离节点影响
    expect(getPath(doc, "b1")).toEqual(["root", "b", "b1"]);
    expect(depthOf(doc, "a2")).toBe(2);
    expect(isAncestor(doc, "lonely", "a")).toBe(false);
    expect(attachPoint(doc, "ghost-child")).toEqual({ parentId: "lonely", index: 0 });
  });

  it("children 互指的病态文档不死循环（visited 防护）", () => {
    const doc = buildCyclic();
    expect(getPath(doc, "y")).toEqual(["root", "x", "y"]);
    expect(getPath(doc, "x")).toEqual(["root", "x"]);
    // 深度遍历遇到已访问节点即停，不死循环
    expect(depthOf(doc, "x")).toBe(1);
    expect(collectSubtreeIds(doc, "x")).toContain("x");
    expect(collectSubtreeIds(doc, "root")).toContain("y");
    expect(collectSubtreeIds(doc, "root")).toHaveLength(3);
  });
});
