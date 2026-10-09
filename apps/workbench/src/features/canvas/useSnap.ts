import type { Frame, Page, Rect, SnapGuide, SnapResult } from "@studio/schema-core";
import { clampFrame, frameRects, snapCandidates } from "@studio/schema-core";
import { useMemo } from "react";
import { clampZoom } from "./canvasGeometry";
import { isPinBox } from "./flowNodes";

/**
 * Snap computation for an in-flight drag/resize (P5-2). Wraps schema-core's
 * pure `snapCandidates` with the drag-session specifics:
 * - exclusion of the moving set (self, or every node when multi-dragging),
 * - per-node composite when several frames move together (the whole group
 *   translates by one delta, so we take the smallest per-axis correction
 *   among members — the least-disruptive snap wins),
 * - zoom-normalized threshold (6 *screen* px, like Figma).
 *
 * Everything here is still pure (no DOM, no React state) so the orchestration
 * itself is unit-testable; the hook below only adds caching.
 */

/** Frames currently being dragged: id -> transient frame (overrides the doc). */
export type MovingSet = Map<string, Frame>;

const SCREEN_SNAP_THRESHOLD = 6;

/** Exclude the moving set; transient frames replace doc frames for others. */
function othersRects(doc: Page, moving: MovingSet): Rect[] {
  const rects = frameRects(doc);
  const others: Rect[] = [];
  for (const [id, rect] of rects) {
    if (moving.has(id)) continue;
    // Plan C (R11 predicate): only pin boxes are snap targets — a legacy
    // frame on a flow node is inert metadata, not a magnet for the drag.
    if (!isPinBox(doc.nodes.find((n) => n.id === id))) continue;
    others.push(rect);
  }
  return others;
}

/** Rect of a moving frame (transient overrides the committed doc frame). */
function movingRect(doc: Page, id: string, frame: Frame): Rect {
  void doc;
  void id;
  return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
}

/**
 * Snap a moving set against all other frame-bearing nodes.
 * Returns the single group delta (dx, dy) plus the guide lines to render.
 * Pure function: identical inputs give identical outputs (test target).
 */
export function recompute(doc: Page, moving: MovingSet, threshold: number): SnapResult {
  const entries = [...moving.entries()];
  if (entries.length === 0) return { dx: 0, dy: 0, guides: [] };
  const others = othersRects(doc, moving);
  let dx = 0;
  let dy = 0;
  let guides: SnapGuide[] = [];
  let bestAbsX = Infinity;
  let bestAbsY = Infinity;
  for (const [id, frame] of entries) {
    const rect = movingRect(doc, id, frame);
    const r = snapCandidates(rect, others, threshold);
    if (r.dx !== 0 && Math.abs(r.dx) < bestAbsX) {
      bestAbsX = Math.abs(r.dx);
      dx = r.dx;
    }
    if (r.dy !== 0 && Math.abs(r.dy) < bestAbsY) {
      bestAbsY = Math.abs(r.dy);
      dy = r.dy;
    }
    guides = r.guides.length > guides.length ? r.guides : guides;
  }
  return { dx, dy, guides };
}

/**
 * Clamp a dragged frame into the page bounds (schema-core clampFrame).
 * x/y move freely; only size shrinks when a frame would overflow the page.
 */
export function clampedFrame(frame: Frame, page: Rect): Frame {
  return clampFrame(frame, page);
}

/**
 * Small sliver (canvas px) that must remain visible inside the page for a
 * frame to be considered "not fully dragged out" (T20): the editor clamps an
 * in-flight drag/resize so at least this much of every selected frame stays
 * inside the slide. Picked small so a user can still pull a node close to an
 * edge without it feeling sticky.
 */
export const MIN_VISIBLE = 8;

/**
 * Clamp BOTH position and size so a frame is never fully outside the page
 * (T20). The schema-core clampFrame only shrinks size past the right/bottom
 * edges, leaving left/top edges free to walk past the page on a resize or a
 * multi-frame move — that lets a title box sit fully below the slide. This
 * helper adds the symmetric position clamp: if the frame would end up with
 * less than MIN_VISIBLE width or height inside the page, x/y is pulled back
 * to keep that sliver visible. Existing on-page frames pass through (size
 * untouched when fully inside).
 *
 * Order matters: position clamp runs FIRST (the user dragged the box away,
 * so x/y is what changed), then size clamp shrinks w/h if the new x/y still
 * overflows. Reversed order would shrink a moving box to 8px before any
 * position correction kicked in.
 */
export function clampInsidePage(frame: Frame, page: Rect): Frame {
  const minVisibleW = Math.min(MIN_VISIBLE, page.w);
  const minVisibleH = Math.min(MIN_VISIBLE, page.h);
  const pageLeft = page.x;
  const pageRight = page.x + page.w;
  const pageTop = page.y;
  const pageBottom = page.y + page.h;
  let { x, y, w, h } = frame;
  // 1. Position clamp (move-out): ensure at least MIN_VISIBLE of the frame
  //    stays inside the page on each axis. If the frame is wider/taller than
  //    the page itself, leave a minimal sliver at the top-left corner.
  const leftMax = pageRight - minVisibleW;
  const topMax = pageBottom - minVisibleH;
  if (x < pageLeft) x = pageLeft;
  else if (x > leftMax) x = leftMax;
  if (y < pageTop) y = pageTop;
  else if (y > topMax) y = topMax;
  // 2. Size clamp (resize-overflow): schema-core semantics — shrink w/h so
  //    the right/bottom edges stay inside the page (never grow).
  const next = clampFrame({ ...frame, x, y }, page);
  return { x: next.x, y: next.y, w: next.w, h: next.h, rotation: frame.rotation };
}

/** Zoom value that fits the page into the viewport (for "fit to canvas"). */
export function fitZoom(pageW: number, pageH: number, view: { w: number; h: number }, padding: number): number {
  const usableW = Math.max(1, view.w - padding * 2);
  const usableH = Math.max(1, view.h - padding * 2);
  return clampZoom(Math.min(usableW / pageW, usableH / pageH));
}

/** Convert 6 screen px into canvas px at the current zoom. */
export function screenThreshold(zoom: number): number {
  return SCREEN_SNAP_THRESHOLD / zoom;
}

export interface UseSnapArgs {
  doc: Page;
  /** Frames of the moving set during a drag; empty = no drag = no guides. */
  moving: MovingSet;
  zoom: number;
}

export interface UseSnapResult {
  /** Group correction to apply to every moving frame (canvas px). */
  dx: number;
  dy: number;
  /** Guide line geometry, page-space, ready to render. */
  guides: SnapGuide[];
}

/**
 * Drag-time snap computation hook. Recomputes only when the moving set or
 * zoom changes; returns zero delta and no guides while nothing is dragged.
 */
export function useSnap({ doc, moving, zoom }: UseSnapArgs): UseSnapResult {
  return useMemo(() => {
    if (moving.size === 0) return { dx: 0, dy: 0, guides: [] };
    const threshold = screenThreshold(zoom);
    const r = recompute(doc, moving, threshold);
    return { dx: r.dx, dy: r.dy, guides: r.guides };
  }, [doc, moving, zoom]);
}
