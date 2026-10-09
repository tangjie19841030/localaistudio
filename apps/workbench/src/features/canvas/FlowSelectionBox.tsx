import type { Rect } from "@studio/schema-core";

/**
 * Selection chrome for a FLOW node (Plan C), drawn as an absolutely positioned
 * box in page space inside the zoomed content layer — the same coordinate
 * system the pin-layer outline and the marquee use, so all selection visuals
 * stay in one transform.
 *
 * Deep (non-root-child) flow nodes additionally carry the "flow lock" badge:
 * they can be selected but cannot be dragged into a pin (drag-to-pin is Task
 * 4; only page-level nodes are pinnable). Top-level flow nodes get the plain
 * outline only.
 */

export interface FlowSelectionBoxProps {
  /** Page-space rect from flowMeasure. */
  rect: Rect;
  /** True for deep nodes: draw the lock badge + dashed outline. */
  locked: boolean;
}

export function FlowSelectionBox({ rect, locked }: FlowSelectionBoxProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="canvas-flow-selection"
      data-flow-locked={locked ? "true" : undefined}
      className="pointer-events-none absolute"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
      }}
    >
      <span
        className={
          locked
            ? "absolute -inset-px rounded-[2px] border-2 border-dashed border-accent"
            : "absolute -inset-px rounded-[2px] ring-2 ring-accent"
        }
      />
      {locked && (
        <span className="absolute -top-2 -right-2 rounded-sm bg-accent px-1 text-[10px] font-semibold leading-4 text-canvas shadow-card">
          流式
        </span>
      )}
    </div>
  );
}
