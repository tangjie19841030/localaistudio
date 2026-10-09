import { posix as pathPosix } from "node:path";
import type { PptSlideObject, Rect } from "@studio/ppt-toolkit";
import {
  asObj,
  attachXmlOrder,
  children,
  orderedXmlParser,
  resolveRelTarget,
  strAttr,
  xmlParser,
  type XmlNode,
} from "./xml-util.js";
import { IDENTITY, toCanvasRect, type Fit } from "./geometry.js";
import { colorMapOf, colorNodeHex, resolveScheme, solidFillHex, type SchemeColorName } from "./paint.js";
import { extractText, phMatchKey } from "./text.js";
import { collectLeaves, type SlideEnv } from "./slide-objects.js";
import { resolveSlideTitle } from "./title-cleanup.js";
import type { SafeZip } from "./zip-safety.js";

/**
 * Per-slide parsing: context, part/rels/layout IO, the per-slide color map and
 * the parseSlide orchestration (collect → background → notes → title). Object
 * walkers live in ./slide-objects.js.
 */

export interface ImportedAsset {
  sha1: string;
  ext: string;
  contentType: string;
  data: Buffer;
}

export interface ParseContext {
  safe: SafeZip;
  scheme: Map<SchemeColorName, string>;
  /** Unmapped theme slots used as the source for each slide's clrMap. */
  baseScheme: Map<SchemeColorName, string>;
  masterColorMap: Map<SchemeColorName, SchemeColorName>;
  masterRoot?: XmlNode;
  fit: Fit;
  assets: Map<string, ImportedAsset>;
  assetBaseUrl: string;
  warn: (msg: string) => void;
  /** Monotonic object-id counter for one parsePptx run (concurrency-safe). */
  objectSeq: number;
}

/** Read + parse an XML part, with rels; returns null when the part is missing. */
export async function readPartXml(safe: SafeZip, partPath: string): Promise<XmlNode | null> {
  const raw = await safe.readText(partPath);
  if (raw === null) return null;
  const parsed = xmlParser.parse(raw) as XmlNode;
  const ordered = orderedXmlParser.parse(raw) as unknown;
  const rootTag = Object.keys(parsed).find((key) => key !== "?xml");
  if (!rootTag) return parsed;
  const orderedRoot = Array.isArray(ordered) ? ordered.find((item) => asObj(item)?.[rootTag]) : undefined;
  if (orderedRoot) attachXmlOrder(asObj(parsed[rootTag])!, orderedRoot[rootTag]);
  return parsed;
}

export async function readRels(safe: SafeZip, sourcePart: string): Promise<Map<string, { type: string; target: string }>> {
  const dir = pathPosix.dirname(sourcePart);
  const base = pathPosix.basename(sourcePart);
  const relsPath = pathPosix.join(dir, "_rels", `${base}.rels`);
  const root = await readPartXml(safe, relsPath);
  const map = new Map<string, { type: string; target: string }>();
  for (const rel of children(asObj(root?.Relationships), "Relationship")) {
    // OOXML relationship parts use capitalized Id/Type/Target attributes.
    const id = strAttr(rel, "Id");
    const type = strAttr(rel, "Type") ?? "";
    const target = strAttr(rel, "Target");
    if (id && target) map.set(id, { type: type.split("/").pop() ?? type, target: resolveRelTarget(sourcePart, target) });
  }
  return map;
}

interface LayoutGeometry {
  byKey: Map<string, Rect>;
}

async function readLayoutGeometry(safe: SafeZip, layoutPath: string | undefined, fit: Fit): Promise<LayoutGeometry> {
  const byKey = new Map<string, Rect>();
  if (!layoutPath) return { byKey };
  const root = await readPartXml(safe, layoutPath);
  const spTree = asObj(asObj(asObj(root?.sldLayout)?.cSld)?.spTree);
  for (const sp of children(spTree, "sp")) {
    const ph = asObj(asObj(asObj(sp.nvSpPr)?.nvPr)?.ph);
    // Layout placeholders live in the presentation's EMU coordinate space.
    const rect = toCanvasRect(asObj(asObj(sp.spPr)?.xfrm), IDENTITY, fit);
    if (ph && rect) byKey.set(phMatchKey(ph), rect);
  }
  return { byKey };
}

export function backgroundOf(cSld: XmlNode | undefined, scheme: Map<SchemeColorName, string>): string | undefined {
  const bg = asObj(cSld?.bg);
  const bgPr = asObj(bg?.bgPr);
  const direct = solidFillHex(bgPr, scheme);
  if (direct) return direct;
  // Gradient: first stop color.
  const gs = children(asObj(bgPr?.gradFill), "gs")[0];
  if (gs) {
    const hex = solidFillHex(gs, scheme);
    if (hex) return hex;
  }
  const bgRef = asObj(bg?.bgRef);
  if (bgRef) {
    const directRef = colorNodeHex(bgRef) ?? (() => {
      const name = strAttr(asObj(bgRef.schemeClr), "val") as SchemeColorName | undefined;
      return name ? scheme.get(name) : undefined;
    })();
    if (directRef) return directRef;
    const idx = strAttr(bgRef, "idx");
    if (idx === "1001") return scheme.get("lt1") ?? scheme.get("bg1");
  }
  return undefined;
}

export function nextObjectId(ctx: ParseContext, slideNo: number, tag: string): string {
  ctx.objectSeq += 1;
  return `imp-s${slideNo}-${tag}${ctx.objectSeq}`;
}

export interface SlideResult {
  slideObjects: PptSlideObject[];
  background?: string;
  notes: string;
  title: string;
}

// Linear orchestration: read order only, no branch nesting — 60-line allowance invoked.
export async function parseSlide(
  ctx: ParseContext,
  slidePart: string,
  slideNo: number,
): Promise<SlideResult | null> {
  const root = await readPartXml(ctx.safe, slidePart);
  const sld = asObj(root?.sld);
  if (!sld) return null;
  const cSld = asObj(sld.cSld);
  const spTree = asObj(cSld?.spTree);
  const rels = await readRels(ctx.safe, slidePart);

  // Layout geometry for placeholders whose xfrm is inherited (very common).
  const layoutRel = [...rels.values()].find((r) => r.type === "slideLayout");
  const layout = await readLayoutGeometry(ctx.safe, layoutRel?.target, ctx.fit);
  const layoutRoot = layoutRel?.target ? await readPartXml(ctx.safe, layoutRel.target) : null;
  const layoutCMap = colorMapOf(asObj(asObj(asObj(layoutRoot?.sldLayout)?.clrMapOvr)?.overrideClrMapping));
  const slideCMap = colorMapOf(asObj(asObj(sld.clrMapOvr)?.overrideClrMapping));
  const effectiveMap = new Map(ctx.masterColorMap);
  for (const [key, value] of layoutCMap) effectiveMap.set(key, value);
  for (const [key, value] of slideCMap) effectiveMap.set(key, value);
  const slideScheme = resolveScheme(ctx.baseScheme, effectiveMap);
  ctx.scheme = slideScheme;
  const layoutCsl = asObj(asObj(layoutRoot?.sldLayout)?.cSld);
  const masterCsl = asObj(asObj(ctx.masterRoot?.sldMaster)?.cSld);
  const layoutBackground = backgroundOf(layoutCsl, slideScheme);
  const masterBackground = backgroundOf(masterCsl, slideScheme);

  const slideObjects: PptSlideObject[] = [];
  const env: SlideEnv = {
    ctx,
    rels,
    slideNo,
    layoutRectFor: (ph) => (ph ? layout.byKey.get(phMatchKey(ph)) : undefined),
    push: (obj, tag) => slideObjects.push({ ...obj, id: nextObjectId(ctx, slideNo, tag) }),
  };

  // spTree direct children; collectLeaves recurses into nested groups itself.
  await collectLeaves(env, spTree, IDENTITY);

  const background = backgroundOf(cSld, slideScheme) ?? layoutBackground ?? masterBackground;
  const notes = await notesOf(ctx, rels);
  const title = titleOf(slideObjects, slideNo);

  return { slideObjects: slideObjects.slice(0, 500), background, notes: notes.slice(0, 20000), title };
}

/** Notes: only body (or typeless) placeholders carry speech text; footer/date/
 * page placeholders are skipped. */
async function notesOf(ctx: ParseContext, rels: Map<string, { type: string; target: string }>): Promise<string> {
  const notesRel = [...rels.values()].find((r) => r.type === "notesSlide");
  if (!notesRel) return "";
  const notesRoot = await readPartXml(ctx.safe, notesRel.target);
  const notesTree = asObj(asObj(asObj(notesRoot?.notes)?.cSld)?.spTree);
  let notes = "";
  for (const sp of children(notesTree, "sp")) {
    const ph = asObj(asObj(asObj(sp.nvSpPr)?.nvPr)?.ph);
    if (ph && strAttr(ph, "type") && strAttr(ph, "type") !== "body") continue;
    const text = extractText(asObj(sp.txBody), ctx.scheme, undefined).plain;
    if (text.trim() !== "") notes += (notes ? "\n" : "") + text;
  }
  return notes;
}

/** Title = title placeholder text, else the first text object's first run. */
function titleOf(slideObjects: PptSlideObject[], slideNo: number): string {
  const titlePlaceholder = slideObjects.find(
    (o): o is Extract<PptSlideObject, { kind: "placeholder" }> => o.kind === "placeholder" && o.subtype === "title",
  );
  const firstText = slideObjects.find((o): o is Extract<PptSlideObject, { kind: "text" }> => o.kind === "text");
  const titleSource = titlePlaceholder?.text?.trim() || firstText?.paragraphs[0]?.runs[0]?.text?.trim() || "";
  return resolveSlideTitle(slideObjects, slideNo, titleSource);
}
