import type { Frame, Page, SnapGuide } from "@studio/schema-core";
import { useCallback, useState } from "react";
import { advance, commitFrames, type DragStart } from "./canvasDrag";
import { clampInsidePage, recompute, screenThreshold } from "./useSnap";
import type { MovingSet } from "./useSnap";

/**
 * Frame drag/resize state machine (P5-2), lifted out of CanvasSurface to keep
 * both files small. During a gesture ONLY transient React state updates —
 * nothing reaches editorStore — so one gesture never pushes partial undo
 * entries. On pointerup the whole gesture commits as ONE applyOp.
 */

export type DragPhase = "idle" | "dragging";

export interface DragState {
  session: DragStart;
  /** Transient frames of the moving set (snapped + clamped). */
  moving: MovingSet;
  /** Snap delta applied this sample (kept for debugging/tests). */
  dx: number;
  dy: number;
  /** Guide lines to render while snapped (Figma red-magenta dashed). */
  guides: SnapGuide[];
}

export interface CanvasDragApi {
  phase: DragPhase;
  state: DragState | null;
  begin: (session: DragStart) => void;
  /**
   * Feed a pointer sample (canvas px). Applies snap + page clamp and stores
   * the transient frames; returns nothing — the caller re-renders from state.
   */
  move: (current: { x: number; y: number }, mods: { shiftKey: boolean; altKey: boolean }, zoom: number) => void;
  /**
   * End the gesture: returns the frames to commit (unchanged frames already
   * filtered out), or an empty map when the pointer never moved (click).
   */
  end: (doc: Page) => Map<string, Frame>;
  /** Abort without committing (e.g. Escape). */
  cancel: () => void;
}

export interface UseCanvasDragArgs {
  doc: Page;
  /** Page bounds for clamping (frameRects outside the page shrink to fit). */
  page: { x: number; y: number; w: number; h: number };
}

export function useCanvasDrag({ doc, page }: UseCanvasDragArgs): CanvasDragApi {
  const [state, setState] = useState<DragState | null>(null);

  const begin = useCallback((session: DragStart) => {
    setState({ session, moving: session.origin, dx: 0, dy: 0, guides: [] });
  }, []);

  const move = useCallback(
    (current: { x: number; y: number }, mods: { shiftKey: boolean; altKey: boolean }, zoom: number) => {
      setState((prev) => {
        if (!prev) return prev;
        const out = advance(prev.session, { current, shiftKey: mods.shiftKey, altKey: mods.altKey });
        // Rotate skips snap + page clamp entirely (T13): a rotation sample
        // never changes x/y/w/h, so snapping/clamping is meaningless on it.
        if (prev.session.kind === "rotate") {
          return { ...prev, moving: out.moving, dx: 0, dy: 0, guides: [] };
        }
        const snapped = snapMoving(doc, out.moving, zoom, page);
        return { ...prev, moving: snapped.moving, dx: snapped.dx, dy: snapped.dy, guides: snapped.guides };
      });
    },
    [doc, page],
  );

  const end = useCallback(
    (currentDoc: Page) => {
      const result = state ? commitFrames(currentDoc, state.moving) : new Map<string, Frame>();
      setState(null);
      return result;
    },
    [state],
  );

  const cancel = useCallback(() => setState(null), []);

  return {
    phase: state ? "dragging" : "idle",
    state,
    begin,
    move,
    end,
    cancel,
  };
}

/** Apply snap correction + page clamping to a computed moving set. */
function snapMoving(
  doc: Page,
  moving: MovingSet,
  zoom: number,
  page: { x: number; y: number; w: number; h: number },
): { moving: MovingSet; dx: number; dy: number; guides: SnapGuide[] } {
  const threshold = screenThreshold(zoom);
  const snap = recompute(doc, moving, threshold);
  const next: MovingSet = new Map();
  for (const [id, frame] of moving) {
    // T20: clampInsidePage keeps at least MIN_VISIBLE px of every frame inside
    // the slide so a user can't drag a node fully outside the canvas.
    next.set(id, clampInsidePage({ ...frame, x: frame.x + snap.dx, y: frame.y + snap.dy }, page));
  }
  return { moving: next, dx: snap.dx, dy: snap.dy, guides: snap.guides };
}
