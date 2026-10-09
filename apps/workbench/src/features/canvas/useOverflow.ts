import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Frame-content overflow detection for the free canvas (P5-2 fix): a frame is
 * a HARD box now — its content is clipped — so content that does not fit must
 * be surfaced instead of silently spilling over sibling nodes.
 *
 * Measurement runs after every commit of the caller's `deps` (frame geometry
 * and the document), which is exactly when the box or its content can change:
 * a live resize re-measures each sample, and any document op produces a new doc
 * reference. No ResizeObserver is installed — it would both churn per drag
 * sample and miss content-only changes (the observed box is a fixed 100% of the
 * frame, so children never resize it).
 */

export interface OverflowMetrics {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

/**
 * Whether the element's content exceeds its padding box. 1px tolerance absorbs
 * sub-pixel rounding (fractional zoom / border-box edges) without masking a
 * real single-line overflow.
 */
export function isOverflowing(el: OverflowMetrics | null | undefined): boolean {
  if (!el) return false;
  if (el.clientHeight === 0 && el.clientWidth === 0) return false; // not laid out (jsdom idle) — no false alarm
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

export function useElementOverflow(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const next = isOverflowing(ref.current);
    setOverflowing((prev) => (prev === next ? prev : next));
    // deps is supplied by the caller (frame geometry / node id / doc); its
    // length is constant per component so the spread array stays stable.
  }, deps);

  return overflowing;
}
