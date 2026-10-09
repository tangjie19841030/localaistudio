/**
 * Pure rotation geometry (T13). Zero DOM, zero React — the rotate gesture is
 * fully expressible as these functions, so the math is unit-testable without
 * a browser.
 *
 * Coordinate model: center and pointer are both CANVAS-space points
 * (pointerInCanvas values; center = frame.x + w/2, frame.y + h/2). Zoom is a
 * uniform scale and pan cancels in a two-point difference, so the screen
 * angle equals the canvas angle — no viewport conversion anywhere.
 */

/** Screen-independent pointer angle in degrees: 0 = +x axis, positive = clockwise on screen. */
export function angleBetween(center: { x: number; y: number }, pt: { x: number; y: number }): number {
  return (Math.atan2(pt.y - center.y, pt.x - center.x) * 180) / Math.PI;
}

/** Shift snap to the nearest step (default 15deg). */
export function snappedAngle(deg: number, step: number = 15): number {
  if (!Number.isFinite(deg) || !Number.isFinite(step) || step <= 0) return deg;
  const snapped = Math.round(deg / step) * step;
  return snapped === 0 ? 0 : snapped; // avoid -0 leaking to frameSchema
}

/**
 * Normalize into [0, 360) — frameSchema bounds (0-360, default 0); never
 * emits 360 or negatives.
 */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const mod = deg % 360;
  if (mod === 0) return 0; // avoid -0 leaking to frameSchema
  return mod < 0 ? mod + 360 : mod;
}

/**
 * New rotation for one pointer sample: base + swept angle (current - start,
 * shortest-wrap not applied — the pointer sweeps continuously), snapped when
 * Shift is held, normalized into [0, 360).
 */
export function rotationFromGesture(
  startAngle: number,
  currentAngle: number,
  baseRotation: number,
  snap: boolean,
): number {
  const swept = currentAngle - startAngle;
  const raw = baseRotation + swept;
  return normalizeRotation(snap ? snappedAngle(raw) : raw);
}
