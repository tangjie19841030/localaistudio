import { describe, expect, it } from "vitest";
import { baseDocument } from "./fixtures.js";
import {
  DEFAULT_STYLE_METRICS,
  estimateBlockHeight,
  findWidowOrphanIssues,
  paginate,
  validateWordDocument,
  type StyleMetrics,
  type WordDocument,
} from "../src/index.js";

/** Paragraph block with `lines` estimated lines at normal 11pt metrics. */
function paragraph(id: string, textLength: number) {
  return { id, type: "paragraph" as const, runs: [{ text: "字".repeat(textLength) }] };
}

function docWithBlocks(textLengths: number[]): WordDocument {
  const doc = baseDocument();
  const blocks = textLengths.map((length, at) => paragraph(`para-${at}`, length));
  const heading = doc.blocks[0]!;
  return validateWordDocument({
    ...doc,
    blocks: [heading, ...blocks],
    sections: [
      { id: "section-1", blockIds: ["heading-1", ...blocks.map((block) => block.id)] },
      { id: "section-2", blockIds: [] },
    ],
  });
}

describe("estimated pagination", () => {
  it("keeps page count monotonically non-decreasing as content grows", () => {
    let previousPages = 0;
    for (const length of [100, 500, 1000, 2000, 4000, 8000, 16000]) {
      const result = paginate(docWithBlocks([length]));
      expect(result.pages.length).toBeGreaterThanOrEqual(previousPages);
      previousPages = result.pages.length;
    }
    expect(paginate(docWithBlocks([16000])).pages.length).toBeGreaterThan(1);
  });

  it("spreads block ids across pages without duplication or loss", () => {
    const doc = docWithBlocks(new Array(30).fill(1500) as number[]);
    const result = paginate(doc);
    const placed = result.pages.flatMap((page) => page.blockIds);
    expect(placed).toEqual(doc.sections[0]!.blockIds);
    const unique = new Set(placed);
    expect(unique.size).toBe(placed.length);
  });

  it("estimates CJK text wider than latin text of the same character count", () => {
    const doc = docWithBlocks([]);
    const cjk = { id: "cjk-para", type: "paragraph" as const, runs: [{ text: "字".repeat(80) }] };
    const latin = { id: "latin-para", type: "paragraph" as const, runs: [{ text: "a".repeat(80) }] };
    const cjkHeight = estimateBlockHeight(doc, cjk, DEFAULT_STYLE_METRICS);
    const latinHeight = estimateBlockHeight(doc, latin, DEFAULT_STYLE_METRICS);
    // Full-width CJK glyphs take ~2x the advance width of narrow latin
    // glyphs, so the same character count must estimate more lines — the old
    // flat 0.6 factor under-counted CJK lines.
    expect(cjkHeight).toBeGreaterThan(latinHeight);
    // Exact lines at A4 (415.3pt column, 11pt normal, 8pt spaceAfter):
    // CJK 880pt -> 3 lines, latin 440pt -> 2 lines.
    expect(cjkHeight - 8).toBeCloseTo(3 * 11 * DEFAULT_STYLE_METRICS.lineHeightFactor);
    expect(latinHeight - 8).toBeCloseTo(2 * 11 * DEFAULT_STYLE_METRICS.lineHeightFactor);
  });

  it("forces a new page at a pageBreak block", () => {
    const doc = docWithBlocks([50]);
    const withBreak = validateWordDocument({
      ...doc,
      blocks: [
        ...doc.blocks,
        { id: "break-1", type: "pageBreak" },
        paragraph("after-break", 50),
      ],
      sections: [
        { id: "section-1", blockIds: [...doc.sections[0]!.blockIds, "break-1", "after-break"] },
        doc.sections[1]!,
      ],
    });
    const result = paginate(withBreak);
    expect(result.pages.length).toBe(2);
    expect(result.pages[0]!.blockIds).toContain("break-1");
    expect(result.pages[1]!.blockIds).toEqual(["after-break"]);
  });

  it("flags an orphaned keep-with-next heading at a page bottom", () => {
    const doc = docWithBlocks([100]);
    const heading = { id: "tail-heading", type: "heading" as const, level: 1 as const, runs: [{ text: "末尾标题" }] };
    const orphanDoc = validateWordDocument({
      ...doc,
      blocks: [...doc.blocks, heading],
      sections: [
        { id: "section-1", blockIds: [...doc.sections[0]!.blockIds, "tail-heading"] },
        doc.sections[1]!,
      ],
    });
    // Orphan: heading (keepWithNext) is the last block of a non-final page.
    const orphanPages = [
      { index: 0, blockIds: ["heading-1", "para-0", "tail-heading"], usedHeight: 600 },
      { index: 1, blockIds: ["para-1"], usedHeight: 100 },
    ];
    const issues = findWidowOrphanIssues(orphanDoc, orphanPages);
    const orphan = issues.find((issue) => issue.blockId === "tail-heading" && issue.kind === "orphan");
    expect(orphan).toBeDefined();
    expect(orphan!.message).toContain("孤行");

    // Not an orphan when the heading sits on the final page.
    const finalPages = [
      { index: 0, blockIds: ["heading-1", "para-0"], usedHeight: 600 },
      { index: 1, blockIds: ["tail-heading"], usedHeight: 30 },
    ];
    const clean = findWidowOrphanIssues(orphanDoc, finalPages);
    expect(clean.some((issue) => issue.blockId === "tail-heading" && issue.kind === "orphan")).toBe(false);
  });

  it("flags a widow when a multi-line paragraph spills exactly one line", () => {
    const doc = docWithBlocks([100]);
    const paragraphId = "para-0";
    // Hand layout: para-0 is 2 estimated lines and starts ~1 line before the
    // page bottom (usedHeight 710 leaves room for only its first line) ->
    // 1 line spills onto the next page -> widow issue.
    const pages = [
      { index: 0, blockIds: ["heading-1", paragraphId], usedHeight: 710 },
      { index: 1, blockIds: ["para-next"], usedHeight: 50 },
    ];
    const issues = findWidowOrphanIssues(doc, pages, DEFAULT_STYLE_METRICS);
    const widow = issues.find((issue) => issue.blockId === paragraphId && issue.kind === "widow");
    expect(widow).toBeDefined();
    expect(widow!.message).toContain("最后一行单独落在");
  });

  it("does not report a widow when the paragraph fits on the page", () => {
    const doc = docWithBlocks([100]);
    const pages = [
      { index: 0, blockIds: ["heading-1", "para-0"], usedHeight: 100 },
      { index: 1, blockIds: ["para-next"], usedHeight: 50 },
    ];
    const issues = findWidowOrphanIssues(doc, pages, DEFAULT_STYLE_METRICS);
    expect(issues.some((issue) => issue.kind === "widow")).toBe(false);
  });

  it("returns at least one page for a pageBreak-only document", () => {
    const doc = validateWordDocument({
      ...baseDocument(),
      blocks: [{ id: "break-1", type: "pageBreak" }],
      sections: [{ id: "section-1", blockIds: ["break-1"] }],
    });
    const result = paginate(doc);
    expect(result.pages.length).toBeGreaterThanOrEqual(1);
    expect(result.pages[0]!.blockIds).toEqual(["break-1"]);
  });

  it("never emits a blank page when keepWithNext moves off a fresh page", () => {
    const doc = docWithBlocks([50]);
    // After the pageBreak, tail-heading (keepWithNext) sits alone on a fresh
    // page and the oversized successor cannot fit beside it. Moving the
    // heading back must not push the emptied page as a blank sheet.
    const withBreak = validateWordDocument({
      ...doc,
      blocks: [
        ...doc.blocks,
        { id: "break-1", type: "pageBreak" as const },
        { id: "tail-heading", type: "heading" as const, level: 1 as const, runs: [{ text: "孤页标题" }] },
        paragraph("huge-para", 2000),
      ],
      sections: [
        {
          id: "section-1",
          blockIds: [...doc.sections[0]!.blockIds, "break-1", "tail-heading", "huge-para"],
        },
        doc.sections[1]!,
      ],
    });
    const result = paginate(withBreak);
    expect(result.pages.every((page) => page.blockIds.length > 0)).toBe(true);
    // The keepWithNext heading still starts a page of its own, with the
    // oversized successor on the following page.
    const headingPageIndex = result.pages.findIndex((page) => page.blockIds.includes("tail-heading"));
    expect(headingPageIndex).toBeGreaterThanOrEqual(0);
    expect(result.pages[headingPageIndex + 1]?.blockIds).toContain("huge-para");
  });

  it("accepts custom style metrics without changing page boundaries order", () => {
    const doc = docWithBlocks([3000]);
    const wide: StyleMetrics = { widthFactor: 1.0, cjkWidthFactor: 1.0, lineHeightFactor: 1.6 };
    const narrow: StyleMetrics = { widthFactor: 0.4, cjkWidthFactor: 0.5, lineHeightFactor: 1.0 };
    const withWide = paginate(doc, wide).pages.length;
    const withNarrow = paginate(doc, narrow).pages.length;
    expect(withNarrow).toBeLessThanOrEqual(withWide);
  });
});
