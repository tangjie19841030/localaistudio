import type { Frame, Page, Tokens } from "@studio/schema-core";
import { getNode } from "@studio/schema-core";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useRef } from "react";
import { HANDLES, type Handle } from "./canvasGeometry";
import { rotateEligible } from "./canvasGroupOps";
import { NodeSubtree } from "./NodeSubtree";
import { capturePointer } from "./pointerCapture";
import { useElementOverflow } from "./useOverflow";
import { useEditorStore } from "../../state/editorStore";

/**
 * One frame-bearing node on the canvas: an absolutely positioned box at the
 * node's frame, containing the node's subtree rendered by the same kit
 * components the flow preview uses (NodeSubtree), so canvas visuals stay
 * consistent with schema preview.
 *
 * The frame is a HARD box: content is clipped (overflow hidden) so an
 * undersized frame can never paint over its siblings. Content that does not
 * fit is surfaced with an amber overflow badge + tinted border instead of
 * silent spill (data-overflow="true" on the box for tests).
 *
 * Interaction is delegated: pointerdown reports the grabbed node/handle to
 * CanvasSurface, which owns the drag session, pointer capture and the single
 * commit. This keeps this component a thin presentational shell.
 */

export interface NodeFrameBoxProps {
  doc: Page;
  tokens: Tokens;
  nodeId: string;
  /** Transient frame during a drag; the committed doc frame otherwise. */
  frame: Frame;
  selected: boolean;
  /** Resizing only shows handles on the selected box (Figma behavior). */
  onSelect: (id: string, additive: boolean) => void;
  /** handle=null → body (move); handle → resize from that grip. */
  onDragStart: (id: string, handle: Handle | null, e: ReactPointerEvent<HTMLElement>) => void;
}

/** Handle grip positions (percent offsets) for the 8 directions + rotate grip. */
const HANDLE_POS: Record<Handle, CSSProperties> = {
  nw: { top: -4, left: -4 },
  n: { top: -4, left: "50%", marginLeft: -3 },
  ne: { top: -4, right: -4 },
  e: { top: "50%", right: -4, marginTop: -3 },
  se: { bottom: -4, right: -4 },
  s: { bottom: -4, left: "50%", marginLeft: -3 },
  sw: { bottom: -4, left: -4 },
  w: { top: "50%", left: -4, marginTop: -3 },
  rot: { top: -28, left: "50%", marginLeft: -5 },
};

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  rot: "grab",
};

function boxStyle(frame: Frame): CSSProperties {
  return {
    position: "absolute",
    left: frame.x,
    top: frame.y,
    width: frame.w,
    height: frame.h,
    ...(frame.rotation
      ? { transform: `rotate(${frame.rotation}deg)`, transformOrigin: "center center" }
      : {}),
  };
}

/** Shared grip visuals: resize grips are 8px squares, the rotate grip a 10px dot. */
function gripStyle(pos: CSSProperties, cursor: string, round: boolean): CSSProperties {
  return {
    position: "absolute",
    width: round ? 10 : 8,
    height: round ? 10 : 8,
    background: "#ffffff",
    border: "1.5px solid #5e6ad2",
    borderRadius: round ? "50%" : 2,
    cursor,
    boxShadow: "0 1px 2px rgb(0 0 0 / 0.25)",
    ...pos,
  };
}

/** Amber overflow ring + badge (module helper keeps the component body thin). */
function overflowBadge(): ReactNode {
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="canvas-frame-overflow"
        title="内容超出当前 frame，已裁剪——可拖拽手柄放大或点击「重排画布」重新排版"
        className="pointer-events-none absolute -inset-px rounded-[2px] ring-2 ring-warn"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-2 -right-2 rounded-sm bg-warn px-1 text-[10px] font-semibold leading-4 text-canvas shadow-card"
      >
        溢出
      </span>
    </>
  );
}

/**
 * Selection chrome: accent outline, the 8 resize grips, and — single-selected
 * AND rotate-eligible only — the rotate grip (module helper keeps the component
 * body thin).
 */
function selectionChrome(
  nodeId: string,
  doc: Page,
  selected: boolean,
  soleSelected: boolean,
  handleDown: (handle: Handle) => (e: ReactPointerEvent<HTMLDivElement>) => void,
): ReactNode {
  if (!selected) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px rounded-[2px] ring-2 ring-accent"
        data-testid="canvas-frame-outline"
      />
      {HANDLES.map((h) => (
        <div
          key={h}
          role="presentation"
          aria-hidden="true"
          data-handle={h}
          onPointerDown={handleDown(h)}
          style={gripStyle(HANDLE_POS[h], HANDLE_CURSOR[h], false)}
        />
      ))}
      {soleSelected && rotateEligible(doc, nodeId) && (
        // Rotate grip (T13): the ROUND handle floats above the box and the box
        // transform rotates it along. Own marker attribute — the 8 resize grips
        // keep their data-handle contract. Eligibility excludes groups / pin-box
        // parents: codegen nests pinned descendants INSIDE the rotated parent,
        // so a rotated canvas pin layer would fork from the export (three-view
        // parity hard line, design §3.4).
        <div
          role="presentation"
          aria-hidden="true"
          data-rot-handle={nodeId}
          onPointerDown={handleDown("rot")}
          style={gripStyle(HANDLE_POS.rot, HANDLE_CURSOR.rot, true)}
        />
      )}
    </>
  );
}

export function NodeFrameBox({ doc, tokens, nodeId, frame, selected, onSelect, onDragStart }: NodeFrameBoxProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  // Re-measure when the box geometry or the rendered node changes.
  const overflowing = useElementOverflow(contentRef, [nodeId, frame.w, frame.h, doc]);
  // Rotate grip is a single-selection affordance (multi-select shows resize
  // grips only). Read from the store: a prop chain would touch the zero-change
  // layer files (CanvasStage/CanvasContentLayer/PinnedFrameLayer, design §6).
  const soleSelected = useEditorStore((s) => s.selectedIds.length <= 1);
  const node = getNode(doc, nodeId);
  if (!node) return null;

  const handleDown = (handle: Handle) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    capturePointer(e.currentTarget, e.pointerId);
    onDragStart(nodeId, handle, e);
  };

  const bodyDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // jsdom does not populate `button` on synthetic pointer events; treat
    // undefined as primary so wiring tests work, real browsers unaffected.
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    onSelect(nodeId, e.shiftKey);
    onDragStart(nodeId, null, e);
  };

  return (
    <div
      data-frame-id={nodeId}
      data-testid={`canvas-frame-${nodeId}`}
      data-overflow={overflowing ? "true" : undefined}
      style={boxStyle(frame)}
      className="group"
      onPointerDown={bodyDown}
    >
      {/* HARD box: the frame is the layout truth, content is clipped — overflow
          is surfaced by the badge below instead of spilling over siblings. */}
      <div ref={contentRef} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        <NodeSubtree doc={doc} tokens={tokens} nodeId={nodeId} />
      </div>
      {overflowing && overflowBadge()}
      {selectionChrome(nodeId, doc, selected, soleSelected, handleDown)}
    </div>
  );
}
