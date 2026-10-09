import type { Page, Rect, Tokens } from "@studio/schema-core";
import { marquee as marqueeSelect } from "@studio/schema-core";
import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { canvasToScreen, screenToCanvas, type Handle } from "./canvasGeometry";
import { AlignBar } from "./AlignBar";
import { CanvasStage } from "./CanvasStage";
import { ImageGenPopover } from "./ImageGenPopover";
import { useImageGen } from "./useImageGen";
import { CanvasToolbar } from "./CanvasToolbar";
import { movingSetFor, startMove, startResize, startRotate } from "./canvasDrag";
import { commitDrag, type ApplyOp, type PinDragPlan } from "./canvasCommit";
import { IDLE_PAN, advancePan, type PanState } from "./canvasPan";
import { pageRect } from "./canvasPage";
import type { Viewport } from "../../state/editorStore";
import { flowHits, useFlowMeasure, type FlowRectMap } from "./flowMeasure";
import { hasPinnedAncestor, isFlowNode } from "./flowNodes";
import { capturePointer } from "./pointerCapture";
import { useCanvasDrag } from "./useCanvasDrag";
import { useCanvasAlign } from "./useCanvasAlign";
import { useCanvasKeyboard } from "./useCanvasKeyboard";
import { useCanvasViewport } from "./useCanvasViewport";
import { usePinned } from "./usePinned";
import { useRelayout } from "./useRelayout";
import { useEditorStore } from "../../state/editorStore";

/**
 * Canvas mode shell (Plan C hybrid positioning): pan/zoom/marquee/keyboard
 * around a fixed page, rendered as TWO layers with the same layout semantics
 * as codegen/preview:
 * - flow layer: every unpinned node as real DOM flow (FlowLayer + NodeSubtree
 *   from the root); legacy frames on unpinned nodes are inert. Selection is
 *   DOM-measured (data-studio-id + getBoundingClientRect, viewport-aware).
 * - pin layer: pinned && frame nodes as absolute NodeFrameBox page-coord
 *   boxes; drag/resize/nudge/snap/overflow badge unchanged.
 *
 * Wheel policy (documented choice): plain wheel = zoom (Figma Make style,
 * trackpad-friendly), ctrl+wheel also zooms, shift+wheel pans horizontally.
 * Space+drag or middle-mouse pans. Zoom range 0.25-4, anchored at cursor.
 *
 * Composition: gesture algebra lives in canvasDrag/canvasPan, the drag state
 * machine in useCanvasDrag, keyboard ops in useCanvasKeyboard, flow DOM
 * measurement in flowMeasure and the pinned frame list in usePinned — this
 * component only wires pointer events to them. The page shell (fixed logical
 * size + single scale(zoom) content transform) renders in CanvasStage.
 */

export interface CanvasSurfaceProps {
  doc: Page;
  /** Document-level tokens (T19 §0.2): AppShell injection in canvas render. */
  tokens: Tokens;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** One call = one undo entry (editorStore.applyOp). */
  applyOp: ApplyOp;
  /** Device preset driving the page shell size (defaults to desktop). */
  device?: Viewport;
  /** Test seam: page rects for flow nodes (jsdom has no layout engine). */
  flowRects?: FlowRectMap;
}

const FIT_PADDING = 80;

export function CanvasSurface({ doc, tokens, selectedId, onSelect, applyOp, device = "desktop", flowRects: injectedRects }: CanvasSurfaceProps) {
  const { viewport, zoomAtCursor, panByDelta, setViewport, fitToRect } = useCanvasViewport();
  const page = pageRect(doc, device);
  const drag = useCanvasDrag({ doc, page });
  const [pan, setPan] = useState<PanState>(IDLE_PAN);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const flowLayerRef = useRef<HTMLDivElement>(null);
  /** Drag-to-pin plan for the in-flight gesture (null for pinned-box drags). */
  const pinPlanRef = useRef<PinDragPlan | null>(null);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectNodes = useEditorStore((s) => s.selectNodes);
  const relayout = useRelayout(doc, applyOp);
  // Align/distribute/group wiring (T13): availability derives from the
  // selection, every action lands as ONE applyOp; the bar mounts only when
  // the selection holds at least one pin box.
  const align = useCanvasAlign({ doc, selectedId, selectedIds, page, applyOp });
  // U7: image generation entry — projectId comes from the store (no prop
  // threading through PreviewSurface), settings probe happens inside the hook.
  const imageProjectId = useEditorStore((s) => s.projectId);
  const imageGen = useImageGen({ projectId: imageProjectId, doc, selectedId, applyOp });

  const pointerInCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToCanvas({ x: clientX - rect.left, y: clientY - rect.top }, viewport);
    },
    [viewport],
  );

  /** Pinned frame list in z order with transient overrides during a drag. */
  const pinned = usePinned(doc, drag.state?.moving);

  // Drag-to-pin transient box (fix round): while a flow node is dragged it
  // renders as a pin-layer box at the transient frame ("拖就走" feedback).
  // The plan ref is set synchronously before drag.begin; drag.state drives
  // the re-render, so reading the ref during render is consistent.
  const pinDragBox =
    drag.phase === "dragging" && pinPlanRef.current
      ? { id: pinPlanRef.current.id, frame: drag.state!.moving.get(pinPlanRef.current.id) }
      : null;

  /** Measured page rects of flow nodes (live DOM or the injected test seam). */
  const flowRects = useFlowMeasure({ doc, viewport, layerRef: flowLayerRef, inject: injectedRects });

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.shiftKey && !e.ctrlKey) {
        panByDelta(-e.deltaX - e.deltaY, 0);
        return;
      }
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAtCursor(cursor, factor);
    },
    [panByDelta, zoomAtCursor],
  );

  const onSurfacePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.phase !== "idle") return;
    // middle-mouse anywhere, or space+drag → pan
    // (jsdom leaves `button` undefined on synthetic pointer events → pan check
    // uses strict === 1; the marquee branch below tolerates undefined.)
    if (e.button === 1 || spaceHeld) {
      capturePointer(e.currentTarget, e.pointerId);
      setPan({ phase: "pan", start: { x: e.clientX, y: e.clientY }, current: { x: e.clientX, y: e.clientY } });
      return;
    }
    if (e.button !== undefined && e.button !== 0) return;
    // click on empty canvas: clear selection; drag = marquee
    capturePointer(e.currentTarget, e.pointerId);
    const pt = pointerInCanvas(e.clientX, e.clientY);
    if (!canvasHit(doc, flowRects, pt)) onSelect(null);
    setPan({ phase: "marquee", start: pt, current: pt });
  };

  const onSurfacePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.phase === "pan") {
      const start = advancePan(pan, { x: e.clientX, y: e.clientY }, panByDelta);
      setPan({ ...pan, start });
      return;
    }
    if (pan.phase === "marquee") {
      setPan({ ...pan, current: pointerInCanvas(e.clientX, e.clientY) });
      return;
    }
    if (drag.phase === "dragging") {
      drag.move(pointerInCanvas(e.clientX, e.clientY), { shiftKey: e.shiftKey, altKey: e.altKey }, viewport.zoom);
    }
  };

  const onSurfacePointerCancel = () => {
    // An interrupted gesture (device loss, alt-tab) must not commit its
    // half-finished state: drag aborts, pan/marquee reset silently.
    pinPlanRef.current = null;
    if (pan.phase !== "idle") {
      setPan(IDLE_PAN);
      return;
    }
    if (drag.phase === "dragging") drag.cancel();
  };

  const onSurfacePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.phase === "pan") {
      setPan(IDLE_PAN);
      return;
    }
    if (pan.phase === "marquee") {
      finishMarquee(pan, pointerInCanvas(e.clientX, e.clientY), e.shiftKey, doc, flowRects, selectedIds, selectNodes, onSelect);
      setPan(IDLE_PAN);
      return;
    }
    if (drag.phase === "dragging") commitDrag(drag, doc, applyOp, pinPlanRef.current);
  };

  const beginNodeDrag = useCallback(
    (id: string, handle: Handle | null, e: ReactPointerEvent<HTMLElement>) => {
      capturePointer(e.currentTarget, e.pointerId);
      pinPlanRef.current = null;
      // Multi-select drag: move every selected id when the clicked node is in
      // the set; otherwise drag just the clicked node (single-select fallback).
      const set = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id];
      const origin = movingSetFor(doc, set);
      const start = pointerInCanvas(e.clientX, e.clientY);
      // Three-way entry (T13): the rotate grip starts a rotation session
      // around the frame center; resize and move keep their existing entries.
      const session = handle === "rot" ? startRotate(origin, start) : handle ? startResize(origin, start, handle) : startMove(origin, start);
      drag.begin(session);
    },
    [doc, drag, pointerInCanvas, selectedIds],
  );

  /**
   * Drag-to-pin entry (Task 4): the grabbed top-level flow node is NOT in the
   * doc's pin layer yet — the transient drag runs off its measured rect and
   * the pin lands in the same applyOp as the move (single undo step).
   */
  const beginFlowDrag = useCallback(
    (id: string, e: ReactPointerEvent<HTMLElement>) => {
      const rect = flowRects.get(id);
      if (!rect || (rect.w === 0 && rect.h === 0)) return;
      capturePointer(e.currentTarget, e.pointerId);
      pinPlanRef.current = { id, rect };
      const origin = new Map([[id, { ...rect, rotation: 0 }]]);
      drag.begin(startMove(origin, pointerInCanvas(e.clientX, e.clientY)));
    },
    [drag, flowRects, pointerInCanvas],
  );

  const { onKeyDown, onKeyUp } = useCanvasKeyboard({
    doc,
    selectedId,
    selectedIds,
    applyOp,
    selectNodes,
    onSelect,
    drag,
    panPhase: pan.phase,
    setSpaceHeld,
    flowRects,
  });

  const marqueeRect = useMemo(() => {
    if (pan.phase !== "marquee") return null;
    return {
      x: Math.min(pan.start.x, pan.current.x),
      y: Math.min(pan.start.y, pan.current.y),
      w: Math.abs(pan.current.x - pan.start.x),
      h: Math.abs(pan.current.y - pan.start.y),
    };
  }, [pan]);

  const pageScreen = canvasToScreen({ x: page.x, y: page.y }, viewport);

  /** Single flow selection (page-space, measured); multi-select has no box yet. */
  const flowSelection = useMemo(() => {
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    if (ids.length !== 1) return null;
    const id = ids[0]!;
    if (!isFlowNode(doc, id) || hasPinnedAncestor(doc, id)) return null;
    const rect = flowRects.get(id);
    if (!rect || (rect.w === 0 && rect.h === 0)) return null;
    // T8 dropped the "cannot drag out" lock: every selectable flow node (the
    // filters above already exclude pin boxes and pinned-ancestor subtrees)
    // can now leave the flow, and the root itself was never badge-locked —
    // so no flow selection carries the lock badge anymore.
    return { id, rect, locked: false };
  }, [doc, selectedId, selectedIds, flowRects]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-rail">
      <div
        ref={surfaceRef}
        role="application"
        aria-label="画布"
        tabIndex={0}
        data-testid="canvas-surface"
        className="h-full w-full outline-none focus-visible:outline-2"
        style={{ cursor: spaceHeld || pan.phase === "pan" ? "grab" : pan.phase === "marquee" ? "crosshair" : "default" }}
        onWheel={onWheel}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={onSurfacePointerCancel}
        onKeyUp={onKeyUp}
        onKeyDown={onKeyDown}
      >
        <CanvasStage
          doc={doc}
          tokens={tokens}
          pageScreen={pageScreen}
          viewport={viewport}
          pageSize={{ w: page.w, h: page.h }}
          flowRects={flowRects}
          pointInCanvas={pointerInCanvas}
          onSelect={(id) => onSelect(id)}
          flowLayerRef={flowLayerRef}
          onFlowDragStart={beginFlowDrag}
          pinned={pinned}
          selectedId={selectedId}
          selectedIds={selectedIds}
          selectNodes={selectNodes}
          onNodeDragStart={beginNodeDrag}
          pinDragBox={pinDragBox}
          flowSelection={flowSelection}
          marquee={marqueeRect}
          guides={drag.state?.guides ?? []}
        />
      </div>
      {align.visible && <AlignBar {...align} />}
      {/* U7: top-right floating AI image entry (or its 501 sticky notice). */}
      <ImageGenPopover api={imageGen} />
      <CanvasToolbar
        zoom={viewport.zoom}
        onZoomDelta={(f) => {
          const rect = surfaceRef.current?.getBoundingClientRect();
          zoomAtCursor(rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 }, f);
        }}
        onFit={() => {
          const rect = surfaceRef.current?.getBoundingClientRect();
          if (rect) fitToRect(page, { w: rect.width, h: rect.height }, FIT_PADDING);
        }}
        onReset={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
        relayoutArmed={relayout.armed}
        onRelayout={relayout.request}
      />
    </div>
  );
}

/** Marquee release: a real sweep selects; a bare click already cleared selection. */
function finishMarquee(
  pan: PanState,
  end: { x: number; y: number },
  shiftKey: boolean,
  doc: Page,
  flowRects: FlowRectMap,
  selectedIds: string[],
  selectNodes: (ids: string[]) => void,
  onSelect: (id: string | null) => void,
): void {
  const a = pan.start;
  const sel: Rect = { x: Math.min(a.x, end.x), y: Math.min(a.y, end.y), w: Math.abs(end.x - a.x), h: Math.abs(end.y - a.y) };
  if (sel.w <= 2 && sel.h <= 2) return;
  // Pinned nodes hit by frame; flow nodes hit by their measured DOM rects.
  // schema-core marquee scans every frame — legacy frames on FLOW nodes are
  // inert, so restrict the frame side to pinned ids (phantom positions must
  // never select). Pinned ids are likewise filtered out of the flow side.
  const frameHits = marqueeSelect(doc, sel).filter((id) => !isFlowNode(doc, id));
  const flowIds = new Set(flowHits(flowRects, sel).filter((id) => isFlowNode(doc, id) && !hasPinnedAncestor(doc, id)));
  const hits = [...new Set([...frameHits, ...flowIds])];
  if (hits.length > 0) {
    // selectNodes already syncs selectedId (last hit). Calling the single-id
    // onSelect here would run App.handleSelect -> selectNode(id), clobbering
    // the multi-select back to one node.
    if (shiftKey) {
      selectNodes([...new Set([...selectedIds, ...hits])]);
    } else {
      selectNodes(hits);
    }
    return;
  }
  if (!shiftKey) {
    selectNodes([]);
    onSelect(null);
  }
}

/**
 * Empty-canvas check for a surface click: any pinned frame OR any measured
 * flow rect under the point counts as content (a flow-only document fills the
 * page top, so clicks inside it must not clear the selection).
 */
function canvasHit(doc: Page, flowRects: FlowRectMap, pt: { x: number; y: number }): boolean {
  const probe: Rect = { x: pt.x, y: pt.y, w: 1, h: 1 };
  if (marqueeSelect(doc, probe).some((id) => !isFlowNode(doc, id))) return true;
  return flowHits(flowRects, probe).some((id) => isFlowNode(doc, id) && !hasPinnedAncestor(doc, id));
}
