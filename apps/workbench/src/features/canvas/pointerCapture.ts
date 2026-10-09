/**
 * jsdom does not implement pointer capture (setPointerCapture is undefined),
 * which throws inside handlers and kills wiring tests. Real browsers always
 * have it; guard so tests pass and behavior is identical where it exists.
 * Real browsers can still throw NotFoundError when the pointer id has no
 * active pointer (element detached mid-gesture, synthetic events) — capture is
 * best-effort: losing it must never break the gesture itself.
 */

export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    // Pointer id without an active pointer — capture is optional, continue.
  }
}

export function releasePointerCapture(el: Element, pointerId: number): void {
  try {
    el.hasPointerCapture?.(pointerId) && el.releasePointerCapture?.(pointerId);
  } catch {
    // Same best-effort contract as capturePointer.
  }
}
