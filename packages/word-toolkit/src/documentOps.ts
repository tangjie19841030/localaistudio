import type { Block, Run, Section, WordDocument } from "./document.js";
import { checkWordDocument } from "./document.js";

/** All ops throw this on invalid input; message is user-visible (Chinese). */
export class WordOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordOpError";
  }
}

let idCounter = 0;
/** Fresh stable id: "wb_" + base36 timestamp + counter, no dependency needed. */
export function newBlockId(): string {
  idCounter += 1;
  return `wb_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function newSectionId(): string {
  idCounter += 1;
  return `ws_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Post-op invariant gate: any checkWordDocument issue aborts the op. */
function assertValid(doc: WordDocument): void {
  const issues = checkWordDocument(doc);
  if (issues.length > 0) throw new WordOpError(`文档不变量失败: ${issues.join("; ")}`);
}

function blockIndex(doc: WordDocument, blockId: string): { section: Section; index: number } {
  const section = doc.sections.find((candidate) => candidate.blockIds.includes(blockId));
  if (!section) throw new WordOpError(`块 "${blockId}" 不存在`);
  return { section, index: section.blockIds.indexOf(blockId) };
}

function replaceBlock(doc: WordDocument, blockId: string, edit: (block: Block) => Block): WordDocument {
  return { ...doc, blocks: doc.blocks.map((block) => (block.id === blockId ? edit(block) : block)) };
}

function replaceSection(doc: WordDocument, sectionId: string, edit: (section: Section) => Section): WordDocument {
  return { ...doc, sections: doc.sections.map((section) => (section.id === sectionId ? edit(section) : section)) };
}

/** Clamp an insertion index into [0, length] (after any pending removal). */
function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

export function renameDocument(doc: WordDocument, name: string): WordDocument {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 120) throw new WordOpError("文档名必须 1-120 个字符");
  return { ...doc, name: trimmed };
}

export function insertBlock(doc: WordDocument, block: Block, sectionId: string, index?: number): WordDocument {
  const section = doc.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new WordOpError(`章节 "${sectionId}" 不存在`);
  if (doc.blocks.some((candidate) => candidate.id === block.id)) {
    throw new WordOpError(`块 ID "${block.id}" 已存在`);
  }
  const at = clampIndex(index, section.blockIds.length);
  const next = replaceSection(doc, sectionId, (target) => ({
    ...target,
    blockIds: [...target.blockIds.slice(0, at), block.id, ...target.blockIds.slice(at)],
  }));
  next.blocks = [...doc.blocks, block];
  assertValid(next);
  return next;
}

export function removeBlock(doc: WordDocument, blockId: string): WordDocument {
  const { section } = blockIndex(doc, blockId);
  const next = replaceSection(doc, section.id, (target) => ({
    ...target,
    blockIds: target.blockIds.filter((candidate) => candidate !== blockId),
  }));
  next.blocks = doc.blocks.filter((block) => block.id !== blockId);
  next.comments = doc.comments.filter((comment) => comment.targetBlockId !== blockId);
  assertValid(next);
  return next;
}

/** Move within one section or across sections; position resolved after removal. */
/** Deep-clone a block (new id) directly after the source, in the same section. */
export function duplicateBlock(doc: WordDocument, blockId: string, newBlockId: string): WordDocument {
  const { section, index } = blockIndex(doc, blockId);
  if (doc.blocks.some((b) => b.id === newBlockId)) {
    throw new WordOpError(`块 ID "${newBlockId}" 已存在`);
  }
  const source = doc.blocks.find((b) => b.id === blockId);
  if (!source) throw new WordOpError(`块 "${blockId}" 不存在`);
  const clone = { ...structuredCloneLike(source), id: newBlockId } as Block;
  delete (clone as { locked?: boolean }).locked;
  const next = replaceSection(doc, section.id, (target) => ({
    ...target,
    blockIds: [
      ...target.blockIds.slice(0, index + 1),
      newBlockId,
      ...target.blockIds.slice(index + 1),
    ],
  }));
  next.blocks = [...doc.blocks, clone];
  assertValid(next);
  return next;
}

/** Structured clone without a structuredClone dependency (Node 16-safe). */
function structuredCloneLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function moveBlock(doc: WordDocument, blockId: string, targetSectionId: string, index?: number): WordDocument {
  const { section: from } = blockIndex(doc, blockId);
  const to = doc.sections.find((candidate) => candidate.id === targetSectionId);
  if (!to) throw new WordOpError(`目标章节 "${targetSectionId}" 不存在`);

  let next = replaceSection(doc, from.id, (target) => ({
    ...target,
    blockIds: target.blockIds.filter((candidate) => candidate !== blockId),
  }));
  const remaining = (from.id === targetSectionId
    ? next.sections.find((candidate) => candidate.id === targetSectionId)!
    : to).blockIds;
  const at = clampIndex(index, remaining.length);
  next = replaceSection(next, targetSectionId, (target) => ({
    ...target,
    blockIds: [...target.blockIds.slice(0, at), blockId, ...target.blockIds.slice(at)],
  }));
  assertValid(next);
  return next;
}

/** Replace all runs of a heading/paragraph wholesale. */
export function updateText(doc: WordDocument, blockId: string, runs: Run[]): WordDocument {
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (block.type !== "heading" && block.type !== "paragraph") {
    throw new WordOpError(`块 "${blockId}" (${block.type}) 不支持替换文本`);
  }
  if (runs.length === 0) throw new WordOpError("runs 不能为空");
  const next = replaceBlock(doc, blockId, () =>
    block.type === "heading" ? { ...block, runs } : { ...block, runs },
  );
  assertValid(next);
  return next;
}

export interface BlockFormatPatch {
  styleId?: string;
  bold?: boolean;
  italic?: boolean;
  /** Whether bold/italic apply to runs instead of the paragraph style. */
  directOnRuns?: boolean;
}

export function setBlockStyle(doc: WordDocument, blockId: string, patch: BlockFormatPatch): WordDocument {
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (block.type !== "paragraph") throw new WordOpError(`块 "${blockId}" (${block.type}) 不支持设置段落样式`);
  const next = replaceBlock(doc, blockId, (target) => {
    const typed = target as typeof block & { type: "paragraph" };
    if (typed.type !== "paragraph") return target;
    const updated: Block = { ...typed };
    if (patch.styleId !== undefined) {
      if (patch.styleId === "") {
        const { styleId: _styleId, ...rest } = updated as typeof typed;
        (updated as typeof typed).styleId = undefined;
        void rest;
      } else {
        updated.styleId = patch.styleId;
      }
    }
    if (patch.bold !== undefined || patch.italic !== undefined) {
      updated.runs = typed.runs.map((run) => ({
        ...run,
        ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
        ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
      }));
    }
    return updated;
  });
  assertValid(next);
  return next;
}

/** Replace a list block's items (whole-array patch, like update-text). */
export function updateListItems(
  doc: WordDocument,
  blockId: string,
  items: { runs: Run[] }[],
  ordered?: boolean,
): WordDocument {
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (block.type !== "list") throw new WordOpError(`块 "${blockId}" (${block.type}) 不是列表`);
  if (items.length === 0) throw new WordOpError("列表至少保留一项");
  const next = replaceBlock(doc, blockId, () => ({
    ...block,
    items,
    ...(ordered !== undefined ? { ordered } : {}),
  }));
  assertValid(next);
  return next;
}

/** Replace one table cell's runs. */
export function updateTableCell(
  doc: WordDocument,
  blockId: string,
  rowIndex: number,
  colIndex: number,
  runs: Run[],
): WordDocument {
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (block.type !== "table") throw new WordOpError(`块 "${blockId}" (${block.type}) 不是表格`);
  if (runs.length === 0) throw new WordOpError("runs 不能为空");
  const row = block.rows[rowIndex];
  if (!row) throw new WordOpError(`表格没有第 ${rowIndex + 1} 行`);
  const cell = row.cells[colIndex];
  if (!cell) throw new WordOpError(`表格没有第 ${colIndex + 1} 列`);
  const next = replaceBlock(doc, blockId, () => ({
    ...block,
    rows: block.rows.map((r, ri) =>
      ri !== rowIndex
        ? r
        : { cells: r.cells.map((c, ci) => (ci === colIndex ? { runs } : c)) },
    ),
  }));
  assertValid(next);
  return next;
}

/** Change a heading block's level (1–3). */
export function setHeadingLevel(doc: WordDocument, blockId: string, level: 1 | 2 | 3): WordDocument {
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (block.type !== "heading") throw new WordOpError(`块 "${blockId}" (${block.type}) 不是标题`);
  const next = replaceBlock(doc, blockId, () => ({ ...block, level }));
  assertValid(next);
  return next;
}

/** Patch an image block (src/width/caption). */
export function updateImage(
  doc: WordDocument,
  blockId: string,
  patch: { src?: string; width?: number; caption?: string | null },
): WordDocument {
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (block.type !== "image") throw new WordOpError(`块 "${blockId}" (${block.type}) 不是图片块`);
  const next = replaceBlock(doc, blockId, () => {
    const updated = {
      ...block,
      ...(patch.src !== undefined ? { src: patch.src } : {}),
      ...(patch.width !== undefined ? { width: patch.width } : {}),
      ...(patch.caption !== undefined && patch.caption !== null ? { caption: patch.caption } : {}),
    };
    if (patch.caption === null) delete (updated as { caption?: string }).caption;
    return updated;
  });
  assertValid(next);
  return next;
}

export function updateTable(
  doc: WordDocument,
  blockId: string,
  patch: { addRow?: boolean; removeRow?: boolean; addColumn?: boolean; removeColumn?: boolean },
): WordDocument {
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (block.type !== "table") throw new WordOpError(`块 "${blockId}" (${block.type}) 不是表格`);
  if (patch.removeRow !== undefined && patch.addRow !== undefined) {
    throw new WordOpError("addRow 与 removeRow 不能同时指定");
  }
  const columns = block.rows[0]?.cells.length ?? 0;
  if (patch.removeRow && block.rows.length <= 1) throw new WordOpError("表格至少要保留一行");
  if (patch.removeColumn && columns <= 1) throw new WordOpError("表格至少要保留一列");
  const applyColumn = (cells: { runs: Run[] }[]) => patch.removeColumn
    ? cells.slice(0, -1)
    : patch.addColumn
      ? [...cells, { runs: [{ text: "" }] }]
      : cells;
  const next = replaceBlock(doc, blockId, (target) => {
    const typed = target as typeof block & { type: "table" };
    if (typed.type !== "table") return target;
    let rows = typed.rows.map((row) => ({ cells: applyColumn(row.cells) }));
    if (patch.addRow) rows = [...rows, { cells: Array.from({ length: columns + (patch.addColumn ? 1 : 0) }, () => ({ runs: [{ text: "" }] as Run[] })) }];
    if (patch.removeRow) rows = rows.slice(0, -1);
    if (patch.removeColumn && block.headerRowCount > 0 && columns - 1 < block.headerRowCount) {
      return { ...typed, rows };
    }
    return { ...typed, rows };
  });
  assertValid(next);
  return next;
}

export function insertSection(doc: WordDocument, sectionId: string, heading?: string, index?: number): WordDocument {
  if (doc.sections.some((candidate) => candidate.id === sectionId)) {
    throw new WordOpError(`章节 ID "${sectionId}" 已存在`);
  }
  const at = clampIndex(index, doc.sections.length);
  const section: Section = { id: sectionId, blockIds: [], ...(heading !== undefined ? { heading } : {}) };
  // An empty section would fail checkWordDocument only if it needs a block; we
  // allow empty sections structurally, but checkWordDocument flags nothing for
  // them because "block referenced by many sections" is the only section rule.
  return {
    ...doc,
    sections: [...doc.sections.slice(0, at), section, ...doc.sections.slice(at)],
  };
}

export function removeSection(doc: WordDocument, sectionId: string): WordDocument {
  const section = doc.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new WordOpError(`章节 "${sectionId}" 不存在`);
  if (doc.sections.length === 1) throw new WordOpError("文档至少要保留一个章节");
  const doomedBlocks = new Set(section.blockIds);
  const next: WordDocument = {
    ...doc,
    sections: doc.sections.filter((candidate) => candidate.id !== sectionId),
    blocks: doc.blocks.filter((block) => !doomedBlocks.has(block.id)),
    comments: doc.comments.filter((comment) => !doomedBlocks.has(comment.targetBlockId)),
  };
  assertValid(next);
  return next;
}

export function renameSection(doc: WordDocument, sectionId: string, heading: string | undefined): WordDocument {
  const trimmed = heading?.trim();
  const next = replaceSection(doc, sectionId, (target) => {
    if (trimmed === undefined || trimmed === "") {
      const { heading: _heading, ...rest } = target;
      return rest;
    }
    return { ...target, heading: trimmed };
  });
  if (next === doc) throw new WordOpError(`章节 "${sectionId}" 不存在`);
  return next;
}

export function setSectionHeader(doc: WordDocument, sectionId: string, runs: Run[] | undefined): WordDocument {
  return setSectionHeaderFooter(doc, sectionId, runs, "header");
}

export function setSectionFooter(doc: WordDocument, sectionId: string, runs: Run[] | undefined): WordDocument {
  return setSectionHeaderFooter(doc, sectionId, runs, "footer");
}

function setSectionHeaderFooter(
  doc: WordDocument,
  sectionId: string,
  runs: Run[] | undefined,
  key: "header" | "footer",
): WordDocument {
  const next = replaceSection(doc, sectionId, (target) => {
    const without = { ...target };
    delete without[key];
    if (runs === undefined) return without;
    return { ...without, [key]: { runs } };
  });
  if (next === doc) throw new WordOpError(`章节 "${sectionId}" 不存在`);
  return next;
}

export function addFootnote(doc: WordDocument, footnoteId: string, blockId: string, runs: Run[]): WordDocument {
  if (doc.footnotes.some((candidate) => candidate.id === footnoteId)) {
    throw new WordOpError(`脚注 ID "${footnoteId}" 已存在`);
  }
  const block = doc.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new WordOpError(`块 "${blockId}" 不存在`);
  if (runs.length === 0) throw new WordOpError("脚注内容不能为空");
  const next = replaceBlock(doc, blockId, (target) => ({
    ...target,
    runs: [...lastRuns(target), { text: "", footnoteRef: footnoteId }],
  }));
  next.footnotes = [...doc.footnotes, { id: footnoteId, runs }];
  assertValid(next);
  return next;
}

function lastRuns(block: Block): Run[] {
  if (block.type === "heading" || block.type === "paragraph") return [...block.runs];
  throw new WordOpError(`块 "${block.type}" 不支持脚注`);
}

/** Regenerate the tocPlaceholder snapshot from the live heading structure. */
export function generateToc(doc: WordDocument, tocBlockId: string): WordDocument {
  const tocBlock = doc.blocks.find((candidate) => candidate.id === tocBlockId);
  if (!tocBlock) throw new WordOpError(`块 "${tocBlockId}" 不存在`);
  if (tocBlock.type !== "tocPlaceholder") throw new WordOpError(`块 "${tocBlockId}" 不是目录占位符`);

  const entries = collectHeadingEntries(doc);
  const next = replaceBlock(doc, tocBlockId, (target) => {
    const typed = target as typeof tocBlock & { type: "tocPlaceholder" };
    return { ...typed, entries };
  });
  assertValid(next);
  return next;
}

export function collectHeadingEntries(doc: WordDocument): { headingBlockId: string; level: 1 | 2 | 3; text: string }[] {
  const entries: { headingBlockId: string; level: 1 | 2 | 3; text: string }[] = [];
  for (const section of doc.sections) {
    for (const blockId of section.blockIds) {
      const block = doc.blocks.find((candidate) => candidate.id === blockId);
      if (block?.type !== "heading") continue;
      entries.push({
        headingBlockId: block.id,
        level: block.level,
        text: block.runs.map((run) => run.text).join(""),
      });
    }
  }
  return entries;
}

export function setBlockLocked(doc: WordDocument, blockId: string, locked: boolean): WordDocument {
  const next = replaceBlock(doc, blockId, (target) => {
    if (locked) return { ...target, locked: true };
    const { locked: _locked, ...rest } = target;
    return rest as Block;
  });
  if (next === doc) throw new WordOpError(`块 "${blockId}" 不存在`);
  return next;
}

export { assertValid };
