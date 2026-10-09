import type { Page, Tokens } from "@studio/schema-core";
import { getNode } from "@studio/schema-core";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEditorStore } from "../../state/editorStore";
import { NodeSubtree } from "./NodeSubtree";
import type { FlowRectMap } from "./flowMeasure";
import { flowDragCandidate } from "./flowNodes";

/**
 * Flow layer (Plan C): the document rendered as REAL DOM flow inside the fixed
 * design-width page box — same layout semantics as the project/schema preview.
 * Every node carries data-studio-id; selection is DOM-measured by CanvasSurface
 * (flowMeasure), so this layer owns no geometry itself.
 *
 * NodeSubtree skips pinned children (they live in the pin layer as absolute
 * boxes), which is exactly why rendering the root here can never double-paint
 * a pinned node.
 */

export interface FlowLayerProps {
  doc: Page;
  /** Document-level tokens (T19): passed down to NodeSubtree. */
  tokens: Tokens;
  /** Measured page rects — used to detect clicks in flow gaps (see below). */
  flowRects?: FlowRectMap;
  /** Canvas-space pointer position of the current event (viewport-aware). */
  pointInCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  /** Single-id select callback (App.handleSelect) — same one pin boxes call. */
  onSelect: (id: string) => void;
  /** Ref for DOM measurement (flowMeasure scans this element's subtree). */
  layerRef?: RefObject<HTMLDivElement | null>;
  /**
   * Drag-to-pin (Task 4, widened T8): pointerdown on ANY flow node — top-level
   * or nested — reports a drag start; CanvasSurface pins it at the measured
   * rect on the first move (nested nodes are promoted to the root on commit).
   * Nodes under a pin-box ancestor stay out (their gestures belong to the pin
   * box path); shift extends selection instead.
   */
  onFlowDragStart?: (id: string, e: ReactPointerEvent<HTMLElement>) => void;
  /** Node currently lifted into the transient pin-drag box (hidden here). */
  hideId?: string | null;
}

/** Nearest flow node id hit by a pointer event (data-studio-id ancestor walk). */
export function flowHitId(e: ReactPointerEvent<HTMLElement>): string | null {
  const el = e.target as HTMLElement | null;
  const hit = el?.closest?.("[data-studio-id]");
  return hit ? hit.getAttribute("data-studio-id") : null;
}

/**
 * The pointer is over a kit element but OUTSIDE its own measured rect — the
 * click lands in a layout gap (parent padding, margins between siblings).
 * Walk ancestors until a rect contains the point so the enclosing container
 * receives the selection instead of the miss reading as "empty canvas".
 */
export function gapHitId(doc: Page, id: string, pt: { x: number; y: number }, rects: FlowRectMap): string {
  const inside = (nid: string) => {
    const r = rects.get(nid);
    return !!r && pt.x >= r.x && pt.x < r.x + r.w && pt.y >= r.y && pt.y < r.y + r.h;
  };
  if (inside(id)) return id;
  const parentOf = new Map<string, string>();
  for (const n of doc.nodes) for (const c of n.children) parentOf.set(c, n.id);
  let cur: string | undefined = parentOf.get(id);
  while (cur !== undefined) {
    if (inside(cur)) return cur;
    cur = parentOf.get(cur);
  }
  return id;
}

/** Select the clicked flow node; shift extends the multi-selection like NodeFrameBox. */
export function selectFlowNode(nodeId: string, additive: boolean, onSelect: (id: string) => void): void {
  const { selectedIds, selectNodes } = useEditorStore.getState();
  if (additive) {
    const next = selectedIds.includes(nodeId)
      ? selectedIds.filter((x) => x !== nodeId)
      : [...selectedIds, nodeId];
    selectNodes(next);
    return;
  }
  selectNodes([nodeId]);
  onSelect(nodeId);
}

export function FlowLayer({ doc, tokens, flowRects, pointInCanvas, onSelect, layerRef, onFlowDragStart, hideId }: FlowLayerProps) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // jsdom leaves `button` undefined on synthetic events: treat as primary.
    if (e.button !== undefined && e.button !== 0) return;
    const id = flowHitId(e);
    // Missing root (broken doc): let the click fall through to the surface.
    if (!id || !getNode(doc, id)) return;
    const pt = pointInCanvas(e.clientX, e.clientY);
    const target = flowRects ? gapHitId(doc, id, pt, flowRects) : id;
    // stopPropagation: the surface would otherwise ALSO handle this event and
    // start a marquee (drag-select on flow content); the surface's own
    // empty-canvas check is only for clicks that never reached a node.
    e.stopPropagation();
    selectFlowNode(target, e.shiftKey, onSelect);
    // Drag-to-pin (T8): any flow node with a measured rect can leave the flow
    // (nested nodes are promoted to the root on commit); the root itself and
    // pin-box subtrees are excluded (flowDragCandidate).
    if (!e.shiftKey && flowDragCandidate(doc, target)) {
      const rect = flowRects?.get(target);
      if (rect && rect.w > 0 && rect.h > 0) onFlowDragStart?.(target, e);
    }
  };

  return (
    // Flow semantics need the natural document flow — do NOT stretch to the
    // fixed page height (absolute inset-0 would fake a full-height block).
    // pointer-events:none lets the SURFACE own clicks on empty canvas (clear
    // selection + marquee); the marker elements re-enable events for hit-testing.
    <div
      ref={layerRef}
      data-testid="canvas-flow-layer"
      className="pointer-events-none absolute inset-x-0 top-0"
      onPointerDown={onPointerDown}
    >
      <NodeSubtree doc={doc} tokens={tokens} nodeId={doc.rootId} hideId={hideId} />
    </div>
  );
}
