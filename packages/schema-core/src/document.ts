import { z } from "zod";
import { docFormat, migrateV1ToV2 } from "./migrate.js";
import { breakpointIssues, nodeBreakpointSchema } from "./registry/breakpoints.js";
import { svgBoxIssues } from "./registry/svgSubset.js";

export const DOCUMENT_VERSION = 2;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "必须是 6 位十六进制颜色，例如 #0F766E");

export const tokensSchema = z.object({
  color: z.object({
    brand: hexColor,
    surface: hexColor,
    text: hexColor,
    muted: hexColor,
    border: hexColor,
    accent: hexColor,
    success: hexColor,
    warning: hexColor,
    danger: hexColor,
  }),
  radius: z.object({
    card: z.number().min(0).max(64),
    control: z.number().min(0).max(64),
  }),
  spacing: z.object({ unit: z.number().min(1).max(24) }),
  font: z.object({ sans: z.string().min(1) }),
});

/**
 * Free-canvas absolute geometry (P5). x/y accept any value including negatives
 * (the canvas is unbounded); w/h must be >= 1; rotation is degrees 0-360
 * (defaults to 0 when omitted).
 */
export const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().min(1),
  h: z.number().min(1),
  rotation: z.number().min(0).max(360).default(0),
});
export type Frame = z.infer<typeof frameSchema>;

/**
 * Node-level interaction intent (W3-A). STRUCTURAL field, never a component
 * prop: no registry propsSchema declares it, so checkProps never sees it.
 * Strip-mode parsing (same contract as pinned/frame) keeps old action-less
 * documents unchanged — no migration, DOCUMENT_VERSION stays 2. Target
 * validity is a doc-level invariant (checkStudioDocument), not a shape one.
 */
export const nodeActionSchema = z.object({
  type: z.literal("navigate"),
  pageId: z.string().min(1),
});
export type NodeAction = z.infer<typeof nodeActionSchema>;

export const nodeRecordSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string().min(1)).default([]),
  locked: z.boolean().optional(),
  // Plan C hybrid positioning: explicit free-positioning exemption. Absent (or
  // false) = flow layout owned by the structure, and any frame is inert legacy
  // metadata; true + frame = absolute placement at PAGE coordinates. Node-level
  // flag on purpose — a props/registry flag would leak into the AI tool surface.
  pinned: z.boolean().optional(),
  // Optional free-canvas geometry. DOCUMENT_VERSION stays put on purpose:
  // zod strip-mode parsing means old (frame-less) documents parse unchanged,
  // and documents that carry frames parse under the same version — no
  // migration needed in either direction.
  frame: frameSchema.optional(),
  // Click-to-navigate intent (W3-A). Same strip-mode contract as frame: absent
  // on old documents, no default injected, DOCUMENT_VERSION unchanged.
  action: nodeActionSchema.optional(),
  // W4-A per-node responsive overrides (whitelist slice). STRUCTURAL field,
  // never a component prop. Same strip-mode contract as pinned/frame/action:
  // old documents parse unchanged, no default injected, zero migration.
  breakpoints: nodeBreakpointSchema.optional(),
});

/**
 * 解析语义：zod 默认 strip 模式——未知键在 parse 时被静默丢弃（同版本内的字段容错策略）。
 * 跨版本演进由 documentVersion 字面量守卫。
 */

export type Tokens = z.infer<typeof tokensSchema>;
export type NodeRecord = z.infer<typeof nodeRecordSchema>;

/** One page: exactly the old single-page root minus documentVersion/tokens/name. */
export type Page = { id: string; name: string; rootId: string; nodes: NodeRecord[] };

/** v2 document root: shared tokens + pages array (multi-page model, T19). */
export type StudioDocument = { documentVersion: 2; name: string; tokens: Tokens; pages: Page[] };

// Schemas are left un-annotated on purpose: zod strip-mode defaults make the
// INPUT type differ from the output, and an explicit z.ZodType<Page> would
// force the input side to carry every default too. The manual Page /
// StudioDocument interfaces above are the canonical types; the inferred parse
// output is structurally identical.
export const pageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  rootId: z.string().min(1),
  nodes: z.array(nodeRecordSchema).min(1),
});

export const studioDocumentSchema = z.object({
  documentVersion: z.literal(DOCUMENT_VERSION),
  name: z.string().min(1).max(80),
  tokens: tokensSchema,
  pages: z.array(pageSchema).min(1),
});

export function defaultTokens(): Tokens {
  return {
    color: {
      brand: "#0F766E",
      surface: "#FFFFFF",
      text: "#172033",
      muted: "#64748B",
      border: "#E2E8F0",
      accent: "#0EA5E9",
      success: "#16A34A",
      warning: "#D97706",
      danger: "#DC2626",
    },
    radius: { card: 8, control: 6 },
    spacing: { unit: 4 },
    font: { sans: "Inter, 'Segoe UI', system-ui, sans-serif" },
  };
}

/** Blank single-node page with a Container root (shared by defaultDoc/pageOps). */
export function defaultPage(name: string, id?: string): Page {
  return {
    id: id ?? "page-1",
    name,
    rootId: "root",
    nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
  };
}

/** Single-page starting document (v2). */
export function defaultStudioDocument(name: string): StudioDocument {
  return {
    documentVersion: DOCUMENT_VERSION,
    name,
    tokens: defaultTokens(),
    pages: [defaultPage(name)],
  };
}

/**
 * Single acceptance funnel (T19 §0.3): v1 raw OR v2 -> always a validated
 * StudioDocument. v1 -> migrated (migrateV1ToV2); v2 -> parsed as-is;
 * anything else -> throws (never guess a downgrade). Every downstream
 * consumer (server store/versions/put-guard/AI parse/workbench import) goes
 * through THIS one function — no second migration site may appear.
 */
export function validateDocument(input: unknown): StudioDocument {
  const format = docFormat(input);
  if (format === "v2") return studioDocumentSchema.parse(input);
  if (format === "v1") return migrateV1ToV2(input);
  throw new Error(`不支持的文档版本形状（documentVersion 不为 1/2 且形状无法识别）`);
}

/**
 * zod 之外的引用完整性不变量（针对单页）。
 * 前置条件：page 必须来自已归一化的文档（validateDocument 输出或等价对象）。
 */
export function checkPage(page: Page): string[] {
  const errors: string[] = [];
  const ids = new Set(page.nodes.map((n) => n.id));
  if (ids.size !== page.nodes.length) {
    errors.push("存在重复的节点 ID");
  }
  if (!ids.has(page.rootId)) {
    errors.push(`rootId "${page.rootId}" 不在节点表中`);
  }
  for (const node of page.nodes) {
    for (const childId of node.children) {
      if (!ids.has(childId)) {
        errors.push(`节点 "${node.id}" 引用了不存在的子节点 "${childId}"`);
      }
    }
  }
  return errors;
}

/**
 * Doc-level invariants: every checkPage(page) + page-id uniqueness + node-id
 * uniqueness ACROSS pages (node ids are globally unique — AI scope addressing,
 * cross-page clipboard and selection all rely on it). tokens presence is
 * guarded by the schema itself. W3-A adds the navigate-target check, which
 * needs the COMPLETE page-id set — hence the second pass.
 */
export function checkStudioDocument(doc: StudioDocument): string[] {
  const errors: string[] = [];
  const pageIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const page of doc.pages) {
    if (pageIds.has(page.id)) {
      errors.push(`存在重复的页 ID "${page.id}"`);
    }
    pageIds.add(page.id);
    for (const node of page.nodes) {
      if (nodeIds.has(node.id)) {
        errors.push(`节点 ID "${node.id}" 跨页重复（页 "${page.id}"）`);
      }
      nodeIds.add(node.id);
    }
  }
  for (const page of doc.pages) {
    errors.push(...checkPage(page));
    // A self-target is legal (navigate to the current page = refresh), and the
    // page's own id is in pageIds, so no special case is needed here.
    for (const node of page.nodes) {
      if (node.action?.type === "navigate" && !pageIds.has(node.action.pageId)) {
        errors.push(`节点 "${node.id}" 的 action 指向不存在的页 "${node.action.pageId}"`);
      }
    }
    // W4-A: per-node breakpoint overrides (whitelist + field schema + pinned
    // mutual exclusion) — same second-pass position as the action check.
    errors.push(...breakpointIssues(page));
    // W5: SvgBox controlled SVG subset (tag/attr whitelist + reference scan).
    errors.push(...svgBoxIssues(page));
  }
  return errors;
}
