/**
 * Server-side minimal patch validation (spec §10 scope-interception path).
 *
 * Deep validation (props schemas, zod discriminated union, atomic apply) lives in
 * schema-core's patch engine and runs on the frontend before apply. The server only
 * needs enough structure to run the scope checker and reject garbage early:
 * a known op string plus its required id/target fields.
 */

const OP_TYPES = new Set([
  "tokens.set",
  "node.add",
  "node.remove",
  "node.update",
  "node.move",
  "setFrame",
]);

export interface GuardedOp {
  op: string;
  id?: string;
  nodeId?: string;
  parentId?: string;
  node?: { id?: string };
  path?: unknown;
  props?: unknown;
  index?: number;
  value?: unknown;
  frame?: unknown;
}

/** Returns issues; empty array means the ops are structurally checkable. */
export function guardOps(ops: unknown): string[] {
  if (!Array.isArray(ops)) return ["ops 必须是数组"];
  const issues: string[] = [];
  ops.forEach((op, i) => {
    if (typeof op !== "object" || op === null) {
      issues.push(`ops[${i}] 不是对象`);
      return;
    }
    const o = op as Record<string, unknown>;
    if (typeof o.op !== "string" || !OP_TYPES.has(o.op)) {
      issues.push(`ops[${i}].op 非法: ${String(o.op)}`);
      return;
    }
    // setFrame targets nodes by nodeId (not id) and needs a frame object.
    if (o.op === "setFrame") {
      if (typeof o.nodeId !== "string") issues.push(`ops[${i}] 缺少必填 nodeId`);
      if (typeof o.frame !== "object" || o.frame === null) {
        issues.push(`ops[${i}] 缺少必填 frame`);
      }
      return;
    }
    if (typeof o.id !== "string" && o.op !== "node.add" && o.op !== "tokens.set") {
      issues.push(`ops[${i}] 缺少必填 id`);
    }
    if (o.op === "node.add" && (typeof o.parentId !== "string" || typeof o.node !== "object")) {
      issues.push(`ops[${i}] 缺少必填 node/parentId`);
    }
    if (o.op === "node.move" && typeof o.parentId !== "string") {
      issues.push(`ops[${i}] 缺少必填 parentId`);
    }
  });
  return issues;
}

/**
 * Scope-check protocol (injected into createApp as opts.scopeChecker):
 * `(ops, scope) => string[]` — empty = compliant, non-empty = violation messages.
 * The real implementation is schema-core checkScope; wiring happens in src/index.ts.
 */
export type ScopeChecker = (
  ops: GuardedOp[],
  scope: { nodeIds?: string[]; allowAllTokens?: boolean },
) => string[];
