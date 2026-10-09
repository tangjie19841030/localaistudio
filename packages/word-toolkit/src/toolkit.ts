import {
  createDocumentEnvelope,
  parseDocumentEnvelope,
  type DocumentAdapter,
  type DocumentEnvelope,
  type SelectionScope,
  type ScopeResolution,
  type ToolKit,
} from "@studio/studio-core";
import type { WordDocument } from "./document.js";
import {
  checkWordDocument,
  emptyWordDocument,
  getBlock,
  getSection,
  validateWordDocument,
  WORD_DOCUMENT_VERSION,
} from "./document.js";
import { WORD_COMMANDS } from "./commands.js";
import { assertTextRange, WordSelectionError } from "./selection.js";

export const WORD_TOOLKIT_ID = "builtin.word";
export const WORD_TOOLKIT_VERSION = "0.1.0";
export { WORD_DOCUMENT_VERSION } from "./document.js";

/** Parse + structural gate; throws with the issue lines on invalid documents. */
export function createWordDocumentEnvelope(document: WordDocument): DocumentEnvelope<WordDocument> {
  const parsed = validateWordDocument(document);
  const issues = checkWordDocument(parsed);
  if (issues.length > 0) throw new Error(`Word 文档结构错误: ${issues.join("; ")}`);
  return createDocumentEnvelope({
    projectType: "word",
    toolkitId: WORD_TOOLKIT_ID,
    toolkitVersion: WORD_TOOLKIT_VERSION,
    documentVersion: WORD_DOCUMENT_VERSION,
    document: parsed,
  });
}

function assertWordEnvelope(envelope: DocumentEnvelope): void {
  if (
    envelope.projectType !== "word" ||
    envelope.toolkitId !== WORD_TOOLKIT_ID ||
    envelope.toolkitVersion !== WORD_TOOLKIT_VERSION ||
    envelope.documentVersion !== WORD_DOCUMENT_VERSION
  ) {
    throw new Error("Word 文档信封不匹配");
  }
}

/** All locked blocks, plus sections and blocks containing locked members. */
function lockedScopeIds(document: WordDocument): { lockedIds: string[]; lockManagementIds: string[] } {
  const lockManagementIds = document.blocks.filter((block) => block.locked).map((block) => block.id);
  const lockedIds = new Set<string>(lockManagementIds);
  for (const section of document.sections) {
    if (section.blockIds.some((blockId) => lockedIds.has(blockId))) lockedIds.add(section.id);
  }
  return { lockedIds: [...lockedIds], lockManagementIds };
}

/**
 * Scope resolution for the core command dispatcher:
 * - file: allowAll; locks still block;
 * - container: target section ids — a section id itself and all its block ids;
 * - selection: target block ids (sections owning them included);
 * - range: containerId must be an existing run-bearing block; the block id is
 *   the only mutable target.
 * Locks always intersect the allowed set (locked ids remain in lockedIds).
 */
function resolveScope(document: WordDocument, scope: SelectionScope): ScopeResolution {
  const { lockedIds, lockManagementIds } = lockedScopeIds(document);
  if (scope.kind === "file") return { allowAll: true, allowedIds: [], lockedIds, lockManagementIds };

  const allowedIds = new Set<string>();
  if (scope.kind === "container") {
    for (const sectionId of scope.targetIds) {
      const section = getSection(document, sectionId);
      if (!section) throw new Error(`Word 章节不存在: ${sectionId}`);
      allowedIds.add(section.id);
      for (const blockId of section.blockIds) allowedIds.add(blockId);
    }
    return { allowAll: false, allowedIds: [...allowedIds], lockedIds, lockManagementIds };
  }

  if (scope.kind === "selection") {
    for (const blockId of scope.targetIds) {
      const block = getBlock(document, blockId);
      if (!block) throw new Error(`Word 块不存在: ${blockId}`);
      allowedIds.add(blockId);
      const owner = document.sections.find((section) => section.blockIds.includes(blockId));
      if (owner) allowedIds.add(owner.id);
    }
    return { allowAll: false, allowedIds: [...allowedIds], lockedIds, lockManagementIds };
  }

  const range = scope.range;
  if (!range) throw new WordSelectionError("文本范围缺少 range");
  assertTextRange(document, range);
  return { allowAll: false, allowedIds: [range.containerId], lockedIds, lockManagementIds };
}

export const wordDocumentAdapter: DocumentAdapter<WordDocument> = {
  createEmpty(name) {
    return createWordDocumentEnvelope(emptyWordDocument(name));
  },
  parse(input) {
    const envelope = parseDocumentEnvelope(input);
    assertWordEnvelope(envelope);
    return createWordDocumentEnvelope(validateWordDocument(envelope.document));
  },
  resolveScope(envelope, scope) {
    return resolveScope(envelope.document, scope);
  },
};

export const WORD_TOOLKIT: ToolKit<WordDocument> = {
  id: WORD_TOOLKIT_ID,
  version: WORD_TOOLKIT_VERSION,
  projectType: "word",
  document: wordDocumentAdapter,
  commands: WORD_COMMANDS,
  aiTools: [
    {
      id: "word.ai.draft",
      title: "起草文档",
      commandIds: ["word.block.insert", "word.section.insert", "word.doc.rename"],
    },
    {
      id: "word.ai.rewrite",
      title: "块级编辑（选中即改）",
      commandIds: [
        "word.block.update-text",
        "word.block.set-style",
        "word.comment.add",
        "word.list.update",
        "word.block.update-table-cell",
        "word.block.update-table",
        "word.heading.set-level",
        "word.block.update-image",
        "word.block.insert",
        "word.block.remove",
        "word.block.duplicate",
        "word.block.move",
        "word.block.set-locked",
      ],
    },
    {
      id: "word.ai.restructure",
      title: "重组结构",
      commandIds: [
        "word.block.move",
        "word.section.insert",
        "word.section.remove",
        "word.section.rename",
        "word.block.remove",
        "word.block.update-table",
        "word.toc.generate",
      ],
    },
  ],
  importers: [],
  exporters: [],
  inspectors: [{ id: "word.inspect.structure", title: "结构检查" }],
  capabilities: [],
};
