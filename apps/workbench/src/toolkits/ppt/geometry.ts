import { SLIDE_HEIGHT, SLIDE_WIDTH, type Rect } from "@studio/ppt-toolkit";

/**
 * Fixed-canvas coordinate math (data space is always 1280x720; the screen
 * surface is a scaled/translated view of it). Pure functions — jsdom-safe
 * unit-testable without layout.
 */

export interface CanvasView {
  /** Rendered slide width in screen px. */
  scale: number;
  /** Slide top-left corner in the canvas container's client coordinates. */
  offsetX: number;
  offsetY: number;
}

/** Fit 16:9 into a container while leaving a margin, keeping aspect locked. */
export function fitScale(containerW: number, containerH: number, margin = 48): number {
  const usableW = Math.max(containerW - margin * 2, 1);
  const usableH = Math.max(containerH - margin * 2, 1);
  return Math.min(usableW / SLIDE_WIDTH, usableH / SLIDE_HEIGHT);
}

/** Screen (client) point -> data-space point. */
export function screenToData(view: CanvasView, screenX: number, screenY: number): { x: number; y: number } {
  return { x: (screenX - view.offsetX) / view.scale, y: (screenY - view.offsetY) / view.scale };
}

/** Data-space size -> screen size. */
export function dataToScreen(view: CanvasView, w: number, h: number): { w: number; h: number } {
  return { w: w * view.scale, h: h * view.scale };
}

/** Translate a pointer delta into a data-space rect, clamped inside the slide. */
export function movedRect(view: CanvasView, rect: Rect, dx: number, dy: number): Rect {
  const x = clamp(rect.x + dx / view.scale, 0, SLIDE_WIDTH - rect.w);
  const y = clamp(rect.y + dy / view.scale, 0, SLIDE_HEIGHT - rect.h);
  return { x, y, w: rect.w, h: rect.h };
}

/** Resize one edge/corner of a rect by a screen delta, clamped to the slide. */
export function resizedRect(view: CanvasView, rect: Rect, handle: ResizeHandle, dx: number, dy: number): Rect {
  const ddx = dx / view.scale;
  const ddy = dy / view.scale;
  let { x, y, w, h } = rect;
  if (handle.includes("e")) w = rect.w + ddx;
  if (handle.includes("s")) h = rect.h + ddy;
  if (handle.includes("w")) {
    x = rect.x + ddx;
    w = rect.w - ddx;
  }
  if (handle.includes("n")) {
    y = rect.y + ddy;
    h = rect.h - ddy;
  }
  return clampRect({ x, y, w, h });
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Clamp a rect into the fixed canvas: inside bounds, positive size, min edge. */
export function clampRect(rect: Rect, minSize = 8): Rect {
  const w = clamp(rect.w, minSize, SLIDE_WIDTH);
  const h = clamp(rect.h, minSize, SLIDE_HEIGHT);
  return { x: clamp(rect.x, 0, SLIDE_WIDTH - w), y: clamp(rect.y, 0, SLIDE_HEIGHT - h), w, h };
}

/** Round rect fields for stable document output (integer-friendly data space). */
export function roundRect(rect: Rect): Rect {
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Property-panel rect entry: clamp each field to the slide (keeps others fixed). */
export function clampedRectField(rect: Rect, field: keyof Rect, value: number): Rect {
  switch (field) {
    case "x":
      return { ...rect, x: clamp(value, 0, SLIDE_WIDTH - rect.w) };
    case "y":
      return { ...rect, y: clamp(value, 0, SLIDE_HEIGHT - rect.h) };
    case "w":
      return { ...rect, w: clamp(value, 1, SLIDE_WIDTH - rect.x) };
    case "h":
      return { ...rect, h: clamp(value, 1, SLIDE_HEIGHT - rect.y) };
  }
}
