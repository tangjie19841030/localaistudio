import type { Frame, NodeRecord, Page } from "../document.js";

/**
 * Whole-document reset to flow layout behind the canvas "重排画布" action
 * (Plan C hybrid positioning).
 *
 * Under Plan C the structure owns layout: an un-pinned node is flow and any
 * frame it carries is inert legacy metadata (autoLayout stamps from the P5
 * era), while `pinned + frame` is an explicit free-positioning exemption. The
 * old pass re-stamped every node through autoLayout — meaningless now that
 * flow rendering ignores frames — so a re-layout is a pure reset: drop every
 * pin AND every frame, leaving a document whose layout is fully described by
 * the tree. Legacy frames are tolerated on load (codegen and canvas ignore
 * them); this action is where they get cleaned up.
 *
 * Pure functions over the document; zero IO. The caller must funnel the result
 * through ONE editorStore.applyOp so the reset is a single undo entry.
 */

/**
 * Immutable copy with every explicit placement removed — both `pinned` and
 * `frame`, since a frame left without a pin is exactly the dead metadata this
 * reset exists to clear. W4-A: `breakpoints` is stripped too — a breakpoint
 * overlay is a layout declaration, so a re-layout returns layout to the
 * structure alone. Returns the input when there is nothing to clear.
 */
export function clearPlacement(doc: Page): Page {
  if (!doc.nodes.some((n) => n.frame !== undefined || n.pinned || n.breakpoints !== undefined)) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map(({ frame: _frame, pinned: _pinned, breakpoints: _breakpoints, ...rest }) => rest),
  };
}

/** Canonical reset pass: unpin and un-frame the whole document (flow layout). */
export function relayoutDocument(doc: Page): Page {
  return clearPlacement(doc);
}

/** Frames match when both are absent, or every field matches (rotation defaults to 0). */
function framesMatch(a: Frame | undefined, b: Frame | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && (a.rotation ?? 0) === (b.rotation ?? 0)
  );
}

/**
 * Whether both docs carry the same placement per node id — frame AND pin
 * state (`pinned: false` reads as flow, same as absent). Editorial callers use
 * this to skip a no-op re-layout: an already-flow document (no pins, no
 * frames) must not flip `dirty` (or push an undo entry) just because the reset
 * ran again, while a legacy framed doc still reports a difference so its dead
 * frames get cleaned up.
 */
export function hasSameFrames(a: Page, b: Page): boolean {
  if (a === b) return true;
  if (a.nodes.length !== b.nodes.length) return false;
  const others = new Map<string, NodeRecord>(b.nodes.map((n) => [n.id, n]));
  return a.nodes.every((n) => {
    const other = others.get(n.id);
    if (!other) return false;
    return Boolean(n.pinned) === Boolean(other.pinned) && framesMatch(n.frame, other.frame);
  });
}
