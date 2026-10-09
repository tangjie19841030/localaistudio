import { useCallback, useRef, useState, type ReactNode } from "react";

export interface PanelResizerProps {
  side: "left" | "right";
  /** Controlled width in px. */
  width: number;
  minWidth?: number;
  maxWidth?: number;
  onWidth: (w: number) => void;
  label?: string;
}

/**
 * Vertical drag handle for side rails. 4px hit strip with a hover groove —
 * familiar Figma/VS Code affordance without stealing layout width.
 */
export function PanelResizer({
  side,
  width,
  minWidth = 200,
  maxWidth = 420,
  onWidth,
  label = "调整面板宽度",
}: PanelResizerProps) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = side === "left" ? e.clientX - d.x : d.x - e.clientX;
    onWidth(Math.min(maxWidth, Math.max(minWidth, d.w + delta)));
  };
  const onUp = () => {
    drag.current = null;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className={`group relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent ${
        side === "left" ? "-mr-1" : "-ml-1"
      }`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent"
      />
    </div>
  );
}

/** Persist side rail width for the session (not across reloads). */
export function usePanelWidth(key: string, initial: number): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    const raw = sessionStorage.getItem(`studio-panel-${key}`);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : initial;
  });
  const set = useCallback(
    (w: number) => {
      setWidth(w);
      sessionStorage.setItem(`studio-panel-${key}`, String(Math.round(w)));
    },
    [key],
  );
  return [width, set];
}

export function SideRail({
  side,
  width,
  onWidth,
  ariaLabel,
  children,
}: {
  side: "left" | "right";
  width: number;
  onWidth: (w: number) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      {side === "left" && (
        <aside
          aria-label={ariaLabel}
          className="flex shrink-0 flex-col border-r border-hairline bg-rail text-sm"
          style={{ width }}
        >
          {children}
        </aside>
      )}
      <PanelResizer side={side} width={width} onWidth={onWidth} />
      {side === "right" && (
        <aside
          aria-label={ariaLabel}
          className="flex shrink-0 flex-col overflow-hidden border-l border-hairline bg-rail text-sm"
          style={{ width }}
        >
          {children}
        </aside>
      )}
    </>
  );
}
