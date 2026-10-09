import { z } from "zod";
import { defaultStyleSet } from "./styles.js";

export const WORD_DOCUMENT_VERSION = 1;

/**
 * Unit choice: points (pt). Word's own layout grid is in twips (1pt = 20
 * twips); pt keeps A4 numbers readable (595.3 x 841.9pt) and converts to
 * DOCX without loss, while mm would force float rounding at the exporter.
 * All sizes/lengths below are pt unless the field name says otherwise.
 */
export const A4_PAGE: Readonly<{ width: number; height: number }> = { width: 595.3, height: 841.9 };
export const A4_MARGINS: Readonly<{ top: number; right: number; bottom: number; left: number }> = {
  top: 72,
  right: 90,
  bottom: 72,
  left: 90,
};

const nonEmptyId = z.string().min(1);

const pageSettingsSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    margin: z.object({
      top: z.number().min(0),
      right: z.number().min(0),
      bottom: z.number().min(0),
      left: z.number().min(0),
    }),
  })
  .strict();
export type PageSettings = z.infer<typeof pageSettingsSchema>;

/** Paragraph-level style primitives only; run-level basics live on the run. */
const styleSchema = z
  .object({
    font: z.string().min(1).optional(),
    size: z.number().positive().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    /** Space before / after the block, in pt. */
    spaceBefore: z.number().min(0).optional(),
    spaceAfter: z.number().min(0).optional(),
    /** First-line indent, in pt. */
    indent: z.number().min(0).optional(),
    /** Keep this block on the same page as the next block (widow control aid). */
    keepWithNext: z.boolean().optional(),
  })
  .strict();
export type WordStyle = z.infer<typeof styleSchema>;

export const WORD_STYLE_IDS = ["normal", "title", "heading1", "heading2", "heading3", "caption", "quote"] as const;
export type WordStyleId = (typeof WORD_STYLE_IDS)[number];

const styleSetSchema = z
  .object({
    normal: styleSchema,
    title: styleSchema.optional(),
    heading1: styleSchema.optional(),
    heading2: styleSchema.optional(),
    heading3: styleSchema.optional(),
    caption: styleSchema.optional(),
    quote: styleSchema.optional(),
  })
  .strict()
  .refine((set) => set.normal.size !== undefined && set.normal.font !== undefined, "normal 样式必须提供 font 与 size 兜底");
export type StyleSet = z.infer<typeof styleSetSchema>;

/** Inline text run. Direct formatting wins over the resolved style. */
const runSchema = z
  .object({
    text: z.string(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    /** Direct run color, e.g. #E11D48 (overrides the style-level color). */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** Direct run size in points. */
    size: z.number().positive().max(200).optional(),
    styleId: z.string().min(1).optional(),
    /** References doc.footnotes[].id; must exist (checkWordDocument). */
    footnoteRef: nonEmptyId.optional(),
  })
  .strict();
export type Run = z.infer<typeof runSchema>;

const runsRefine = z.array(runSchema).refine((runs) => runs.length > 0, "runs 不能为空");

const blockBase = { id: nonEmptyId, locked: z.boolean().optional() } as const;

const headingBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    runs: runsRefine,
  })
  .strict();

const paragraphBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal("paragraph"),
    runs: runsRefine,
    styleId: nonEmptyId.optional(),
  })
  .strict();

const listItemSchema = z.object({ runs: runsRefine }).strict();

const listBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(listItemSchema).min(1),
  })
  .strict();

const tableCellSchema = z.object({ runs: runsRefine }).strict();

const tableBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal("table"),
    /** Header rows repeat when the table breaks across pages (preview hint). */
    headerRowCount: z.number().int().min(0),
    rows: z
      .array(z.object({ cells: z.array(tableCellSchema).min(1) }).strict())
      .min(1)
      .refine(
        (rows) => rows.every((row) => row.cells.length === (rows[0]?.cells.length ?? 0)),
        "表格所有行的单元格数量必须一致",
      ),
  })
  .strict();

const imageBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal("image"),
    src: nonEmptyId,
    width: z.number().positive(),
    caption: z.string().optional(),
  })
  .strict();

const pageBreakBlockSchema = z.object({ ...blockBase, type: z.literal("pageBreak") }).strict();

const tocEntrySchema = z
  .object({
    /** Block id of the heading this entry points at. */
    headingBlockId: nonEmptyId,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().min(1),
  })
  .strict();

const tocPlaceholderBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal("tocPlaceholder"),
    /** Snapshot produced by word.toc-generate; absent until first generation. */
    entries: z.array(tocEntrySchema).optional(),
  })
  .strict();

export const blockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  listBlockSchema,
  tableBlockSchema,
  imageBlockSchema,
  pageBreakBlockSchema,
  tocPlaceholderBlockSchema,
]);
export type Block = z.infer<typeof blockSchema>;
export type HeadingBlock = z.infer<typeof headingBlockSchema>;
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>;
export type ListBlock = z.infer<typeof listBlockSchema>;
export type TableBlock = z.infer<typeof tableBlockSchema>;
export type ImageBlock = z.infer<typeof imageBlockSchema>;
export type TocPlaceholderBlock = z.infer<typeof tocPlaceholderBlockSchema>;
export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "table",
  "image",
  "pageBreak",
  "tocPlaceholder",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * Command-insertable block payload: id optional (the word.block.insert command
 * assigns one when absent) and locked stripped (locking goes through the
 * separate risk-gated word.block.set-locked command).
 */
export const blockPayloadSchema = z.preprocess(
  (input) => {
    if (input !== null && typeof input === "object" && !("id" in input)) {
      return { ...input, id: "__pending__" };
    }
    return input;
  },
  blockSchema,
);

/** One header/footer body per section — minimal P10.1 shape. */
const headerFooterSchema = z.object({ runs: runsRefine }).strict();
export type HeaderFooter = z.infer<typeof headerFooterSchema>;

const sectionSchema = z
  .object({
    id: nonEmptyId,
    heading: z.string().min(1).optional(),
    /** Ordered block ids; block content lives in the flat doc.blocks table. */
    blockIds: z.array(nonEmptyId),
    header: headerFooterSchema.optional(),
    footer: headerFooterSchema.optional(),
  })
  .strict();
export type Section = z.infer<typeof sectionSchema>;

const footnoteSchema = z
  .object({
    id: nonEmptyId,
    runs: runsRefine,
  })
  .strict();
export type Footnote = z.infer<typeof footnoteSchema>;

const commentSchema = z
  .object({
    id: nonEmptyId,
    author: z.string().min(1),
    text: z.string().min(1),
    /** Block this comment anchors at; must exist (checkWordDocument). */
    targetBlockId: nonEmptyId,
  })
  .strict();
export type WordComment = z.infer<typeof commentSchema>;

export const wordDocumentSchema = z
  .object({
    documentVersion: z.literal(WORD_DOCUMENT_VERSION),
    name: z.string().min(1).max(120),
    sections: z.array(sectionSchema).min(1),
    /** Flat block table keyed by stable id, like schema-core's nodes table. */
    blocks: z.array(blockSchema).min(1),
    styles: styleSetSchema,
    pageSettings: pageSettingsSchema,
    footnotes: z.array(footnoteSchema).default([]),
    comments: z.array(commentSchema).default([]),
  })
  .strict();
export type WordDocument = z.infer<typeof wordDocumentSchema>;

export function defaultPageSettings(): PageSettings {
  return { width: A4_PAGE.width, height: A4_PAGE.height, margin: { ...A4_MARGINS } };
}

/** Minimal legal document: one section containing one empty-text paragraph. */
export function emptyWordDocument(name: string): WordDocument {
  const paragraph: Block = { id: "block-1", type: "paragraph", runs: [{ text: "" }] };
  return {
    documentVersion: WORD_DOCUMENT_VERSION,
    name,
    sections: [{ id: "section-1", blockIds: ["block-1"] }],
    blocks: [paragraph],
    styles: defaultStyleSet(),
    pageSettings: defaultPageSettings(),
    footnotes: [],
    comments: [],
  };
}

export function validateWordDocument(input: unknown): WordDocument {
  return wordDocumentSchema.parse(input);
}

export function getBlock(doc: WordDocument, blockId: string): Block | undefined {
  return doc.blocks.find((block) => block.id === blockId);
}

export function getSection(doc: WordDocument, sectionId: string): Section | undefined {
  return doc.sections.find((section) => section.id === sectionId);
}

export function sectionOfBlock(doc: WordDocument, blockId: string): Section | undefined {
  return doc.sections.find((section) => section.blockIds.includes(blockId));
}

/**
 * Referential invariants beyond zod's reach: unique ids, every block reachable
 * exactly once, every reference resolvable, list/table/list-cell runs not
 * all-blank, table rows rectangular, footnotes anchored. Returns issue lines
 * (empty = valid). Preconditions mirror checkDocument: input must be
 * schema-parsed.
 */
export function checkWordDocument(doc: WordDocument): string[] {
  const issues: string[] = [];
  const blockIds = new Set(doc.blocks.map((block) => block.id));
  if (blockIds.size !== doc.blocks.length) issues.push("存在重复的块 ID");
  const sectionIds = new Set(doc.sections.map((section) => section.id));
  if (sectionIds.size !== doc.sections.length) issues.push("存在重复的章节 ID");

  const reachable = new Set<string>();
  for (const section of doc.sections) {
    for (const blockId of section.blockIds) {
      if (!blockIds.has(blockId)) {
        issues.push(`章节 "${section.id}" 引用了不存在的块 "${blockId}"`);
        continue;
      }
      if (reachable.has(blockId)) issues.push(`块 "${blockId}" 被多个章节引用`);
      reachable.add(blockId);
    }
  }
  for (const block of doc.blocks) {
    if (!reachable.has(block.id)) issues.push(`块 "${block.id}" 未被任何章节引用`);
    if (block.type === "tocPlaceholder" && block.entries) {
      for (const entry of block.entries) {
        if (!blockIds.has(entry.headingBlockId)) {
          issues.push(`目录条目引用了不存在的标题块 "${entry.headingBlockId}"`);
        }
      }
    }
  }
  checkFootnotes(doc, issues);
  checkComments(doc, blockIds, issues);
  return issues;
}

function blockRuns(block: Block): readonly Run[] {
  if (block.type === "heading" || block.type === "paragraph") return block.runs;
  if (block.type === "list") return block.items.flatMap((item) => item.runs);
  if (block.type === "table") return block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.runs));
  return [];
}

function checkFootnotes(doc: WordDocument, issues: string[]): void {
  const footnoteIds = new Set(doc.footnotes.map((footnote) => footnote.id));
  if (footnoteIds.size !== doc.footnotes.length) issues.push("存在重复的脚注 ID");
  for (const block of doc.blocks) {
    for (const run of blockRuns(block)) {
      if (run.footnoteRef && !footnoteIds.has(run.footnoteRef)) {
        issues.push(`块 "${block.id}" 引用了不存在的脚注 "${run.footnoteRef}"`);
      }
    }
  }
  for (const footnote of doc.footnotes) {
    if (!footnote.runs.some((run) => run.text.trim().length > 0)) {
      issues.push(`脚注 "${footnote.id}" 的文本内容为空`);
    }
  }
}

function checkComments(doc: WordDocument, blockIds: Set<string>, issues: string[]): void {
  const commentIds = new Set(doc.comments.map((comment) => comment.id));
  if (commentIds.size !== doc.comments.length) issues.push("存在重复的批注 ID");
  for (const comment of doc.comments) {
    if (!blockIds.has(comment.targetBlockId)) {
      issues.push(`批注 "${comment.id}" 引用了不存在的块 "${comment.targetBlockId}"`);
    }
  }
}
