import type { Frame, NodeRecord, Page } from "../document.js";
import { getComponentDef } from "./componentDefs.js";

/**
 * Auto-framing for AI-generated documents (generate mode).
 *
 * Generated docs validate fine but carry no frames, so canvas mode (which
 * renders frame-bearing nodes only) shows an empty page. This layer walks the
 * tree once and assigns every frame-less node an absolute rect: visible,
 * non-overlapping, draggable. Nodes that already have a frame keep it
 * untouched — manual placement always wins over regeneration.
 *
 * Pure function over the document; zero IO. Frames are PAGE-ABSOLUTE
 * coordinates (matching canvasLayout.frameRects), never parent-relative.
 */

/** Workbench page baseline: workbench canvasGeometry.CANVAS_PAGE derives w/h from this. */
export const AUTO_LAYOUT_PAGE = { w: 1440, h: 900 } as const;

const PAD = 24;
const DEFAULT_GAP = 16;
const CONTENT_W = AUTO_LAYOUT_PAGE.w - PAD * 2;
/** Shell children start below the 64px top bar. */
const SHELL_TOP = 64;
const SHELL_SIDEBAR = 208;
const TITLE_H = 44;

/** Base heights per category; unknown types fall back to the 80 default. */
const CATEGORY_H: Record<string, number> = {
  layout: 64,
  navigation: 64,
  form: 56,
  data: 240,
  chart: 220,
  content: 80,
  feedback: 80,
  marketing: 120,
};
const DEFAULT_LEAF_H = 80;
const DEFAULT_LEAF_W = 320;

/** A position + width the parent offers a child. minH floors a container (root page frame only). */
interface Slot {
  x: number;
  y: number;
  w: number;
  /** 0 = the node sizes itself (leaf category height / container content height). */
  minH: number;
}

/** Whether the node is laid out as a container (def says so, or it has children anyway). */
function isContainerLike(node: NodeRecord): boolean {
  return Boolean(getComponentDef(node.type)?.container) || node.children.length > 0;
}

/** Leaf default height by component category (registry def, unknown → 80). */
function leafHeight(type: string): number {
  return CATEGORY_H[getComponentDef(type)?.category ?? ""] ?? DEFAULT_LEAF_H;
}

function layoutGap(parent: NodeRecord): number {
  const raw = Number((parent.props as { gap?: unknown } | undefined)?.gap);
  return Number.isFinite(raw) && raw >= 0 ? raw * 4 : DEFAULT_GAP;
}

function hasTitle(parent: NodeRecord): boolean {
  const title = (parent.props as { title?: unknown } | undefined)?.title;
  return typeof title === "string" && title.trim() !== "";
}

/** Frame without rotation — zod's .default(0) materializes it on next parse. */
function toFrame(x: number, y: number, w: number, h: number): Frame {
  return { x, y, w, h } as Frame;
}

/**
 * Layout pass. Returns the subtree's outer height; frames are written into
 * `frames` (id → Frame). The cycle-safe `seen` set mirrors treeUtils: a doc
 * can pass checkDocument yet still be cyclic, so walks must terminate.
 */
function measureNode(
  doc: Page,
  id: string,
  slot: Slot | undefined,
  frames: Map<string, Frame>,
  seen: Set<string>,
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return 0;

  if (node.frame) {
    frames.set(id, node.frame);
    // A placed node keeps its frame; frame-less DESCENDANTS still need rects.
    // Seed the walk from the node's CONTENT region (same inset an unframed
    // container would use) so children don't coincide with their parent.
    // placeChildren applies the shell top bar itself.
    const box = { x: node.frame.x + PAD, y: node.frame.y + PAD, w: node.frame.w - PAD * 2 };
    placeChildren(doc, node, box, frames, seen);
    return node.frame.h;
  }
  if (!isContainerLike(node)) {
    const x = slot?.x ?? 0;
    const y = slot?.y ?? 0;
    const w = slot?.w ?? DEFAULT_LEAF_W;
    const h = slot && slot.minH > 0 ? slot.minH : leafHeight(node.type);
    frames.set(id, toFrame(x, y, w, h));
    return h;
  }
  const x = slot?.x ?? 0;
  const y = slot?.y ?? 0;
  const w = slot?.w ?? CONTENT_W;
  const box = { x: x + PAD, y: y + PAD, w: w - PAD * 2 };
  const contentH = placeChildren(doc, node, box, frames, seen);
  // Own height = padding + content + padding, never below the offered floor
  // (the root's page frame is 900 tall even when content is short).
  const h = Math.max(slot?.minH ?? 0, PAD + contentH + PAD);
  frames.set(id, toFrame(x, y, w, h));
  return h;
}

/** Place a container's children by layout kind; returns the content height used. */
function placeChildren(
  doc: Page,
  parent: NodeRecord,
  box: { x: number; y: number; w: number },
  frames: Map<string, Frame>,
  seen: Set<string>,
): number {
  const layout = getComponentDef(parent.type)?.layout ?? "stack-v";
  const childIds = parent.children.filter((id) => !seen.has(id));

  const gap = layoutGap(parent);
  const contentTop = box.y + (hasTitle(parent) ? TITLE_H : 0);
  const shellInset = layout === "shell" && Boolean((parent.props as { sidebar?: unknown } | undefined)?.sidebar)
    ? SHELL_SIDEBAR
    : 0;

  if (layout === "stack-v" || layout === "shell") {
    const top = contentTop + (layout === "shell" ? SHELL_TOP : 0);
    const childX = box.x + shellInset;
    const childW = Math.max(160, box.w - shellInset);
    let cursor = top;
    for (const id of childIds) {
      const h = measureNode(doc, id, { x: childX, y: cursor, w: childW, minH: 0 }, frames, seen);
      cursor += h + gap;
    }
    return Math.max(0, cursor - top - (childIds.length > 0 ? gap : 0) + (hasTitle(parent) ? TITLE_H : 0));
  }
  if (layout === "grid") {
    // Honor the declared column count (Grid/MetricGrid carry `columns` with a
    // schema default); fall back to the historical 2-col split when absent.
    const declared = Number((parent.props as { columns?: unknown } | undefined)?.columns);
    const cols = Number.isInteger(declared) && declared >= 1 && declared <= 12 ? declared : 2;
    const colW = (box.w - gap * (cols - 1)) / cols;
    let rowH = 0;
    let maxY = box.y;
    let cursorY = box.y;
    childIds.forEach((id, i) => {
      const col = i % cols;
      if (i > 0 && col === 0) {
        cursorY += rowH + gap;
        rowH = 0;
      }
      const h = measureNode(doc, id, { x: box.x + col * (colW + gap), y: cursorY, w: colW, minH: 0 }, frames, seen);
      rowH = Math.max(rowH, h);
      maxY = Math.max(maxY, cursorY + h);
    });
    return Math.max(0, maxY - box.y);
  }
  // row: single horizontal band of leaf-sized columns.
  const n = Math.max(childIds.length, 1);
  const colW = Math.min(DEFAULT_LEAF_W, (box.w - gap * Math.max(childIds.length - 1, 0)) / n);
  let cursorX = box.x;
  let rowH = 0;
  for (const id of childIds) {
    const h = measureNode(doc, id, { x: cursorX, y: box.y, w: colW, minH: 0 }, frames, seen);
    rowH = Math.max(rowH, h);
    cursorX += colW + gap;
  }
  return rowH;
}

/**
 * Assign frames to every frame-less node reachable from rootId. The root is
 * the whole page (its own frame, when present, is the origin + width
 * baseline). Immutably returns a new doc; existing frames are preserved
 * verbatim. Idempotent: a fully-framed doc maps to an equivalent doc.
 */
export function autoLayout(doc: Page): Page {
  const frames = new Map<string, Frame>();
  const root = doc.nodes.find((n) => n.id === doc.rootId);
  const pageSlot: Slot = root?.frame
    ? { x: root.frame.x, y: root.frame.y, w: root.frame.w, minH: root.frame.h }
    : { x: 0, y: 0, w: AUTO_LAYOUT_PAGE.w, minH: AUTO_LAYOUT_PAGE.h };
  measureNode(doc, doc.rootId, pageSlot, frames, new Set());
  // Only touched nodes get new objects; untouched ones keep their references.
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.frame === undefined && frames.has(n.id) ? { ...n, frame: frames.get(n.id) } : n)),
  };
}

/** propose_document adapter: auto-frame frame-less nodes (see autoLayout). */
export function withAutoLayout(doc: Page): Page {
  return autoLayout(doc);
}
