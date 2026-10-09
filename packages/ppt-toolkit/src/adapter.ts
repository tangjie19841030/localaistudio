import type { DataCategory, ScopeResolution, SelectionScope } from "@studio/studio-core";
import {
  createDocumentEnvelope,
  parseDocumentEnvelope,
  type DocumentAdapter,
  type DocumentEnvelope,
} from "@studio/studio-core";
import { createEmptyDeck } from "./layout.js";
import { checkPptDocument, PPT_DOCUMENT_VERSION, validatePptDocument, type PptDocument, type PptSlide } from "./document.js";

export const PPT_TOOLKIT_ID = "builtin.ppt";
export const PPT_TOOLKIT_VERSION = "0.1.0";

export function createPptDocumentEnvelope(document: PptDocument): DocumentEnvelope<PptDocument> {
  const parsed = validatePptDocument(document);
  const issues = checkPptDocument(parsed);
  if (issues.length > 0) throw new Error(`PPT 文档结构错误: ${issues.join("; ")}`);
  return createDocumentEnvelope({
    projectType: "ppt",
    toolkitId: PPT_TOOLKIT_ID,
    toolkitVersion: PPT_TOOLKIT_VERSION,
    documentVersion: PPT_DOCUMENT_VERSION,
    document: parsed,
  });
}

function assertPptEnvelope(envelope: DocumentEnvelope): void {
  if (
    envelope.projectType !== "ppt" ||
    envelope.toolkitId !== PPT_TOOLKIT_ID ||
    envelope.toolkitVersion !== PPT_TOOLKIT_VERSION ||
    envelope.documentVersion !== PPT_DOCUMENT_VERSION
  ) {
    throw new Error("PPT 文档信封不匹配");
  }
}

/**
 * Scope resolution mirrors the UI toolkit contract:
 * - container targets must be slides; the slide itself becomes editable.
 * - selection targets must be objects, and ONLY those objects are editable —
 *   a selection scope never widens to the whole slide.
 * - lockedIds carries direct slide/object locks plus inherited object locks
 *   from locked slides; lockManagementIds keeps the directly locked ids so
 *   manual commands can request overrides.
 */
function resolveScope(document: PptDocument, scope: SelectionScope): ScopeResolution {
  if (scope.kind === "range") throw new Error("PPT 工具包不支持文本范围");

  const lockedSlides = document.slides.filter((slide) => slide.locked);
  const lockManagementIds = [
    ...lockedSlides.map((slide) => slide.id),
    ...document.slides.flatMap((slide) => slide.objects.filter((object) => object.locked).map((object) => object.id)),
  ];
  // Lock inheritance: a locked slide freezes every object on it.
  const lockedIds = [...lockManagementIds, ...lockedSlides.flatMap((slide) => slide.objects.map((object) => object.id))];

  if (scope.kind === "file") return { allowAll: true, allowedIds: [], lockedIds, lockManagementIds };

  const slideIds = new Set(document.slides.map((slide) => slide.id));
  const objectOwners = new Map(document.slides.flatMap((slide) => slide.objects.map((object) => [object.id, slide.id] as const)));
  const allowedIds = new Set<string>();
  for (const id of new Set(scope.targetIds)) {
    if (slideIds.has(id)) {
      if (scope.kind === "selection") throw new Error(`选择范围目标不是对象: ${id}`);
      // Container (slide) scope widens to everything on the slide — matching
      // the UI toolkit's container behavior (container subtree is editable).
      allowedIds.add(id);
      const slide = document.slides.find((candidate) => candidate.id === id)!;
      for (const object of slide.objects) allowedIds.add(object.id);
    } else if (objectOwners.has(id)) {
      if (scope.kind === "container") throw new Error(`容器范围目标不是幻灯片: ${id}`);
      allowedIds.add(id);
      allowedIds.add(objectOwners.get(id)!); // the owning slide is always editable context
    } else {
      throw new Error(`PPT 选择目标不存在: ${id}`);
    }
  }
  return { allowAll: false, allowedIds: [...allowedIds], lockedIds, lockManagementIds };
}

export const pptDocumentAdapter: DocumentAdapter<PptDocument> = {
  createEmpty(name) {
    return createPptDocumentEnvelope(createEmptyDeck(name));
  },

  parse(input) {
    const envelope = parseDocumentEnvelope(input);
    assertPptEnvelope(envelope);
    return createPptDocumentEnvelope(validatePptDocument(envelope.document));
  },

  resolveScope(envelope, scope) {
    return resolveScope(envelope.document, scope);
  },
};

export function slideById(document: PptDocument, id: string): PptSlide | undefined {
  return document.slides.find((slide) => slide.id === id);
}

export type PptCapabilityId = "ppt.export";
export const PPT_CAPABILITIES: { id: PptCapabilityId; title: string; dataCategories: DataCategory[] }[] = [
  { id: "ppt.export", title: "导出 PPT 演示文稿", dataCategories: ["document"] },
];
