import type { QualityInspector } from "@studio/studio-core";
import type { PptDocument, PptPlaceholderObject, PptSlideObject, Rect } from "./document.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "./document.js";

/**
 * P9.2 quality inspectors (pure functions over PptDocument): out-of-canvas
 * objects, >30% object overlap on one slide, empty text placeholders, and
 * object-less slides. Every issue is located by slide/object id — never by
 * DOM selector — so callers can jump straight to the offender. T78: the
 * overlap check protects text only — pairs where neither side carries text
 * are never reported; pairs involving text keep the T53 chain untouched.
 */

export interface PptQualityIssue {
  inspectorId: string;
  slideId: string;
  /** Offending object id, when the issue is about one (or the smaller of a pair). */
  objectId?: string;
  message: string;
}

/** studio-core QualityInspector ({ id, title }) + the pure inspect step. */
export interface PptInspector extends QualityInspector {
  inspect(doc: PptDocument): PptQualityIssue[];
}

const EPSILON = 1e-9;
/** Overlap ratio threshold: overlap area vs the smaller object's area. */
const OVERLAP_RATIO_THRESHOLD = 0.3;
/** Tightened threshold for text pairs: opaque shape covering text reports at >=60%. */
const TEXT_COVER_RATIO_THRESHOLD = 0.6;
/** Shapes with opacity >= this (or absent, default 1) count as opaque covers. */
const OPAQUE_OPACITY_THRESHOLD = 0.85;

/** Group shells carry children ids, not their own geometry — skip geometry checks. */
function hasGeometry(object: PptSlideObject): boolean {
  return object.kind !== "group";
}

function area(rect: Rect): number {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function objectLabel(object: PptSlideObject): string {
  return object.title ? `对象 "${object.id}"（${object.title}）` : `对象 "${object.id}"`;
}

/** True when the rect pokes out of the fixed 1280x720 canvas. */
function outOfCanvas(rect: Rect): boolean {
  return (
    rect.x < -EPSILON ||
    rect.y < -EPSILON ||
    rect.x + rect.w > SLIDE_WIDTH + EPSILON ||
    rect.y + rect.h > SLIDE_HEIGHT + EPSILON
  );
}

function boundsIssues(slideId: string, objects: readonly PptSlideObject[]): PptQualityIssue[] {
  const issues: PptQualityIssue[] = [];
  for (const object of objects) {
    if (!hasGeometry(object) || !outOfCanvas(object.rect)) continue;
    issues.push({
      inspectorId: "ppt.qc.bounds",
      slideId,
      objectId: object.id,
      message: `${objectLabel(object)} 超出画布边界（画布 ${SLIDE_WIDTH}x${SLIDE_HEIGHT}）`,
    });
  }
  return issues;
}

function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(area(a), area(b));
  if (smaller <= 0) return 0;
  return (w * h) / smaller;
}

/** Decorative layers (illustration/chart) may sit under floating text by design. */
function isIllustration(object: PptSlideObject): boolean {
  return object.kind === "image" || object.kind === "chart";
}

/** Text carriers whose legibility the overlap check protects. */
function isTextual(object: PptSlideObject): boolean {
  return object.kind === "text" || object.kind === "placeholder";
}

/** Opaque cover: opacity absent (default 1) or >= 0.85; translucent shades are design. */
function isOpaqueShape(object: PptSlideObject): boolean {
  return (
    object.kind === "shape" &&
    (object.opacity === undefined || object.opacity >= OPAQUE_OPACITY_THRESHOLD)
  );
}

/** Same-group stacking is intentional composition: both ids under one group shell. */
function inSameGroup(
  a: PptSlideObject,
  b: PptSlideObject,
  objects: readonly PptSlideObject[],
): boolean {
  return objects.some(
    (object) =>
      object.kind === "group" && object.children.includes(a.id) && object.children.includes(b.id),
  );
}

/**
 * Pair verdict under the tightened rules (W2 T53): same-group stacking and
 * illustration-under-text are exempt; text pairs only report when an opaque
 * shape covers the text by >=60%. Textless pairs never reach this function —
 * they are skipped upstream (T78).
 */
function pairOverlapIssue(
  slideId: string,
  slideObjects: readonly PptSlideObject[],
  below: PptSlideObject,
  above: PptSlideObject,
  ratio: number,
): PptQualityIssue | null {
  if (inSameGroup(below, above, slideObjects)) return null;
  // Illustration below + text floating above is the sanctioned composition.
  if (isIllustration(below) && isTextual(above)) return null;
  if (isTextual(below) || isTextual(above)) return textCoverIssue(slideId, below, above, ratio);
  return null;
}

/** Only "text covered dead by an opaque shape (>=60%)" reports for text pairs. */
function textCoverIssue(
  slideId: string,
  below: PptSlideObject,
  above: PptSlideObject,
  ratio: number,
): PptQualityIssue | null {
  if (!isTextual(below) || !isOpaqueShape(above) || ratio < TEXT_COVER_RATIO_THRESHOLD) return null;
  const smaller = area(below.rect) <= area(above.rect) ? below : above;
  return {
    inspectorId: "ppt.qc.overlap",
    slideId,
    objectId: smaller.id,
    message: `文字被不透明图形遮挡 ${Math.round(ratio * 100)}%`,
  };
}

/** Candidate overlap pair (ratio already above threshold); below is drawn first. */
interface CandidatePair {
  below: PptSlideObject;
  above: PptSlideObject;
  ratio: number;
}

/** T78: textless-vs-textless overlap is intentional design layering — never reported. */
function isTextlessPair(a: PptSlideObject, b: PptSlideObject): boolean {
  return !isTextual(a) && !isTextual(b);
}

function collectCandidatePairs(objects: readonly PptSlideObject[]): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  // filter() keeps array order: i < j means geometries[i] is drawn first (below).
  const geometries = objects.filter(hasGeometry);
  for (let i = 0; i < geometries.length; i += 1) {
    for (let j = i + 1; j < geometries.length; j += 1) {
      const below = geometries[i]!;
      const above = geometries[j]!;
      const ratio = overlapRatio(below.rect, above.rect);
      if (ratio <= OVERLAP_RATIO_THRESHOLD) continue;
      // T53 auto-exemptions: same-group stacking and illustration-under-text.
      if (inSameGroup(below, above, objects)) continue;
      if (isIllustration(below) && isTextual(above)) continue;
      pairs.push({ below, above, ratio });
    }
  }
  return pairs;
}

function overlapIssues(slideId: string, objects: readonly PptSlideObject[]): PptQualityIssue[] {
  // T78: the overlap check protects text. Textless pairs are skipped
  // unconditionally; text pairs keep the T53 chain untouched.
  const issues: PptQualityIssue[] = [];
  for (const { below, above, ratio } of collectCandidatePairs(objects)) {
    if (isTextlessPair(below, above)) continue;
    const issue = pairOverlapIssue(slideId, objects, below, above, ratio);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Placeholders count as empty when text is absent or whitespace-only. */
function isEmptyPlaceholder(object: PptSlideObject): object is PptPlaceholderObject {
  return object.kind === "placeholder" && (object.text ?? "").trim() === "";
}

function emptyPlaceholderIssues(
  slideId: string,
  objects: readonly PptSlideObject[],
): PptQualityIssue[] {
  return objects
    .filter(isEmptyPlaceholder)
    .map((object) => ({
      inspectorId: "ppt.qc.empty-placeholder",
      slideId,
      objectId: object.id,
      message: `${objectLabel(object)} 是空的 ${object.subtype} 占位符，缺少文本`,
    }));
}

function emptySlideIssues(slide: { id: string; objects: readonly PptSlideObject[] }): PptQualityIssue[] {
  if (slide.objects.length > 0) return [];
  return [
    {
      inspectorId: "ppt.qc.empty-slide",
      slideId: slide.id,
      message: `幻灯片 "${slide.id}" 没有任何对象`,
    },
  ];
}

export const PPT_INSPECTORS: PptInspector[] = [
  {
    id: "ppt.qc.bounds",
    title: "对象越界检查",
    inspect: (doc) =>
      doc.slides.flatMap((slide) => boundsIssues(slide.id, slide.objects)),
  },
  {
    id: "ppt.qc.overlap",
    title: "对象重叠检查",
    inspect: (doc) =>
      doc.slides.flatMap((slide) => overlapIssues(slide.id, slide.objects)),
  },
  {
    id: "ppt.qc.empty-placeholder",
    title: "空文本占位符检查",
    inspect: (doc) =>
      doc.slides.flatMap((slide) => emptyPlaceholderIssues(slide.id, slide.objects)),
  },
  {
    id: "ppt.qc.empty-slide",
    title: "空幻灯片检查",
    inspect: (doc) => doc.slides.flatMap((slide) => emptySlideIssues(slide)),
  },
];

/** Run every inspector (or a given subset) and flatten the issues. */
export function runPptInspectors(
  doc: PptDocument,
  inspectors: readonly PptInspector[] = PPT_INSPECTORS,
): PptQualityIssue[] {
  return inspectors.flatMap((inspector) => inspector.inspect(doc));
}
