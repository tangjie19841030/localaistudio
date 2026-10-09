import type { PptDocument } from "./document.js";

/**
 * PPT selection semantics on top of shared core SelectionScope kinds:
 * - file: whole deck, targetIds must be empty (shared core enforces).
 * - container: targetIds are slide IDs.
 * - selection: targetIds are object IDs, all within ONE slide (single-slide
 *   rule keeps object commands simple; multi-slide object selection is out
 *   of P9.1 scope).
 * The PPT domain does NOT reuse UI frame semantics; the canvas is fixed.
 */
export interface PptSelection {
  level: "slide" | "object";
  slideId?: string;
  objectIds: string[];
}

export interface ResolvedPptSelection {
  selection: PptSelection;
  slideIds: string[];
  objectIds: string[];
}

interface TargetIndex {
  slideIds: Set<string>;
  /** objectId -> owning slideId */
  objectOwners: Map<string, string>;
}

function indexTargets(doc: PptDocument): TargetIndex {
  const slideIds = new Set<string>();
  const objectOwners = new Map<string, string>();
  for (const slide of doc.slides) {
    slideIds.add(slide.id);
    for (const object of slide.objects) objectOwners.set(object.id, slide.id);
  }
  return { slideIds, objectOwners };
}

function classify(doc: PptDocument, targetIds: readonly string[]): { slides: string[]; objects: string[]; unknown: string[] } {
  const index = indexTargets(doc);
  const slides: string[] = [];
  const objects: string[] = [];
  const unknown: string[] = [];
  for (const id of new Set(targetIds)) {
    if (index.slideIds.has(id)) slides.push(id);
    else if (index.objectOwners.has(id)) objects.push(id);
    else unknown.push(id);
  }
  return { slides, objects, unknown };
}

/** Resolve targetIds into PPT domain targets; throws with a plain message on drift. */
export function resolvePptSelection(doc: PptDocument, targetIds: readonly string[]): ResolvedPptSelection {
  const issues = validateSelection(doc, targetIds);
  if (issues.length > 0) throw new Error(issues.join("; "));
  const { slides, objects } = classify(doc, targetIds);
  const level: PptSelection["level"] = slides.length > 0 ? "slide" : "object";
  const slideId = level === "object" ? doc.slides.find((slide) => slide.objects.some((object) => object.id === objects[0]))?.id : undefined;
  return { selection: { level, slideId, objectIds: objects }, slideIds: slides, objectIds: objects };
}

/** Static validation of targetIds against a document; returns violation lines. */
export function validateSelection(doc: PptDocument, targetIds: readonly string[]): string[] {
  const issues: string[] = [];
  const { slides, objects, unknown } = classify(doc, targetIds);
  for (const id of unknown) issues.push(`选择目标不存在: ${id}`);
  if (slides.length > 0 && objects.length > 0) issues.push("选择目标混用了幻灯片与对象");
  if (objects.length > 0) {
    const owners = new Set(objects.map((id) => indexTargets(doc).objectOwners.get(id)!));
    if (owners.size > 1) issues.push("对象选择跨越多张幻灯片");
  }
  return issues;
}
