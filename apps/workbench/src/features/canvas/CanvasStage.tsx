import type { Page, Frame, SnapGuide, Tokens } from "@studio/schema-core";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { CANVAS_PAGE, type CanvasRect, type CanvasViewport, type Handle } from "./canvasGeometry";
import { CanvasContentLayer } from "./CanvasContentLayer";
import { CanvasOverlayLayer } from "./CanvasOverlayLayer";
import type { FlowRectMap } from "./flowMeasure";

/**
 * The single page shell rendered inside the zoomed viewport (zoom fix).
 * Coordinate model — ONE visual scale, applied exactly once:
 * - canvas-page: a PAGE-SPACE shell (device preset size, desktop baseline
 *   CANVAS_PAGE 1440x900) positioned by the viewport pan (left/top). It does
 *   NOT multiply its size by zoom: its
 *   only job is to host the content layer so page-space coords (pinned frames,
 *   marquee, flow selection) render 1:1 as CSS px.
 * - canvas-page-content (CanvasContentLayer): the single zoom transform
 *   `scale(zoom)` (top-left origin), carrying the white-paper background. The
 *   visible white paper is therefore 1440*zoom wide and the flow content
 *   inside it is 1440*zoom wide — identical scale, so flow content is never
 *   double-zoomed.
 * - CanvasOverlayLayer: SCREEN-space marquee/guides wrapper (pointer-events-none),
 *   keeping its original 1440*zoom containing block.
 *
 * Flow/pin layers and the flow selection box all render inside the scaled
 * content layer, so their page-space coords need no zoom math. CanvasSurface
 * owns viewport/selection/drag state and feeds it in as props.
 */
export interface CanvasStageProps {
  doc: Page;
  /** Document-level tokens (T19): threaded down to subtree renderers. */
  tokens: Tokens;
  /** Page-space left/top of the shell (viewport pan applied). */
  pageScreen: { x: number; y: number };
  viewport: CanvasViewport;
  /** Page shell size; defaults to the desktop baseline CANVAS_PAGE. */
  pageSize?: { w: number; h: number };
  /** Page-space measured rects for flow nodes (jsdom seam). */
  flowRects: FlowRectMap;
  /** Canvas-space pointer position of the current event (viewport-aware). */
  pointInCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  /** Single-id select callback — same one pin boxes and flow nodes call. */
  onSelect: (id: string) => void;
  /** Ref for flow DOM measurement (flowMeasure scans this element's subtree). */
  flowLayerRef: RefObject<HTMLDivElement | null>;
  /** Drag-to-pin entry: pointerdown on a top-level flow node. */
  onFlowDragStart: (id: string, e: ReactPointerEvent<HTMLElement>) => void;
  /** Z-ordered pinned boxes (pinned && frame). */
  pinned: { id: string; frame: Frame }[];
  selectedId: string | null;
  selectedIds: string[];
  selectNodes: (ids: string[]) => void;
  /** Pinned-box drag/resize entry (handle null = move). */
  onNodeDragStart: (id: string, handle: Handle | null, e: ReactPointerEvent<HTMLElement>) => void;
  /** Transient drag-to-pin box (page-space frame), null when not dragging. */
  pinDragBox: { id: string; frame: Frame | undefined } | null;
  /** Single flow selection (page-space), null when none/not single. */
  flowSelection: { rect: CanvasRect; locked: boolean } | null;
  /** Marquee rect in page space; null when not rubber-band selecting. */
  marquee: { x: number; y: number; w: number; h: number } | null;
  /** Active snap guides in page space during a drag. */
  guides: readonly SnapGuide[];
}

export function CanvasStage({
  doc,
  tokens,
  pageScreen,
  viewport,
  pageSize = { w: CANVAS_PAGE.w, h: CANVAS_PAGE.h },
  flowRects,
  pointInCanvas,
  onSelect,
  flowLayerRef,
  onFlowDragStart,
  pinned,
  selectedId,
  selectedIds,
  selectNodes,
  onNodeDragStart,
  pinDragBox,
  flowSelection,
  marquee,
  guides,
}: CanvasStageProps) {
  return (
    <div
      data-testid="canvas-page"
      className="absolute"
      style={{ left: pageScreen.x, top: pageScreen.y, width: pageSize.w, height: pageSize.h, position: "relative" }}
    >
      <CanvasContentLayer
        doc={doc}
        tokens={tokens}
        zoom={viewport.zoom}
        flowRects={flowRects}
        pointInCanvas={pointInCanvas}
        onSelect={onSelect}
        flowLayerRef={flowLayerRef}
        onFlowDragStart={onFlowDragStart}
        pinned={pinned}
        selectedId={selectedId}
        selectedIds={selectedIds}
        selectNodes={selectNodes}
        onNodeDragStart={onNodeDragStart}
        pinDragBox={pinDragBox}
        flowSelection={flowSelection}
      />
      <CanvasOverlayLayer
        viewport={viewport}
        pageSize={pageSize}
        guides={guides}
        marquee={marquee}
      />
    </div>
  );
}
