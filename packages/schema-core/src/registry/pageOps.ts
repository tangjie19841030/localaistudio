import { nanoid } from "nanoid";
import type { Page, StudioDocument } from "../document.js";
import { cloneSubtree, newNodeId } from "./documentOps.js";
import { collectSubtreeIds } from "./treeUtils.js";

/**
 * Page-level CRUD operators (T19 §3.2): pure, immutable, one-pass functions
 * over the multi-page document. Node-level writes stay in documentOps and run
 * on ONE page (the editorStore.applyPageOp funnel); these functions own the
 * pages array itself. Node ids are globally unique across pages (T19 §0.2),
 * which duplicatePage relies on via cloneSubtree's fresh-id remap.
 */

const PAGE_ID_PREFIX = "p_";

function freshPageId(): string {
  return `${PAGE_ID_PREFIX}${nanoid(8)}`;
}

/**
 * Append one fresh page (id `p_<nanoid8>`, empty Container root). The page
 * root NODE id is fresh too — node ids are globally unique across pages
 * (T19 §0.2), so a second "root" would violate checkStudioDocument. Never
 * fails (pages has no max). One doc pass, immutable.
 */
export function addPage(doc: StudioDocument, name: string): { doc: StudioDocument; pageId: string } {
  const rootId = newNodeId();
  const page: Page = {
    id: freshPageId(),
    name,
    rootId,
    nodes: [{ id: rootId, type: "Container", props: {}, children: [] }],
  };
  return { doc: { ...doc, pages: [...doc.pages, page] }, pageId: page.id };
}

/** Remove by id; null when it is the LAST page (>=1 invariant). */
export function removePage(doc: StudioDocument, pageId: string): StudioDocument | null {
  if (doc.pages.length <= 1) return null;
  const exists = doc.pages.some((p) => p.id === pageId);
  if (!exists) return null;
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) };
}

/** Rename; pageId unknown -> null (caller silent no-op, button disabled first). */
export function renamePage(doc: StudioDocument, pageId: string, name: string): StudioDocument | null {
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return null;
  const pages = doc.pages.map((p, i) => (i === index ? { ...p, name } : p));
  return { ...doc, pages };
}

/**
 * Deep-clone a page: fresh page id + fresh ids for every cloned node (reuses
 * documentOps cloneSubtree remap, so the clone is guaranteed collision-free
 * against the source page AND the rest of the doc). Null on unknown id.
 *
 * W3-A: cloning does NOT preserve node `action` (navigate intents do not
 * migrate with a clone; cloneSubtree's whitelist simply omits the field).
 * W4-A: same for `breakpoints` — the clone does not carry over responsive
 * overrides (an override describes one node's layout, not a reusable payload).
 */
export function duplicatePage(
  doc: StudioDocument,
  pageId: string,
): { doc: StudioDocument; pageId: string } | null {
  const source = doc.pages.find((p) => p.id === pageId);
  if (!source) return null;
  const clone = cloneSubtree(source, source.rootId);
  // cloneSubtree walks pre-order; pair old subtree ids with cloned records by
  // index to rebuild the page table with fresh ids throughout.
  const oldIds = collectSubtreeIds(source, source.rootId);
  const remapped = oldIds.map((oldId, i) => {
    const cloned = clone.nodes[i];
    if (!cloned) throw new Error(`duplicatePage: 节点 "${oldId}" 克隆缺失`);
    return cloned;
  });
  const copy: Page = {
    id: freshPageId(),
    name: source.name,
    rootId: clone.rootId,
    nodes: remapped,
  };
  return { doc: { ...doc, pages: [...doc.pages, copy] }, pageId: copy.id };
}

/** Splice a modified page back (the write half of every page-scoped op). */
export function replacePage(doc: StudioDocument, pageId: string, page: Page): StudioDocument {
  const pages = doc.pages.map((p) => (p.id === pageId ? page : p));
  return { ...doc, pages };
}

/**
 * Active page resolution: pageId -> that page; null/unknown -> pages[0].
 * Never throws (open safety net); checkStudioDocument guards id validity
 * upstream.
 */
export function activePageOf(doc: StudioDocument, pageId: string | null): Page {
  return doc.pages.find((p) => p.id === pageId) ?? doc.pages[0]!;
}
