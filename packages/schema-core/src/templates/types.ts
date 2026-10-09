import type { NodeRecord, Page, StudioDocument } from "../document.js";
import { defaultStudioDocument } from "../document.js";

/** Template categories — the gallery groups by these. */
export type TemplateCategory = "数据看板" | "管理后台" | "认证" | "营销";

export interface StudioTemplate {
  id: string;
  name: string;
  description: string;
  /** Gallery grouping label. */
  category: TemplateCategory;
  /** Suggested token preset to apply on creation (color-mood pairing). */
  suggestedPreset: string;
  /** Returns a document that always passes validateDocument / checkStudioDocument. */
  build(docName: string): StudioDocument;
}

/** Compact NodeRecord factory used by the template builders. */
export function node(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: string[] = [],
): NodeRecord {
  return { id, type, props, children };
}

/** Wraps a node list into a single-page v2 document with default tokens. */
export function docOf(docName: string, rootId: string, nodes: NodeRecord[]): StudioDocument {
  const doc = defaultStudioDocument(docName);
  doc.pages[0]!.rootId = rootId;
  doc.pages[0]!.nodes = nodes;
  return doc;
}

/**
 * Wraps fully-built pages into a multi-page v2 document with default tokens.
 * Node ids must be unique ACROSS pages (checkStudioDocument invariant), so each
 * page builder uses its own id prefix.
 */
export function docOfPages(docName: string, pages: Page[]): StudioDocument {
  const doc = defaultStudioDocument(docName);
  doc.pages = pages;
  return doc;
}
