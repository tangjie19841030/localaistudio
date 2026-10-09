import type { SnapGuide } from "@studio/schema-core";
import { useMemo } from "react";
import { canvasToScreen, type CanvasViewport } from "./canvasGeometry";

/**
 * Decorative overlay layer rendered ABOVE the page in canvas mode (P5-2):
 * - snap guide lines (red-magenta dashed, Figma convention) during a drag,
 * - the marquee rect while rubber-band selecting.
 * Pure rendering: no state, no events — CanvasSurface feeds it geometry.
 */

const GUIDE_COLOR = "#f24e1e";

export interface CanvasOverlayProps {
  viewport: CanvasViewport;
  /** Active snap guides in canvas/page space; empty when nothing snaps. */
  guides: readonly SnapGuide[];
  /** Marquee rect in canvas/page space; null when not rubber-band selecting. */
  marquee: { x: number; y: number; w: number; h: number } | null;
}

function guideStyle(guide: SnapGuide, viewport: CanvasViewport): { left: number; top: number; width: number; height: number } {
  const a = canvasToScreen({ x: guide.from, y: guide.at }, viewport);
  const b = canvasToScreen({ x: guide.to, y: guide.at }, viewport);
  if (guide.axis === "x") {
    // vertical line at x = at, spanning from..to (y axis values)
    return { left: a.x, top: a.y, width: 0, height: b.y - a.y };
  }
  // horizontal line at y = at, spanning from..to (x axis values)
  return { left: a.x, top: a.y, width: b.x - a.x, height: 0 };
}

export function CanvasOverlay({ viewport, guides, marquee }: CanvasOverlayProps) {
  const guideLines = useMemo(
    () => guides.map((g, i) => ({ key: `${g.axis}-${g.at}-${i}`, style: guideStyle(g, viewport) })),
    [guides, viewport],
  );
  const marqueeScreen = marquee ? canvasToScreen({ x: marquee.x, y: marquee.y }, viewport) : null;
  const marqueeW = marquee ? marquee.w * viewport.zoom : 0;
  const marqueeH = marquee ? marquee.h * viewport.zoom : 0;

  return (
    <div data-testid="canvas-overlay" aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {guideLines.map((line) => (
        <div
          key={line.key}
          data-testid="canvas-guide"
          className="absolute"
          style={{
            ...line.style,
            borderLeft: line.style.width === 0 ? `1px dashed ${GUIDE_COLOR}` : undefined,
            borderTop: line.style.height === 0 ? `1px dashed ${GUIDE_COLOR}` : undefined,
          }}
        />
      ))}
      {marqueeScreen && (
        <div
          data-testid="canvas-marquee"
          className="absolute border border-accent bg-accent-soft"
          style={{
            left: Math.min(marqueeScreen.x, marqueeScreen.x + marqueeW),
            top: Math.min(marqueeScreen.y, marqueeScreen.y + marqueeH),
            width: Math.abs(marqueeW),
            height: Math.abs(marqueeH),
          }}
        />
      )}
    </div>
  );
}
