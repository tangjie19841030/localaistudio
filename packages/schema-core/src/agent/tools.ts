import { z } from "zod";
import type { NodeRecord, Page, StudioDocument } from "../document.js";
import { frameSchema } from "../document.js";
import {
  insertNode,
  makeNode,
  moveNode,
  removeNode,
  setFrame,
  setToken,
  type TokenPath,
  updateProps,
} from "../registry/documentOps.js";
import { componentPropKeys, getComponentDef, listComponentDefs } from "../registry/componentDefs.js";
import { proposeDocumentTool } from "./proposeDocument.js";
import { normalizeAgentProps } from "./propsNormalize.js";
import { collectSubtreeIds, getNode } from "../registry/treeUtils.js";
import { replacePage } from "../registry/pageOps.js";
import {
  checkProps,
  guardNode,
  guardTokens,
  issueLines,
  noDoc,
  runMutation,
  treeOutline,
} from "./scopeGuard.js";

// ---------------------------------------------------------------------------
// Agent tool contract (the server agent loop codes against these signatures).
// Pure functions over ToolContext: zero IO, zero DOM; execute never throws.
// Every write tool runs its scope gate right after arg parsing — mirroring
// the patch pipeline where checkScope runs before any op executes.
// ---------------------------------------------------------------------------

export interface ToolScope {
  nodeIds?: string[];
  allowAllTokens?: boolean;
}

/** Execution context the agent loop injects per step (T19 §3.6: page + doc). */
export interface ToolContext {
  /** The ACTIVE page — every node-level tool edits this page only. */
  page: Page;
  /** The whole document — tokens are document-level; read_document lists pages. */
  doc: StudioDocument;
  scope?: ToolScope;
}

export type ToolResult =
  | { ok: true; doc: StudioDocument; message: string }
  | { ok: false; message: string };

export interface StudioTool {
  name: string;
  /** Chinese description — this is what the model reads to choose a tool. */
  description: string;
  /** zod input schema; AI SDK consumes it directly for tool-calling. */
  parameters: z.ZodType;
  execute(args: unknown, ctx: ToolContext): ToolResult;
}

// ---------------------------------------------------------------------------
// read_document: name, node count, tree outline, full tokens. READ-ONLY,
// scope-exempt; returns the input doc untouched (same reference).
// ---------------------------------------------------------------------------

function readDocumentTool(): StudioTool {
  return {
    name: "read_document",
    description: "读取当前活动页面：文档名、页面清单、当前页节点数与树形结构大纲（id(类型) 用 > 连接）和完整设计 token。不修改文档。",
    parameters: z.object({}),
    execute(_args, ctx) {
      if (!ctx?.doc || !ctx?.page) return noDoc();
      const pageList = ctx.doc.pages.map((p, i) => `${i + 1}.${p.name}(${p.id})`).join("、");
      const message = [
        `文档: ${ctx.doc.name}`,
        `页面清单: ${pageList}`,
        `当前页: ${ctx.page.name}（节点数: ${ctx.page.nodes.length}）`,
        `结构: ${treeOutline(ctx.page)}`,
        `tokens: ${JSON.stringify(ctx.doc.tokens)}`,
      ].join("\n");
      return { ok: true, doc: ctx.doc, message };
    },
  };
}

// ---------------------------------------------------------------------------
// list_components: registry catalog, one line per def. READ-ONLY, scope-exempt.
// ---------------------------------------------------------------------------

function listComponentsTool(): StudioTool {
  return {
    name: "list_components",
    description: "列出所有可插入的组件类型及精确属性字段：类型名、中文标题、分类、是否为容器、props 可用字段。不修改文档。",
    parameters: z.object({}),
    execute(_args, ctx) {
      if (!ctx?.doc) return noDoc();
      const lines = listComponentDefs().map(
        (d) => `${d.type} ${d.title} ${d.category}${d.container ? " 容器" : ""} 属性: ${componentPropKeys(d).join(", ") || "无"}`,
      );
      return { ok: true, doc: ctx.doc, message: lines.join("\n") };
    },
  };
}

// ---------------------------------------------------------------------------
// insert_node
// ---------------------------------------------------------------------------

const insertNodeSchema = z.object({
  type: z.string().min(1).describe("组件类型，见 list_components"),
  parentId: z.string().min(1).optional().describe("父容器节点 ID；省略则插入文档根节点下"),
  index: z.number().optional().describe("插入下标；省略则追加到末尾"),
  props: z.record(z.string(), z.unknown()).optional().describe("组件属性，按组件 schema 校验，缺省字段取默认值"),
});

function insertNodeTool(): StudioTool {
  return {
    name: "insert_node",
    description: "插入一个组件节点（属性缺省时取注册表默认值）。省略 parentId 时插入根节点下；props 按组件 schema 校验。",
    parameters: insertNodeSchema,
    execute(args, ctx) {
      if (!ctx?.doc) return noDoc();
      const parsed = insertNodeSchema.safeParse(args);
      if (!parsed.success) return { ok: false, message: issueLines(parsed.error) };
      const { type, parentId, index, props } = parsed.data;
      const page = ctx.page;
      const target = parentId ?? page.rootId;

      // Scope gate first: the TARGET PARENT must be in scope. The new node id
      // is generated here, so only the parent is auditable against the scope.
      const scopeResult = guardNode(ctx.scope, target);
      if (scopeResult) return scopeResult;

      const def = getComponentDef(type);
      if (!def) return { ok: false, message: `未知组件类型 "${type}"，请先调用 list_components 查看可用组件` };
      const parent = getNode(page, target);
      if (!parent) return { ok: false, message: `父节点 "${target}" 不存在` };
      if (!getComponentDef(parent.type)?.container) {
        return { ok: false, message: `父节点 "${target}" (${parent.type}) 不是容器` };
      }
      // Normalize BEFORE the gate so validation and the write agree on one input.
      const writeProps = normalizeAgentProps(type, props);
      const propsResult = checkProps(type, writeProps);
      if (propsResult) return propsResult;

      // Built before mutating: type is registry-known and props just passed
      // safeParse, so makeNode/parse cannot throw here.
      const node: NodeRecord = makeNode(type);
      if (writeProps !== undefined) {
        node.props = getComponentDef(type)!.propsSchema.parse(writeProps) as Record<string, unknown>;
      }
      return runMutation(
        () => replacePage(ctx.doc, ctx.page.id, insertNode(page, node, target, index)),
        () => `已插入 ${def.title}（id: ${node.id}）`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// update_props
// ---------------------------------------------------------------------------

const updatePropsToolSchema = z.object({
  nodeId: z.string().min(1).describe("目标节点 ID"),
  props: z.record(z.string(), z.unknown()).describe("完整属性对象，缺省字段取组件默认值"),
});

function updatePropsTool(): StudioTool {
  return {
    name: "update_props",
    description: "整体更新一个节点的属性（props 为完整对象，缺省字段取组件默认值），按组件 schema 校验。",
    parameters: updatePropsToolSchema,
    execute(args, ctx) {
      if (!ctx?.doc || !ctx?.page) return noDoc();
      const parsed = updatePropsToolSchema.safeParse(args);
      if (!parsed.success) return { ok: false, message: issueLines(parsed.error) };
      const { nodeId, props } = parsed.data;

      const scopeResult = guardNode(ctx.scope, nodeId);
      if (scopeResult) return scopeResult;

      const target = getNode(ctx.page, nodeId);
      if (!target) return { ok: false, message: `节点 "${nodeId}" 不存在` };
      // Normalize BEFORE the gate so validation and the write agree on one input.
      const writeProps = normalizeAgentProps(target.type, props);
      const propsResult = checkProps(target.type, writeProps);
      if (propsResult) return propsResult;

      return runMutation(
        () => replacePage(ctx.doc, ctx.page.id, updateProps(ctx.page, nodeId, writeProps)),
        (next) => {
          const updated = next.pages.find((pg) => pg.id === ctx.page.id)!;
          return `已更新节点 ${nodeId} 的 ${Object.keys(getNode(updated, nodeId)!.props).length} 个属性`;
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// remove_node
// ---------------------------------------------------------------------------

const removeNodeToolSchema = z.object({
  nodeId: z.string().min(1).describe("要删除的节点 ID（连同整棵子树）"),
});

function removeNodeTool(): StudioTool {
  return {
    name: "remove_node",
    description: "删除一个节点及其整棵子树；根节点不可删除。",
    parameters: removeNodeToolSchema,
    execute(args, ctx) {
      if (!ctx?.doc || !ctx?.page) return noDoc();
      const parsed = removeNodeToolSchema.safeParse(args);
      if (!parsed.success) return { ok: false, message: issueLines(parsed.error) };
      const { nodeId } = parsed.data;
      const page = ctx.page;

      // Same audit surface as planScope: node.remove gates the id itself.
      const scopeResult = guardNode(ctx.scope, nodeId);
      if (scopeResult) return scopeResult;

      if (!getNode(page, nodeId)) return { ok: false, message: `节点 "${nodeId}" 不存在` };
      const descendants = collectSubtreeIds(page, nodeId).length - 1;

      return runMutation(
        () => replacePage(ctx.doc, page.id, removeNode(page, nodeId)),
        () =>
          descendants > 0
            ? `已删除节点 ${nodeId}（含 ${descendants} 个后代节点）`
            : `已删除节点 ${nodeId}`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// move_node
// ---------------------------------------------------------------------------

const moveNodeToolSchema = z.object({
  nodeId: z.string().min(1).describe("要移动的节点 ID"),
  newParentId: z.string().min(1).describe("新的父容器节点 ID"),
  index: z.number().optional().describe("新位置下标；省略则追加到末尾"),
});

function moveNodeTool(): StudioTool {
  return {
    name: "move_node",
    description: "把一个节点移动到新容器下；节点与新父容器都必须在修改范围内。",
    parameters: moveNodeToolSchema,
    execute(args, ctx) {
      if (!ctx?.doc || !ctx?.page) return noDoc();
      const parsed = moveNodeToolSchema.safeParse(args);
      if (!parsed.success) return { ok: false, message: issueLines(parsed.error) };
      const { nodeId, newParentId, index } = parsed.data;

      // Both ends audited, matching planScope's node.move surface.
      const scopeResult = guardNode(ctx.scope, nodeId, newParentId);
      if (scopeResult) return scopeResult;

      if (!getNode(ctx.page, nodeId)) return { ok: false, message: `节点 "${nodeId}" 不存在` };
      const parent = getNode(ctx.page, newParentId);
      if (!parent) return { ok: false, message: `目标父节点 "${newParentId}" 不存在` };

      return runMutation(
        () => replacePage(ctx.doc, ctx.page.id, moveNode(ctx.page, nodeId, newParentId, index)),
        () => `已移动节点 ${nodeId} 到 ${newParentId} 下`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// set_frame
// ---------------------------------------------------------------------------

const setFrameToolSchema = z.object({
  nodeId: z.string().min(1).describe("目标节点 ID"),
  frame: frameSchema.describe("绝对几何：x/y 任意数值，w/h ≥ 1，rotation 0-360 可省略默认 0"),
});

function setFrameTool(): StudioTool {
  return {
    name: "set_frame",
    description: "设置节点的自由画布绝对几何（x/y/w/h/rotation）；节点必须已存在。",
    parameters: setFrameToolSchema,
    execute(args, ctx) {
      if (!ctx?.doc || !ctx?.page) return noDoc();
      const parsed = setFrameToolSchema.safeParse(args);
      if (!parsed.success) return { ok: false, message: issueLines(parsed.error) };
      const { nodeId, frame } = parsed.data;

      const scopeResult = guardNode(ctx.scope, nodeId);
      if (scopeResult) return scopeResult;

      if (!getNode(ctx.page, nodeId)) return { ok: false, message: `节点 "${nodeId}" 不存在` };

      return runMutation(
        () => replacePage(ctx.doc, ctx.page.id, setFrame(ctx.page, nodeId, frame)),
        () => `已设置节点 ${nodeId} 的 frame (x:${frame.x}, y:${frame.y}, w:${frame.w}, h:${frame.h})`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// set_token
// ---------------------------------------------------------------------------

// token 路径以定长数组表达。注意：z.tuple 生成的 JSON Schema 不被部分
// OpenAI 兼容端接受（实测 ark/glm 报 "parameter not valid"），统一为
// z.array(...).length(2)，运行时 setToken 仍按 [family, key] 解构校验。
const tokenPathSchema: z.ZodType<TokenPath> = (z
  .array(z.string().min(1))
  .length(2)
  .describe("token 路径，如 [\"color\", \"brand\"]") as unknown) as z.ZodType<TokenPath>;

const setTokenToolSchema = z.object({
  path: tokenPathSchema.describe("token 路径，如 [\"color\", \"brand\"]"),
  value: z.union([z.string(), z.number()]).describe("颜色 #RRGGBB；radius/spacing 为数值；font 为非空字符串"),
});

const TOKEN_FAMILIES = new Set(["color", "radius", "spacing", "font"]);
const COLOR_KEYS = new Set(["brand", "surface", "text", "muted", "border", "accent", "success", "warning", "danger"]);
const RADIUS_KEYS = new Set(["card", "control"]);

function setTokenTool(): StudioTool {
  return {
    name: "set_token",
    description: "修改一个设计 token（颜色/圆角/间距/字体）；局部修改模式下需要 token 权限。",
    parameters: setTokenToolSchema,
    execute(args, ctx) {
      if (!ctx?.doc || !ctx?.page) return noDoc();
      const parsed = setTokenToolSchema.safeParse(args);
      if (!parsed.success) return { ok: false, message: issueLines(parsed.error) };
      const { path, value } = parsed.data;

      // path 现为定长数组（z.array 而非 z.tuple，保证 JSON Schema 兼容）；
      // 成员合法性在这里显式校验，错误仍以 zod 行号风格回传（模型可纠正）。
      const [family, key] = path;
      if (!TOKEN_FAMILIES.has(family)) {
        return { ok: false, message: `path: 未知的 token 族 "${family}"` };
      }
      if (family === "color" && !COLOR_KEYS.has(key)) {
        return { ok: false, message: `path: 未知的颜色 token 键 "${key}"` };
      }
      if (family === "radius" && !RADIUS_KEYS.has(key)) {
        return { ok: false, message: `path: 未知的 radius token 键 "${key}"` };
      }
      if (family === "spacing" && key !== "unit") {
        return { ok: false, message: `path: 未知的 spacing token 键 "${key}"` };
      }
      if (family === "font" && key !== "sans") {
        return { ok: false, message: `path: 未知的 font token 键 "${key}"` };
      }

      const scopeResult = guardTokens(ctx.scope, path);
      if (scopeResult) return scopeResult;

      return runMutation(
        () => setToken(ctx.doc, path, value),
        () => `已设置 token ${path.join(".")} = ${String(value)}`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STUDIO_TOOLS: StudioTool[] = [
  readDocumentTool(),
  listComponentsTool(),
  insertNodeTool(),
  updatePropsTool(),
  removeNodeTool(),
  moveNodeTool(),
  setFrameTool(),
  setTokenTool(),
  proposeDocumentTool(),
];

export function toolByName(name: string): StudioTool | undefined {
  return STUDIO_TOOLS.find((t) => t.name === name);
}
