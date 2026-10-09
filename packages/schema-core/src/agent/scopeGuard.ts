import type { ZodError } from "zod";
import type { Page, StudioDocument } from "../document.js";
import { OpError, type TokenPath } from "../registry/documentOps.js";
import { getComponentDef } from "../registry/componentDefs.js";
import { getNode } from "../registry/treeUtils.js";
import type { ToolResult, ToolScope } from "./tools.js";

/**
 * Shared pure helpers for the agent tool registry: scope gates (mirroring
 * patch.ts checkScope semantics), zod issue rendering, and the never-throw
 * mutation wrapper. The registry itself lives in tools.ts.
 */

/** zod issues rendered as actionable lines "path: message" (the model reads them). */
export function issueLines(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

/** Any thrown value to a readable one-line message; execute must never throw. */
export function reasonOf(e: unknown): string {
  if (e instanceof OpError) return e.reason;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Standard failure for a loop context that carries no doc. */
export function noDoc(): ToolResult {
  return { ok: false, message: "工具上下文缺少当前文档" };
}

/**
 * Scope gate for node writes — mirrors checkScope: a defined scope with omitted
 * nodeIds is read-only (every target violates). Same violation phrasing as the
 * existing pipeline so the model sees one consistent error vocabulary.
 */
export function guardNode(scope: ToolScope | undefined, ...ids: string[]): ToolResult | undefined {
  if (scope === undefined) return undefined;
  const allowed = new Set(scope.nodeIds ?? []);
  const violations = ids.filter((id) => !allowed.has(id));
  if (violations.length === 0) return undefined;
  return { ok: false, message: violations.map((id) => `节点 ${id} 超出修改范围`).join("\n") };
}

/** Token gate: a defined scope without allowAllTokens blocks every set_token. */
export function guardTokens(scope: ToolScope | undefined, path: TokenPath): ToolResult | undefined {
  if (scope === undefined || scope.allowAllTokens === true) return undefined;
  return { ok: false, message: `token ${path.join(".")} 不在允许范围` };
}

/** Props schema gate shared by insert_node/update_props; runs before any mutation. */
export function checkProps(type: string, props: unknown): ToolResult | undefined {
  const def = getComponentDef(type);
  if (!def) return { ok: false, message: `未知组件类型 "${type}"，请先调用 list_components 查看可用组件` };
  const result = def.propsSchema.safeParse(props ?? {});
  if (!result.success) return { ok: false, message: `props 校验失败 (${type}):\n${issueLines(result.error)}` };
  return undefined;
}

/** Delegate to a documentOps primitive; OpError text flows back as the message. */
export function runMutation(mutate: () => StudioDocument, messageOf: (next: StudioDocument) => string): ToolResult {
  try {
    const next = mutate();
    return { ok: true, doc: next, message: messageOf(next) };
  } catch (e) {
    return { ok: false, message: reasonOf(e) };
  }
}

/** Flat pre-order outline, e.g. "root(AppShell) > sec(Section) > stat1(StatCard)". */
export function treeOutline(doc: Page): string {
  const parts: string[] = [];
  const walk = (id: string): void => {
    const node = getNode(doc, id);
    if (!node) return; // dangling refs are checkPage's business, not the outline's
    for (const childId of node.children) {
      const child = getNode(doc, childId);
      if (child) parts.push(`${childId}(${child.type})`);
      walk(childId);
    }
  };
  walk(doc.rootId);
  const root = getNode(doc, doc.rootId);
  parts.unshift(`${doc.rootId}(${root ? root.type : "?"})`);
  return parts.join(" > ");
}
