import { useCallback, useMemo, useState } from "react";
import {
  fitViewport,
  panBy,
  zoomAt,
  type CanvasRect,
  type CanvasViewport,
} from "./canvasGeometry";

/**
 * Zoom/pan state hook for the canvas surface (P5-2). All math lives in
 * canvasGeometry; this hook only owns the state and exposes setters.
 * The viewport is UI-local: it is intentionally NOT in editorStore —
 * zoom/pan must never create undo entries.
 */

export interface UseCanvasViewport {
  viewport: CanvasViewport;
  /** Anchored zoom: the canvas point under the cursor stays fixed. */
  zoomAtCursor: (cursor: { x: number; y: number }, factor: number) => void;
  /** Pan by screen px (space-drag / middle-mouse / shift+wheel). */
  panByDelta: (dx: number, dy: number) => void;
  /** Jump to an exact viewport (e.g. "reset" restoring zoom 1, pan 0). */
  setViewport: (vp: CanvasViewport) => void;
  /** Fit the page into the viewport rect, centered ("适应画布"). */
  fitToRect: (page: CanvasRect, view: { w: number; h: number }, padding: number) => void;
}

export const INITIAL_VIEWPORT: CanvasViewport = { zoom: 1, panX: 0, panY: 0 };

export function useCanvasViewport(): UseCanvasViewport {
  const [viewport, setViewport] = useState<CanvasViewport>(INITIAL_VIEWPORT);

  const zoomAtCursor = useCallback((cursor: { x: number; y: number }, factor: number) => {
    setViewport((vp) => zoomAt(cursor, vp, factor));
  }, []);

  const panByDelta = useCallback((dx: number, dy: number) => {
    setViewport((vp) => panBy(vp, dx, dy));
  }, []);

  const fitToRect = useCallback((page: CanvasRect, view: { w: number; h: number }, padding: number) => {
    setViewport(fitViewport(page, view, padding));
  }, []);

  return useMemo(
    () => ({ viewport, zoomAtCursor, panByDelta, setViewport, fitToRect }),
    [viewport, zoomAtCursor, panByDelta, fitToRect],
  );
}
