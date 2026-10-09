import { z } from "zod";
import type { NodeRecord, Page } from "../document.js";
import { getComponentDef } from "./componentDefs.js";
import { OpError } from "./opError.js";

/**
 * W4-A per-node responsive overrides (whitelist slice).
 *
 * `breakpoints` is a STRUCTURAL node field (like pinned/frame/action), never a
 * component prop: no registry propsSchema declares it, so checkProps never
 * sees it. Strip-mode parsing keeps old documents unchanged — no migration,
 * DOCUMENT_VERSION stays 2. Two enforcement layers:
 *  - schema layer: `breakpointIssues(page)` (wired into checkStudioDocument)
 *    rejects non-whitelist keys, desktop keys, pinned combinations and values
 *    the component field schema refuses;
 *  - runtime layer: `resolveBreakpointProps` re-checks both the whitelist and
 *    the field schema, silently dropping anything bad so rendering a legacy
 *    document that bypassed validation can never crash.
 *
 * Only the import of `NodeRecord`/`Page` is type-only on purpose: this module
 * must stay a value dependency of document.ts without a runtime import cycle
 * (componentDefs.ts never imports document.ts).
 */

/** The three spec viewports (mirrors visual/viewports.ts names). */
export const BREAKPOINT_NAMES = ["desktop", "tablet", "mobile"] as const;
export type BreakpointName = (typeof BREAKPOINT_NAMES)[number];
export type OverlayViewport = Exclude<BreakpointName, "desktop">;

/**
 * Per-type whitelist: ONLY these (type, prop) pairs accept an override.
 * Layout-structure props only — colors/content stay out, and `frame` is canvas
 * metadata that never participates in responsive semantics.
 */
export const BREAKPOINT_PROPS: Readonly<Record<string, readonly string[]>> = {
  Grid: ["columns", "gap"],
  MetricGrid: ["columns"],
  Stack: ["gap"],
};

/** Overlay shape: each entry is optional; value is validated per component schema. */
export const nodeBreakpointSchema = z.object({
  tablet: z.record(z.string(), z.unknown()).optional(),
  mobile: z.record(z.string(), z.unknown()).optional(),
});
export type NodeBreakpoints = z.infer<typeof nodeBreakpointSchema>;

/** The node slice resolveBreakpointProps needs (keeps the runtime import type-only). */
export interface BreakpointNode {
  type: string;
  props: Record<string, unknown>;
  breakpoints?: NodeBreakpoints;
}

/** Minimal safeParse surface of a registry field schema (same duck-type as emitters). */
interface FieldSchema {
  safeParse?: (value: unknown) => { success: boolean; data?: unknown };
}

/** Registry field schema for one prop, or undefined when the type/key is unknown. */
function fieldSchema(type: string, key: string): FieldSchema | undefined {
  const def = getComponentDef(type);
  const shape = (def?.propsSchema as { shape?: Record<string, unknown> } | undefined)?.shape;
  return shape?.[key] as FieldSchema | undefined;
}

/** Runtime guard for callers that bypass the TypeScript overlay viewport type. */
function assertOverlayViewport(nodeId: string, viewport: string): asserts viewport is OverlayViewport {
  if (viewport === "desktop" || (viewport !== "tablet" && viewport !== "mobile")) {
    throw new OpError(`节点 "${nodeId}" 的断点覆盖视口 "${viewport}" 不合法`);
  }
}

/** Return a new page with one node replaced; other records also stay immutable. */
function replaceNode(page: Page, nodeId: string, nextNode: NodeRecord): Page {
  return { ...page, nodes: page.nodes.map((node) => (node.id === nodeId ? nextNode : { ...node })) };
}

/** Validate and normalize every patched entry before the page copy is built. */
function validatedOverlayPatch(node: NodeRecord, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new OpError(`节点 "${node.id}" 的断点覆盖 patch 必须是对象`);
  }
  const allowed = BREAKPOINT_PROPS[node.type] ?? [];
  const parsedPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const issue = propIssue(node, key, value, allowed)[0];
    if (issue) throw new OpError(issue);
    const result = fieldSchema(node.type, key)!.safeParse!(value)!;
    parsedPatch[key] = result.data;
  }
  return parsedPatch;
}

/** Reject the operation if the resulting page violates breakpoint invariants. */
function assertBreakpointInvariants(page: Page): void {
  const errors = breakpointIssues(page);
  if (errors.length > 0) throw new OpError(errors.join("; "));
}

/** Raw overlay record for a viewport; non-object overlays read as absent. */
function readOverlay(breakpoints: NodeBreakpoints | undefined, viewport: BreakpointName): Record<string, unknown> | undefined {
  if (!breakpoints || typeof breakpoints !== "object") return undefined;
  const value = (breakpoints as Record<string, unknown>)[viewport];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Resolve the effective props for a viewport: base = node.props (the desktop /
 * identity viewport), then every whitelisted + schema-valid overlay entry for
 * tablet/mobile replaces the same key. Rejected pairs are silently dropped.
 *
 * Returns a NEW object and never writes back into `node` (the store is
 * immutable; rendering must stay read-only).
 */
export function resolveBreakpointProps(node: BreakpointNode, viewport: BreakpointName): Record<string, unknown> {
  const resolved = { ...(node.props ?? {}) };
  if (viewport === "desktop") return resolved;
  const overlay = readOverlay(node.breakpoints, viewport);
  if (!overlay) return resolved;
  const allowed = BREAKPOINT_PROPS[node.type] ?? [];
  for (const [key, value] of Object.entries(overlay)) {
    if (!allowed.includes(key)) continue;
    const result = fieldSchema(node.type, key)?.safeParse?.(value);
    if (result?.success && result.data !== undefined) resolved[key] = result.data;
  }
  return resolved;
}

/** Error line for one overlay key: whitelist first, then the field schema. */
function propIssue(node: NodeRecord, key: string, value: unknown, allowed: readonly string[]): string[] {
  if (!allowed.includes(key)) {
    return [`节点 "${node.id}" 的断点覆盖 "${node.type}.${key}" 不在白名单`];
  }
  const result = fieldSchema(node.type, key)?.safeParse?.(value);
  if (result?.success) return [];
  return [`节点 "${node.id}" 的断点覆盖 "${node.type}.${key}" 取值不合法`];
}

/** Per-viewport overlay checks of one node (pinned nodes are rejected as a whole). */
function overlayIssues(node: NodeRecord, raw: Record<string, unknown>): string[] {
  const views = Object.keys(raw);
  if (views.length === 0) return [];
  if (node.pinned) {
    return [`节点 "${node.id}" 已 pinned（自由定位），不能带断点覆盖（互斥）`];
  }
  const allowed = BREAKPOINT_PROPS[node.type] ?? [];
  const errors: string[] = [];
  for (const view of views) {
    if (view === "desktop") {
      errors.push(`节点 "${node.id}" 的断点覆盖不允许出现 desktop（基础值写在 props 里）`);
      continue;
    }
    if (view !== "tablet" && view !== "mobile") {
      errors.push(`节点 "${node.id}" 的断点覆盖视口 "${view}" 不是 desktop/tablet/mobile`);
      continue;
    }
    const overlay = raw[view];
    if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) continue;
    for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
      errors.push(...propIssue(node, key, value, allowed));
    }
  }
  return errors;
}

/** Error lines for one node's breakpoints (empty when absent or clean). */
function nodeBreakpointIssues(node: NodeRecord): string[] {
  const raw = (node as { breakpoints?: unknown }).breakpoints;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return overlayIssues(node, raw as Record<string, unknown>);
}

/**
 * checkStudioDocument-style error lines for dangling/bad overrides: every node
 * of the page, in node order. Text is the contract AI and save paths surface.
 */
export function breakpointIssues(page: Page): string[] {
  const errors: string[] = [];
  for (const node of page.nodes) {
    errors.push(...nodeBreakpointIssues(node));
  }
  return errors;
}

/** Merge whitelisted, schema-valid overrides for one non-desktop viewport. */
export function updateNodeBreakpoints(
  page: Page,
  nodeId: string,
  viewport: OverlayViewport,
  patch: Record<string, unknown>,
): Page {
  const node = page.nodes.find((item) => item.id === nodeId);
  if (!node) throw new OpError(`节点 "${nodeId}" 不存在`);
  assertOverlayViewport(nodeId, viewport);
  if (node.pinned) {
    throw new OpError(`节点 "${nodeId}" 已 pinned，不能同时设置断点覆盖`);
  }
  const parsedPatch = validatedOverlayPatch(node, patch);
  const overlay = { ...(readOverlay(node.breakpoints, viewport) ?? {}), ...parsedPatch };
  const nextNode: NodeRecord = {
    ...node,
    breakpoints: { ...(node.breakpoints ?? {}), [viewport]: overlay },
  };
  const next = replaceNode(page, nodeId, nextNode);
  assertBreakpointInvariants(next);
  return next;
}

/** Remove every override from one non-desktop viewport without mutating input. */
export function clearNodeBreakpoints(page: Page, nodeId: string, viewport: OverlayViewport): Page {
  const node = page.nodes.find((item) => item.id === nodeId);
  if (!node) throw new OpError(`节点 "${nodeId}" 不存在`);
  assertOverlayViewport(nodeId, viewport);
  if (node.pinned) {
    throw new OpError(`节点 "${nodeId}" 已 pinned，不能同时设置断点覆盖`);
  }

  const remaining = { ...(node.breakpoints ?? {}) };
  delete remaining[viewport];
  const nextNode: NodeRecord =
    Object.keys(remaining).length === 0 ? { ...node } : { ...node, breakpoints: remaining };
  if (Object.keys(remaining).length === 0) delete nextNode.breakpoints;
  const next = replaceNode(page, nodeId, nextNode);
  assertBreakpointInvariants(next);
  return next;
}
