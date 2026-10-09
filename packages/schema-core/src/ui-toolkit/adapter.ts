import {
  createDocumentEnvelope,
  parseDocumentEnvelope,
  type DocumentAdapter,
  type DocumentEnvelope,
  type SelectionScope,
  type ScopeResolution,
} from "@studio/studio-core";
import {
  checkStudioDocument,
  defaultStudioDocument,
  validateDocument,
  type Page,
  type StudioDocument,
} from "../document.js";
import { getComponentDef } from "../registry/componentDefs.js";
import { collectSubtreeIds, getNode } from "../registry/treeUtils.js";

export const UI_TOOLKIT_ID = "builtin.ui";
export const UI_TOOLKIT_VERSION = "1.0.0";
export const UI_DOCUMENT_VERSION = 1;

export function createUiDocumentEnvelope(document: StudioDocument): DocumentEnvelope<StudioDocument> {
  // validateDocument is the single v1/v2 acceptance funnel (T19 §0.3) — the
  // envelope parse path therefore accepts legacy v1 raw docs automatically.
  const parsed = validateDocument(document);
  const issues = checkStudioDocument(parsed);
  if (issues.length > 0) throw new Error(`UI 文档结构错误: ${issues.join("; ")}`);
  return createDocumentEnvelope({
    projectType: "ui",
    toolkitId: UI_TOOLKIT_ID,
    toolkitVersion: UI_TOOLKIT_VERSION,
    documentVersion: UI_DOCUMENT_VERSION,
    document: parsed,
  });
}

function assertUiEnvelope(envelope: DocumentEnvelope): void {
  // Note: envelope.documentVersion is the store's save-revision counter (P7.2),
  // NOT the document schema version — that lives in document.documentVersion.
  if (
    envelope.projectType !== "ui" ||
    envelope.toolkitId !== UI_TOOLKIT_ID ||
    envelope.toolkitVersion !== UI_TOOLKIT_VERSION
  ) {
    throw new Error("UI 文档信封不匹配");
  }
}

/** Node table across ALL pages: node ids are globally unique (T19 §0.2), so
 *  scope resolution addresses nodes page-agnostically. */
function pageNodesOf(doc: StudioDocument): Page["nodes"] {
  return doc.pages.flatMap((p) => p.nodes);
}

/** Page a node id lives in (first hit); used to scope subtree walks per page. */
function ownerPageOf(doc: StudioDocument, id: string): Page | undefined {
  return doc.pages.find((p) => p.nodes.some((n) => n.id === id));
}

function resolveScope(document: StudioDocument, scope: SelectionScope): ScopeResolution {
  const pages = pageNodesOf(document);
  const lockManagementIds = pages.filter((node) => node.locked).map((node) => node.id);
  const lockedIds = [...new Set(lockManagementIds.flatMap((id) => lockedSubtreeOf(document, id)))];
  if (scope.kind === "file") return { allowAll: true, allowedIds: [], lockedIds, lockManagementIds };
  if (scope.kind === "range") throw new Error("UI 工具包不支持文本范围");

  const targetIds = [...new Set(scope.targetIds)];
  for (const id of targetIds) {
    if (!ownerPageOf(document, id)) throw new Error(`UI 选择对象不存在: ${id}`);
  }

  if (scope.kind === "selection") {
    const allowedIds = new Set<string>();
    for (const id of targetIds) {
      for (const descendantId of lockedSubtreeOf(document, id)) allowedIds.add(descendantId);
    }
    return { allowAll: false, allowedIds: [...allowedIds], lockedIds, lockManagementIds };
  }

  const allowedIds = new Set<string>();
  for (const id of targetIds) {
    const page = ownerPageOf(document, id)!;
    const node = getNode(page, id)!;
    if (!getComponentDef(node.type)?.container) {
      throw new Error(`UI 容器范围目标不是容器: ${id}`);
    }
    for (const descendantId of lockedSubtreeOf(document, id)) allowedIds.add(descendantId);
  }
  return { allowAll: false, allowedIds: [...allowedIds], lockedIds, lockManagementIds };
}

/** Subtree ids of `id` within its owner page (collectSubtreeIds is page-scoped). */
function lockedSubtreeOf(document: StudioDocument, id: string): string[] {
  const page = ownerPageOf(document, id);
  return page ? collectSubtreeIds(page, id) : [];
}

export const uiDocumentAdapter: DocumentAdapter<StudioDocument> = {
  createEmpty(name) {
    return createUiDocumentEnvelope(defaultStudioDocument(name));
  },

  parse(input) {
    const envelope = parseDocumentEnvelope(input);
    assertUiEnvelope(envelope);
    return createUiDocumentEnvelope(envelope.document as StudioDocument);
  },

  resolveScope(envelope, scope) {
    return resolveScope(envelope.document, scope);
  },
};
