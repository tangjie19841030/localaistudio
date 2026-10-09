import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type PptDocument,
} from "@studio/ppt-toolkit";
import { openZip, type SafeZip } from "./parse/zip-safety.js";
import { computeFit } from "./parse/geometry.js";
import { asObj, children, intAttr, strAttr, type XmlNode } from "./parse/xml-util.js";
import { buildSchemeMap, colorMapOf, parseTheme, type SchemeColorName, type ThemeParseResult } from "./parse/paint.js";
import { finalizeDocument } from "./parse/merge.js";
import { parseSlide, readPartXml, readRels, type ImportedAsset, type ParseContext } from "./parse/slide.js";

/**
 * PPTX (OOXML PresentationML) -> PptDocument importer.
 *
 * Pure parsing layer: no Hono, no store, no disk writes — the route owns
 * upload limits, asset persistence and id guards. Output always passes
 * validatePptDocument + checkPptDocument, so callers can persist or merge it
 * directly. Thin orchestration entry; the implementation lives under
 * ./parse/ (zip safety, xml utils, media sniffing, geometry, paint/theme,
 * text, per-slide parsing/objects, merge).
 *
 * Faithfulness is deliberately scoped: slides/text/shapes/images/tables/notes,
 * theme colors + fonts, equal contain-fit onto the fixed 1280x720 canvas.
 * Gradients (angle + up to 8 stops) and alpha (transparency washes) are
 * supported. Unsupported: masters' decorative shapes, charts/SmartArt (grey
 * placeholders), rotations/flips, transitions/animations — every downgrade
 * adds a deduplicated warning.
 */

export interface ParsePptxResult {
  /** zod-normalized PptDocument (field order stable; required by the workbench save contract). */
  document: PptDocument;
  /** Distinct image parts, content-hash named; the route writes them to <project>/assets. */
  assets: ImportedAsset[];
  /** Human-readable Chinese downgrade/skip notes, already deduplicated. */
  warnings: string[];
}

export interface ParsePptxOptions {
  /** Forced doc.name (project name wins over the pptx internal title). */
  name: string;
  /** e.g. /api/projects/<id>/assets — image src values are "<base>/<sha1>.<ext>". */
  assetBaseUrl: string;
}

type RelMap = Map<string, { type: string; target: string }>;

type ThemeChain = {
  themeResult: ThemeParseResult;
  masterRoot: XmlNode | undefined;
  masterColorMap: Map<SchemeColorName, SchemeColorName>;
};

type SlideRef = { part: string; hidden: boolean };

/** Theme: presentation → slideMaster → theme. */
async function readThemeChain(safe: SafeZip, presentationRels: RelMap, warn: (msg: string) => void): Promise<ThemeChain> {
  const masterRel = [...presentationRels.values()].find((r) => r.type === "slideMaster");
  const masterRels = masterRel ? await readRels(safe, masterRel.target) : undefined;
  const themePart = masterRels ? [...masterRels.values()].find((r) => r.type === "theme")?.target : undefined;
  const themeRoot = themePart ? await readPartXml(safe, themePart) : null;
  const themeResult = parseTheme(asObj(themeRoot?.theme), warn);
  const masterRoot = masterRel ? (await readPartXml(safe, masterRel.target)) ?? undefined : undefined;
  const masterColorMap = colorMapOf(asObj(asObj(masterRoot?.sldMaster)?.clrMap));
  return { themeResult, masterRoot, masterColorMap };
}

async function readSlideOrder(safe: SafeZip, presentation: XmlNode | undefined, presentationRels: RelMap): Promise<SlideRef[]> {
  // Slide order = sldIdLst order; rels resolve ids → parts. Hidden → warning.
  // IMPORTANT: <p:sldId> carries BOTH @id (a numeric slide id) and @r:id (the
  // relationship key); removeNSPrefix collapses both to @_id, with whichever
  // attribute was written LAST winning. Pull r:id from the raw XML in order.
  const sldIdLst = asObj(presentation?.sldIdLst);
  const presentationRaw = await safe.readText("ppt/presentation.xml");
  const rawRelIds =
    presentationRaw === null
      ? []
      : [...presentationRaw.matchAll(/<p:sldId\b[^>]*?\br:id="([^"]+)"/g)].map((m) => m[1] as string);
  const orderedParts: SlideRef[] = [];
  children(sldIdLst, "sldId").forEach((sldId, index) => {
    const relId = rawRelIds[index] ?? strAttr(sldId, "id");
    const rel = relId ? presentationRels.get(relId) : undefined;
    if (rel) orderedParts.push({ part: rel.target, hidden: strAttr(sldId, "show") === "0" });
  });
  return orderedParts;
}

/** Core properties (best effort; name is forced by the caller anyway). */
async function readCoreProps(safe: SafeZip): Promise<{ docTitle: string | null; author: string | null; subject: string | null }> {
  let docTitle: string | null = null;
  let author: string | null = null;
  let subject: string | null = null;
  const coreRoot = await readPartXml(safe, "docProps/core.xml");
  const core = asObj(coreRoot?.coreProperties);
  if (core) {
    docTitle = typeof core.title === "string" && core.title.trim() !== "" ? core.title.slice(0, 300) : null;
    author = typeof core.creator === "string" && core.creator.trim() !== "" ? core.creator.slice(0, 120) : null;
    subject = typeof core.subject === "string" && core.subject.trim() !== "" ? core.subject.slice(0, 300) : null;
  }
  return { docTitle, author, subject };
}

/** Slides in sldIdLst order (cap 200); hidden slides stay with a warning. */
async function collectSlides(ctx: ParseContext, orderedParts: SlideRef[], warn: (msg: string) => void): Promise<PptDocument["slides"]> {
  const slides: PptDocument["slides"] = [];
  let slideNo = 0;
  for (const { part, hidden } of orderedParts.slice(0, 200)) {
    slideNo += 1;
    const parsed = await parseSlide(ctx, part, slideNo);
    if (!parsed) {
      slideNo -= 1;
      continue;
    }
    if (hidden) warn("源文件包含隐藏幻灯片，已一并导入");
    slides.push({
      id: `imp-s${slideNo}`,
      title: parsed.title,
      ...(parsed.background ? { background: parsed.background } : {}),
      notes: parsed.notes,
      objects: parsed.slideObjects,
    });
  }
  if (orderedParts.length > 200) warn(`幻灯片超过 200 页上限，仅导入前 200 页`);
  if (slides.length === 0) {
    warn("文件中没有可导入的幻灯片，已创建一张空白页");
    slides.push({
      id: "imp-s1",
      title: "幻灯片 1",
      notes: "",
      objects: [],
    });
  }
  return slides;
}

export async function parsePptx(buffer: Uint8Array, opts: ParsePptxOptions): Promise<ParsePptxResult> {
  const safe = await openZip(buffer);
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (msg: string): void => {
    if (!seen.has(msg)) {
      seen.add(msg);
      warnings.push(msg);
    }
  };

  const presentationRoot = await readPartXml(safe, "ppt/presentation.xml");
  const presentation = asObj(presentationRoot?.presentation);
  const sldSz = asObj(presentation?.sldSz);
  const srcW = intAttr(sldSz, "cx") ?? 12192000;
  const srcH = intAttr(sldSz, "cy") ?? 6858000;
  const fit = computeFit(srcW, srcH);
  const presentationRels = await readRels(safe, "ppt/presentation.xml");
  const chain = await readThemeChain(safe, presentationRels, warn);
  const baseScheme = buildSchemeMap(chain.themeResult.theme, chain.themeResult.scheme);
  const orderedParts = await readSlideOrder(safe, presentation, presentationRels);

  const assets = new Map<string, ImportedAsset>();
  const ctx: ParseContext = {
    safe,
    scheme: baseScheme,
    baseScheme,
    masterColorMap: chain.masterColorMap,
    masterRoot: chain.masterRoot,
    fit,
    assets,
    assetBaseUrl: opts.assetBaseUrl.replace(/\/+$/, ""),
    warn,
    objectSeq: 0,
  };

  const slides = await collectSlides(ctx, orderedParts, warn);
  const core = await readCoreProps(safe);
  const candidate: PptDocument = {
    documentVersion: 1,
    name: opts.name.slice(0, 200) || core.docTitle || "导入的演示文稿",
    presentation: { title: core.docTitle, author: core.author, subject: core.subject },
    slideSize: { w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
    theme: chain.themeResult.theme,
    masters: [],
    layouts: [],
    slides,
  };
  return { document: finalizeDocument(candidate), assets: [...assets.values()], warnings };
}

// ---------------------------------------------------------------------------
// Public re-exports (routes.ts / assets.ts / the test suite import from here)
// ---------------------------------------------------------------------------

export { PptImportError } from "./parse/errors.js";
export { mergeImportedSlides, randomImportNonce, type MergeResult } from "./parse/merge.js";
export { sniffImageAsset, type SniffedImage } from "./parse/media.js";
export type { ImportedAsset } from "./parse/slide.js";
