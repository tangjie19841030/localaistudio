import { hasSameFrames, relayoutDocument, replacePage } from "@studio/schema-core";
import type { Page } from "@studio/schema-core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplyOp } from "./canvasCommit";

/**
 * "重排画布" action (Plan C): resets the whole document back to flow layout —
 * every pin and every legacy frame is dropped. Two-step confirmation — a
 * single click arms the button, a second click inside the window executes —
 * because the pass discards every manual placement.
 *
 * The reset runs as ONE applyOp, so one undo returns the previous layout
 * verbatim. An already-flow document is a no-op: no undo entry, no dirty flag
 * (flow layout loses nothing by being reset again).
 */

export const RELAYOUT_CONFIRM_MS = 3000;

export interface RelayoutApi {
  /** True while the button waits for its confirming second click. */
  armed: boolean;
  /** First call arms (or re-arms); the confirming call re-layouts the document. */
  request: () => void;
}

export function useRelayout(doc: Page, applyOp: ApplyOp): RelayoutApi {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A pending confirmation must not outlive the surface (or a project switch).
  useEffect(() => clearTimer, [clearTimer]);

  const request = useCallback(() => {
    if (!armed) {
      clearTimer();
      setArmed(true);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setArmed(false);
      }, RELAYOUT_CONFIRM_MS);
      return;
    }
    clearTimer();
    setArmed(false);
    const next = relayoutDocument(doc);
    if (hasSameFrames(next, doc)) return;
    applyOp((d) => replacePage(d, next.id, next));
  }, [applyOp, armed, clearTimer, doc]);

  return { armed, request };
}
