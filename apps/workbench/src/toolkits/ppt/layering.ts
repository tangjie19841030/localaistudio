import type { PptDocument, PptSlideObject } from "@studio/ppt-toolkit";

/**
 * One-shot layer repair for decks produced by older importers.
 *
 * Those importers:
 *  - dropped <a:alpha> (semi-transparent washes became opaque);
 *  - kept the XML document order, where background tints and decorative
 *    stripes (the templates' full-bleed pastel panels and thin vertical
 *    bars) are emitted AFTER the pictures/text they visually sit behind.
 *
 * The result: large pale rectangles + dozens of thin pastel bars paint OVER
 * every title and image ("solid color page / yellow bars over everything").
 *
 * The deterministic fix is a stable background/foreground partition:
 * pale page-aligned shapes that currently cover lower-layer content move to
 * a background group (their mutual order preserved), everything else keeps
 * its exact relative order. Idempotent: once a shape sits below the content
 * it covers, it no longer qualifies.
 */

const SLIDE_W = 1280;
const SLIDE_H = 720;
/** Background elements must be flush with the page edge. */
const EDGE_TOLERANCE = 0.01;
/** Above this relative luminance the fill is treated as a pale tint. */
const PALE_LUMINANCE = 0.78;
/** Large wash candidate: at least this fraction of the slide. */
const LARGE_AREA = 0.45;
/** Stripe candidate: page-edge aligned, thin, running most of an edge. */
const STRIPE_SPAN = 0.75;
const STRIPE_THIN = 0.08;
/** Small decorative tile candidate (e.g. stepped bars near a corner). */
const TILE_AREA = 0.005;
/** Full-width top/bottom band candidate. */
const BAND_AREA = 0.1;
/** Broad band candidate must span nearly the full slide width. */
const BAND_SPAN = 0.9;

function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function rectsOverlap(a: PptSlideObject, b: PptSlideObject): boolean {
  return (
    a.rect.x < b.rect.x + b.rect.w &&
    a.rect.x + a.rect.w > b.rect.x &&
    a.rect.y < b.rect.y + b.rect.h &&
    a.rect.y + a.rect.h > b.rect.y
  );
}

/** Is this pale shape a background element (page wash / edge stripe / tile)? */
function isBackgroundShape(obj: PptSlideObject): boolean {
  if (obj.kind !== "shape" || !obj.fill) return false;
  if (luminance(obj.fill) < PALE_LUMINANCE) return false;
  const { x, y, w, h } = obj.rect;
  const area = (w * h) / (SLIDE_W * SLIDE_H);
  const onSideEdge = x <= 8 || x + w >= SLIDE_W - 8;
  const flushSideEdge = x <= EDGE_TOLERANCE || Math.abs(x + w - SLIDE_W) <= EDGE_TOLERANCE;
  const onTopBottom = y <= 8 || y + h >= SLIDE_H - 8;
  // Full/half-bleed panel aligned to a corner.
  if (area >= LARGE_AREA && onSideEdge && onTopBottom) return true;
  // Thin bar running along a slide edge.
  if (w / SLIDE_W <= STRIPE_THIN && h / SLIDE_H >= STRIPE_SPAN && flushSideEdge) return true;
  if (h / SLIDE_H <= STRIPE_THIN && w / SLIDE_W >= STRIPE_SPAN && onTopBottom) return true;
  // Broad bands are backgrounds only when they span most of the page;
  // avoid treating a large content card touching the bottom edge as a wash.
  if (area >= BAND_AREA && w / SLIDE_W >= BAND_SPAN && onTopBottom) return true;
  // Small pale tile hugging a side/top edge (stepped decorative bars).
  if (area >= TILE_AREA && area < BAND_AREA && (onSideEdge || onTopBottom)) return true;
  return false;
}

/**
 * Partition objects into [background..., foreground...] while preserving
 * each group's original relative order. Only shapes that actually cover a
 * lower-layer image/text move — this keeps the transform idempotent and
 * avoids pulling intentional foreground cards to the back.
 */
export function repairSlideWashLayering(objects: readonly PptSlideObject[]): {
  objects: PptSlideObject[];
  moved: number;
  movedIds: string[];
} {
  const movedIds: string[] = [];
  const moveSet = new Set<string>();

  objects.forEach((obj, idx) => {
    if (!isBackgroundShape(obj)) return;
    const coversLowerContent = objects.some(
      (o, oIdx) =>
        oIdx < idx &&
        (o.kind === "image" || o.kind === "text") &&
        rectsOverlap(obj, o),
    );
    if (coversLowerContent) moveSet.add(obj.id);
  });

  if (moveSet.size === 0) {
    return { objects: [...objects], moved: 0, movedIds: [] };
  }

  // Stable partition: backgrounds first (in original order), then every
  // non-moved object in original order.
  const background = objects.filter((o) => moveSet.has(o.id));
  const foreground = objects.filter((o) => !moveSet.has(o.id));
  movedIds.push(...background.map((o) => o.id));
  return { objects: [...background, ...foreground], moved: background.length, movedIds };
}

/** Repair every slide; returns the next document and a human-readable report. */
export function repairDeckWashLayering(deck: PptDocument): {
  deck: PptDocument;
  repairs: string[];
} {
  const repairs: string[] = [];
  const slides = deck.slides.map((slide) => {
    const result = repairSlideWashLayering(slide.objects);
    if (result.moved > 0) {
      repairs.push(`${slide.title || slide.id}: ${result.moved} 个背景装饰色块已沉到内容下方`);
      return { ...slide, objects: result.objects };
    }
    return slide;
  });
  return repairs.length > 0 ? { deck: { ...deck, slides }, repairs } : { deck, repairs: [] };
}
