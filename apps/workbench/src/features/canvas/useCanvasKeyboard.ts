import type { Page } from "@studio/schema-core";
import { moveNode, pin, removeNode, replacePage, setFrame } from "@studio/schema-core";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ApplyOp } from "./canvasCommit";
import { groupNodes, refreshGroupFrames, ungroupNode } from "./canvasGroupOps";
import type { FlowRectMap } from "./flowMeasure";
import type { PanPhase } from "./canvasPan";
import { flowDragCandidate, hasPinnedAncestor, isPinBox, isRootChild, withPinDescendants } from "./flowNodes";
import type { useCanvasDrag } from "./useCanvasDrag";
import { useEditorStore } from "../../state/editorStore";

/**
 * Canvas keyboard handling (P5-2), lifted out of CanvasSurface: space = pan
 * modifier, Escape aborts an in-flight drag, Delete removes the selection,
 * Ctrl/Cmd+G groups (Shift ungroups, T13) and arrows nudge frames by 1px
 * (shift = 10px).
 *
 * Held-arrow coalescing (P5 known limitation): rapid nudges inside one burst
 * window merge into a single undo entry, so key-repeat cannot flood the stack.
 */

export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;
export const NUDGE_COALESCE_MS = 400;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Module-level so repeated keypresses (not re-rendered) share one burst window. */
let nudgeBurst: { active: boolean; startedAt: number } = { active: false, startedAt: 0 };

/** Test seam: clear the burst window so tests do not leak state into each other. */
export function resetNudgeWindow(): void {
  nudgeBurst = { active: false, startedAt: 0 };
}

/**
 * Merge held-arrow nudges into one undo entry: drop the intermediate past
 * snapshot so the next undo jumps back to the start of the burst.
 */
export function coalesceUndo(store: typeof useEditorStore): void {
  const { undoStack } = store.getState();
  if (undoStack.past.length < 2) return;
  const past = undoStack.past.slice(0, -1);
  store.setState({
    undoStack: { past, future: undoStack.future },
    canUndo: past.length > 0,
  });
}

/** Pure nudge step for one arrow key: null when the key is not an arrow. */
export function nudgeSteps(key: string, shiftKey: boolean): { step: number; stepY: number } | null {
  const dir = ARROWS[key];
  if (!dir) return null;
  const unit = shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
  return { step: unit * dir[0], stepY: unit * dir[1] };
}

/**
 * Nudge-to-pin (Task 4, widened T8): a flow node is first pinned at its
 * measured flow rect, then the step applies to the fresh frame. A NESTED flow
 * node is promoted to the root before pinning, the same algebra as commitDrag's
 * nested drag-out, so the pin layer stays page-level (T8: the old deep-node
 * no-op R7 is gone). The root itself and nodes under a pin-box ancestor stay
 * no-op. Unmeasured (jsdom without injected rects) also no-ops — no rect to
 * pin at. Pin-box ids arrive pre-expanded with their pin-box descendants
 * (withPinDescendants, T13 group carry), so every listed pin box shifts by the
 * same step; group ancestors of every moved id are refreshed in the same op.
 */
function pinAndNudge(doc: Page, ids: readonly string[], step: number, stepY: number, flowRects?: FlowRectMap): Page {
  let next = doc;
  const moved: string[] = [];
  for (const nid of ids) {
    const n = next.nodes.find((x) => x.id === nid);
    if (!n) continue;
    if (isPinBox(n)) {
      next = setFrame(next, nid, { ...n.frame!, x: n.frame!.x + step, y: n.frame!.y + stepY });
      moved.push(nid);
      continue;
    }
    if (nid === next.rootId || hasPinnedAncestor(next, nid)) continue;
    const rect = flowRects?.get(nid);
    if (!rect || (rect.w === 0 && rect.h === 0)) continue;
    // T8 nested drag-out parity: promote to the root FIRST, then pin —
    // pin() never re-parents and a pinned node under a flow parent would
    // break the pin layer's page-level invariant.
    if (!isRootChild(next, nid)) next = moveNode(next, nid, next.rootId);
    next = pin(next, nid, { x: rect.x + step, y: rect.y + stepY, w: rect.w, h: rect.h, rotation: 0 });
    moved.push(nid);
  }
  // Group frames are derived values (T13): refresh group ancestors of every
  // moved id inside the same op (design §3.5 / risk R3).
  return refreshGroupFrames(next, moved);
}

/**
 * Ctrl/Cmd+G group / Ctrl/Cmd+Shift+G ungroup (T13 §3.6). Same contract as the
 * AlignBar handlers: one applyOp per action, selection follows the result
 * (the minted group id / the lifted members). Unmet preconditions → silent
 * no-op (the AlignBar buttons are disabled for the same cases).
 */
function handleGroupChord(
  doc: Page,
  ids: readonly string[],
  ungroup: boolean,
  applyOp: ApplyOp,
  selectNodes: (ids: string[]) => void,
): void {
  if (ungroup) {
    const single = ids.length === 1 ? ids[0]! : null;
    if (!single) return;
    const members = doc.nodes.find((n) => n.id === single)?.children ?? [];
    const next = ungroupNode(doc, single);
    if (!next) return;
    applyOp((d) => replacePage(d, next.id, next));
    selectNodes([...members]);
    return;
  }
  const roots = ids.filter((id) => isRootChild(doc, id) && isPinBox(doc.nodes.find((n) => n.id === id)));
  if (roots.length < 2) return;
  const grouped = groupNodes(doc, roots);
  if (!grouped) return;
  applyOp((d) => replacePage(d, grouped.doc.id, grouped.doc));
  selectNodes([grouped.groupId]);
}

/** Nudge entry: held-arrow bursts coalesce into one undo entry (P5). */
function handleNudge(
  ids: readonly string[],
  dir: { step: number; stepY: number },
  doc: Page,
  flowRects: FlowRectMap | undefined,
  applyOp: ApplyOp,
): void {
  const now = Date.now();
  if (nudgeBurst.active && now - nudgeBurst.startedAt < NUDGE_COALESCE_MS) {
    applyOp((d) => { const page0 = d.pages[0]!; return replacePage(d, page0.id, pinAndNudge(page0, ids, dir.step, dir.stepY, flowRects)); });
    // Squash the extra undo entries into the first of this burst.
    coalesceUndo(useEditorStore);
    return;
  }
  nudgeBurst = { active: true, startedAt: now };
  applyOp((d) => { const page0 = d.pages[0]!; return replacePage(d, page0.id, pinAndNudge(page0, ids, dir.step, dir.stepY, flowRects)); });
}

export interface CanvasKeyboardArgs {
  doc: Page;
  selectedId: string | null;
  selectedIds: string[];
  applyOp: ApplyOp;
  selectNodes: (ids: string[]) => void;
  onSelect: (id: string | null) => void;
  drag: ReturnType<typeof useCanvasDrag>;
  panPhase: PanPhase;
  /** Space down/up toggles the pan modifier (owned by CanvasSurface state). */
  setSpaceHeld: (held: boolean) => void;
  /** Measured flow rects — the pin target for a top-level flow nudge (Task 4). */
  flowRects?: FlowRectMap;
}

/** Builds the surface's onKeyDown/onKeyUp; behavior matches the previous inline version. */
export function useCanvasKeyboard(args: CanvasKeyboardArgs) {
  const { doc, selectedId, selectedIds, applyOp, selectNodes, onSelect, drag, panPhase, setSpaceHeld, flowRects } = args;

  const onKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") setSpaceHeld(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") {
      setSpaceHeld(true);
      e.preventDefault();
      return;
    }
    // Escape aborts an in-flight drag (Figma parity): transient frames are
    // discarded, nothing commits. Consumed ONLY while dragging — an idle
    // Escape stays untouched (closes menus etc. elsewhere in the app).
    if (e.key === "Escape" && drag.phase === "dragging") {
      e.preventDefault();
      drag.cancel();
      return;
    }
    // No keyboard ops while a pointer gesture is active (would fight the drag).
    if (drag.phase === "dragging" || panPhase !== "idle") return;
    if (!selectedId) return;
    const node = doc.nodes.find((n) => n.id === selectedId);
    if (!node) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const targets = selectedIds.length > 0 ? selectedIds : [selectedId];
      applyOp((d) => {
        const page0 = d.pages[0]!;
        let next = page0;
        for (const tid of targets) next = removeNode(next, tid);
        return replacePage(d, page0.id, next);
      });
      selectNodes([]);
      onSelect(null);
      return;
    }
    // Ctrl/Cmd+G group / Ctrl/Cmd+Shift+G ungroup (T13; no window-level
    // Ctrl+G conflict). Same in-gesture guard as every branch above.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
      e.preventDefault();
      handleGroupChord(doc, selectedIds.length > 0 ? selectedIds : [selectedId], e.shiftKey, applyOp, selectNodes);
      return;
    }
    // Nudge semantics (Task 4 + T8 + T13): pin boxes move their frame and
    // carry their pin-box descendants (group carry); any flow node the
    // drag-out gate admits pins at its measured rect and moves in the same
    // op — nested ones are promoted to the root first, matching commitDrag.
    const dir = nudgeSteps(e.key, e.shiftKey);
    if (!dir) return;
    if (!isPinBox(node) && !flowDragCandidate(doc, selectedId)) return;
    e.preventDefault();
    const nudgeIds = withPinDescendants(doc, selectedIds.length > 0 ? selectedIds : [selectedId]);
    handleNudge(nudgeIds, dir, doc, flowRects, applyOp);
  };

  return { onKeyDown, onKeyUp };
}
