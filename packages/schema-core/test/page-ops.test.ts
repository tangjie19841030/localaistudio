import { describe, expect, it } from "vitest";
import {
  addPage,
  activePageOf,
  duplicatePage,
  makeNode,
  insertNode,
  removePage,
  renamePage,
  replacePage,
  type NodeRecord,
} from "../src/index.js";
import {
  checkStudioDocument,
  defaultStudioDocument,
  type Page,
} from "../src/document.js";

const node = (id: string, type: string, children: string[] = []): NodeRecord => ({
  id,
  type,
  props: {},
  children,
});

/** Single-page doc with root > a > b1, b2 (Exercise deeper subtrees). */
function baseDoc(): Page {
  return defaultStudioDocument("页操作测试").pages[0]!;
}

function withPage(page: Page) {
  const doc = defaultStudioDocument("页操作测试");
  return { ...doc, pages: [page] };
}

describe("T19 B 组：pageOps", () => {
  it("B1 addPage 追加空页且整档通过 checkStudioDocument", () => {
    const doc = withPage(baseDoc());
    const { doc: next, pageId } = addPage(doc, "第二页");
    expect(next.pages).toHaveLength(2);
    expect(next.pages[1]!.id).toBe(pageId);
    expect(next.pages[1]!.rootId).toBe(next.pages[1]!.nodes[0]!.id); // fresh root node id
    expect(next.pages[1]!.nodes).toHaveLength(1);
    expect(checkStudioDocument(next)).toEqual([]);
  });

  it("B2 removePage 最后一页 → null；非最后一页正常删除", () => {
    const doc = withPage(baseDoc());
    expect(removePage(doc, "page-1")).toBeNull(); // last page
    const { doc: two } = addPage(doc, "第二页");
    expect(removePage(two, "page-1")).not.toBeNull();
    expect(removePage(two, "不存在的页")).toBeNull();
  });

  it("B3 duplicatePage 全节点 fresh-id 且结构同构", () => {
    const page = baseDoc();
    const withChildren = insertNode(page, makeNode("Card"), "root");
    const doc = withPage(withChildren);
    const result = duplicatePage(doc, "page-1");
    expect(result).not.toBeNull();
    const { doc: next, pageId } = result!;
    expect(next.pages).toHaveLength(2);
    const [src, clone] = [next.pages[0]!, next.pages[1]!];
    expect(clone.id).toBe(pageId);
    expect(clone.id).not.toBe(src.id);
    // structure isomorphic
    const srcShape = src.nodes.map((n) => `${n.type}:${n.children.length}`).join("|");
    const cloneShape = clone.nodes.map((n) => `${n.type}:${n.children.length}`).join("|");
    expect(cloneShape).toBe(srcShape);
    // every cloned node id is fresh
    const srcIds = new Set(src.nodes.map((n) => n.id));
    for (const n of clone.nodes) expect(srcIds.has(n.id)).toBe(false);
    expect(checkStudioDocument(next)).toEqual([]);
  });

  it("B4 renamePage 未知 id → null；已知 id 改名成功", () => {
    const doc = withPage(baseDoc());
    expect(renamePage(doc, "nope", "x")).toBeNull();
    const next = renamePage(doc, "page-1", "改名页")!;
    expect(next.pages[0]!.name).toBe("改名页");
  });

  it("B5 replacePage 不动其他页（引用对比）", () => {
    const doc = withPage(baseDoc());
    const { doc: two, pageId: secondId } = addPage(doc, "第二页");
    const first = two.pages[0]!;
    const second = two.pages[1]!;
    const edited: Page = { ...first, name: "编辑过" };
    const next = replacePage(two, first.id, edited);
    expect(next.pages[0]).toBe(edited);
    expect(next.pages[1]).toBe(second); // untouched reference
    expect(next.pages[1]!.id).toBe(secondId);
  });

  it("activePageOf: 未知/null id 回落 pages[0]", () => {
    const doc = withPage(baseDoc());
    expect(activePageOf(doc, "page-1").id).toBe("page-1");
    expect(activePageOf(doc, "ghost").id).toBe("page-1");
    expect(activePageOf(doc, null).id).toBe("page-1");
  });
});
