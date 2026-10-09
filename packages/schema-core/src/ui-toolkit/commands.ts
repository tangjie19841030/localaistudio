import type { CommandDefinition, CommandResult, DocumentEnvelope } from "@studio/studio-core";
import { z } from "zod";
import { frameSchema, type Frame, type Page, type StudioDocument } from "../document.js";
import { getComponentDef } from "../registry/componentDefs.js";
import {
  duplicateNode,
  insertNode,
  makeNode,
  moveNode,
  removeNode,
  renameDocument,
  setFrame,
  setNodeLocked,
  setToken,
  updateProps,
  type TokenPath,
} from "../registry/documentOps.js";
import { replacePage } from "../registry/pageOps.js";
import { attachPoint, collectSubtreeIds, getNode } from "../registry/treeUtils.js";

function next(
  envelope: DocumentEnvelope<StudioDocument>,
  document: StudioDocument,
  summary: string,
  affectedIds: string[],
  scopeIds: string[],
): CommandResult<StudioDocument> {
  return { nextEnvelope: { ...envelope, document }, summary, affectedIds, scopeIds };
}

/** The page a node id lives in (node ids are globally unique, T19 §0.2). */
function ownerPage(document: StudioDocument, nodeId: string): Page {
  const page = document.pages.find((p) => p.nodes.some((n) => n.id === nodeId));
  if (!page) throw new Error(`节点 "${nodeId}" 不存在于任何页面`);
  return page;
}

/** Run a page-scoped node op on the owner page and splice the result back. */
function withOwnerPage(
  document: StudioDocument,
  nodeId: string,
  op: (page: Page) => Page,
): StudioDocument {
  const page = ownerPage(document, nodeId);
  return replacePage(document, page.id, op(page));
}

const tokenPathSchema = z.union([
  z.tuple([
    z.literal("color"),
    z.enum(["brand", "surface", "text", "muted", "border", "accent", "success", "warning", "danger"]),
  ]),
  z.tuple([z.literal("radius"), z.enum(["card", "control"])]),
  z.tuple([z.literal("spacing"), z.literal("unit")]),
  z.tuple([z.literal("font"), z.literal("sans")]),
]);

const insertArgsSchema = z
  .object({
    type: z.string().min(1),
    parentId: z.string().min(1).optional(),
    index: z.number().int().optional(),
    nodeId: z.string().min(1).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    frame: frameSchema.optional(),
  })
  .strict();

const updatePropsArgsSchema = z
  .object({ nodeId: z.string().min(1), props: z.record(z.string(), z.unknown()) })
  .strict();

const removeArgsSchema = z.object({ nodeId: z.string().min(1) }).strict();
const duplicateArgsSchema = z.object({ nodeId: z.string().min(1), index: z.number().int().optional() }).strict();
const moveArgsSchema = z
  .object({ nodeId: z.string().min(1), parentId: z.string().min(1), index: z.number().int().optional() })
  .strict();
const tokenArgsSchema = z
  .object({ path: tokenPathSchema, value: z.union([z.string(), z.number()]) })
  .strict();
const frameArgsSchema = z.object({ nodeId: z.string().min(1), frame: frameSchema }).strict();
const lockedArgsSchema = z.object({ nodeId: z.string().min(1), locked: z.boolean() }).strict();
const renameArgsSchema = z.object({ name: z.string().min(1).max(80) }).strict();

const insertNodeCommand: CommandDefinition<
  StudioDocument,
  z.infer<typeof insertArgsSchema>,
  z.input<typeof insertArgsSchema>
> = {
  id: "ui.insert-node",
  title: "插入 UI 节点",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: insertArgsSchema,
  execute(envelope, args) {
    // Insert target page: the parent's page, else the FIRST page (v1 root
    // semantics — the insert command has no explicit page addressing).
    const page = args.parentId ? ownerPage(envelope.document, args.parentId) : envelope.document.pages[0]!;
    const parentId = args.parentId ?? page.rootId;
    const definition = getComponentDef(args.type);
    if (!definition) throw new Error(`未知组件类型: ${args.type}`);
    const node = makeNode(args.type, args.nodeId);
    if (args.props !== undefined) {
      const parsed = definition.propsSchema.safeParse(args.props);
      if (!parsed.success) throw new Error(`组件属性无效: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      node.props = parsed.data as Record<string, unknown>;
    }
    if (args.frame) node.frame = args.frame;
    const document = replacePage(envelope.document, page.id, insertNode(page, node, parentId, args.index));
    return {
      ...next(envelope, document, `已插入 ${definition.title}`, [node.id], [parentId]),
      createdIds: [node.id],
    };
  },
};

const updatePropsCommand: CommandDefinition<StudioDocument, z.infer<typeof updatePropsArgsSchema>> = {
  id: "ui.update-props",
  title: "更新 UI 属性",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: updatePropsArgsSchema,
  execute(envelope, args) {
    return next(
      envelope,
      withOwnerPage(envelope.document, args.nodeId, (page) => updateProps(page, args.nodeId, args.props)),
      `已更新 ${args.nodeId} 的属性`,
      [args.nodeId],
      [args.nodeId],
    );
  },
};

const removeNodeCommand: CommandDefinition<StudioDocument, z.infer<typeof removeArgsSchema>> = {
  id: "ui.remove-node",
  title: "删除 UI 节点",
  riskLevel: "medium",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: removeArgsSchema,
  execute(envelope, args) {
    const page = ownerPage(envelope.document, args.nodeId);
    const affectedIds = collectSubtreeIds(page, args.nodeId);
    const parentId = attachPoint(page, args.nodeId)?.parentId;
    return next(
      envelope,
      replacePage(envelope.document, page.id, removeNode(page, args.nodeId)),
      `已删除 ${args.nodeId}`,
      affectedIds,
      [...affectedIds, ...(parentId ? [parentId] : [])],
    );
  },
};

const duplicateNodeCommand: CommandDefinition<StudioDocument, z.infer<typeof duplicateArgsSchema>> = {
  id: "ui.duplicate-node",
  title: "复制 UI 节点",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: duplicateArgsSchema,
  execute(envelope, args) {
    const page = ownerPage(envelope.document, args.nodeId);
    const originalIds = new Set(page.nodes.map((node) => node.id));
    const sourceIds = collectSubtreeIds(page, args.nodeId);
    const parentId = attachPoint(page, args.nodeId)?.parentId;
    const nextPage = duplicateNode(page, args.nodeId, args.index);
    const cloneIds = nextPage.nodes.filter((node) => !originalIds.has(node.id)).map((node) => node.id);
    return {
      ...next(
        envelope,
        replacePage(envelope.document, page.id, nextPage),
        `已复制 ${args.nodeId}`,
        [args.nodeId, ...cloneIds],
        [...sourceIds, ...(parentId ? [parentId] : [])],
      ),
      createdIds: cloneIds,
    };
  },
};

const moveNodeCommand: CommandDefinition<StudioDocument, z.infer<typeof moveArgsSchema>> = {
  id: "ui.move-node",
  title: "移动 UI 节点",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: moveArgsSchema,
  execute(envelope, args) {
    const page = ownerPage(envelope.document, args.nodeId);
    const subtreeIds = collectSubtreeIds(page, args.nodeId);
    const oldParentId = attachPoint(page, args.nodeId)?.parentId;
    return next(
      envelope,
      replacePage(envelope.document, page.id, moveNode(page, args.nodeId, args.parentId, args.index)),
      `已移动 ${args.nodeId}`,
      [args.nodeId, args.parentId, ...(oldParentId ? [oldParentId] : [])],
      [...subtreeIds, args.parentId, ...(oldParentId ? [oldParentId] : [])],
    );
  },
};

const setTokenCommand: CommandDefinition<StudioDocument, z.infer<typeof tokenArgsSchema>> = {
  id: "ui.set-token",
  title: "设置 UI Token",
  riskLevel: "medium",
  allowedScopeKinds: ["file"],
  parameters: tokenArgsSchema,
  execute(envelope, args) {
    return next(
      envelope,
      setToken(envelope.document, args.path as TokenPath, args.value),
      `已设置 ${args.path.join(".")}`,
      [],
      [],
    );
  },
};

const setFrameCommand: CommandDefinition<
  StudioDocument,
  z.infer<typeof frameArgsSchema>,
  z.input<typeof frameArgsSchema>
> = {
  id: "ui.set-frame",
  title: "设置 UI 画布几何",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: frameArgsSchema,
  execute(envelope, args) {
    return next(
      envelope,
      withOwnerPage(envelope.document, args.nodeId, (page) => setFrame(page, args.nodeId, args.frame as Frame)),
      `已设置 ${args.nodeId} 的画布几何`,
      [args.nodeId],
      [args.nodeId],
    );
  },
};

const setNodeLockedCommand: CommandDefinition<StudioDocument, z.infer<typeof lockedArgsSchema>> = {
  id: "ui.set-node-locked",
  title: "锁定 UI 节点",
  riskLevel: "medium",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: lockedArgsSchema,
  execute(envelope, args) {
    const page = ownerPage(envelope.document, args.nodeId);
    const wasLocked = getNode(page, args.nodeId)?.locked === true;
    return {
      ...next(
        envelope,
        replacePage(envelope.document, page.id, setNodeLocked(page, args.nodeId, args.locked)),
        args.locked ? `已锁定 ${args.nodeId}` : `已解锁 ${args.nodeId}`,
        [args.nodeId],
        [args.nodeId],
      ),
      ...(wasLocked ? { lockOverrideIds: [args.nodeId] } : {}),
    };
  },
};

const renameDocumentCommand: CommandDefinition<StudioDocument, z.infer<typeof renameArgsSchema>> = {
  id: "ui.rename-document",
  title: "重命名 UI 文档",
  riskLevel: "low",
  allowedScopeKinds: ["file"],
  parameters: renameArgsSchema,
  execute(envelope, args) {
    return next(envelope, renameDocument(envelope.document, args.name), "已重命名 UI 文档", [], []);
  },
};

export const UI_COMMANDS: CommandDefinition<StudioDocument>[] = [
  insertNodeCommand,
  updatePropsCommand,
  removeNodeCommand,
  duplicateNodeCommand,
  moveNodeCommand,
  setTokenCommand,
  setFrameCommand,
  setNodeLockedCommand,
  renameDocumentCommand,
];
