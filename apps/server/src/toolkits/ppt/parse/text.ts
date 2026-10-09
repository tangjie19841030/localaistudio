import type { TextParagraph } from "@studio/ppt-toolkit";
import { asObj, asArr, children, intAttr, strAttr, textOf, type XmlNode } from "./xml-util.js";
import { colorNodeHex, type SchemeColorName } from "./paint.js";

/**
 * Text/shape extraction: placeholder typing, run color, paragraph text and
 * the font-size clamp shared by shape bodies, notes and titles.
 */

export type PlaceholderSubtype = "title" | "subtitle" | "content";

export const PH_DEFAULT_SIZE: Record<PlaceholderSubtype, number> = { title: 40, subtitle: 24, content: 18 };

export function phSubtype(ph: XmlNode | undefined): PlaceholderSubtype | null {
  const type = strAttr(ph, "type");
  if (!type) return "content"; // OOXML: a ph without type inherits body/object
  if (type === "title" || type === "ctrTitle") return "title";
  if (type === "subTitle") return "subtitle";
  if (type === "body" || type === "obj" || type === "ctr") return "content";
  return null; // dt/ftr/sldNum/hdr/… — not imported
}

export function phMatchKey(ph: XmlNode | undefined): string {
  return `${strAttr(ph, "type") ?? ""}#${strAttr(ph, "idx") ?? ""}`;
}

/** Run color: rPr/solidFill with srgbClr or schemeClr (lumMod/lumOff ignored). */
export function runColor(rPr: XmlNode | undefined, scheme: Map<SchemeColorName, string>): string | undefined {
  const fill = asObj(rPr?.solidFill);
  const srgb = colorNodeHex(fill);
  if (srgb) return srgb;
  const schemeNode = asObj(fill?.schemeClr);
  const name = strAttr(schemeNode, "val") as SchemeColorName | undefined;
  if (name && scheme.has(name)) return scheme.get(name);
  return undefined;
}

export interface ExtractedText {
  paragraphs: TextParagraph[];
  fontSize?: number;
  align?: "left" | "center" | "right";
  plain: string;
}

export function extractText(
  txBody: XmlNode | undefined,
  scheme: Map<SchemeColorName, string>,
  defaultSize: number | undefined,
): ExtractedText {
  const paragraphs: TextParagraph[] = [];
  let fontSize: number | undefined;
  let align: ExtractedText["align"];
  for (const p of children(txBody, "p")) {
    const pAlign = strAttr(asObj(p.pPr), "algn");
    if (!align && pAlign) {
      align = pAlign === "ctr" ? "center" : pAlign === "r" ? "right" : "left";
    }
    const runs: TextParagraph["runs"] = [];
    for (const r of children(p, "r")) {
      // a:t is a text node — children() drops non-objects, so read it directly.
      const text = textOf(r.t);
      if (text === "") continue;
      const rPr = asObj(r.rPr);
      const sz = intAttr(rPr, "sz");
      if (fontSize === undefined && sz !== undefined) fontSize = clampFontSize(sz / 75); // hundredths of a point → px
      runs.push({
        text,
        ...(strAttr(rPr, "b") === "1" ? { bold: true } : {}),
        ...(strAttr(rPr, "i") === "1" ? { italic: true } : {}),
        ...(runColor(rPr, scheme) ? { color: runColor(rPr, scheme) } : {}),
      });
    }
    for (const fld of children(p, "fld")) {
      const text = textOf(fld.t);
      if (text === "") continue;
      runs.push({ text });
    }
    if (runs.length > 0) paragraphs.push({ runs: runs.slice(0, 50) });
    if (paragraphs.length >= 20) break;
  }
  return {
    paragraphs,
    fontSize: fontSize ?? (defaultSize !== undefined ? clampFontSize(defaultSize) : undefined),
    align,
    plain: paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n"),
  };
}

/**
 * Plain text of one a:p, including soft breaks (a:br) and tabs (a:tab).
 * The object-shaped XML parse loses inter-tag order, so with B breaks we join
 * the run/fld texts with B newlines — exact for the common run/br/run case.
 */
export function paragraphText(p: XmlNode): string {
  const texts = [
    ...children(p, "r").map((r) => textOf(r.t)),
    ...children(p, "fld").map((f) => textOf(f.t)),
  ].filter((t) => t !== "");
  // asArr, not children(): a self-closing <a:br/> parses as "" and children()
  // filters non-objects, which silently hid every soft break.
  if (asArr(p.br).length > 0) return texts.join("\n");
  if (asArr(p.tab).length > 0) return texts.join("\t");
  return texts.join("");
}

export function clampFontSize(px: number): number {
  if (!Number.isFinite(px) || px < 4) return 4;
  return Math.min(400, Math.round(px * 10) / 10);
}
