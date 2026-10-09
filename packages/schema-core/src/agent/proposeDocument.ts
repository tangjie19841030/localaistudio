import { z } from "zod";
import type { Page, StudioDocument } from "../document.js";
import { checkPage, pageSchema } from "../document.js";
import { componentPropKeys, getComponentDef } from "../registry/componentDefs.js";
import { withAutoLayout } from "../registry/autoLayout.js";
import { svgBoxIssues } from "../registry/svgSubset.js";
import { issueLines, noDoc } from "./scopeGuard.js";
import type { StudioTool } from "./tools.js";

// ---------------------------------------------------------------------------
// propose_document: generation-mode escape hatch (T19 §3.6). pageSchema.parse
// first (zod issue lines feed back so the model can retry), then checkPage
// (reference integrity). Any defined scope means patch mode — granular tools
// are the only sanctioned path there, whole-doc proposals are rejected. The
// proposal is ONE PAGE; tokens are preserved from the existing document.
// Accepted docs get auto-framed (withAutoLayout) — generated docs carry no
// frames, and canvas mode renders frame-bearing nodes only.
//
// Real models rarely emit the flat node table on the first try (verified live
// against glm-5.3-flash: 5/5 first-round attempts failed on format, burning
// the whole step budget). normalizeProposalDoc repairs the three recurring
// shapes BEFORE validation so one format slip costs nothing:
//   1. children as inline node objects → hoisted into the flat node table
//   2. partial/missing tokens → deep-merged over defaultTokens()
//   3. rootId / name / documentVersion missing → healed with safe defaults
// ---------------------------------------------------------------------------

const proposeDocumentSchema = z.object({
  // AI SDK 会把 z.unknown() 宽松传递，模型偶尔把整页 JSON 序列化成字符串
  // 传进来；允许 string 并在 execute 里解析，避免一次偶发格式失败。
  document: z.union([z.record(z.string(), z.unknown()), z.string()]).describe("完整页面文档对象（或 JSON 字符串）"),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Flatten inline-tree children into the node table. Models habitually nest
 * whole node objects under `children`; the schema only accepts string id
 * references. Hoisted children keep their declared id when unique, otherwise
 * get a fresh `<Type>-<n>` id. Non-object entries pass through untouched so
 * zod still reports them with positional clarity.
 */
function flattenInlineNodes(nodes: unknown[]): unknown[] {
  const out: unknown[] = [];
  // `declared` keeps fresh ids away from ids that exist later in the tree;
  // `claimed` decides keep-vs-regenerate for each node actually visited.
  const declared = new Set<string>();
  const claimed = new Set<string>();
  for (const n of nodes) {
    if (isRecord(n) && typeof n.id === "string" && n.id !== "") declared.add(n.id);
  }
  let serial = 0;
  const freshId = (type: unknown): string => {
    const base = typeof type === "string" && type !== "" ? type : "node";
    let id = "";
    do {
      serial += 1;
      id = `${base}-${serial}`;
    } while (declared.has(id) || claimed.has(id));
    claimed.add(id);
    return id;
  };
  const visit = (raw: unknown): unknown => {
    if (!isRecord(raw)) return raw;
    const node = { ...raw };
    if (typeof node.id === "string" && node.id !== "" && !claimed.has(node.id)) {
      claimed.add(node.id);
    } else {
      node.id = freshId(node.type);
    }
    out.push(node);
    // Models also stash the child list inside props; structural `children` is
    // never a declared prop, so lift it out (node-level wins on conflict).
    if (isRecord(node.props) && Array.isArray(node.props.children)) {
      if (!Array.isArray(node.children)) node.children = node.props.children;
      const { children: _dropped, ...rest } = node.props;
      node.props = rest;
    }
    if (Array.isArray(node.children)) {
      node.children = node.children.map((child: unknown) => {
        if (!isRecord(child)) return child;
        const hoisted = visit(child) as Record<string, unknown>;
        return typeof hoisted.id === "string" ? hoisted.id : child;
      });
    }
    return node;
  };
  for (const n of nodes) {
    if (isRecord(n)) visit(n);
    else out.push(n);
  }
  return out;
}

/** Synthesize the root container when rootId points nowhere; adopt orphans. */
function healRootNode(nodes: unknown[], rootId: string): unknown[] {
  if (nodes.some((n) => isRecord(n) && n.id === rootId)) return nodes;
  const referenced = new Set<string>();
  for (const n of nodes) {
    if (!isRecord(n) || !Array.isArray(n.children)) continue;
    for (const c of n.children) {
      if (typeof c === "string") referenced.add(c);
    }
  }
  const orphans = nodes
    .filter((n) => isRecord(n) && typeof n.id === "string" && !referenced.has(n.id))
    .map((n) => (n as Record<string, unknown>).id as string);
  return [...nodes, { id: rootId, type: "Container", props: {}, children: orphans }];
}

/**
 * Ruling R9: AI output is always flow — `pinned` is a human-only exemption.
 * Strip any model-authored `pinned` at the normalize entry so proposals
 * cannot smuggle absolute placement past the flow default. Other node fields
 * (including legacy `frame` geometry, harmless without a pin) pass through.
 */
function stripPinnedFlag(nodes: unknown[]): unknown[] {
  return nodes.map((n) => {
    if (!isRecord(n) || !("pinned" in n)) return n;
    const { pinned: _stripped, ...rest } = n;
    return rest;
  });
}

function normalizeProposalPage(input: unknown, fallbackName: string): unknown {
  if (!isRecord(input)) return input;
  const rootId = typeof input.rootId === "string" && input.rootId !== "" ? input.rootId : "root";
  const nodes = Array.isArray(input.nodes) ? flattenInlineNodes(input.nodes) : input.nodes;
  return {
    ...input,
    name: typeof input.name === "string" && input.name.trim() !== "" ? input.name : fallbackName,
    rootId,
    nodes: Array.isArray(nodes) ? stripPinnedFlag(healRootNode(nodes, rootId)) : nodes,
  };
}

/** Reject unknown props before a whole-page proposal can reach preview/codegen. */
function unknownPropIssues(page: Page): string[] {
  const issues: string[] = [];
  for (const node of page.nodes) {
    const definition = getComponentDef(node.type);
    if (!definition) continue;
    const allowed = new Set(componentPropKeys(definition));
    const unknown = Object.keys(node.props).filter((key) => !allowed.has(key));
    if (unknown.length === 0) continue;
    issues.push(
      `节点 "${node.id}" (${node.type}) 含未声明 props: ${unknown.join(", ")}；允许字段: ${componentPropKeys(definition).join(", ") || "无"}`,
    );
  }
  return issues;
}

/**
 * W3-A: a navigate target must exist in the WHOLE document. checkPage only
 * sees the proposed page, so the cross-page half is checked here against
 * ctx.doc.pages — the set the accepted page is about to be spliced into
 * (its own id included, so a self-target stays legal).
 */
function actionPageIdIssues(page: Page, pages: Page[]): string[] {
  const pageIds = new Set(pages.map((p) => p.id));
  const issues: string[] = [];
  for (const node of page.nodes) {
    if (node.action && !pageIds.has(node.action.pageId)) {
      issues.push(`节点 "${node.id}" 的 action 指向不存在的页 "${node.action.pageId}"`);
    }
  }
  return issues;
}

export function proposeDocumentTool(): StudioTool {
  return {
    name: "propose_document",
    description: "提出完整的整页提案（生成模式）。children 需为字符串 id 引用；tokens 由系统保留，无需提交；错误明细逐行回传，可修正后重试。",
    parameters: proposeDocumentSchema,
    execute(args, ctx) {
      const parsed = proposeDocumentSchema.safeParse(args);
      if (!parsed.success) return { ok: false, message: issueLines(parsed.error) };
      let input: unknown = parsed.data.document;
      // String tolerance: model serialized the whole page as JSON text.
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          return { ok: false, message: "文档参数是字符串但不是合法 JSON，请改为对象或有效 JSON 文本" };
        }
      }

      if (ctx?.scope !== undefined) {
        return {
          ok: false,
          message: "当前处于局部修改模式，请改用 insert_node / update_props / remove_node / move_node 等单节点工具",
        };
      }
      if (!ctx?.doc || !ctx?.page) return noDoc();

      // T19 §3.6: the proposal is ONE PAGE. tokens/documentVersion/pages are
      // never model-authored — tokens ride over from the existing document and
      // the page id is the ACTIVE PAGE's id (a replacement, not a new page).
      input = normalizeProposalPage(input, ctx.page.name || ctx.doc.name || "AI 生成页面");
      if (isRecord(input)) {
        delete input.tokens;
        delete input.documentVersion;
        delete input.pages;
        input.id = ctx.page.id;
      }
      const pageResult = pageSchema.safeParse(input);
      if (!pageResult.success) {
        return { ok: false, message: `页面校验失败:\n${issueLines(pageResult.error)}` };
      }
      const page = pageResult.data;
      const propIssues = unknownPropIssues(page);
      if (propIssues.length > 0) {
        return { ok: false, message: `文档属性校验失败:\n${propIssues.join("\n")}` };
      }
      const issues = checkPage(page);
      if (issues.length > 0) {
        return { ok: false, message: `文档引用完整性失败:\n${issues.join("\n")}` };
      }
      const actionIssues = actionPageIdIssues(page, ctx.doc.pages);
      if (actionIssues.length > 0) {
        return { ok: false, message: `文档引用完整性失败:\n${actionIssues.join("\n")}` };
      }
      // W5: SvgBox sources pass the controlled subset before acceptance.
      const svgIssues = svgBoxIssues(page);
      if (svgIssues.length > 0) return { ok: false, message: `文档 SVG 子集校验失败:\n${svgIssues.join("\n")}` };
      // Generate path only: frame-less nodes get auto-framed so canvas mode
      // isn't blank (see autoLayout.ts); manual inserts never come through here.
      const laidOut = withAutoLayout(page);
      // Splice the accepted page back into the whole document (tokens kept).
      const doc: StudioDocument = { ...ctx.doc, pages: ctx.doc.pages.map((p) => (p.id === ctx.page.id ? laidOut : p)) };
      return {
        ok: true,
        doc,
        message: `页面提案有效: ${page.name}，${page.nodes.length} 个节点（无 frame 节点已自动布局）`,
      };
    },
  };
}
