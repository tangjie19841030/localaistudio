import type {
  Block,
  ImageBlock,
  ListBlock,
  Run,
  StyleSet,
  TableBlock,
  TocPlaceholderBlock,
  WordDocument,
} from "@studio/word-toolkit";
import { deriveResolvedBlockStyle, deriveResolvedRunStyle } from "@studio/word-toolkit";
import {
  packDocx,
  renderXml,
  xmlDeclaration,
  xmlEscape,
  type XmlNode,
} from "../../office/docx-package.js";

/**
 * P10.2 DOCX exporter: WordDocument -> minimal OOXML via jszip
 * (see office/docx-package.ts for the dependency rationale).
 *
 * Simplified mappings in this first pass (each noted for the follow-up plan):
 * - list: character prefixes ("- " / "1. ") instead of numbering.xml; the
 *   real path is a numbering.xml part + w:numPr on each item paragraph.
 * - image: alt-text placeholder paragraph instead of a w:drawing part; the
 *   real path embeds media in word/media/ + w:drawing with EMU sizes.
 * - tocPlaceholder: static entry list from the stored snapshot instead of a
 *   live TOC field; the real path is a { TOC \o "1-3" } field + update on open.
 * - footnotes: text inlined as "(注: ...)" instead of footnotes.xml parts.
 * - headers/footers (section.header/footer): skipped entirely; the real path
 *   adds header/footer parts + rels + sectPr references.
 * - table: single-row-height grid; gridSpan/rowspan not modeled by the domain.
 *
 * Units: the domain is pt; OOXML w:sz is half-points (pt * 2), spacing is
 * twips (pt * 20), page size/margins in sectPr are also twips.
 */

export class WordExportError extends Error {}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const twips = (pt: number): number => Math.round(pt * 20);
const halfPoints = (pt: number): number => Math.round(pt * 2);

/** Word style ids in the domain -> the OOXML pStyle id we emit. */
function pStyleId(block: Block): string {
  if (block.type === "heading") return `Heading${block.level}`;
  return "Normal";
}

function runXml(run: Run, styles: StyleSet, block: Block, footnoteText?: string): XmlNode {
  const resolvedRun = deriveResolvedRunStyle(styles, block, run);
  const rPr: XmlNode[] = [];
  const bold = run.bold ?? resolvedRun.bold;
  const italic = run.italic ?? resolvedRun.italic;
  if (bold) rPr.push({ name: "w:b" });
  if (italic) rPr.push({ name: "w:i" });
  if (run.underline) rPr.push({ name: "w:u", attrs: { "w:val": "single" } });
  if (run.strike) rPr.push({ name: "w:strike" });
  const runSize = run.size ?? resolvedRun.size;
  rPr.push({ name: "w:sz", attrs: { "w:val": String(halfPoints(runSize)) } });
  rPr.push({ name: "w:szCs", attrs: { "w:val": String(halfPoints(runSize)) } });
  if (run.color) rPr.push({ name: "w:color", attrs: { "w:val": run.color.slice(1) } });
  const text = run.footnoteRef && footnoteText ? `${run.text}（注：${footnoteText}）` : run.text;
  const textNode: XmlNode = { name: "w:t", ...(text.startsWith(" ") || text.endsWith(" ") ? { attrs: { "xml:space": "preserve" } } : {}), children: [xmlEscape(text)] };
  return { name: "w:r", children: [...rPr, textNode] };
}

function paragraphXml(
  runs: Run[],
  styles: StyleSet,
  block: Block,
  pStyle: string,
  footnotes: Map<string, string>,
): XmlNode {
  const resolved = deriveResolvedBlockStyle(styles, block);
  const pPr: XmlNode[] = [{ name: "w:pStyle", attrs: { "w:val": pStyle } }];
  if (resolved.spaceBefore || resolved.spaceAfter) {
    pPr.push({ name: "w:spacing", attrs: { "w:before": String(twips(resolved.spaceBefore)), "w:after": String(twips(resolved.spaceAfter)) } });
  }
  if (resolved.indent) pPr.push({ name: "w:ind", attrs: { "w:firstLine": String(twips(resolved.indent)) } });
  if (resolved.keepWithNext) pPr.push({ name: "w:keepNext" });
  return {
    name: "w:p",
    children: [
      { name: "w:pPr", children: pPr },
      ...runs.map((run) =>
        runXml(run, styles, block, run.footnoteRef ? footnotes.get(run.footnoteRef) : undefined),
      ),
    ],
  };
}

function footnoteTextOf(footnote: WordDocument["footnotes"][number]): string {
  return footnote.runs.map((run) => run.text).join("");
}

function listParagraphs(block: ListBlock): string[] {
  // Character-prefix simplification (see file header note).
  return block.items.map((item, index) => {
    const prefix = block.ordered ? `${index + 1}. ` : "- ";
    return prefix + item.runs.map((run) => run.text).join("");
  });
}

function listXml(block: ListBlock, styles: StyleSet, footnotes: Map<string, string>): XmlNode[] {
  return listParagraphs(block).map((text) =>
    paragraphXml([{ text }], styles, block, "Normal", footnotes),
  );
}

function tableXml(block: TableBlock, styles: StyleSet, footnotes: Map<string, string>): XmlNode {
  const cols = block.rows[0]?.cells.length ?? 0;
  const grid: XmlNode = {
    name: "w:tblGrid",
    children: Array.from({ length: cols }, () => ({ name: "w:gridCol" })),
  };
  const rows = block.rows.map((row) => ({
    name: "w:tr",
    children: row.cells.map((cell) => ({
      name: "w:tc",
      children: [paragraphXml(cell.runs, styles, block, "Normal", footnotes)],
    })),
  }));
  return { name: "w:tbl", children: [grid, ...rows] };
}

function imageXml(block: ImageBlock, styles: StyleSet): XmlNode {
  // Placeholder simplification (see file header note): emit the caption/alt as
  // text so the reader knows where the image belongs.
  const text = `[图片占位] ${block.caption ?? block.src}`;
  return paragraphXml([{ text }], styles, block, "Normal", new Map());
}

function tocXml(block: TocPlaceholderBlock, styles: StyleSet): XmlNode[] {
  const br: Run[] = [];
  if (!block.entries || block.entries.length === 0) {
    return [paragraphXml([{ text: "[目录占位]" }], styles, block, "Normal", new Map())];
  }
  return block.entries.map((entry) =>
    paragraphXml(
      [{ text: `${"  ".repeat(entry.level - 1)}${entry.text}` }],
      styles,
      block,
      "Normal",
      new Map(),
    ),
  );
}

function blockXmls(block: Block, styles: StyleSet, footnotes: Map<string, string>): XmlNode[] {
  switch (block.type) {
    case "heading":
      return [paragraphXml(block.runs, styles, block, pStyleId(block), footnotes)];
    case "paragraph":
      return [paragraphXml(block.runs, styles, block, pStyleId(block), footnotes)];
    case "list":
      return listXml(block, styles, footnotes);
    case "table":
      return [tableXml(block, styles, footnotes)];
    case "image":
      return [imageXml(block, styles)];
    case "pageBreak":
      // A page break is a paragraph holding a single w:br w:type="page".
      return [{ name: "w:p", children: [{ name: "w:r", children: [{ name: "w:br", attrs: { "w:type": "page" } }] }] }];
    case "tocPlaceholder":
      return tocXml(block, styles);
  }
}

function sectPrXml(pageSettings: WordDocument["pageSettings"]): XmlNode {
  return {
    name: "w:sectPr",
    children: [
      {
        name: "w:pgSz",
        attrs: {
          "w:w": String(twips(pageSettings.width)),
          "w:h": String(twips(pageSettings.height)),
        },
      },
      {
        name: "w:pgMar",
        attrs: {
          "w:top": String(twips(pageSettings.margin.top)),
          "w:right": String(twips(pageSettings.margin.right)),
          "w:bottom": String(twips(pageSettings.margin.bottom)),
          "w:left": String(twips(pageSettings.margin.left)),
        },
      },
    ],
  };
}

function sectionBreakXml(pageSettings: WordDocument["pageSettings"]): XmlNode {
  return {
    name: "w:p",
    children: [{ name: "w:pPr", children: [sectPrXml(pageSettings)] }],
  };
}

function styleDefXml(id: string, name: string, sizePt: number, bold: boolean, font?: string): XmlNode {
  const rPr: XmlNode[] = [
    ...(font ? [{ name: "w:rFonts", attrs: { "w:ascii": font.split(",")[0]?.trim(), "w:hAnsi": font.split(",")[0]?.trim(), "w:eastAsia": "微软雅黑" } }] : []),
    { name: "w:sz", attrs: { "w:val": String(halfPoints(sizePt)) } },
    { name: "w:szCs", attrs: { "w:val": String(halfPoints(sizePt)) } },
  ];
  if (bold) rPr.push({ name: "w:b" });
  return {
    name: "w:style",
    attrs: { "w:type": "paragraph", "w:styleId": id },
    children: [
      { name: "w:name", attrs: { "w:val": name } },
      ...(id === "Normal" ? [] : [{ name: "w:basedOn", attrs: { "w:val": "Normal" } }]),
      { name: "w:rPr", children: rPr },
    ],
  };
}

function stylesXml(styles: StyleSet): string {
  // Only the styles the body renderer references (Normal + Heading1-3);
  // title/caption/quote stay in the domain style set until the renderer uses them.
  const defs = [
    styleDefXml("Normal", "Normal", styles.normal.size ?? 11, false, styles.normal.font),
    styleDefXml("Heading1", "heading 1", styles.heading1?.size ?? 18, true, styles.heading1?.font),
    styleDefXml("Heading2", "heading 2", styles.heading2?.size ?? 15, true, styles.heading2?.font),
    styleDefXml("Heading3", "heading 3", styles.heading3?.size ?? 12.5, true, styles.heading3?.font),
  ];
  return xmlDeclaration(
    renderXml({
      name: "w:styles",
      attrs: { xmlns: W_NS },
      children: defs,
    }),
  );
}

function documentXml(doc: WordDocument): string {
  if (!Array.isArray(doc.sections) || !Array.isArray(doc.blocks)) {
    throw new WordExportError("文档缺少 sections/blocks 数组");
  }
  const byId = new Map(doc.blocks.map((block) => [block.id, block]));
  const footnotes = new Map(
    doc.footnotes.map((footnote) => [footnote.id, footnoteTextOf(footnote)]),
  );
  const body: XmlNode[] = [];
  for (const [index, section] of doc.sections.entries()) {
    for (const blockId of section.blockIds) {
      const block = byId.get(blockId);
      if (!block) throw new WordExportError(`章节 "${section.id}" 引用了不存在的块 "${blockId}"`);
      body.push(...blockXmls(block, doc.styles, footnotes));
    }
    if (index < doc.sections.length - 1) body.push(sectionBreakXml(doc.pageSettings));
  }
  body.push(sectPrXml(doc.pageSettings));
  return xmlDeclaration(
    renderXml({
      name: "w:document",
      attrs: { xmlns: W_NS },
      children: [{ name: "w:body", children: body }],
    }),
  );
}

/**
 * Export a validated WordDocument to a .docx Buffer.
 * Throws WordExportError on malformed shapes (defensive: store already
 * zod-validates; this guards direct exporter callers).
 */
export async function exportDocx(doc: WordDocument): Promise<Buffer> {
  return packDocx({
    documentXml: documentXml(doc),
    stylesXml: stylesXml(doc.styles),
  });
}
