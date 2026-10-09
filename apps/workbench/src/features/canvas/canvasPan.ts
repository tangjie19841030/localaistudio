import type { Page } from "@studio/schema-core";

/**
 * Canvas pan/marquee session state (P5-2), lifted out of CanvasSurface with
 * the gesture types so the surface and the keyboard hook share one shape.
 */

export type PanPhase = "idle" | "pan" | "marquee";

export interface PanState {
  phase: PanPhase;
  start: { x: number; y: number };
  /** marquee only: current canvas-space pointer */
  current: { x: number; y: number };
}

export const IDLE_PAN: PanState = { phase: "idle", start: { x: 0, y: 0 }, current: { x: 0, y: 0 } };

export interface PanPoint {
  x: number;
  y: number;
}

/**
 * Advance a pan drag by one screen-space sample: the pointer delta since the
 * last sample pans the viewport and re-anchors the session start. Pure.
 */
export function advancePan(
  state: PanState,
  client: PanPoint,
  panByDelta: (dx: number, dy: number) => void,
): PanPoint {
  panByDelta(client.x - state.start.x, client.y - state.start.y);
  return client;
}
