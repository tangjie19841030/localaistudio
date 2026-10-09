import type { Frame, Page, Rect } from "@studio/schema-core";
import { setFrame } from "@studio/schema-core";
import { refreshGroupFrames } from "./canvasGroupOps";
import { isPinBox } from "./flowNodes";

/**
 * Align/distribute pure geometry (T13). Targets are pin boxes among the given
 * ids (flow ids ignored); multi-target bounds = selection bbox, single target
 * = page rect (Figma parent rule). `applyFrameSet` lands every new frame in
 * ONE doc pass — the caller wraps it in a single applyOp = one undo entry.
 *
 * Group semantics: a moved target carries its pin-box descendants by the SAME
 * delta, and group ancestors of every moved id get `refreshGroupFrames`.
 */

export type AlignMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type DistributeMode = "horizontal" | "vertical";

/** Eligible targets: pin boxes among ids (R11 predicate isPinBox). Flow ids ignored. */
export function alignTargets(doc: Page, ids: readonly string[]): Map<string, Frame> {
  const targets = new Map<string, Frame>();
  for (const id of ids) {
    const node = doc.nodes.find((n) => n.id === id);
    if (isPinBox(node)) targets.set(id, node!.frame!);
  }
  return targets;
}

/** Bounds rule: multi-target -> selection bbox; single target -> page rect (Figma parent rule). */
export function alignBounds(targets: Map<string, Frame>, page: Rect): Rect {
  if (targets.size <= 1) return page;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of targets.values()) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** New frames for one align mode; empty map when no eligible target. */
export function alignFrames(targets: Map<string, Frame>, mode: AlignMode, bounds: Rect): Map<string, Frame> {
  const next = new Map<string, Frame>();
  for (const [id, f] of targets) next.set(id, { ...f, ...alignedXY(f, mode, bounds) });
  return next;
}

/**
 * Even EDGE-GAP distribution along the axis (first/last stay, gaps equal);
 * empty map when targets < 3.
 */
export function distributeFrames(
  targets: Map<string, Frame>,
  mode: DistributeMode,
  bounds: Rect,
): Map<string, Frame> {
  if (targets.size < 3) return new Map();
  const sorted = [...targets.entries()].sort((a, b) => pos(a[1], mode) - pos(b[1], mode));
  const sizes = sorted.map(([, f]) => size(f, mode));
  const totalSize = sizes.reduce((sum, s) => sum + s, 0);
  const start = pos(sorted[0]![1], mode);
  const end = pos(sorted[sorted.length - 1]![1], mode) + sizes[sizes.length - 1]!;
  const gap = (end - start - totalSize) / (sorted.length - 1);
  const next = new Map<string, Frame>();
  let cursor = start;
  for (const [id, f] of sorted) {
    next.set(id, { ...f, ...placedXY(f, mode, cursor) });
    cursor += size(f, mode) + gap;
  }
  void bounds; // first/last anchor on their own edges; bounds kept for API symmetry
  return next;
}

/**
 * Apply a frame set in one doc pass (one applyOp = one undo entry).
 * Idempotent, immutable. Targets' pin descendants shift by the same delta
 * (group semantics); group ancestors of every moved id are refreshed.
 */
export function applyFrameSet(doc: Page, frames: Map<string, Frame>): Page {
  const deltas = new Map<string, { dx: number; dy: number }>();
  let next = doc;
  for (const [id, frame] of frames) {
    const before = doc.nodes.find((n) => n.id === id)?.frame;
    if (before) deltas.set(id, { dx: frame.x - before.x, dy: frame.y - before.y });
    next = setFrame(next, id, frame);
  }
  for (const [id, delta] of deltas) {
    next = shiftPinDescendants(next, id, delta, frames);
  }
  return refreshGroupFrames(next, [...frames.keys(), ...carriedIds(next, deltas, frames)]);
}

// --- helpers ---

/** One axis alignment: w/h/rotation untouched, only x or y moves. */
function alignedXY(f: Frame, mode: AlignMode, bounds: Rect): Partial<Frame> {
  switch (mode) {
    case "left": return { x: bounds.x };
    case "center-x": return { x: bounds.x + (bounds.w - f.w) / 2 };
    case "right": return { x: bounds.x + bounds.w - f.w };
    case "top": return { y: bounds.y };
    case "center-y": return { y: bounds.y + (bounds.h - f.h) / 2 };
    case "bottom": return { y: bounds.y + bounds.h - f.h };
  }
}

/** Axis position/size accessors for distribution. */
function pos(f: Frame, mode: DistributeMode): number { return mode === "horizontal" ? f.x : f.y; }
function size(f: Frame, mode: DistributeMode): number { return mode === "horizontal" ? f.w : f.h; }
function placedXY(f: Frame, mode: DistributeMode, p: number): Partial<Frame> {
  return mode === "horizontal" ? { x: p, y: f.y } : { x: f.x, y: p };
}

/** Shift the pin-box descendants of id by delta (skips ids in frames — they move themselves). */
function shiftPinDescendants(
  doc: Page,
  id: string,
  delta: { dx: number; dy: number },
  frames: Map<string, Frame>,
): Page {
  let next = doc;
  for (const pinId of pinDescendantIds(doc, id)) {
    if (frames.has(pinId)) continue;
    const node = doc.nodes.find((n) => n.id === pinId);
    if (!node?.frame) continue;
    next = setFrame(next, pinId, {
      ...node.frame,
      x: node.frame.x + delta.dx,
      y: node.frame.y + delta.dy,
    });
  }
  return next;
}

/** Pin-box descendants of id (excluding id itself), walking flat children edges. */
function pinDescendantIds(doc: Page, id: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>([id]);
  const walk = (nodeId: string): void => {
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    for (const childId of node.children) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      if (isPinBox(doc.nodes.find((n) => n.id === childId))) out.push(childId);
      walk(childId);
    }
  };
  walk(id);
  return out;
}

/** Ids that only moved via descendant carry (not directly in the frames set). */
function carriedIds(
  doc: Page,
  deltas: Map<string, { dx: number; dy: number }>,
  frames: Map<string, Frame>,
): string[] {
  const out: string[] = [];
  for (const id of doc.nodes.map((n) => n.id)) {
    if (frames.has(id)) continue;
    for (const movedId of deltas.keys()) {
      if (pinDescendantIds(doc, movedId).includes(id)) {
        out.push(id);
        break;
      }
    }
  }
  return out;
}
