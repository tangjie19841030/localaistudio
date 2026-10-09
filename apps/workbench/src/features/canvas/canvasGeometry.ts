import { AUTO_LAYOUT_PAGE, type Frame } from "@studio/schema-core";

/**
 * Pure viewport/resize math for the free canvas (P5-2). Zero DOM, zero React —
 * every geometric behavior is provable in a unit test without a browser.
 * Components stay thin: they only convert pointer events into these calls.
 *
 * Coordinate model:
 * - canvas space  = page space; frame x/y live there (origin = page top-left).
 * - screen space  = px relative to the viewport element's top-left corner.
 * - The transform is: screen = canvas * zoom + pan (pan in screen px).
 */

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Default fixed page: frames live in page space, the viewport only transforms.
 * Single source of truth: w/h derive from schema-core AUTO_LAYOUT_PAGE (the
 * auto-framing baseline) so canvas mode and auto layout can never drift.
 */
export const CANVAS_PAGE = { x: 0, y: 0, w: AUTO_LAYOUT_PAGE.w, h: AUTO_LAYOUT_PAGE.h } as const;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/**
 * Resize handle ids: corners + edge midpoints, plus "rot" (rotate grip). The
 * HANDLES list stays the 8 resize grips; "rot" only reaches startRotate —
 * handleAxes("rot") is all-false, so the resize path can never act on it.
 */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rot";

export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface ResizeOptions {
  /** Shift: keep the current aspect ratio (corners only; edges ignore it). */
  keepRatio?: boolean;
  /** Alt: resize symmetrically from the frame center (both edges move). */
  fromCenter?: boolean;
}

/** Resize must never produce w/h below this floor (frameSchema requires >= 1). */
export const MIN_FRAME_SIZE = 1;

/** Clamp zoom into [MIN_ZOOM, MAX_ZOOM]; non-finite falls back to 1. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** screen = canvas * zoom + pan. */
export function canvasToScreen(pt: { x: number; y: number }, viewport: CanvasViewport): { x: number; y: number } {
  return {
    x: pt.x * viewport.zoom + viewport.panX,
    y: pt.y * viewport.zoom + viewport.panY,
  };
}

/** canvas = (screen - pan) / zoom. */
export function screenToCanvas(pt: { x: number; y: number }, viewport: CanvasViewport): { x: number; y: number } {
  return {
    x: (pt.x - viewport.panX) / viewport.zoom,
    y: (pt.y - viewport.panY) / viewport.zoom,
  };
}

/**
 * Anchored zoom: the canvas point under the cursor stays under the cursor.
 * Solve for the new pan that keeps screenToCanvas(cursor) fixed:
 *   cursor = canvas * zoom' + pan'  =>  pan' = cursor - canvas * zoom'
 * When clamping pins zoom, the anchor math still runs with the clamped value
 * (the cursor point keeps its screen position as closely as possible).
 */
export function zoomAt(cursor: { x: number; y: number }, viewport: CanvasViewport, factor: number): CanvasViewport {
  const zoom = clampZoom(viewport.zoom * factor);
  const canvas = screenToCanvas(cursor, viewport);
  return {
    zoom,
    panX: cursor.x - canvas.x * zoom,
    panY: cursor.y - canvas.y * zoom,
  };
}

/** Move the pan by screen px (space-drag / middle-mouse / shift+wheel). */
export function panBy(viewport: CanvasViewport, dx: number, dy: number): CanvasViewport {
  return { zoom: viewport.zoom, panX: viewport.panX + dx, panY: viewport.panY + dy };
}

/** Axis-aligned rect (same shape as schema-core Rect, kept local/optional). */
export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function frameToRect(frame: Frame): CanvasRect {
  return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
}

/** The dominant-axis delta for a Shift-constrained move (Figma behavior). */
export function constrainMove(dx: number, dy: number): { dx: number; dy: number } {
  // Diagonal (45deg) when both deltas are comparable; pure axis otherwise.
  if (Math.abs(dx) > Math.abs(dy) * 2) return { dx, dy: 0 };
  if (Math.abs(dy) > Math.abs(dx) * 2) return { dx: 0, dy };
  const signX = Math.sign(dx) || 0;
  const signY = Math.sign(dy) || 0;
  const len = Math.min(Math.abs(dx), Math.abs(dy));
  return { dx: signX * len, dy: signY * len };
}

/** Axis flags of a handle: which edges the handle pulls. */
function handleAxes(handle: Handle): { north: boolean; south: boolean; west: boolean; east: boolean } {
  return {
    north: handle.includes("n"),
    south: handle.includes("s"),
    west: handle.includes("w"),
    east: handle.includes("e"),
  };
}

function isCorner(handle: Handle): boolean {
  return handle.length === 2;
}

export interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** New edges for a Shift-ratio resize: the larger-travel axis drives the other. */
function ratioEdges(
  edges: Edges,
  axes: { north: boolean; west: boolean },
  frame: Frame,
  fromCenter: boolean,
): Edges {
  let { left, right, top, bottom } = edges;
  const ratio = frame.w / frame.h;
  const width = right - left;
  const height = bottom - top;
  // Figma: the axis with the larger travel drives the other axis.
  const newWidth = Math.abs(width - frame.w) >= Math.abs(height - frame.h) ? width : height * ratio;
  const newHeight = newWidth / ratio;
  if (fromCenter) {
    // Anchor the ratio at the moving center, not at an edge.
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    left = cx - newWidth / 2;
    right = cx + newWidth / 2;
    top = cy - newHeight / 2;
    bottom = cy + newHeight / 2;
  } else {
    // Anchor at the untouched opposite edges.
    if (axes.west) left = right - newWidth;
    else right = left + newWidth;
    if (axes.north) top = bottom - newHeight;
    else bottom = top + newHeight;
  }
  return { left, right, top, bottom };
}

/**
 * Solve the resulting edges given accumulated pointer deltas (canvas px).
 * Isolated from resizeFrame so each modifier's math is independently testable.
 */
export function resizeEdges(frame: Frame, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Edges {
  const axes = handleAxes(handle);
  let { left, right, top, bottom } = {
    left: frame.x,
    right: frame.x + frame.w,
    top: frame.y,
    bottom: frame.y + frame.h,
  };

  // 1. Move the grabbed edges by the pointer delta.
  if (axes.west) left += dx;
  if (axes.east) right += dx;
  if (axes.north) top += dy;
  if (axes.south) bottom += dy;

  // 2. Alt (fromCenter): mirror the opposite edge so the center stays fixed.
  //    Dragging an edge by d therefore changes that axis size by 2d.
  if (opts.fromCenter === true) {
    if (axes.west) right -= dx;
    if (axes.east) left -= dx;
    if (axes.north) bottom -= dy;
    if (axes.south) top -= dy;
  }

  // 3. Shift (keepRatio) on corners: enforce the original aspect ratio.
  if (opts.keepRatio === true && isCorner(handle) && frame.h !== 0) {
    return ratioEdges({ left, right, top, bottom }, axes, frame, opts.fromCenter === true);
  }

  return { left, right, top, bottom };
}

/** Enforce the 1x1 floor: a grabbed edge pulled past the opposite edge stops there. */
function floorEdges(edges: Edges, handle: Handle, fromCenter: boolean): Edges {
  const { north, south, west, east } = handleAxes(handle);
  let { left, right, top, bottom } = edges;
  if (fromCenter) {
    // Keep the center fixed; both sides shrink symmetrically to the floor.
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    if (right - left < MIN_FRAME_SIZE) {
      left = cx - MIN_FRAME_SIZE / 2;
      right = cx + MIN_FRAME_SIZE / 2;
    }
    if (bottom - top < MIN_FRAME_SIZE) {
      top = cy - MIN_FRAME_SIZE / 2;
      bottom = cy + MIN_FRAME_SIZE / 2;
    }
    return { left, right, top, bottom };
  }
  // The grabbed edge stops at the fixed edge (Figma edge-crossing behavior).
  if (west && right - left < MIN_FRAME_SIZE) left = right - MIN_FRAME_SIZE;
  if (east && right - left < MIN_FRAME_SIZE) right = left + MIN_FRAME_SIZE;
  if (north && bottom - top < MIN_FRAME_SIZE) top = bottom - MIN_FRAME_SIZE;
  if (south && bottom - top < MIN_FRAME_SIZE) bottom = top + MIN_FRAME_SIZE;
  return { left, right, top, bottom };
}

/**
 * Resize a frame from one of its 8 handles by pointer deltas (canvas px).
 * dx/dy are the accumulated pointer delta since resize start (canvas space).
 * Min size 1x1 is enforced; when Shift pins the ratio, the floor is applied
 * ratio-preservingly (e.g. 2:1 frame bottoms out at 2x1, not 1x1).
 * Rotation passes through untouched.
 */
export function resizeFrame(frame: Frame, handle: Handle, dx: number, dy: number, opts?: ResizeOptions): Frame {
  const merged: ResizeOptions = opts ?? {};
  const raw = resizeEdges(frame, handle, dx, dy, merged);
  const hitFloor = raw.right - raw.left < MIN_FRAME_SIZE || raw.bottom - raw.top < MIN_FRAME_SIZE;
  const { left, right, top, bottom } = floorEdges(raw, handle, merged.fromCenter === true);

  let x = left;
  let y = top;
  let w = Math.max(MIN_FRAME_SIZE, right - left);
  let h = Math.max(MIN_FRAME_SIZE, bottom - top);

  // Shift past the floor: keep the ratio with both axes >= 1.
  if (merged.keepRatio === true && isCorner(handle) && hitFloor && frame.h !== 0) {
    const ratio = frame.w / frame.h;
    const wMin = Math.max(MIN_FRAME_SIZE, MIN_FRAME_SIZE * ratio);
    w = wMin;
    h = wMin / ratio;
    if (merged.fromCenter === true) {
      // Keep the center where the symmetric collapse put it.
      const cx = (raw.left + raw.right) / 2;
      const cy = (raw.top + raw.bottom) / 2;
      x = cx - w / 2;
      y = cy - h / 2;
    }
  }
  return { x, y, w, h, rotation: frame.rotation };
}

/**
 * Fit the page rect into the viewport rect and center it: computes the
 * viewport for "fit to canvas" (zoom clamped, pan centers the page).
 */
export function fitViewport(page: CanvasRect, view: { w: number; h: number }, padding: number): CanvasViewport {
  const usableW = Math.max(1, view.w - padding * 2);
  const usableH = Math.max(1, view.h - padding * 2);
  const zoom = clampZoom(Math.min(usableW / page.w, usableH / page.h));
  return {
    zoom,
    panX: view.w / 2 - (page.x + page.w / 2) * zoom,
    panY: view.h / 2 - (page.y + page.h / 2) * zoom,
  };
}
