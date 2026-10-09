import type { Page, Rect } from "@studio/schema-core";
import { useLayoutEffect, useState, type RefObject } from "react";
import type { CanvasViewport } from "./canvasGeometry";

/**
 * DOM measurement of flow-layer nodes (Plan C). Flow nodes have no frame —
 * their page-space rect comes from the rendered DOM: getBoundingClientRect of
 * the element carrying data-studio-id, converted from screen px to page px via
 * the SAME viewport transform the overlay/marquee use:
 *   page = (screen - contentOrigin) / zoom
 * where contentOrigin is the flow layer element's own top-left screen corner.
 * Measuring an element against its layer ancestor makes pan/zoom cancel out
 * except the zoom scale itself, so rects land in page space by construction.
 *
 * Re-measure triggers (brief: no per-frame ResizeObserver polling):
 * - doc reference change (any op produces a new doc → layout may have moved),
 * - viewport zoom change (page-px rect scales with the content transform),
 * - flow layer resize (only when ResizeObserver exists; jsdom skips it).
 *
 * jsdom has no layout engine, so `inject` is the test seam: explicit page-rects
 * merged over (never cleared by) live measurements — a jsdom live pass reads
 * all-zero rects and must not wipe injected values.
 */

/** id -> page-space rect. */
export type FlowRectMap = Map<string, Rect>;

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** jsdom renders everything as a 0x0 box at the origin — that is NOT a measurement. */
function isZeroRect(r: Rect): boolean {
  return r.w === 0 && r.h === 0 && r.x === 0 && r.y === 0;
}

/** Page-space rect of `el` relative to `origin` under the given zoom. */
export function measureFlowRect(el: DOMRect, origin: DOMRect, zoom: number): Rect {
  return {
    x: (el.left - origin.left) / zoom,
    y: (el.top - origin.top) / zoom,
    w: el.width / zoom,
    h: el.height / zoom,
  };
}

/** Read every data-studio-id element under `layer` into page-space rects. */
export function collectFlowRects(layer: HTMLElement, zoom: number): FlowRectMap {
  const origin = layer.getBoundingClientRect();
  const rects: FlowRectMap = new Map();
  for (const el of layer.querySelectorAll<HTMLElement>("[data-studio-id]")) {
    const id = el.getAttribute("data-studio-id");
    if (!id) continue;
    rects.set(id, measureFlowRect(measureTarget(el).getBoundingClientRect(), origin, zoom));
  }
  return rects;
}

/**
 * The marker wrapper is display:contents (transparent to flow layouts), which
 * generates NO box of its own — getBoundingClientRect on it is a zero rect in
 * Firefox and a children-union in Blink (interop risk). Its first element
 * child is the kit root (a real border box, padding included), which is
 * exactly the box a pointer interacts with — measure that instead. Real-box
 * elements (e.g. the NodeSubtree root wrapper) measure themselves.
 */
export function measureTarget(el: HTMLElement): HTMLElement {
  const contents = typeof getComputedStyle === "function" && getComputedStyle(el).display === "contents";
  if (contents && el.firstElementChild) return el.firstElementChild as HTMLElement;
  return el;
}

/** Flow ids whose rects intersect `sel` (strict intersection, like schema-core marquee). */
export function flowHits(rects: FlowRectMap, sel: Rect): string[] {
  const hits: string[] = [];
  for (const [id, r] of rects) {
    if (r.w === 0 || r.h === 0) continue; // unmeasured: never hit
    if (r.x < sel.x + sel.w && sel.x < r.x + r.w && r.y < sel.y + sel.h && sel.y < r.y + r.h) hits.push(id);
  }
  return hits;
}

export interface UseFlowMeasureArgs {
  doc: Page;
  viewport: CanvasViewport;
  /** Ref to the flow layer element (the zoomed content box). */
  layerRef: RefObject<HTMLElement | null>;
  /** Test seam: page rects replacing live measurements (jsdom-safe). */
  inject?: FlowRectMap;
}

export function useFlowMeasure({ doc, viewport, layerRef, inject }: UseFlowMeasureArgs): FlowRectMap {
  const [measured, setMeasured] = useState<FlowRectMap>(new Map());

  useLayoutEffect(() => {
    if (inject) return; // injected rects are the source of truth — no live pass
    const layer = layerRef.current;
    if (!layer) return;
    const pass = () =>
      setMeasured((prev) => {
        const next = collectFlowRects(layer, viewport.zoom);
        // Never regress a known rect to the jsdom zero-box.
        for (const [id, r] of prev) {
          if (isZeroRect(next.get(id) ?? ZERO)) next.set(id, r);
        }
        return next;
      });
    pass();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(pass);
    ro.observe(layer);
    return () => ro.disconnect();
  }, [doc, viewport.zoom, layerRef, inject]);

  return inject ?? measured;
}
