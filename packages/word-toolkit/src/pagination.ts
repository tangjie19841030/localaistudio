import type { Block, PageSettings, WordDocument } from "./document.js";
import { getBlock } from "./document.js";
import { deriveResolvedBlockStyle, type ResolvedBlockStyle } from "./styles.js";

/**
 * ESTIMATED pagination only — a coarse line-count model for the preview and
 * the pagination quality checks. It is NOT a layout engine: no kerning, no
 * hyphenation, no table row splitting across pages. Numbers must never be
 * presented to users as exact page breaks.
 */
export interface StyleMetrics {
  /** Narrow glyph advance width in pt per font-size unit (latin, digits, spaces). */
  widthFactor: number;
  /** Full-width CJK glyph advance width in pt per font-size unit (Han/Kana/Hangul). */
  cjkWidthFactor: number;
  /** Line height as a multiple of font size. */
  lineHeightFactor: number;
}

export const DEFAULT_STYLE_METRICS: StyleMetrics = {
  widthFactor: 0.5,
  cjkWidthFactor: 1.0,
  lineHeightFactor: 1.25,
};

/**
 * Full-width CJK ranges: Hangul Jamo, CJK radicals/punctuation, Kana,
 * Bopomofo, enclosed CJK, Hangul compatibility, Han (incl. ext-A), compat
 * ideographs, halfwidth/fullwidth forms. Everything else (latin, digits,
 * punctuation, whitespace) uses the narrow widthFactor.
 */
const CJK_CHAR = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** Estimated advance width of a text chunk in pt, per character class. */
function textAdvanceWidth(text: string, fontSize: number, metrics: StyleMetrics): number {
  let units = 0;
  for (const char of text) {
    units += CJK_CHAR.test(char) ? metrics.cjkWidthFactor : metrics.widthFactor;
  }
  return units * fontSize;
}

export interface Page {
  index: number;
  /** Block ids placed on this page, in document order. */
  blockIds: string[];
  /** Estimated consumed height, pt (excluding bottom whitespace). */
  usedHeight: number;
}

export interface PaginationIssue {
  blockId: string;
  kind: "widow" | "orphan" | "keepWithNext";
  message: string;
}

export interface PaginationResult {
  pages: Page[];
  issues: PaginationIssue[];
}

/** Usable text column width after margins, pt. */
function contentWidth(settings: PageSettings): number {
  return Math.max(1, settings.width - settings.margin.left - settings.margin.right);
}

function contentHeight(settings: PageSettings): number {
  return Math.max(1, settings.height - settings.margin.top - settings.margin.bottom);
}

/** Rough line count for one text chunk: total advance width / column width. */
function estimateLines(text: string, style: ResolvedBlockStyle, metrics: StyleMetrics, width: number): number {
  if (text.trim().length === 0) return 1;
  const advanceWidth = textAdvanceWidth(text, style.size, metrics);
  return Math.max(1, Math.ceil(advanceWidth / width));
}

function lineBatchHeight(lines: number, style: ResolvedBlockStyle, metrics: StyleMetrics): number {
  return lines * style.size * metrics.lineHeightFactor;
}

/** Estimated drawn height of one block in pt, block-granular (no run splitting). */
export function estimateBlockHeight(doc: WordDocument, block: Block, metrics: StyleMetrics): number {
  const style = deriveResolvedBlockStyle(doc.styles, block);
  const width = contentWidth(doc.pageSettings);
  if (block.type === "pageBreak") return 0;
  if (block.type === "image") {
    // Fixed aspect assumption: images take 1/3 of the column width and a 2:1
    // ratio; exact intrinsic sizes arrive with the real asset loader (P10.2).
    const drawn = Math.min(block.width, width);
    const height = (drawn / width) * width * 0.5;
    return height + style.spaceBefore + style.spaceAfter;
  }
  if (block.type === "heading" || block.type === "paragraph") {
    const text = block.runs.map((run) => run.text).join("");
    const lines = estimateLines(text, style, metrics, width);
    return lineBatchHeight(lines, style, metrics) + style.spaceBefore + style.spaceAfter;
  }
  if (block.type === "list") {
    const lines = block.items.reduce(
      (total, item) => total + estimateLines(item.runs.map((run) => run.text).join(""), style, metrics, width),
      0,
    );
    return lineBatchHeight(lines, style, metrics) + style.spaceBefore + style.spaceAfter;
  }
  if (block.type === "table") {
    const lines = block.rows.reduce(
      (total, row) =>
        total +
        Math.max(
          ...row.cells.map((cell) => estimateLines(cell.runs.map((run) => run.text).join(""), style, metrics, width)),
        ),
      0,
    );
    return lineBatchHeight(lines, style, metrics) + style.spaceBefore + style.spaceAfter;
  }
  // tocPlaceholder with no snapshot yet occupies a stub line.
  const entries = block.entries ?? [];
  const lines = Math.max(1, entries.length);
  return lineBatchHeight(lines, style, metrics) + style.spaceBefore + style.spaceAfter;
}

/**
 * Greedy page filling with keepWithNext and forced page breaks. Block
 * granularity: a block is never split across pages. A pageBreak block closes
 * its page as a zero-height marker sitting on the page it ends, and the next
 * block starts a fresh page. A keepWithNext block landing at a page bottom
 * with its in-section successor not fitting moves to the next page so the
 * pair stays together.
 */
export function paginate(
  doc: WordDocument,
  metrics: StyleMetrics = DEFAULT_STYLE_METRICS,
): PaginationResult {
  const limit = contentHeight(doc.pageSettings);
  const pages: Page[] = [];
  const issues: PaginationIssue[] = [];
  let current: Page = { index: 0, blockIds: [], usedHeight: 0 };

  for (const section of doc.sections) {
    for (const blockId of section.blockIds) {
      const block = getBlock(doc, blockId);
      if (!block) continue;
      if (block.type === "pageBreak") {
        current.blockIds.push(blockId);
        pages.push(current);
        current = { index: pages.length, blockIds: [], usedHeight: 0 };
        continue;
      }
      const height = estimateBlockHeight(doc, block, metrics);
      if (height > limit) {
        issues.push({
          blockId,
          kind: "keepWithNext",
          message: `块 "${blockId}" 估算高度超过整页，无法完整分页（估算模型）`,
        });
      }
      if (current.usedHeight + height > limit && current.blockIds.length > 0) {
        pages.push(current);
        current = { index: pages.length, blockIds: [], usedHeight: 0 };
      }
      current.blockIds.push(blockId);
      current.usedHeight += height;
      current = keepWithNextPlacement(doc, section.blockIds, blockId, height, metrics, limit, current, pages);
    }
  }
  // Trailing empty page (after a closing pageBreak) is dropped: a pageBreak
  // ends a page, it never opens an empty trailing one.
  if (current.blockIds.length > 0) pages.push(current);
  issues.push(...findWidowOrphanIssues(doc, pages, metrics));
  return { pages, issues };
}

/**
 * A keepWithNext block landing at a page bottom with its in-section successor
 * not fitting moves to a fresh page so the pair stays together. If the block
 * is alone on its (fresh) page, moving it would push an empty page as a blank
 * sheet, so it stays where it is.
 */
function keepWithNextPlacement(
  doc: WordDocument,
  sectionBlockIds: readonly string[],
  blockId: string,
  height: number,
  metrics: StyleMetrics,
  limit: number,
  current: Page,
  pages: Page[],
): Page {
  const block = getBlock(doc, blockId);
  if (!block || !deriveResolvedBlockStyle(doc.styles, block).keepWithNext) return current;
  const successor = nextInSection(doc, sectionBlockIds, blockId);
  if (!successor || successorFits(current, doc, successor, metrics, limit)) return current;
  if (current.blockIds.length <= 1) return current;
  current.blockIds.pop();
  current.usedHeight -= height;
  pages.push(current);
  return { index: pages.length, blockIds: [blockId], usedHeight: height };
}

function successorFits(
  current: Page,
  doc: WordDocument,
  successor: Block,
  metrics: StyleMetrics,
  limit: number,
): boolean {
  return current.usedHeight + estimateBlockHeight(doc, successor, metrics) <= limit;
}

function nextInSection(doc: WordDocument, blockIds: readonly string[], blockId: string): Block | undefined {
  const at = blockIds.indexOf(blockId);
  if (at < 0 || at + 1 >= blockIds.length) return undefined;
  return getBlock(doc, blockIds[at + 1] ?? "");
}

/**
 * Widow/orphan check on the estimated, block-granular layout:
 * - orphan: a keepWithNext block (heading) is the last block of a page while
 *   its content successor starts on the next page;
 * - widow: a multi-line paragraph estimated to start in the last line-height
 *   of a page, spilling its single last line onto the next page.
 * Issues point at block ids, never DOM selectors.
 */
export function findWidowOrphanIssues(
  doc: WordDocument,
  pages: readonly Page[],
  metrics: StyleMetrics = DEFAULT_STYLE_METRICS,
): PaginationIssue[] {
  const issues: PaginationIssue[] = [];
  for (let pageAt = 0; pageAt < pages.length - 1; pageAt += 1) {
    const page = pages[pageAt];
    if (!page) continue;
    const lastId = page.blockIds[page.blockIds.length - 1];
    const lastBlock = lastId !== undefined ? getBlock(doc, lastId) : undefined;
    if (lastBlock && deriveResolvedBlockStyle(doc.styles, lastBlock).keepWithNext) {
      issues.push({
        blockId: lastId!,
        kind: "orphan",
        message: `块 "${lastId}" 位于第 ${page.index + 1} 页末尾，后续内容落在下一页（孤行）`,
      });
    }
    collectPageWidows(doc, page, pageAt, pages, metrics, issues);
  }
  return issues;
}

function collectPageWidows(
  doc: WordDocument,
  page: Page,
  pageAt: number,
  pages: readonly Page[],
  metrics: StyleMetrics,
  issues: PaginationIssue[],
): void {
  const limit = contentHeight(doc.pageSettings);
  for (const blockId of page.blockIds) {
    const block = getBlock(doc, blockId);
    if (!block || (block.type !== "paragraph" && block.type !== "heading")) continue;
    const style = deriveResolvedBlockStyle(doc.styles, block);
    const width = contentWidth(doc.pageSettings);
    const lines = estimateLines(block.runs.map((run) => run.text).join(""), style, metrics, width);
    if (lines <= 1) continue;
    const lineHeight = style.size * metrics.lineHeightFactor;
    const height = estimateBlockHeight(doc, block, metrics);
    // Offset where this block starts: everything before it on the page,
    // derived from the page's own recorded usedHeight (so hand-built page
    // layouts and paginate output behave identically here).
    const startOffset = Math.max(0, page.usedHeight - height);
    const linesFitOnPage = Math.floor((limit - startOffset) / lineHeight);
    const nextPage = pages[pageAt + 1];
    const startsOnThisPage = startOffset < limit;
    const spillsForward = startsOnThisPage && linesFitOnPage < lines && nextPage !== undefined;
    if (spillsForward && lines - linesFitOnPage === 1) {
      issues.push({
        blockId,
        kind: "widow",
        message: `块 "${blockId}" 估算有 ${lines} 行，最后一行单独落在第 ${page.index + 2} 页（孤行）`,
      });
    }
  }
}
