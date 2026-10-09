import type { Frame, Page, Tokens } from "@studio/schema-core";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Handle } from "./canvasGeometry";
import { NodeFrameBox } from "./NodeFrameBox";

/**
 * Pin layer (Plan C): every pin-box node (`pinned && frame`, z-ordered) as an
 * absolute NodeFrameBox in page space, plus the transient drag-to-pin ghost on
 * top during a flow drag. Renders INSIDE the zoomed content layer, so frames
 * are page-space px with no zoom math of their own. Pure composition —
 * CanvasSurface owns selection/drag state and feeds it in as props.
 */

export interface PinnedFrameLayerProps {
  doc: Page;
  /** Document-level tokens (T19): threaded down to subtree renderers. */
  tokens: Tokens;
  /** Z-ordered pinned boxes (pinned && frame). */
  pinned: { id: string; frame: Frame }[];
  selectedId: string | null;
  selectedIds: string[];
  /** Single-id select callback — same one pin boxes and flow nodes call. */
  onSelect: (id: string) => void;
  selectNodes: (ids: string[]) => void;
  /** Pinned-box drag/resize entry (handle null = move). */
  onNodeDragStart: (id: string, handle: Handle | null, e: ReactPointerEvent<HTMLElement>) => void;
  /** Transient drag-to-pin box (page-space frame), null when not dragging. */
  pinDragBox: { id: string; frame: Frame | undefined } | null;
}

/** A pin box's selection/onSelect wiring (multi-select additive semantics). */
function pinSelectHandler(
  nodeId: string,
  additive: boolean,
  selectedIds: string[],
  selectNodes: (ids: string[]) => void,
  onSelect: (id: string) => void,
): void {
  if (additive) {
    const next = selectedIds.includes(nodeId) ? selectedIds.filter((x) => x !== nodeId) : [...selectedIds, nodeId];
    // selectNodes syncs selectedId; the single-id onSelect would clobber the
    // additive set back to one node.
    selectNodes(next);
    return;
  }
  selectNodes([nodeId]);
  onSelect(nodeId);
}

export function PinnedFrameLayer({
  doc,
  tokens,
  pinned,
  selectedId,
  selectedIds,
  onSelect,
  selectNodes,
  onNodeDragStart,
  pinDragBox,
}: PinnedFrameLayerProps) {
  return (
    <>
      {pinned.map(({ id, frame }) => (
        <NodeFrameBox
          key={id}
          doc={doc}
          tokens={tokens}
          nodeId={id}
          frame={frame}
          selected={selectedIds.length > 1 ? selectedIds.includes(id) : id === selectedId}
          onSelect={(nodeId, additive) => pinSelectHandler(nodeId, additive, selectedIds, selectNodes, onSelect)}
          onDragStart={onNodeDragStart}
        />
      ))}
      {/* Transient drag-to-pin box: top of the pin layer, follows the pointer;
          unmounts on pointerup/pointercancel (drag.state → null). */}
      {pinDragBox?.frame && (
        <NodeFrameBox doc={doc} tokens={tokens} nodeId={pinDragBox.id} frame={pinDragBox.frame} selected onSelect={() => {}} onDragStart={() => {}} />
      )}
    </>
  );
}
