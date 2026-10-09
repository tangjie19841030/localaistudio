import type { CommandDefinition, CommandResult, DocumentEnvelope } from "@studio/studio-core";
import type { PptDocument, PptSlide, PptSlideObject } from "./document.js";
import { PptCommandError } from "./utils.js";

export type PptCommand<TArgs> = CommandDefinition<PptDocument, TArgs>;

/** scopeIds always include the owning slide so ensureScopeAllows passes resolveScope's design. */
export function objectScopeIds(slideId: string, objectIds: readonly string[]): string[] {
  return [...objectIds, slideId];
}

export function next(
  envelope: DocumentEnvelope<PptDocument>,
  document: PptDocument,
  summary: string,
  affectedIds: string[],
  scopeIds: string[],
): CommandResult<PptDocument> {
  return { nextEnvelope: { ...envelope, document }, summary, affectedIds, scopeIds };
}

export function requireSlide(doc: PptDocument, slideId: string): PptSlide {
  const slide = doc.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new PptCommandError(`幻灯片不存在: ${slideId}`);
  return slide;
}

export function requireObjectInDeck(doc: PptDocument, objectId: string): { slide: PptSlide; object: PptSlideObject } {
  for (const slide of doc.slides) {
    const object = slide.objects.find((candidate) => candidate.id === objectId);
    if (object) return { slide, object };
  }
  throw new PptCommandError(`对象不存在: ${objectId}`);
}

/** Guard: slide-level lock or object-level lock blocks the mutation. */
export function assertObjectEditable(slide: PptSlide, objectId: string): void {
  if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${slide.id}`);
  const object = slide.objects.find((candidate) => candidate.id === objectId);
  if (!object) throw new PptCommandError(`幻灯片 "${slide.id}" 中不存在对象: ${objectId}`);
  if (object.locked) throw new PptCommandError(`对象已锁定: ${objectId}`);
}

export function withSlide(doc: PptDocument, slide: PptSlide): PptDocument {
  return { ...doc, slides: doc.slides.map((candidate) => (candidate.id === slide.id ? slide : candidate)) };
}
