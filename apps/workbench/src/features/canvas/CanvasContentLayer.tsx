import type { Frame, Page, Tokens } from "@studio/schema-core";
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import type { CanvasRect, Handle } from "./canvasGeometry";
import { FlowLayer } from "./FlowLayer";
import { FlowSelectionBox } from "./FlowSelectionBox";
import { PinnedFrameLayer } from "./PinnedFrameLayer";
import type { FlowRectMap } from "./flowMeasure";

/**
 * The single zoom transform layer (zoom fix): the white paper (1440x900)
 * scaled EXACTLY once by scale(zoom), carrying everything that lives in page
 * space — flow DOM, pinned boxes, the drag-to-pin ghost and the flow selection
 * box. Because flow content sits in the SAME scaled layer as the paper, flow
 * is visually 1440*zoom wide — never zoom^2. Pure composition; no gesture
 * logic (CanvasSurface owns all pointer/drag state).
 */

export interface CanvasContentLayerProps {
  doc: Page;
  /** Document-level tokens (T19): threaded down to subtree renderers. */
  tokens: Tokens;
  /** The single visual zoom — applied here and nowhere else in the page. */
  zoom: number;
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
}

/** Empty-page hint (non-component render helper; only mounts when no nodes). */
function renderEmptyHint(): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center gap-1 text-center"
    >
      {/* Canvas paper is always white — use fixed slate tones, not the
          chrome ink tokens (near-invisible on white in dark theme). */}
      <p className="text-sm font-medium text-slate-500">画布为空</p>
      <p className="max-w-80 text-xs leading-relaxed text-slate-400">
        在右侧「属性 · 插入组件」点选即可落框；或切到 Schema 预览，用左侧 AI 生成整页后再回来排版。
      </p>
    </div>
  );
}

export function CanvasContentLayer({
  doc,
  tokens,
  zoom,
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
}: CanvasContentLayerProps) {
  return (
    <div
      data-testid="canvas-page-content"
      className="absolute inset-0 bg-white shadow-card ring-1 ring-hairline"
      style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
    >
      {doc.nodes.length === 0 && renderEmptyHint()}
      {/* Flow layer first (bottom), then pin boxes in doc order (top). */}
      <FlowLayer
        doc={doc}
        tokens={tokens}
        flowRects={flowRects}
        pointInCanvas={pointInCanvas}
        onSelect={onSelect}
        layerRef={flowLayerRef}
        onFlowDragStart={onFlowDragStart}
        hideId={pinDragBox?.id ?? null}
      />
      <PinnedFrameLayer
        doc={doc}
        tokens={tokens}
        pinned={pinned}
        selectedId={selectedId}
        selectedIds={selectedIds}
        selectNodes={selectNodes}
        onSelect={onSelect}
        onNodeDragStart={onNodeDragStart}
        pinDragBox={pinDragBox}
      />
      {flowSelection && <FlowSelectionBox rect={flowSelection.rect} locked={flowSelection.locked} />}
    </div>
  );
}
