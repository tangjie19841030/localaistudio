import { useEffect, useState } from "react";
import type { AiPhase } from "./types";

/**
 * Stall detection for the streaming phase (P7 流式可见性): a model turn can
 * legitimately run silent for 10–60s, so after STALL_AFTER seconds without any
 * SSE frame we surface a "疑似卡住" warning instead of leaving the user to
 * guess. Reuses the 1s interval both as the clock and the re-render tick.
 */
export const STALL_AFTER_MS = 15_000;

export interface StallWarn {
  stalled: boolean;
  /** Seconds since the last frame (floored); only meaningful while stalled. */
  seconds: number;
}

/**
 * true when no frame arrived for STALL_AFTER_MS. Any phase other than
 * "streaming" is never stalled (idle/awaiting-confirm means the turn ended).
 */
export function useStallWarn(lastFrameAt: number | null, phase: AiPhase): StallWarn {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "streaming") return; // idle clock: nothing to watch
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (phase !== "streaming" || lastFrameAt === null) return { stalled: false, seconds: 0 };
  const elapsed = now - lastFrameAt;
  return { stalled: elapsed >= STALL_AFTER_MS, seconds: Math.max(1, Math.floor(elapsed / 1000)) };
}
