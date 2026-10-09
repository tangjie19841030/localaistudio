import type { CommandDefinition, CommandResult, DocumentEnvelope } from "@studio/studio-core";
import { z } from "zod";
import type { Block, Run, WordDocument } from "./document.js";
import { blockPayloadSchema, getBlock, getSection, sectionOfBlock } from "./document.js";
import { WORD_COMMENT_COMMANDS } from "./comments.js";
import {
  addFootnote, duplicateBlock, generateToc, insertBlock, insertSection, moveBlock, newBlockId, newSectionId,
  removeBlock, removeSection, renameDocument, renameSection, setBlockLocked, setBlockStyle,
  setHeadingLevel, setSectionFooter, setSectionHeader, updateImage, updateListItems,
  updateTableCell, updateTable, updateText, WordOpError,
} from "./documentOps.js";

const SCOPE_ALL = ["file", "container", "selection", "range"] as const;
const SCOPE_BLOCKISH = ["file", "container", "selection"] as const;

function next(
  envelope: DocumentEnvelope<WordDocument>,
  document: WordDocument,
  summary: string,
  affectedIds: string[],
  scopeIds: string[],
): CommandResult<WordDocument> {
  return { nextEnvelope: { ...envelope, document }, summary, affectedIds, scopeIds };
}

/** Block id + owning section id for scope checks (commands run per-block). */
function requireBlock(doc: WordDocument, blockId: string): { block: Block; sectionId: string } {
  const block = getBlock(doc, blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  const sectionId = sectionOfBlock(doc, blockId)?.id;
  if (!sectionId) throw new WordOpError(`块 "${blockId}" 不属于任何章节`);
  return { block, sectionId };
}

function sectionIdOf(doc: WordDocument, blockId: string): string {
  const sectionId = sectionOfBlock(doc, blockId)?.id;
  return sectionId ?? blockId;
}

const renameArgs = z.object({ name: z.string().min(1).max(120) }).strict();
const renameCommand: CommandDefinition<WordDocument, z.infer<typeof renameArgs>> = {
  id: "word.doc.rename",
  title: "重命名文档",
  riskLevel: "low",
  allowedScopeKinds: ["file"],
  parameters: renameArgs,
  execute(envelope, args) {
    return next(envelope, renameDocument(envelope.document, args.name), "已重命名文档", [], []);
  },
};

const insertBlockArgs = z
  .object({
    /** Block payload; id optional (assigned when absent), locked ignored. */
    block: blockPayloadSchema,
    blockId: z.string().min(1).optional(),
    sectionId: z.string().min(1),
    index: z.number().int().min(0).optional(),
  })
  .strict();
type InsertBlockArgs = z.infer<typeof insertBlockArgs>;

const insertBlockCommand: CommandDefinition<WordDocument, InsertBlockArgs, z.input<typeof insertBlockArgs>> = {
  id: "word.block.insert",
  title: "插入块",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_ALL,
  parameters: insertBlockArgs,
  execute(envelope, args) {
    const id = args.blockId ?? (args.block.id !== "__pending__" ? args.block.id : undefined) ?? newBlockId();
    const { locked: _locked, ...rest } = args.block;
    const block = { ...rest, id } as Block;
    const document = insertBlock(envelope.document, block, args.sectionId, args.index);
    return {
      ...next(envelope, document, `已在章节 ${args.sectionId} 插入 ${block.type} 块`, [id, args.sectionId], [args.sectionId]),
      createdIds: [id],
    };
  },
};

const removeBlockArgs = z.object({ blockId: z.string().min(1) }).strict();
const removeBlockCommand: CommandDefinition<WordDocument, z.infer<typeof removeBlockArgs>> = {
  id: "word.block.remove",
  title: "删除块",
  riskLevel: "medium",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: removeBlockArgs,
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.blockId);
    const document = removeBlock(envelope.document, args.blockId);
    return next(envelope, document, `已删除块 ${args.blockId}`, [args.blockId], [args.blockId, sectionId]);
  },
};

const duplicateBlockCommand: CommandDefinition<WordDocument, { blockId: string }> = {
  id: "word.block.duplicate",
  title: "复制块",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: z.object({ blockId: z.string().min(1) }).strict(),
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.blockId);
    const newId = newBlockId();
    const document = duplicateBlock(envelope.document, args.blockId, newId);
    return {
      ...next(envelope, document, `已复制块 ${args.blockId}`, [newId], [args.blockId, sectionId, newId]),
      createdIds: [newId],
    };
  },
};

const moveBlockArgs = z
  .object({
    blockId: z.string().min(1),
    targetSectionId: z.string().min(1),
    index: z.number().int().min(0).optional(),
  })
  .strict();
const moveBlockCommand: CommandDefinition<WordDocument, z.infer<typeof moveBlockArgs>> = {
  id: "word.block.move",
  title: "移动块",
  riskLevel: "medium",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: moveBlockArgs,
  execute(envelope, args) {
    const { sectionId: fromSectionId } = requireBlock(envelope.document, args.blockId);
    if (!getSection(envelope.document, args.targetSectionId)) {
      throw new WordOpError(`目标章节 "${args.targetSectionId}" 不存在`);
    }
    const document = moveBlock(envelope.document, args.blockId, args.targetSectionId, args.index);
    return next(
      envelope,
      document,
      `已移动块 ${args.blockId}`,
      [args.blockId, fromSectionId, args.targetSectionId],
      [args.blockId, fromSectionId, args.targetSectionId],
    );
  },
};

const updateTextArgs = z
  .object({
    blockId: z.string().min(1),
    runs: z
      .array(
        z.object({
          text: z.string(),
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          underline: z.boolean().optional(),
          strike: z.boolean().optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          size: z.number().positive().max(200).optional(),
          styleId: z.string().min(1).optional(),
          footnoteRef: z.string().min(1).optional(),
        }).strict(),
      )
      .min(1),
  })
  .strict();
const updateTextCommand: CommandDefinition<WordDocument, z.infer<typeof updateTextArgs>> = {
  id: "word.block.update-text",
  title: "替换块文本",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_ALL,
  parameters: updateTextArgs,
  execute(envelope, args, context) {
    requireBlock(envelope.document, args.blockId);
    // Range scopes only allow the container block; other scope kinds also
    // admit the owning section (see wordDocumentAdapter.resolveScope).
    const scopeIds =
      context.scope.kind === "range"
        ? [args.blockId]
        : [args.blockId, sectionIdOf(envelope.document, args.blockId)];
    const document = updateText(envelope.document, args.blockId, args.runs as Run[]);
    return next(envelope, document, `已更新块 ${args.blockId} 的文本`, [args.blockId], scopeIds);
  },
};
const setStyleArgs = z
  .object({
    blockId: z.string().min(1),
    styleId: z
      .enum(["normal", "title", "heading1", "heading2", "heading3", "caption", "quote"])
      .optional(),
    /** Empty string clears the paragraph styleId. */
    clearStyle: z.boolean().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
  })
  .strict();
const setStyleCommand: CommandDefinition<WordDocument, z.infer<typeof setStyleArgs>> = {
  id: "word.block.set-style",
  title: "设置块样式",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_ALL,
  parameters: setStyleArgs,
  execute(envelope, args) {
    const { block, sectionId } = requireBlock(envelope.document, args.blockId);
    if (block.type !== "paragraph") throw new WordOpError(`块 "${args.blockId}" (${block.type}) 不支持设置段落样式`);
    const document = setBlockStyle(envelope.document, args.blockId, {
      styleId: args.clearStyle ? "" : args.styleId,
      bold: args.bold,
      italic: args.italic,
    });
    return next(envelope, document, `已更新块 ${args.blockId} 的样式`, [args.blockId], [args.blockId, sectionId]);
  },
};

const updateTableArgs = z
  .object({
    blockId: z.string().min(1),
    addRow: z.boolean().optional(),
    removeRow: z.boolean().optional(),
    addColumn: z.boolean().optional(),
    removeColumn: z.boolean().optional(),
  })
  .strict();
const updateTableCommand: CommandDefinition<WordDocument, z.infer<typeof updateTableArgs>> = {
  id: "word.block.update-table",
  title: "调整表格行列",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: updateTableArgs,
  execute(envelope, args) {
    const { block, sectionId } = requireBlock(envelope.document, args.blockId);
    if (block.type !== "table") throw new WordOpError(`块 "${args.blockId}" (${block.type}) 不是表格`);
    const document = updateTable(envelope.document, args.blockId, args);
    return next(envelope, document, `已调整表格 ${args.blockId} 的行列`, [args.blockId], [args.blockId, sectionId]);
  },
};

const sectionIdArgs = z.object({ sectionId: z.string().min(1) }).strict();
const sectionHeadingArgs = z
  .object({ sectionId: z.string().min(1), heading: z.string().max(120).optional() })
  .strict();

const insertSectionArgs = z
  .object({
    sectionId: z.string().min(1).optional(),
    heading: z.string().min(1).max(120).optional(),
    index: z.number().int().min(0).optional(),
  })
  .strict();
const insertSectionCommand: CommandDefinition<WordDocument, z.infer<typeof insertSectionArgs>> = {
  id: "word.section.insert",
  title: "插入章节",
  riskLevel: "low",
  // Creates a brand-new section id: it can never be inside a container/selection
  // reach, so the gate must keep it file-only (mirrors PPT slide.add).
  allowedScopeKinds: ["file"],
  parameters: insertSectionArgs,
  execute(envelope, args) {
    const id = args.sectionId ?? newSectionId();
    const document = insertSection(envelope.document, id, args.heading, args.index);
    return {
      ...next(envelope, document, `已插入章节 ${id}`, [id], [id]),
      createdIds: [id],
    };
  },
};

const removeSectionCommand: CommandDefinition<WordDocument, z.infer<typeof sectionIdArgs>> = {
  id: "word.section.remove",
  title: "删除章节",
  riskLevel: "high",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: sectionIdArgs,
  execute(envelope, args) {
    const section = getSection(envelope.document, args.sectionId);
    if (!section) throw new WordOpError(`章节 "${args.sectionId}" 不存在`);
    const affected = [args.sectionId, ...section.blockIds];
    const document = removeSection(envelope.document, args.sectionId);
    return next(envelope, document, `已删除章节 ${args.sectionId}`, affected, affected);
  },
};

const renameSectionCommand: CommandDefinition<WordDocument, z.infer<typeof sectionHeadingArgs>> = {
  id: "word.section.rename",
  title: "重命名章节",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: sectionHeadingArgs,
  execute(envelope, args) {
    const document = renameSection(envelope.document, args.sectionId, args.heading);
    return next(envelope, document, `已更新章节 ${args.sectionId} 的标题`, [args.sectionId], [args.sectionId]);
  },
};

const footnoteArgs = z
  .object({
    footnoteId: z.string().min(1),
    blockId: z.string().min(1),
    runs: z.array(z.object({ text: z.string() }).strict()).min(1),
  })
  .strict();
const footnoteCommand: CommandDefinition<WordDocument, z.infer<typeof footnoteArgs>> = {
  id: "word.footnote.add",
  title: "添加脚注",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_ALL,
  parameters: footnoteArgs,
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.blockId);
    const document = addFootnote(envelope.document, args.footnoteId, args.blockId, args.runs as Run[]);
    return {
      ...next(envelope, document, `已在块 ${args.blockId} 添加脚注`, [args.footnoteId, args.blockId], [args.blockId, sectionId]),
      createdIds: [args.footnoteId],
    };
  },
};

const headerFooterArgs = z
  .object({
    sectionId: z.string().min(1),
    /** Omitted runs clears the header/footer. */
    runs: z.array(z.object({ text: z.string() }).strict()).min(1).optional(),
  })
  .strict();

function setHeaderFooter(kind: "header" | "footer"): CommandDefinition<WordDocument, z.infer<typeof headerFooterArgs>> {
  return {
    id: kind === "header" ? "word.header.set" : "word.footer.set",
    title: kind === "header" ? "设置页眉" : "设置页脚",
    riskLevel: "low",
    allowedScopeKinds: SCOPE_BLOCKISH,
    parameters: headerFooterArgs,
    execute(envelope, args) {
      if (!getSection(envelope.document, args.sectionId)) {
        throw new WordOpError(`章节 "${args.sectionId}" 不存在`);
      }
      const document =
        kind === "header"
          ? setSectionHeader(envelope.document, args.sectionId, args.runs as Run[] | undefined)
          : setSectionFooter(envelope.document, args.sectionId, args.runs as Run[] | undefined);
      const label = kind === "header" ? "页眉" : "页脚";
      return next(
        envelope,
        document,
        args.runs ? `已设置章节 ${args.sectionId} 的${label}` : `已清除章节 ${args.sectionId} 的${label}`,
        [args.sectionId],
        [args.sectionId],
      );
    },
  };
}

const tocArgs = z.object({ tocBlockId: z.string().min(1) }).strict();
const tocCommand: CommandDefinition<WordDocument, z.infer<typeof tocArgs>> = {
  id: "word.toc.generate",
  title: "生成目录",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: tocArgs,
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.tocBlockId);
    const document = generateToc(envelope.document, args.tocBlockId);
    const entryCount = collectEntryCount(document, args.tocBlockId);
    return next(
      envelope,
      document,
      `已生成目录（${entryCount} 个标题）`,
      [args.tocBlockId],
      [args.tocBlockId, sectionId],
    );
  },
};

function collectEntryCount(document: WordDocument, tocBlockId: string): number {
  const block = getBlock(document, tocBlockId);
  return block?.type === "tocPlaceholder" ? (block.entries?.length ?? 0) : 0;
}

const lockArgs = z.object({ blockId: z.string().min(1), locked: z.boolean() }).strict();
const lockCommand: CommandDefinition<WordDocument, z.infer<typeof lockArgs>> = {
  id: "word.block.set-locked",
  title: "锁定/解锁块",
  riskLevel: "medium",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: lockArgs,
  execute(envelope, args) {
    const wasLocked = getBlock(envelope.document, args.blockId)?.locked === true;
    const document = setBlockLocked(envelope.document, args.blockId, args.locked);
    return {
      ...next(
        envelope,
        document,
        args.locked ? `已锁定块 ${args.blockId}` : `已解锁块 ${args.blockId}`,
        [args.blockId],
        [args.blockId],
      ),
      ...(wasLocked ? { lockOverrideIds: [args.blockId] } : {}),
    };
  },
};

// ---------------------------------------------------------------------------
// List items / table cell / heading level / image patches (selected-block AI)

const runsSchema = z
  .array(
    z
      .object({
        text: z.string(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
        strike: z.boolean().optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        size: z.number().positive().max(200).optional(),
      })
      .strict(),
  )
  .min(1);

const listUpdateCommand: CommandDefinition<
  WordDocument,
  { blockId: string; items: { runs: Run[] }[]; ordered?: boolean }
> = {
  id: "word.list.update",
  title: "更新列表项",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: z
    .object({
      blockId: z.string().min(1),
      items: z.array(z.object({ runs: runsSchema }).strict()).min(1),
      ordered: z.boolean().optional(),
    })
    .strict(),
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.blockId);
    const document = updateListItems(envelope.document, args.blockId, args.items, args.ordered);
    return next(envelope, document, `已更新列表 ${args.blockId}`, [args.blockId], [args.blockId, sectionId]);
  },
};

const tableCellCommand: CommandDefinition<
  WordDocument,
  { blockId: string; row: number; col: number; runs: Run[] }
> = {
  id: "word.block.update-table-cell",
  title: "更新表格单元格",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: z
    .object({
      blockId: z.string().min(1),
      row: z.number().int().min(0),
      col: z.number().int().min(0),
      runs: runsSchema,
    })
    .strict(),
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.blockId);
    const document = updateTableCell(envelope.document, args.blockId, args.row, args.col, args.runs as Run[]);
    return next(envelope, document, `已更新表格单元格 ${args.blockId}`, [args.blockId], [args.blockId, sectionId]);
  },
};

const headingLevelCommand: CommandDefinition<WordDocument, { blockId: string; level: 1 | 2 | 3 }> = {
  id: "word.heading.set-level",
  title: "调整标题层级",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: z.object({ blockId: z.string().min(1), level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.blockId);
    const document = setHeadingLevel(envelope.document, args.blockId, args.level);
    return next(envelope, document, `标题 ${args.blockId} 调整为 H${args.level}`, [args.blockId], [args.blockId, sectionId]);
  },
};

const imageUpdateCommand: CommandDefinition<
  WordDocument,
  { blockId: string; src?: string; width?: number; caption?: string | null }
> = {
  id: "word.block.update-image",
  title: "更新图片块",
  riskLevel: "low",
  allowedScopeKinds: SCOPE_BLOCKISH,
  parameters: z
    .object({
      blockId: z.string().min(1),
      src: z.string().min(1).max(2000).optional(),
      width: z.number().positive().max(2000).optional(),
      caption: z.string().max(300).nullable().optional(),
    })
    .strict(),
  execute(envelope, args) {
    const { sectionId } = requireBlock(envelope.document, args.blockId);
    const document = updateImage(envelope.document, args.blockId, args);
    return next(envelope, document, `已更新图片块 ${args.blockId}`, [args.blockId], [args.blockId, sectionId]);
  },
};

export const WORD_COMMANDS: CommandDefinition<WordDocument>[] = [
  renameCommand,
  insertBlockCommand,
  removeBlockCommand,
  duplicateBlockCommand,
  moveBlockCommand,
  updateTextCommand,
  setStyleCommand,
  updateTableCommand,
  listUpdateCommand,
  tableCellCommand,
  headingLevelCommand,
  imageUpdateCommand,
  insertSectionCommand,
  removeSectionCommand,
  renameSectionCommand,
  footnoteCommand,
  setHeaderFooter("header"),
  setHeaderFooter("footer"),
  tocCommand,
  ...WORD_COMMENT_COMMANDS,
  lockCommand,
];
