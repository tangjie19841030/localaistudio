import PptxGenJS from "pptxgenjs";
import type {
  PptChartObject,
  PptDocument,
  PptImageObject,
  PptPlaceholderObject,
  PptShapeObject,
  PptSlide,
  PptSlideObject,
  PptTableObject,
  PptTextObject,
  PptVideoObject,
  Rect,
  TextParagraph,
} from "@studio/ppt-toolkit";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@studio/ppt-toolkit";

/**
 * P9.2 PPTX exporter: PptDocument -> .pptx Buffer via pptxgenjs.
 *
 * Unit conventions (fixed, do not invent alternatives):
 * - Domain canvas is px at 96-DPI authoring scale: 1280x720 == 16:9.
 *   pptxgenjs works in inches: px/96 -> in. (1280/96 = 13.33in 16:9.)
 *   PPTX itself stores EMU: px * 9525 = EMU; pptxgenjs does that from inches
 *   (1in = 914400 EMU), so we never touch EMU here.
 * - fontSize in the domain is px; pptxgenjs wants pt: px * 0.75 = pt.
 * - Colors: domain uses "#RRGGBB"; pptxgenjs wants "RRGGBB" (strip #).
 */

export class PptExportError extends Error {}

export interface ExportPptxOptions {
  /**
   * Resolve a non-data-URL image src (imported project assets such as
   * /api/projects/<id>/assets/<sha>.<ext>) to a data URL pptxgenjs can embed.
   * Returning null (or omitting the hook) keeps the historical strict error.
   */
  resolveImageSrc?: (src: string) => Promise<string | null>;
}

/** 96-DPI px -> inches (pptxgenjs coordinate unit). */
function pxToIn(px: number): number {
  return px / 96;
}

/** px font size -> pt (1px = 0.75pt at 96 DPI). */
function pxToPt(px: number): number {
  return px * 0.75;
}

function hexColor(color: string): string {
  return color.replace("#", "").toUpperCase();
}

/** Domain shapeKind -> pptxgenjs SHAPE_NAME. */
const SHAPE_MAP = {
  rect: "rect",
  round: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  arrow: "rightArrow",
} as const;

/** Placeholder subtype -> font size (px) + bold, mirroring layout defaults. */
const PLACEHOLDER_STYLE = {
  title: { fontSize: 40, bold: true },
  subtitle: { fontSize: 24, bold: false },
  content: { fontSize: 18, bold: false },
  notes: { fontSize: 14, bold: false },
} as const;

function position(rect: Rect) {
  return { x: pxToIn(rect.x), y: pxToIn(rect.y), w: pxToIn(rect.w), h: pxToIn(rect.h) };
}

function mustRect(object: PptSlideObject): Rect {
  const rect = (object as { rect?: unknown }).rect;
  if (
    typeof rect !== "object" || rect === null ||
    typeof (rect as Rect).x !== "number" || typeof (rect as Rect).y !== "number" ||
    typeof (rect as Rect).w !== "number" || typeof (rect as Rect).h !== "number"
  ) {
    throw new PptExportError(`对象 "${object.id}" 缺少合法的 rect`);
  }
  return rect as Rect;
}

function runsToTextProps(paragraphs: TextParagraph[], fontSizePx?: number) {
  // pptxgenjs takes a flat TextProps[]; paragraphs are separated by explicit
  // break runs since the plain-array form has no paragraph nesting.
  const props: { text?: string; options?: Record<string, unknown> }[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) props.push({ text: "\n", options: { breakLine: true } });
    for (const run of paragraph.runs) {
      props.push({
        text: run.text,
        options: {
          bold: run.bold,
          italic: run.italic,
          color: run.color ? hexColor(run.color) : undefined,
          fontSize: fontSizePx ? pxToPt(fontSizePx) : undefined,
        },
      });
    }
    // ensure at least one entry per paragraph (empty paragraph = blank line)
    if (paragraph.runs.length === 0) props.push({ text: "" });
  });
  return props;
}

function addTextObject(slide: PptxGenJS.Slide, object: PptTextObject): void {
  const rect = mustRect(object);
  const alignMap = { left: "left", center: "center", right: "right" } as const;
  slide.addText(runsToTextProps(object.paragraphs, object.fontSize), {
    ...position(rect),
    align: object.align ? alignMap[object.align] : undefined,
  });
}

function addShapeObject(slide: PptxGenJS.Slide, object: PptShapeObject): void {
  const rect = mustRect(object);
  const options: Record<string, unknown> = { ...position(rect) };
  if (object.fill) options.fill = { color: hexColor(object.fill) };
  if (object.stroke) options.line = { color: hexColor(object.stroke) };
  slide.addShape(SHAPE_MAP[object.shape], options as PptxGenJS.ShapeProps);
}

async function addImageObject(
  slide: PptxGenJS.Slide,
  object: PptImageObject,
  resolveImageSrc?: (src: string) => Promise<string | null>,
): Promise<void> {
  const rect = mustRect(object);
  // pptxgenjs `data` wants either "image/png;base64,..." (its README form) or a
  // full data URL ("data:image/png;base64,...") — the data URL is what the
  // domain stores, and it parses both the mime type and the payload from it.
  const src = object.src;
  if (src.startsWith("data:") || src.startsWith("image/")) {
    slide.addImage({ data: src, ...position(rect) });
    return;
  }
  // Imported decks reference project assets by URL; the route injects a
  // resolver that reads the asset back as a data URL.
  const resolved = resolveImageSrc ? await resolveImageSrc(src) : null;
  if (resolved) {
    slide.addImage({ data: resolved, ...position(rect) });
    return;
  }
  // Bare base64 / unresolvable URL without any mime hint is an explicit error
  // rather than a silently broken image part.
  throw new PptExportError(`图片对象 "${object.id}" 的 src 缺少 data URL 或无法解析的资源地址`);
}

function addTableObject(slide: PptxGenJS.Slide, object: PptTableObject): void {
  const rect = mustRect(object);
  const rows = object.cells.map((row) => row.map((cell) => ({ text: cell.text })));
  slide.addTable(rows, { x: pxToIn(rect.x), y: pxToIn(rect.y), w: pxToIn(rect.w) });
}

/**
 * Video via pptxgenjs addMedia. `data` must contain the "base64," marker
 * (pptxgenjs 3.12 checks the substring), so both the resolver's
 * "data:video/mp4;base64,…" and a raw "video/mp4;base64,…" work; `cover`
 * carries the optional poster frame with the same data-URL contract.
 */
async function addVideoObject(
  slide: PptxGenJS.Slide,
  object: PptVideoObject,
  resolveImageSrc?: (src: string) => Promise<string | null>,
): Promise<void> {
  const rect = mustRect(object);
  let data = object.src;
  if (!data.includes("base64,")) {
    const resolved = resolveImageSrc ? await resolveImageSrc(object.src) : null;
    if (!resolved) throw new PptExportError(`视频对象 "${object.id}" 的 src 缺少 data URL 或无法解析的资源地址`);
    data = resolved;
  }
  let cover: string | undefined;
  if (object.poster && !object.poster.includes("base64,")) {
    cover = resolveImageSrc ? ((await resolveImageSrc(object.poster)) ?? undefined) : undefined;
  } else {
    cover = object.poster;
  }
  slide.addMedia({ type: "video", data, ...(cover ? { cover } : {}), ...position(rect) });
}

function addChartObject(slide: PptxGenJS.Slide, object: PptChartObject): void {
  const rect = mustRect(object);
  // All series share the label axis; labels come from the first series.
  const labels = object.series[0]?.points.map((point) => point.label) ?? [];
  const data = object.series.map((series) => ({
    name: series.name,
    labels,
    values: series.points.map((point) => point.value),
  }));
  slide.addChart(object.chartType, data, {
    x: pxToIn(rect.x),
    y: pxToIn(rect.y),
    w: pxToIn(rect.w),
    h: pxToIn(rect.h),
  });
}

function addPlaceholderObject(slide: PptxGenJS.Slide, object: PptPlaceholderObject): void {
  const rect = mustRect(object);
  const style = PLACEHOLDER_STYLE[object.subtype];
  slide.addText(object.text ?? "", {
    ...position(rect),
    fontSize: pxToPt(style.fontSize),
    bold: style.bold,
    align: object.subtype === "title" || object.subtype === "subtitle" ? "center" : "left",
  });
}

async function addObjectToSlide(
  slide: PptxGenJS.Slide,
  object: PptSlideObject,
  resolveImageSrc?: (src: string) => Promise<string | null>,
): Promise<void> {
  switch (object.kind) {
    case "text":
      addTextObject(slide, object);
      break;
    case "shape":
      addShapeObject(slide, object);
      break;
    case "image":
      await addImageObject(slide, object, resolveImageSrc);
      break;
    case "table":
      addTableObject(slide, object);
      break;
    case "video":
      await addVideoObject(slide, object, resolveImageSrc);
      break;
    case "chart":
      addChartObject(slide, object);
      break;
    case "placeholder":
      addPlaceholderObject(slide, object);
      break;
    case "group":
      // Groups are flat in the domain (children ids on the same slide) and the
      // child objects are rendered independently; the group shell carries no
      // geometry of its own, so nothing to emit here.
      break;
  }
}

async function addSlideToDeck(
  pptx: PptxGenJS,
  slide: PptSlide,
  resolveImageSrc?: (src: string) => Promise<string | null>,
): Promise<void> {
  const pptxSlide = pptx.addSlide();
  if (slide.background) pptxSlide.background = { color: hexColor(slide.background) };
  for (const object of slide.objects) await addObjectToSlide(pptxSlide, object, resolveImageSrc);
  if (slide.notes) pptxSlide.addNotes(slide.notes);
}

/**
 * Export a validated PptDocument to a .pptx Buffer.
 * Throws PptExportError on malformed object shapes (defensive: store already
 * zod-validates, this guards direct exporter callers against bad casts).
 */
export async function exportPptx(doc: PptDocument, opts: ExportPptxOptions = {}): Promise<Buffer> {
  if (!Array.isArray(doc.slides)) throw new PptExportError("文档缺少 slides 数组");
  if (doc.slideSize.w !== SLIDE_WIDTH || doc.slideSize.h !== SLIDE_HEIGHT) {
    throw new PptExportError(`不支持的画布尺寸: ${doc.slideSize.w}x${doc.slideSize.h}`);
  }
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "STUDIO_16x9", width: pxToIn(SLIDE_WIDTH), height: pxToIn(SLIDE_HEIGHT) });
  pptx.layout = "STUDIO_16x9";
  pptx.title = doc.presentation.title ?? doc.name;
  if (doc.presentation.author) pptx.author = doc.presentation.author;
  if (doc.presentation.subject) pptx.subject = doc.presentation.subject;
  // Same asset URL can repeat across slides; resolve once.
  const srcCache = new Map<string, string | null>();
  const resolveImageSrc = opts.resolveImageSrc
    ? async (src: string): Promise<string | null> => {
        if (srcCache.has(src)) return srcCache.get(src) ?? null;
        const resolved = await opts.resolveImageSrc!(src);
        srcCache.set(src, resolved);
        return resolved;
      }
    : undefined;
  for (const slide of doc.slides) await addSlideToDeck(pptx, slide, resolveImageSrc);
  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
