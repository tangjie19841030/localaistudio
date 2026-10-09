import { moveNode, pin, replacePage, setFrame } from "@studio/schema-core";
import type { Page, Rect, StudioDocument } from "@studio/schema-core";
import { refreshGroupFrames } from "./canvasGroupOps";
import { isRootChild } from "./flowNodes";
import type { useCanvasDrag } from "./useCanvasDrag";

/**
 * Drag commit algebra (P5-2), lifted out of CanvasSurface. One finished
 * gesture becomes exactly ONE applyOp — an empty commit set (a click without
 * movement) writes nothing.
 */

/** Document op entry point: one call = one undo entry (editorStore.applyOp). */
export type ApplyOp = (fn: (doc: StudioDocument) => StudioDocument) => boolean;

/**
 * A drag that started on a flow node (drag-to-pin, Task 4): on the FIRST
 * pointer displacement the node is pinned at its measured flow rect, so the
 * gesture lands it in the pin layer and then moves like any pinned box.
 */
export interface PinDragPlan {
  id: string;
  /** Measured page-space flow rect captured at gesture start. */
  rect: Rect;
  /**
   * True when the grabbed node is NOT a root child (T8 nested drag-out):
   * commit first promotes it to the root (moveNode), keeping the pin layer
   * page-level (LayerTree display, delete-parent cascade). Optional —
   * commitDrag derives it from the doc when omitted; the only construction
   * site (CanvasSurface) passes { id, rect }.
   */
  needsPromotion?: boolean;
}

export function commitDrag(
  drag: ReturnType<typeof useCanvasDrag>,
  doc: Page,
  applyOp: ApplyOp,
  pinPlan?: PinDragPlan | null,
): void {
  const changed = drag.end(doc);
  // commitFrames diffs against the doc frame — a flow node has none, so its
  // transient frame would be dropped. The drag-to-pin baseline is the
  // measured rect instead.
  const transient = pinPlan ? drag.state?.moving.get(pinPlan.id) : undefined;
  const pinMoved = pinPlan !== null && pinPlan !== undefined && transient !== undefined && frameMoved(pinPlan.rect, transient);
  // A bare click commits nothing: selection already happened on pointerdown.
  // The pin itself lands ONLY on first displacement (R5 "拖就走") — grabbing
  // a flow node without moving it must not dirty the document.
  if (!pinMoved && changed.size === 0) return;
  // T8 nested drag-out: pin() never re-parents, and a pinned node nested under
  // a flow parent would break the pin layer's page-level invariant — so a
  // non-root-child is promoted to the root FIRST, then pinned. moveNode +
  // pin + setFrame inside ONE applyOp = a single undo step.
  const needsPromotion = pinPlan ? (pinPlan.needsPromotion ?? !isRootChild(doc, pinPlan.id)) : false;
  applyOp((d) => {
    let next = d.pages[0]!;
    if (pinMoved) {
      if (needsPromotion) next = moveNode(next, pinPlan.id, next.rootId);
      next = pin(next, pinPlan.id, { ...pinPlan.rect, rotation: 0 });
    }
    for (const [id, frame] of changed) next = setFrame(next, id, frame);
    if (pinMoved) next = setFrame(next, pinPlan.id, transient);
    // Group frames are derived values (T13): every moved id refreshes its
    // group ancestors' union bbox inside the SAME applyOp (risk R3 — any new
    // member-moving op must tail-call refreshGroupFrames the same way).
    next = refreshGroupFrames(next, [...changed.keys(), ...(pinMoved ? [pinPlan.id] : [])]);
    return replacePage(d, next.id, next);
  });
}

/** True when the transient frame actually left the measured flow rect. */
function frameMoved(base: Rect, f: { x: number; y: number; w: number; h: number }): boolean {
  return f.x !== base.x || f.y !== base.y || f.w !== base.w || f.h !== base.h;
}
