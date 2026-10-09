import { checkPptDocument, validatePptDocument, type PptDocument } from "@studio/ppt-toolkit";
import { PptImportError } from "./errors.js";

/**
 * Post-parse assembly: authoritative validation of the candidate document and
 * append-merge of a second import into an existing deck with nonce-stamped ids.
 */

const NONCE_ALPHABET = "abcdefghijkmnpqrstvxyz23456789";

export function randomImportNonce(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += NONCE_ALPHABET[Math.floor(Math.random() * NONCE_ALPHABET.length)];
  return out;
}

export interface MergeResult {
  document: PptDocument;
  warnings: string[];
}

/** Run the authoritative validators; throw PptImportError with the issue list. */
export function finalizeDocument(candidate: PptDocument): PptDocument {
  let document: PptDocument;
  try {
    document = validatePptDocument(candidate);
  } catch (err) {
    throw new PptImportError(`导入文档未通过结构校验：${err instanceof Error ? err.message : String(err)}`);
  }
  const issues = checkPptDocument(document);
  if (issues.length > 0) throw new PptImportError(`导入文档引用不完整：${issues.join("；")}`);
  return document;
}

/**
 * Append incoming slides to a base deck, re-id-ing EVERY imported slide/object
 * with a per-import nonce (group children remapped in the same table). The
 * base theme wins. Truncates at 200 slides / 500 objects per slide.
 */
export function mergeImportedSlides(base: PptDocument, incoming: PptDocument, nonce: string): MergeResult {
  const warnings: string[] = [];
  const takenSlides = new Set(base.slides.map((s) => s.id));
  const remapped: PptDocument["slides"] = [];
  for (const slide of incoming.slides) {
    if (takenSlides.size >= 200) {
      warnings.push(`合并后超过 200 页上限，余下 ${incoming.slides.length - remapped.length} 页未追加`);
      break;
    }
    const newSlideId = stampId(slide.id, nonce);
    takenSlides.add(newSlideId);
    const idMap = new Map<string, string>();
    const objects = slide.objects.slice(0, 500).map((object) => {
      const newId = stampId(object.id, nonce);
      idMap.set(object.id, newId);
      return { ...object, id: newId };
    });
    const withChildren = objects.map((object) =>
      object.kind === "group"
        ? { ...object, children: object.children.map((child) => idMap.get(child) ?? child).filter((id) => objects.some((o) => o.id === id)) }
        : object,
    );
    remapped.push({ ...slide, id: newSlideId, objects: withChildren });
  }
  const document = finalizeDocument({ ...base, slides: [...base.slides, ...remapped] });
  return { document, warnings };
}

function stampId(id: string, nonce: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  return `${cleaned}-${nonce}`.slice(0, 80);
}
