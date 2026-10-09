import { z } from "zod";
import type { Frame, NodeRecord, Page, StudioDocument } from "../document.js";
import { frameSchema } from "../document.js";
import { activePageOf, replacePage } from "./pageOps.js";
import {
  insertNode,
  moveNode,
  OpError,
  removeNode,
  setFrame,
  setToken,
  type TokenPath,
  updateProps,
} from "./documentOps.js";

/**
 * Unified AI patch operation set (spec §5.2): every op delegates to the matching
 * documentOps function, so validation semantics stay in exactly one place.
 */
export type PatchOp =
  | { op: "tokens.set"; path: TokenPath; value: string | number }
  | {
      op: "node.add";
      node: NodeRecord;
      parentId: string;
      index?: number;
      subtreeNodes?: NodeRecord[];
    }
  | { op: "node.remove"; id: string }
  | { op: "node.update"; id: string; props: Record<string, unknown> }
  | { op: "node.move"; id: string; parentId: string; index?: number }
  | { op: "setFrame"; nodeId: string; frame: Frame };

/**
 * Input-side patch payload: setFrame may omit rotation (frameSchema's default
 * fills it at parse time), while the parsed PatchOp always carries a full Frame.
 */
type SetFrameInput = { op: "setFrame"; nodeId: string; frame: z.input<typeof frameSchema> };

export const patchOpSchema: z.ZodType<PatchOp, z.ZodTypeDef, PatchOp | SetFrameInput> = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("tokens.set"),
    path: z.union([
      z.tuple([
        z.literal("color"),
        z.enum(["brand", "surface", "text", "muted", "border", "accent", "success", "warning", "danger"]),
      ]),
      z.tuple([z.literal("radius"), z.enum(["card", "control"])]),
      z.tuple([z.literal("spacing"), z.literal("unit")]),
      z.tuple([z.literal("font"), z.literal("sans")]),
    ]),
    value: z.union([z.string(), z.number()]),
  }),
  z.object({
    op: z.literal("node.add"),
    // Same shape as nodeRecordSchema but with all fields required: patch input
    // must be explicit; no zod defaults are silently injected for AI payloads.
    node: z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      props: z.record(z.string(), z.unknown()),
      children: z.array(z.string().min(1)),
    }),
    parentId: z.string().min(1),
    index: z.number().optional(),
    subtreeNodes: z.array(
      z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        props: z.record(z.string(), z.unknown()),
        children: z.array(z.string().min(1)),
      }),
    ).optional(),
  }),
  z.object({
    op: z.literal("node.remove"),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal("node.update"),
    id: z.string().min(1),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("node.move"),
    id: z.string().min(1),
    parentId: z.string().min(1),
    index: z.number().optional(),
  }),
  z.object({
    op: z.literal("setFrame"),
    nodeId: z.string().min(1),
    // frameSchema parse injects the rotation default, mirroring node.add's
    // explicit-input rule loosely: here the default matches how documents
    // themselves parse, so AI payloads may omit rotation.
    frame: frameSchema,
  }),
]);

export interface ApplyPatchResult {
  /** New doc on success; the untouched input doc on any failure (all-or-nothing). */
  doc: StudioDocument;
  /** Ops that were applied; empty when any op failed. */
  applied: PatchOp[];
  /** Failure reasons as "op[i] <op>: <OpError message>". */
  errors: string[];
}

/**
 * Delegate one op to its documentOps counterpart (single source of validation).
 * Node ops run on the ACTIVE page (first page while the doc is still single-page,
 * which every v1-era caller is); tokens.set is document-level (T19 §0.2).
 */
function applyOne(doc: StudioDocument, op: PatchOp): StudioDocument {
  if (op.op === "tokens.set") return setToken(doc, op.path, op.value);
  const page = activePageOf(doc, null);
  const nextPage = applyPageOne(page, op);
  return replacePage(doc, page.id, nextPage);
}

/** Delegate one NODE op to its documentOps counterpart on a single page. */
function applyPageOne(page: Page, op: PatchOp): Page {
  switch (op.op) {
    case "node.add":
      return insertNode(page, op.node, op.parentId, op.index, op.subtreeNodes ?? []);
    case "node.remove":
      return removeNode(page, op.id);
    case "node.update":
      return updateProps(page, op.id, op.props);
    case "node.move":
      return moveNode(page, op.id, op.parentId, op.index);
    case "setFrame":
      return setFrame(page, op.nodeId, op.frame);
  }
  // tokens.set is handled by applyOne before the page split; this line is
  // unreachable by construction but keeps the switch exhaustive for tsc.
  throw new Error(`未知的 patch 操作: ${(op as { op: string }).op}`);
}

function reasonOf(e: unknown): string {
  if (e instanceof OpError) return e.reason;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Apply ops sequentially on a scratch chain; all-or-nothing: the first failure
 * aborts and returns the original doc (documentOps are pure, so nothing leaked).
 */
export function applyPatch(doc: StudioDocument, ops: PatchOp[]): ApplyPatchResult {
  let current = doc;
  const applied: PatchOp[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]!;
    try {
      current = applyOne(current, op);
      applied.push(op);
    } catch (e) {
      return { doc, applied: [], errors: [`op[${i}] ${op.op}: ${reasonOf(e)}`] };
    }
  }
  return { doc: current, applied, errors: [] };
}

export interface PatchScope {
  /** Every node id an op touches (added/removed/updated/moved or parent). */
  nodeIds: string[];
  /** Token paths in dotted form, e.g. "color.brand". */
  tokenPaths: string[];
}

/**
 * Audit which nodes and token paths the ops would touch, in first-seen op order,
 * deduplicated. Feeds the preview card and the scope checker.
 */
export function planScope(ops: PatchOp[]): PatchScope {
  const nodeIds: string[] = [];
  const tokenPaths: string[] = [];
  const seenNodes = new Set<string>();
  const seenTokens = new Set<string>();
  const addNode = (id: string | undefined): void => {
    if (id && !seenNodes.has(id)) {
      seenNodes.add(id);
      nodeIds.push(id);
    }
  };
  for (const op of ops) {
    if (op.op === "tokens.set") {
      const dotted = op.path.join(".");
      if (!seenTokens.has(dotted)) {
        seenTokens.add(dotted);
        tokenPaths.push(dotted);
      }
    } else if (op.op === "node.add") {
      addNode(op.node.id);
      addNode(op.parentId);
      for (const sub of op.subtreeNodes ?? []) addNode(sub.id);
    } else if (op.op === "setFrame") {
      // Node-level write, gated exactly like node.update.
      addNode(op.nodeId);
    } else {
      addNode(op.id);
      if (op.op === "node.move") addNode(op.parentId);
    }
  }
  return { nodeIds, tokenPaths };
}

/**
 * Scope interception (spec §5.2): list every violation, node ids first then token
 * paths. Omitted allowed.nodeIds means read-only (any node is a violation);
 * omitted allowAllTokens defaults to false (any tokens.set is a violation).
 */
export function checkScope(
  ops: PatchOp[],
  allowed: { nodeIds?: string[]; allowAllTokens?: boolean },
): string[] {
  const scope = planScope(ops);
  const violations: string[] = [];
  const allowedNodes = allowed.nodeIds ? new Set(allowed.nodeIds) : undefined;
  // A node.add changes the parent container's children list, while the added
  // node ids are newly created by the operation and cannot be pre-authorized
  // in a selection scope. Keep the parent in the audit (the actual boundary),
  // but do not reject the generated ids themselves. This also covers an
  // explicitly supplied subtree whose records are all part of the add.
  const addedNodeIds = new Set<string>();
  for (const op of ops) {
    if (op.op !== "node.add") continue;
    addedNodeIds.add(op.node.id);
    for (const child of op.subtreeNodes ?? []) addedNodeIds.add(child.id);
  }
  for (const id of scope.nodeIds) {
    if (addedNodeIds.has(id)) continue;
    if (!allowedNodes?.has(id)) violations.push(`节点 ${id} 超出修改范围`);
  }
  if (allowed.allowAllTokens !== true) {
    for (const dotted of scope.tokenPaths) {
      violations.push(`token ${dotted} 不在允许范围`);
    }
  }
  return violations;
}
