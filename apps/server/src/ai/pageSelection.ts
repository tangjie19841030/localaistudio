import { activePageOf, type Page, type StudioDocument } from "@studio/schema-core";

/**
 * Target-page semantics for the AI chain (T21 §3.6): the loop edits ONE page —
 * the request's pageId, defaulting to pages[0] for legacy callers and tests —
 * while done frames always carry the WHOLE document. Pure functions only.
 */

/** Active-page pick: pageId -> that page plus its index; null/unknown -> pages[0]. */
export function pickPage(doc: StudioDocument, pageId: string | null): { page: Page; index: number } {
  const page = activePageOf(doc, pageId);
  const index = doc.pages.findIndex((p) => p.id === page.id);
  return { page, index: index === -1 ? 0 : index };
}

/** Splice a loop/patch result page back into the whole doc at its original index. */
export function splicePageBack(doc: StudioDocument, index: number, page: Page): StudioDocument {
  const pages = [...doc.pages];
  pages[index] = page;
  return { ...doc, pages };
}

/** Prompt-facing digest inputs: the active page plus a one-line page list (active marked). */
export function pageViewForPrompt(doc: StudioDocument, pageId: string | null): { page: Page; pageList: string } {
  const page = activePageOf(doc, pageId);
  const pageList = doc.pages
    .map((p, i) => `${i + 1}.${p.name}(${p.id})${p.id === page.id ? "（当前）" : ""}`)
    .join("、");
  return { page, pageList };
}
