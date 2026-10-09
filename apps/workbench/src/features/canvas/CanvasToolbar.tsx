import { MIN_ZOOM, MAX_ZOOM, clampZoom } from "./canvasGeometry";

/**
 * Floating canvas toolbar (P5-2): zoom % readout, zoom out/in, fit-to-canvas,
 * reset, plus the "重排画布" re-layout action (P5-2 fix). Pure presentational —
 * CanvasSurface owns the viewport state and the confirm arming.
 */

export interface CanvasToolbarProps {
  zoom: number;
  onZoomDelta: (factor: number) => void;
  onFit: () => void;
  onReset: () => void;
  /** True while 重排画布 waits for its confirming second click. */
  relayoutArmed: boolean;
  onRelayout: () => void;
}

const RELAYOUT_HINT =
  "清除全部自由定位（pin）与遗留坐标（frame），整页回到流式布局（可 Ctrl+Z 一步撤销）。";

export function CanvasToolbar({ zoom, onZoomDelta, onFit, onReset, relayoutArmed, onRelayout }: CanvasToolbarProps) {
  const pct = Math.round(zoom * 100);
  const atMin = zoom <= MIN_ZOOM + 1e-9;
  const atMax = zoom >= MAX_ZOOM - 1e-9;
  return (
    <div
      role="toolbar"
      aria-label="画布工具"
      data-testid="canvas-toolbar"
      className="absolute bottom-4 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1 rounded-md border border-hairline bg-overlay p-0.5 shadow-pop"
    >
      <button
        type="button"
        aria-label="缩小"
        disabled={atMin}
        onClick={() => onZoomDelta(1 / 1.2)}
        className="h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface disabled:opacity-40"
      >
        −
      </button>
      <span data-testid="canvas-zoom" className="min-w-11 text-center text-xs tabular-nums text-ink">
        {pct}%
      </span>
      <button
        type="button"
        aria-label="放大"
        disabled={atMax}
        onClick={() => onZoomDelta(1.2)}
        className="h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface disabled:opacity-40"
      >
        +
      </button>
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />
      <button
        type="button"
        onClick={onFit}
        title="缩放以适应页面"
        className="h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface"
      >
        适应
      </button>
      <button
        type="button"
        onClick={() => onZoomDelta(clampZoom(1) / zoom)}
        title="缩放至 100%"
        className="h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface"
      >
        100%
      </button>
      <button
        type="button"
        onClick={onReset}
        title="重置视口（100% 并回到原点）"
        className="h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface"
      >
        重置
      </button>
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />
      <button
        type="button"
        data-testid="canvas-relayout"
        data-armed={relayoutArmed ? "true" : undefined}
        aria-pressed={relayoutArmed}
        onClick={onRelayout}
        title={relayoutArmed ? "再点一次确认重排（清除全部自由定位，可撤销）" : RELAYOUT_HINT}
        className={
          relayoutArmed
            ? "h-7 rounded bg-warn-soft px-2 text-xs font-medium text-warn ring-1 ring-warn/40"
            : "h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface"
        }
      >
        {relayoutArmed ? "确认重排？" : "重排画布"}
      </button>
    </div>
  );
}
