import {
  FLOW_CONTEXT,
  childFrameContext,
  frameStyleSource,
  getComponentDef,
} from "@studio/schema-core";
import type { FrameEmitContext, NodeRecord, Page } from "@studio/schema-core";

/** Marker for a declared prop the codegen emitter would throw on; the
 *  read-only inspector degrades to this instead of breaking the panel. */
const INVALID_PROP = "(校验失败)";

/** Flow nodes emit no frame wrapper in default codegen — banner copy (T51). */
const FLOW_NOTE = "流式布局 · 继承容器";

/** One copyable row: label is the display key, value is the clipboard payload. */
export interface InspectRow {
  label: string;
  value: string;
}

/** A titled group of inspect rows (布局参数 / 有效属性). */
export interface InspectSection {
  title: string;
  rows: InspectRow[];
}

/** Codegen-same-source read-only data for one selected node. */
export interface InspectData {
  /** Registry title (falls back to the raw type for unknown components). */
  title: string;
  subtitle: string;
  /** Non-null when default codegen emits no frame wrapper for this node. */
  flowNote: string | null;
  /** Page-absolute geometry rows; empty for frame-less nodes. */
  frameSection: InspectSection;
  /** frameStyleSource output exactly as codegen would emit it; "" when flow. */
  cssPreview: string;
  /** Effective props under declaredProps semantics (defaults filled in). */
  propsSection: InspectSection;
}

/** Display/copy formatting: strings verbatim, everything else JSON. */
function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Flat-scan chain root→…→node (same one-pass pattern as LayerTree). */
function ancestorChain(doc: Page, id: string): NodeRecord[] {
  const byId = new Map<string, NodeRecord>();
  const parentOf = new Map<string, string>();
  for (const n of doc.nodes) {
    byId.set(n.id, n);
    for (const child of n.children) parentOf.set(child, n.id);
  }
  const chain: NodeRecord[] = [];
  let cur = byId.get(id);
  while (cur) {
    chain.push(cur);
    cur = byId.get(parentOf.get(cur.id) ?? "");
  }
  return chain.reverse();
}

/** Codegen-identical positioning origin: replay childFrameContext from the
 *  page root down to the node's parent (FLOW_CONTEXT default, like emitNodeJsx).
 *  Unknown ids yield an empty chain, i.e. the untouched flow context. */
function ancestorContext(doc: Page, id: string): FrameEmitContext {
  const chain = ancestorChain(doc, id);
  let ctx: FrameEmitContext = FLOW_CONTEXT;
  for (const ancestor of chain.slice(0, -1)) ctx = childFrameContext(ancestor, ctx);
  return ctx;
}

/**
 * Read-only mirror of codegen's declaredProps (emitters.ts, private on
 * purpose — T51 contract forbids importing it): keep schema-valid values,
 * fall back to the registry default on invalid values, fill required props
 * from defaults, drop undeclared/invalid-optional keys. Where the emitter
 * throws (required prop with no usable default) this degrades to a marker.
 * Unknown types or non-object schemas pass raw props through untouched.
 */
function reflectProps(node: NodeRecord): InspectRow[] {
  const raw = (node.props ?? {}) as Record<string, unknown>;
  const def = getComponentDef(node.type);
  const shape = (def?.propsSchema as { shape?: Record<string, unknown> } | undefined)?.shape;
  const rows: InspectRow[] = [];
  if (!def || !shape) {
    for (const [key, value] of Object.entries(raw)) {
      rows.push({ label: key, value: formatValue(value) });
    }
    return rows;
  }
  const required = new Set(def.requiredProps);
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const parse = (fieldSchema as { safeParse?: (v: unknown) => { success: boolean; data?: unknown } })
      .safeParse;
    let value: unknown;
    if (Object.hasOwn(raw, key)) {
      const result = parse?.call(fieldSchema, raw[key]);
      if (result?.success) value = result.data;
      else if (Object.hasOwn(def.defaultProps, key)) value = def.defaultProps[key];
      else if (required.has(key)) value = INVALID_PROP;
      // else: invalid optional prop — dropped, same as codegen
    } else if (required.has(key)) {
      value = Object.hasOwn(def.defaultProps, key) ? def.defaultProps[key] : INVALID_PROP;
    }
    if (value !== undefined) rows.push({ label: key, value: formatValue(value) });
  }
  return rows;
}

/** Frame geometry key/value rows (page-absolute, canvas metadata). */
function frameRows(node: NodeRecord): InspectRow[] {
  const frame = node.frame;
  if (!frame) return [];
  return [
    { label: "x", value: String(frame.x) },
    { label: "y", value: String(frame.y) },
    { label: "w", value: String(frame.w) },
    { label: "h", value: String(frame.h) },
    { label: "rotation", value: String(frame.rotation) },
  ];
}

/**
 * Build the inspect payload for one node: geometry rows, the CSS style source
 * codegen would emit for it (flow semantics: only pinned+frame nodes wrap,
 * origins re-based through childFrameContext), and the effective props list.
 */
export function buildInspectData(node: NodeRecord, doc: Page): InspectData {
  const wraps = node.frame !== undefined && node.pinned === true;
  const ctx = ancestorContext(doc, node.id);
  return {
    title: getComponentDef(node.type)?.title ?? node.type,
    subtitle: node.type,
    flowNote: wraps ? null : FLOW_NOTE,
    frameSection: { title: "布局参数", rows: frameRows(node) },
    cssPreview: wraps && node.frame ? frameStyleSource(node.frame, ctx.originX, ctx.originY) : "",
    propsSection: { title: "有效属性", rows: reflectProps(node) },
  };
}
