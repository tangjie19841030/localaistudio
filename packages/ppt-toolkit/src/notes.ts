import type { PptDocument, PptSlide } from "./document.js";

export const NOTES_MAX_LENGTH = 20000;

export function readNotes(doc: PptDocument, slideId: string): string | undefined {
  return doc.slides.find((slide) => slide.id === slideId)?.notes;
}

export function writeNotes(doc: PptDocument, slideId: string, notes: string): PptDocument {
  const slide = requireSlide(doc, slideId);
  if (notes.length > NOTES_MAX_LENGTH) {
    throw new Error(`备注超出长度限制（${NOTES_MAX_LENGTH} 字）`);
  }
  return withReplacedSlide(doc, { ...slide, notes });
}

/** Append a line to speaker notes (AI storyline narration helper). */
export function appendNotes(doc: PptDocument, slideId: string, line: string): PptDocument {
  const slide = requireSlide(doc, slideId);
  const joined = slide.notes.length > 0 ? `${slide.notes}\n${line}` : line;
  return writeNotes(doc, slideId, joined.slice(0, NOTES_MAX_LENGTH));
}

function requireSlide(doc: PptDocument, slideId: string): PptSlide {
  const slide = doc.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error(`幻灯片不存在: ${slideId}`);
  return slide;
}

function withReplacedSlide(doc: PptDocument, slide: PptSlide): PptDocument {
  return { ...doc, slides: doc.slides.map((candidate) => (candidate.id === slide.id ? slide : candidate)) };
}
