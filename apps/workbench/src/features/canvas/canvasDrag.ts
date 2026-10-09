import type { Frame, Page } from "@studio/schema-core";
import { getNode } from "@studio/schema-core";
import type { Handle, ResizeOptions } from "./canvasGeometry";
import { constrainMove, resizeFrame } from "./canvasGeometry";
import { angleBetween, rotationFromGesture } from "./frameRotation";
import { withPinDescendants } from "./flowNodes";
import type { MovingSet } from "./useSnap";

/**
 * Pure drag-session algebra (P5-2). NodeFrameBox converts pointer events into
 * session inputs; these functions turn them into the next MovingSet without
 * touching React state — so drag physics is unit-testable without a browser.
 */

export type DragKind = "move" | "resize" | "rotate";

export interface DragStart {
  kind: DragKind;
  /** Canvas-space pointer position at pointerdown. */
  start: { x: number; y: number };
  /** Handle id when resizing. */
  handle?: Handle;
  /** Frames of every dragged node at pointerdown (id -> committed frame). */
  origin: MovingSet;
  /** Rotate session: pivot = frame center (canvas space). */
  center?: { x: number; y: number };
  /** Pointer angle (deg) around the pivot at gesture start. */
  startAngle?: number;
  /** Frame rotation at gesture start. */
  baseRotation?: number;
}

export interface DragInput {
  /** Canvas-space pointer position now. */
  current: { x: number; y: number };
  shiftKey: boolean;
  altKey: boolean;
}

export interface DragOutput {
  /** Next transient frames for the moving set. */
  moving: MovingSet;
}

/** Start frames of the dragged node, or the whole multi-selection. */
export function startMove(origin: Map<string, Frame>, pointer: { x: number; y: number }): DragStart {
  return { kind: "move", start: pointer, origin };
}

export function startResize(origin: Map<string, Frame>, pointer: { x: number; y: number }, handle: Handle): DragStart {
  return { kind: "resize", handle, start: pointer, origin };
}

/**
 * Start a rotation session (T13): origin is a single-entry map { id -> frame };
 * pivot = its center, base rotation = its committed rotation.
 */
export function startRotate(origin: Map<string, Frame>, pointer: { x: number; y: number }): DragStart {
  const frame = origin.values().next().value;
  const center = frame ? { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 } : pointer;
  return {
    kind: "rotate",
    start: pointer,
    origin,
    center,
    startAngle: angleBetween(center, pointer),
    baseRotation: frame?.rotation ?? 0,
  };
}

/**
 * Collect the moving set: the primary node plus (optionally) its selection
 * peers; a pin box additionally carries its pin-box descendants (group
 * semantics, T13 §3.5 — dragging a group moves the whole group).
 */
export function movingSetFor(
  doc: Page,
  ids: readonly string[],
): Map<string, Frame> {
  const set = new Map<string, Frame>();
  for (const id of withPinDescendants(doc, ids)) {
    const node = getNode(doc, id);
    if (node?.frame) set.set(id, node.frame);
  }
  return set;
}

/**
 * Advance the drag session by one pointer sample.
 * Move: translate every origin frame by the constrained delta.
 * Rotate: rewrite only rotation from the pointer sweep around the pivot
 * (x/y/w/h carried through — useCanvasDrag skips snap/clamp for this kind).
 * Resize: apply resizeFrame to the primary frame (the first id); peers are not
 * resized in this phase (single-node resize only — multi-resize is P6 scope).
 */
export function advance(session: DragStart, input: DragInput): DragOutput {
  const dx = input.current.x - session.start.x;
  const dy = input.current.y - session.start.y;
  const moving = new Map<string, Frame>();
  if (session.kind === "move") {
    const delta = input.shiftKey ? constrainMove(dx, dy) : { dx, dy };
    for (const [id, frame] of session.origin) {
      moving.set(id, { ...frame, x: frame.x + delta.dx, y: frame.y + delta.dy });
    }
    return { moving };
  }
  if (session.kind === "rotate") {
    // Fields are set iff kind === "rotate" (only startRotate builds it).
    const rotation = rotationFromGesture(
      session.startAngle!,
      angleBetween(session.center!, input.current),
      session.baseRotation!,
      input.shiftKey,
    );
    for (const [id, frame] of session.origin) {
      moving.set(id, { ...frame, rotation });
    }
    return { moving };
  }
  const opts: ResizeOptions = { keepRatio: input.shiftKey, fromCenter: input.altKey };
  for (const [id, frame] of session.origin) {
    const handle = session.handle ?? "se";
    const next = resizeFrame(frame, handle, dx, dy, opts);
    moving.set(id, next);
  }
  return { moving };
}

/**
 * Commit set for pointerup: caller feeds the final (snapped) transient frames.
 * Frames identical to their committed counterpart are dropped so a click
 * without movement commits nothing (selection only).
 */
export function commitFrames(doc: Page, moving: MovingSet): Map<string, Frame> {
  const changed = new Map<string, Frame>();
  for (const [id, frame] of moving) {
    const committed = getNode(doc, id)?.frame;
    if (!committed) continue;
    if (
      committed.x !== frame.x ||
      committed.y !== frame.y ||
      committed.w !== frame.w ||
      committed.h !== frame.h ||
      committed.rotation !== frame.rotation
    ) {
      changed.set(id, frame);
    }
  }
  return changed;
}
