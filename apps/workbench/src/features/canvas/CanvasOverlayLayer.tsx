import type { SnapGuide } from "@studio/schema-core";
import type { CanvasViewport } from "./canvasGeometry";
import { CanvasOverlay } from "./CanvasOverlay";

/**
 * Screen-space overlay wrapper (zoom fix): the marquee and snap guides are
 * SCREEN-space (canvasToScreen already applied zoom+pan), so they must NOT
 * live inside the scaled content layer. This wrapper keeps the original
 * containing block — the page shell at pageScreen, 1440*zoom — so overlay
 * coordinates are unchanged by the page-size fix. left/top stay 0 because the
 * wrapper is a child of canvas-page (positioned at pageScreen).
 *
 * pointer-events:none is REQUIRED: the wrapper spans the whole scaled paper
 * and would otherwise block every click on the flow content and the pinned
 * boxes below it (verified in real Chromium: flow clicks stopped selecting and
 * pin drag/resize was dead). Decorative only — no events, no state.
 */

export interface CanvasOverlayLayerProps {
  viewport: CanvasViewport;
  /** Fixed page size in page-space px (1440x900). */
  pageSize: { w: number; h: number };
  /** Active snap guides in page space; empty when nothing snaps. */
  guides: readonly SnapGuide[];
  /** Marquee rect in page space; null when not rubber-band selecting. */
  marquee: { x: number; y: number; w: number; h: number } | null;
}

export function CanvasOverlayLayer({ viewport, pageSize, guides, marquee }: CanvasOverlayLayerProps) {
  return (
    <div
      data-testid="canvas-overlay-layer"
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: 0, top: 0, width: pageSize.w * viewport.zoom, height: pageSize.h * viewport.zoom }}
    >
      <CanvasOverlay viewport={viewport} guides={guides} marquee={marquee} />
    </div>
  );
}
