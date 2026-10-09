import type { Frame, Page } from "../document.js";

/**
 * Pure geometry layer for the free canvas (P5). Zero DOM, zero browser APIs —
 * everything here is trivially unit-testable. The workbench renders/interacts
 * on top of these; the document stays the single source of truth.
 */

/** Axis-aligned rectangle in document space (rotation ignored for hit math). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A visible snap guide line: axis-aligned segment from `from` to `to` at `at`. */
export interface SnapGuide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

export interface SnapResult {
  /** Correction to add to the moving rect's x/y (0 when no snap). */
  dx: number;
  dy: number;
  /** Guide line geometry for rendering each snapped alignment. */
  guides: SnapGuide[];
}

const DEFAULT_SNAP_THRESHOLD = 6;

/** Only frame-bearing nodes, mapped id -> rect. Frame-less nodes are ignored. */
export function frameRects(doc: Page): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const n of doc.nodes) {
    if (n.frame) rects.set(n.id, { x: n.frame.x, y: n.frame.y, w: n.frame.w, h: n.frame.h });
  }
  return rects;
}

/** Canvas paint order: nodes array order — earlier = bottom, later = top. */
export function zOrder(doc: Page): string[] {
  return doc.nodes.map((n) => n.id);
}

/**
 * Smallest size a clamped frame keeps when its edge starts past the page
 * bound — shrinking to 1px would persist an invisible 1px sliver after the
 * drag commits. Free-canvas semantics stay: x/y move freely, only size
 * shrinks, and a frame dragged past the edge keeps this visible minimum.
 */
export const MIN_FRAME_SIZE = 8;

/**
 * Clamp a frame so it never exceeds `bounds` while keeping x/y untouched
 * (the canvas is unbounded, so only size shrinks; position never moves).
 * Never shrinks below MIN_FRAME_SIZE — no 1px drag residue.
 */
export function clampFrame(frame: Frame, bounds: Rect): Frame {
  const maxW = Math.max(MIN_FRAME_SIZE, bounds.x + bounds.w - frame.x);
  const maxH = Math.max(MIN_FRAME_SIZE, bounds.y + bounds.h - frame.y);
  return { ...frame, w: Math.min(frame.w, maxW), h: Math.min(frame.h, maxH) };
}

/** Candidate positions (start = left/top edge, mid = center, end = right/bottom edge). */
function positionsOf(rect: Rect, axis: "x" | "y"): { start: number; mid: number; end: number } {
  if (axis === "x") {
    return { start: rect.x, mid: rect.x + rect.w / 2, end: rect.x + rect.w };
  }
  return { start: rect.y, mid: rect.y + rect.h / 2, end: rect.y + rect.h };
}

/** Guide line spanning both rects along the perpendicular axis of `at`. */
function guideFor(axis: "x" | "y", at: number, a: Rect, b: Rect): SnapGuide {
  if (axis === "x") {
    const from = Math.min(a.y, b.y);
    return { axis, at, from, to: Math.max(a.y + a.h, b.y + b.h) };
  }
  const from = Math.min(a.x, b.x);
  return { axis, at, from, to: Math.max(a.x + a.w, b.x + b.w) };
}

/**
 * Pick the single strongest candidate on one axis: smallest |delta| wins,
 * ties break toward the first candidate scanned. Null when nothing is within
 * threshold — never both left-and-right (or both guides) at once.
 * Cross-aligns: every moving position (start/mid/end) snaps to every other
 * rect position (start/mid/end), so e.g. a moving top edge can align to
 * another rect's bottom edge.
 */
function strongestOnAxis(
  moving: Rect,
  others: Rect[],
  axis: "x" | "y",
  threshold: number,
): { delta: number; guide: SnapGuide } | null {
  const movingPos = positionsOf(moving, axis);
  let best: { delta: number; guide: SnapGuide } | null = null;
  for (const other of others) {
    const otherPos = positionsOf(other, axis);
    for (const movingKey of ["start", "mid", "end"] as const) {
      for (const otherKey of ["start", "mid", "end"] as const) {
        const delta = otherPos[otherKey] - movingPos[movingKey];
        // delta 0 = already coincident, nothing to correct or to draw.
        if (delta === 0 || Math.abs(delta) > threshold) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, guide: guideFor(axis, otherPos[otherKey], moving, other) };
        }
      }
    }
  }
  return best;
}

/**
 * Snap a moving rect against other rects: aligns the moving start/mid/end to
 * each other rect's start/mid/end on both axes. Returns the strongest
 * (smallest |delta|) correction per axis plus guide lines for rendering.
 * Default threshold is 6 (document px, zoom-normalized by the caller).
 */
export function snapCandidates(moving: Rect, others: Rect[], threshold: number = DEFAULT_SNAP_THRESHOLD): SnapResult {
  const guides: SnapGuide[] = [];
  const snapX = strongestOnAxis(moving, others, "x", threshold);
  const snapY = strongestOnAxis(moving, others, "y", threshold);
  const dx = snapX?.delta ?? 0;
  const dy = snapY?.delta ?? 0;
  if (snapX) guides.push(snapX.guide);
  if (snapY) guides.push(snapY.guide);
  return { dx, dy, guides };
}

/** Strict rect intersection (touching edges do NOT count). */
function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Topmost frame-bearing node containing `point`, or null. Topmost = latest in
 * the nodes array (paint order); frame-less nodes are never hit.
 */
export function hitTest(doc: Page, point: { x: number; y: number }): string | null {
  for (let i = doc.nodes.length - 1; i >= 0; i -= 1) {
    const n = doc.nodes[i]!;
    if (!n.frame) continue;
    const r: Rect = { x: n.frame.x, y: n.frame.y, w: n.frame.w, h: n.frame.h };
    if (point.x >= r.x && point.x < r.x + r.w && point.y >= r.y && point.y < r.y + r.h) return n.id;
  }
  return null;
}

/** Frame-bearing nodes intersecting the marquee rect (intersection, not containment). */
export function marquee(doc: Page, sel: Rect): string[] {
  const hits: string[] = [];
  for (const n of doc.nodes) {
    if (!n.frame) continue;
    const r: Rect = { x: n.frame.x, y: n.frame.y, w: n.frame.w, h: n.frame.h };
    if (intersects(r, sel)) hits.push(n.id);
  }
  return hits;
}
