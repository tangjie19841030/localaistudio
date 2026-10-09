import { useEffect, useState } from "react";

/**
 * Viewport breakpoint for the workbench responsive rules:
 * - "wide"   : >= 1440px (both rails inline by default)
 * - "medium" : 1024–1439px (left rail inline, right rail collapsed)
 * - "narrow" : < 1024px (rails become overlay drawers)
 *
 * Defensive fallback mirrors themeStore: when matchMedia is unavailable
 * (jsdom, privacy mode) we pin "wide" so existing layouts/tests are stable.
 * Subscribes via addEventListener with a legacy addListener fallback.
 */

export type Breakpoint = "wide" | "medium" | "narrow";

const WIDE_QUERY = "(min-width: 1440px)";
const MEDIUM_QUERY = "(min-width: 1024px)";

function matchMediaSupported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function computeBreakpoint(): Breakpoint {
  if (!matchMediaSupported()) return "wide";
  if (window.matchMedia(WIDE_QUERY).matches) return "wide";
  if (window.matchMedia(MEDIUM_QUERY).matches) return "medium";
  return "narrow";
}

type LegacyMediaList = MediaQueryList & {
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

/** Subscribe to change events, tolerating both modern and legacy APIs. */
function subscribe(mq: MediaQueryList, onChange: () => void): () => void {
  const legacy = mq as LegacyMediaList;
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  if (typeof legacy.addListener === "function") {
    legacy.addListener(onChange);
    return () => legacy.removeListener?.(onChange);
  }
  return () => {};
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(computeBreakpoint);

  useEffect(() => {
    if (!matchMediaSupported()) return undefined;
    const onChange = (): void => setBreakpoint(computeBreakpoint());
    const unsubscribeWide = subscribe(window.matchMedia(WIDE_QUERY), onChange);
    const unsubscribeMedium = subscribe(window.matchMedia(MEDIUM_QUERY), onChange);
    return () => {
      unsubscribeWide();
      unsubscribeMedium();
    };
  }, []);

  return breakpoint;
}
