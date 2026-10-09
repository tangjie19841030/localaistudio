import { createHash } from "node:crypto";
import type { PptSlideObject, Rect } from "@studio/ppt-toolkit";
import { asObj, children, intAttr, orderedChildren, strAttr, type XmlNode } from "./xml-util.js";
import { compose, groupAffine, toCanvasRect, type Affine } from "./geometry.js";
import { PRST_SHAPE_MAP, paintInfo, solidFillInfo } from "./paint.js";
import { sniffImage, sniffVideo } from "./media.js";
import { PH_DEFAULT_SIZE, extractText, paragraphText, phSubtype, type ExtractedText, type PlaceholderSubtype } from "./text.js";
import type { ParseContext } from "./slide.js";

/**
 * Slide object collection: the mutually recursive sp/pic/group/graphicFrame/
 * AlternateContent walkers (z-order via preserve-order children) plus the
 * image/shape builders they share. Split from slide.ts so parseSlide stays a
 * thin orchestrator and both files fit the 400-line bound; slide.ts builds
 * the SlideEnv and drives collectLeaves.
 */

/** Closure state of one slide's collection pass, made explicit from parseSlide. */
export interface SlideEnv {
  ctx: ParseContext;
  rels: Map<string, { type: string; target: string }>;
  slideNo: number;
  layoutRectFor: (ph: XmlNode | undefined) => Rect | undefined;
  push: (obj: PptSlideObject, tag: string) => void; // id counter lives on ctx.objectSeq
}

export async function collectLeaves(env: SlideEnv, container: XmlNode | undefined, matrix: Affine): Promise<void> {
  // Dispatch the preserve-order child sequence. This is the OOXML z-order;
  // grouping by tag would move pictures behind shapes (or vice versa).
  const sequence = orderedChildren(container);
  if (sequence.length === 0) {
    for (const node of children(container, "sp")) await collectShape(env, node, matrix);
    for (const node of children(container, "pic")) await collectPicture(env, node, matrix);
    for (const node of children(container, "graphicFrame")) collectFrame(env, node, matrix);
    for (const node of children(container, "grpSp")) await collectGroup(env, node, matrix);
    for (const node of children(container, "AlternateContent")) await collectAlternateContent(env, node, matrix);
    return;
  }
  for (const { tag, node } of sequence) {
    if (tag === "sp") await collectShape(env, node, matrix);
    else if (tag === "pic") await collectPicture(env, node, matrix);
    else if (tag === "video") await collectVideo(env, node, matrix);
    else if (tag === "graphicFrame") collectFrame(env, node, matrix);
    else if (tag === "grpSp") await collectGroup(env, node, matrix);
    else if (tag === "AlternateContent") await collectAlternateContent(env, node, matrix);
  }
}

/** Canvas-space defaults for placeholders whose xfrm is missing everywhere. */
function fallbackPlaceholderRect(subtype: PlaceholderSubtype): Rect {
  if (subtype === "title") return { x: 140, y: 240, w: 1000, h: 140 };
  if (subtype === "subtitle") return { x: 140, y: 420, w: 1000, h: 80 };
  return { x: 80, y: 200, w: 1120, h: 460 };
}

async function collectGroup(env: SlideEnv, node: XmlNode, matrix: Affine): Promise<void> {
  const xfrm = asObj(asObj(node.grpSpPr)?.xfrm);
  if (strAttr(xfrm, "rot") !== undefined) env.ctx.warn("部分组合对象含旋转，已按未旋转位置导入");
  await collectLeaves(env, node, compose(matrix, groupAffine(xfrm)));
}

async function collectAlternateContent(env: SlideEnv, node: XmlNode, matrix: Affine): Promise<void> {
  const fallback = asObj(node.Fallback) ?? children(node, "Fallback")[0];
  const choice = asObj(node.Choice) ?? children(node, "Choice")[0];
  if (fallback) await collectLeaves(env, fallback, matrix);
  else if (choice) {
    env.ctx.warn("部分 SVG 矢量图缺少位图回退，已尝试按原始内容导入（可能显示为占位）");
    await collectLeaves(env, choice, matrix);
  }
}

async function collectShape(env: SlideEnv, sp: XmlNode, matrix: Affine): Promise<void> {
  const nvPr = asObj(asObj(sp.nvSpPr)?.nvPr);
  const phNode = asObj(nvPr?.ph);
  const spPr = asObj(sp.spPr);
  const xfrm = asObj(spPr?.xfrm);
  const subtype = phNode ? phSubtype(phNode) : undefined;
  const text = extractText(asObj(sp.txBody), env.ctx.scheme, subtype ? PH_DEFAULT_SIZE[subtype] : undefined);

  let rect = toCanvasRect(xfrm, matrix, env.ctx.fit);
  if (!rect && phNode && subtype) rect = env.layoutRectFor(phNode) ?? fallbackPlaceholderRect(subtype);
  if (!rect) return;

  if (phNode) {
    const phType = strAttr(phNode, "type");
    if (phType === "pic" || phType === "media") {
      await imageFromPicPlaceholder(env, sp, phNode, rect);
      return;
    }
    if (!subtype) return; // footer/date/slide-number placeholders: skip
    env.push(
      {
        id: "",
        kind: "placeholder",
        rect,
        subtype,
        ...(text.plain.trim() !== "" ? { text: text.plain.slice(0, 2000) } : {}),
      },
      subtype === "title" ? "title" : subtype === "subtitle" ? "subtitle" : "content",
    );
    return;
  }
  if (text.paragraphs.length > 0) {
    textObjectOf(env, text, rect);
    return;
  }
  // Shape-only sp (prstGeom); invisible no-fill/no-line autoshape boxes are noise.
  const paint = paintInfo(spPr, env.ctx.scheme);
  const strokeFill = solidFillInfo(asObj(spPr?.ln), env.ctx.scheme);
  if (!paint.solid && !paint.gradient && !strokeFill) return;
  // Nearly invisible (<5%) fills with no border are invisible in PowerPoint too.
  if ((paint.solid?.opacity ?? 1) < 0.05 && !paint.gradient && !strokeFill) return;
  env.push(shapeFromAutoshape(spPr, rect, env.ctx), "shape");
}

/** Picture placeholder that actually carries a blip (PowerPoint stores
 * user-filled image placeholders as p:sp with type="pic" + blipFill). */
async function imageFromPicPlaceholder(env: SlideEnv, sp: XmlNode, phNode: XmlNode, rect: Rect): Promise<void> {
  const phBlipFill = asObj(asObj(sp.spPr)?.blipFill);
  const embed = strAttr(asObj(phBlipFill?.blip), "embed");
  const rel = embed ? env.rels.get(embed) : undefined;
  if (!rel) {
    env.ctx.warn("图片占位符中没有可读取的图片，已跳过");
    return;
  }
  const object = await buildImageObject(env.ctx, rel.target, rect, phBlipFill);
  if (object) env.push(object, object.kind === "shape" ? "shape" : "image");
}

function textObjectOf(env: SlideEnv, text: ExtractedText, rect: Rect): void {
  env.push(
    {
      id: "",
      kind: "text",
      rect,
      paragraphs: text.paragraphs,
      ...(text.fontSize ? { fontSize: text.fontSize } : {}),
      ...(text.align ? { align: text.align } : {}),
    },
    "text",
  );
}

async function collectPicture(env: SlideEnv, pic: XmlNode, matrix: Affine): Promise<void> {
  const pictureXfrm = asObj(asObj(pic.spPr)?.xfrm);
  if (strAttr(pictureXfrm, "flipH") === "1" || strAttr(pictureXfrm, "flipV") === "1") {
    env.ctx.warn("部分图片含翻转，当前文档模型仅保留其边界框，图片方向可能不同");
  }
  const rect = toCanvasRect(pictureXfrm, matrix, env.ctx.fit);
  if (!rect) return;
  const blipFill = asObj(pic.blipFill);
  const blip = asObj(blipFill?.blip);
  if (strAttr(blip, "link")) {
    env.ctx.warn("部分图片是外部链接图（文件不含图像数据），已替换为灰色占位");
    env.push({ id: "", kind: "shape", rect, shape: "rect", fill: "#D4D4D8", title: "外部链接图片" }, "shape");
    return;
  }
  const relId = strAttr(blip, "embed");
  const rel = relId ? env.rels.get(relId) : undefined;
  if (!rel) return;
  const object = await buildImageObject(env.ctx, rel.target, rect, blipFill);
  if (object) env.push(object, object.kind === "shape" ? "shape" : "image");
}

/**
 * p:video (PowerPoint embedded video): geometry from p:spPr/a:xfrm, the media
 * part linked via p:nvSpPr/p:nvPr/a:videoFile@r:link (OP-1 default; the
 * blipFill form has no separate bytes). sniff hit → kind=video object +
 * registered asset; miss (mov/avi/wmv) → grey placeholder + warning. The
 * poster frame is not parsed — the canvas renders the first frame instead.
 */
async function collectVideo(env: SlideEnv, node: XmlNode, matrix: Affine): Promise<void> {
  const rect = toCanvasRect(asObj(asObj(node.spPr)?.xfrm), matrix, env.ctx.fit);
  if (!rect) return;
  const nvPr = asObj(asObj(asObj(node.nvSpPr)?.nvPr));
  const relId = strAttr(asObj(nvPr?.videoFile), "link");
  const rel = relId ? env.rels.get(relId) : undefined;
  const object = rel ? await videoObjectOf(env.ctx, rel.target, rect) : null;
  if (object) env.push(object, "video");
  else {
    env.ctx.warn("部分视频格式（MOV/AVI/WMV）暂不支持，已替换为灰色占位");
    env.push({ id: "", kind: "shape", rect, shape: "rect", fill: "#D4D4D8", title: "不支持的视频" }, "shape");
  }
}

/** Read + sniff the linked media part; sniff hit → asset-registered video object. */
async function videoObjectOf(
  ctx: ParseContext,
  mediaPath: string,
  rect: Rect,
): Promise<PptSlideObject | null> {
  const buf = await ctx.safe.readBuffer(mediaPath);
  if (!buf) return null;
  const kind = sniffVideo(buf);
  if (!kind) return null;
  const sha1 = createHash("sha1").update(buf).digest("hex");
  if (!ctx.assets.has(sha1)) ctx.assets.set(sha1, { sha1, ext: kind.ext, contentType: kind.contentType, data: buf });
  return { id: "", kind: "video", rect, src: `${ctx.assetBaseUrl}/${sha1}.${kind.ext}` };
}

function collectFrame(env: SlideEnv, frame: XmlNode, matrix: Affine): void {  const rect = toCanvasRect(asObj(frame.xfrm), matrix, env.ctx.fit);
  if (!rect) return;
  const graphicData = asObj(asObj(frame.graphic)?.graphicData);
  const uri = strAttr(graphicData, "uri") ?? "";
  const tbl = asObj(graphicData?.tbl);
  if (tbl) {
    collectTable(env, tbl, rect);
    return;
  }
  env.push({ id: "", kind: "shape", rect, shape: "rect", fill: "#E4E4E7", title: uri.includes("chart") ? "图表（导入为占位）" : "SmartArt/图表（导入为占位）" }, "shape");
  env.ctx.warn("图表/SmartArt 已替换为灰色占位框");
}

function collectTable(env: SlideEnv, tbl: XmlNode, rect: Rect): void {
  // gridCol lives under a:tblGrid (tbl > tblGrid > gridCol) — reading it off
  // tbl itself always returned [] and every imported table collapsed to 1 col.
  const cols = Math.min(20, children(asObj(tbl.tblGrid), "gridCol").length || 1);
  const rowsNode = children(tbl, "tr").slice(0, 50);
  if (rowsNode.length === 0) return;
  const cells: { text: string }[][] = [];
  for (const tr of rowsNode) {
    const row: { text: string }[] = [];
    const tcs = children(tr, "tc");
    // PowerPoint writes BOTH gridSpan="n" on the start cell AND explicit
    // hMerge/vMerge continuation <a:tc> elements. When continuations exist
    // they already occupy the spanned grid slots — filling span-1 extras
    // too double-counted the merge and pushed trailing real cells out.
    const hasContinuation = tcs.some(
      (tc) => strAttr(tc, "hMerge") === "1" || strAttr(tc, "vMerge") === "1",
    );
    for (const tc of tcs) {
      const span = intAttr(tc, "gridSpan") ?? 1;
      const merged = strAttr(tc, "vMerge") === "1" || strAttr(tc, "hMerge") === "1";
      const cellText = merged
        ? ""
        : children(asObj(tc.txBody), "p")
            .map((p) => paragraphText(p))
            .join("\n")
            .slice(0, 500);
      row.push({ text: cellText });
      // Producers that omit continuation tcs: reserve the spanned slots here.
      if (!merged && span > 1 && !hasContinuation) {
        for (let i = 1; i < span && row.length < cols; i += 1) row.push({ text: "" });
      }
    }
    while (row.length < cols) row.push({ text: "" });
    cells.push(row.slice(0, cols));
  }
  env.push({ id: "", kind: "table", rect, rows: cells.length, cols, cells }, "table");
}

/** Build an image object from a media part, or a grey placeholder for unsupported bytes. */
export async function buildImageObject(
  ctx: ParseContext,
  mediaPath: string,
  rect: Rect,
  blipFill: XmlNode | undefined,
): Promise<PptSlideObject | null> {
  const buf = await ctx.safe.readBuffer(mediaPath);
  if (!buf) {
    ctx.warn("部分图片在文件中缺失，已跳过");
    return null;
  }
  const kind = sniffImage(buf);
  if (!kind) {
    ctx.warn("部分图片格式（SVG/EMF/WMF/TIFF）浏览器无法显示，已替换为灰色占位");
    return { id: "", kind: "shape", rect, shape: "rect", fill: "#D4D4D8", title: "不支持的图片" };
  }
  const sha1 = createHash("sha1").update(buf).digest("hex");
  if (!ctx.assets.has(sha1)) ctx.assets.set(sha1, { sha1, ext: kind.ext, contentType: kind.contentType, data: buf });
  return {
    id: "",
    kind: "image",
    rect,
    src: `${ctx.assetBaseUrl}/${sha1}.${kind.ext}`,
    fit: asObj(blipFill?.stretch) ? "fill" : "contain",
  };
}

function shapeFromAutoshape(spPr: XmlNode | undefined, rect: Rect, ctx: ParseContext): PptSlideObject {
  const prst = strAttr(asObj(spPr?.prstGeom), "prst") ?? "rect";
  const shape = PRST_SHAPE_MAP[prst] ?? "rect";
  if (!(prst in PRST_SHAPE_MAP)) ctx.warn(`部分自选图形（${prst}）已按矩形导入`);
  const paint = paintInfo(spPr, ctx.scheme);
  const strokeFill = solidFillInfo(asObj(spPr?.ln), ctx.scheme);
  return {
    id: "",
    kind: "shape",
    rect,
    shape,
    ...(paint.gradient ? { gradient: paint.gradient } : {}),
    ...(paint.solid
      ? {
          fill: paint.solid.hex,
          ...(paint.solid.opacity !== undefined ? { opacity: paint.solid.opacity } : {}),
        }
      : {}),
    ...(strokeFill ? { stroke: strokeFill.hex } : {}),
  };
}
