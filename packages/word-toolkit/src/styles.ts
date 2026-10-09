import type { Block, Run, StyleSet, WordStyle, WordStyleId } from "./document.js";
import { WORD_STYLE_IDS } from "./document.js";

/**
 * Default style set, tuned for the A4/pt layout: normal is 11pt with
 * 8pt paragraph spacing; headings step by 2pt and keep-with-next so a
 * heading never strands at a page bottom in the estimated preview.
 */
export function defaultStyleSet(): StyleSet {
  return {
    normal: { font: "Calibri, 'Microsoft YaHei', sans-serif", size: 11, spaceAfter: 8 },
    title: { font: "Calibri, 'Microsoft YaHei', sans-serif", size: 26, bold: true, spaceBefore: 0, spaceAfter: 12, keepWithNext: true },
    heading1: { font: "Calibri, 'Microsoft YaHei', sans-serif", size: 18, bold: true, spaceBefore: 16, spaceAfter: 8, keepWithNext: true },
    heading2: { font: "Calibri, 'Microsoft YaHei', sans-serif", size: 15, bold: true, spaceBefore: 12, spaceAfter: 6, keepWithNext: true },
    heading3: { font: "Calibri, 'Microsoft YaHei', sans-serif", size: 12.5, bold: true, spaceBefore: 10, spaceAfter: 4, keepWithNext: true },
    caption: { font: "Calibri, 'Microsoft YaHei', sans-serif", size: 9.5, italic: true, spaceBefore: 2, spaceAfter: 10 },
    quote: { font: "Calibri, 'Microsoft YaHei', sans-serif", size: 11, italic: true, indent: 24, spaceBefore: 6, spaceAfter: 6 },
  };
}

export function styleById(styles: StyleSet, styleId: WordStyleId | string | undefined): WordStyle | undefined {
  if (styleId === undefined) return undefined;
  if (!WORD_STYLE_IDS.includes(styleId as WordStyleId)) return undefined;
  return styles[styleId as WordStyleId];
}

/** Paragraph-style id implied by a block's shape, before styleId is consulted. */
function implicitStyleId(block: Block): WordStyleId {
  if (block.type === "heading") return `heading${block.level}` as WordStyleId;
  if (block.type === "image") return "caption";
  return "normal";
}

export interface ResolvedRunStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

/** Run-level style primitives a run may declare on top of the paragraph style. */
export interface RunStylePrimitives {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface ResolvedBlockStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  spaceBefore: number;
  spaceAfter: number;
  indent: number;
  keepWithNext: boolean;
}

/**
 * Inheritance chain, weakest to strongest: normal fallback > block-implied or
 * block-declared style > run.styleId > run direct formatting. Pure function;
 * unknown styleId resolves to the normal fallback rather than throwing so a
 * stale document never blocks rendering (checkWordDocument still flags it).
 */
export function deriveResolvedRunStyle(styles: StyleSet, block: Block, run: Run): ResolvedRunStyle {
  const blockStyle = deriveResolvedBlockStyle(styles, block);
  const runStyle: RunStylePrimitives | undefined = styleById(styles, run.styleId);
  const runSize = runStyle?.size ?? blockStyle.size;
  return {
    font: runStyle?.font ?? blockStyle.font,
    size: runSize,
    bold: run.bold ?? runStyle?.bold ?? blockStyle.bold,
    italic: run.italic ?? runStyle?.italic ?? blockStyle.italic,
    underline: run.underline ?? runStyle?.underline ?? false,
    strike: run.strike ?? runStyle?.strike ?? false,
  };
}

export function deriveResolvedBlockStyle(styles: StyleSet, block: Block): ResolvedBlockStyle {
  const normal = styles.normal;
  const declaredId = declaredStyleId(block);
  const declared = declaredId === undefined ? undefined : styles[declaredId];
  const fallback = declared ?? normal;
  return {
    font: fallback.font ?? normal.font!,
    size: fallback.size ?? normal.size!,
    bold: fallback.bold ?? false,
    italic: fallback.italic ?? false,
    spaceBefore: fallback.spaceBefore ?? 0,
    spaceAfter: fallback.spaceAfter ?? 0,
    indent: fallback.indent ?? 0,
    keepWithNext: fallback.keepWithNext ?? false,
  };
}

/** Explicit styleId on the block; headings/images fall back to their implicit style. */
function declaredStyleId(block: Block): WordStyleId | undefined {
  if (block.type === "paragraph") {
    return styleIdOrImplicit(block.styleId, "normal");
  }
  return implicitStyleId(block);
}

function styleIdOrImplicit(styleId: string | undefined, implicit: WordStyleId): WordStyleId {
  return WORD_STYLE_IDS.includes(styleId as WordStyleId) ? (styleId as WordStyleId) : implicit;
}
