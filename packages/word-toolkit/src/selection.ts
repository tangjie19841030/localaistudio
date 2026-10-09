import type { SelectionScope, TextRange } from "@studio/studio-core";
import { SELECTION_SCOPE_KINDS } from "@studio/studio-core";
import type { Block, WordDocument } from "./document.js";
import { getBlock, getSection } from "./document.js";
import { deriveResolvedBlockStyle } from "./styles.js";

/**
 * Word scope mapping onto the core SelectionScope kinds:
 * - file: whole document;
 * - container: one or more section ids;
 * - selection: one or more block ids;
 * - range: text range inside a single block (containerId = block id,
 *   start/end are run indices, end exclusive).
 */
export const WORD_SCOPE_KINDS = SELECTION_SCOPE_KINDS;
export type WordScopeKind = (typeof WORD_SCOPE_KINDS)[number];

export class WordSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordSelectionError";
  }
}

export interface WordSelection {
  kind: WordScopeKind;
  sectionIds: string[];
  blockIds: string[];
  range?: TextRange;
}

export const WORD_BLOCK_SCOPE_KINDS = ["file", "container", "selection"] as const;

/** True when a block-level change inside `scope` is permitted by the scope kind. */
export function scopeAllowsBlock(scope: SelectionScope, blockId: string, allowedSectionId: string): boolean {
  if (scope.kind === "file") return true;
  if (scope.kind === "container") return scope.targetIds.includes(allowedSectionId);
  return scope.targetIds.includes(blockId);
}

/**
 * Resolve a core SelectionScope into the word view of the selection.
 * Throws WordSelectionError on dangling references. Locks are reported by
 * the adapter's resolveScope (see toolkit.ts), not here.
 */
export function resolveWordSelection(doc: WordDocument, scope: SelectionScope): WordSelection {
  if (scope.kind === "file") return { kind: "file", sectionIds: doc.sections.map((s) => s.id), blockIds: [] };
  if (scope.kind === "container") {
    for (const sectionId of scope.targetIds) {
      if (!getSection(doc, sectionId)) throw new WordSelectionError(`章节不存在: ${sectionId}`);
    }
    return { kind: "container", sectionIds: [...scope.targetIds], blockIds: [] };
  }
  if (scope.kind === "selection") {
    for (const blockId of scope.targetIds) {
      if (!getBlock(doc, blockId)) throw new WordSelectionError(`块不存在: ${blockId}`);
    }
    return { kind: "selection", sectionIds: [], blockIds: [...scope.targetIds] };
  }
  const range = scope.range;
  if (!range) throw new WordSelectionError("文本范围缺少 range");
  const block = getBlock(doc, range.containerId);
  if (!block) throw new WordSelectionError(`文本范围所在块不存在: ${range.containerId}`);
  return { kind: "range", sectionIds: [], blockIds: [range.containerId], range };
}

export function textBlockRuns(block: Block): readonly { text: string }[] | undefined {
  if (block.type === "heading" || block.type === "paragraph") return block.runs;
  return undefined;
}

/**
 * Validate a text range against a document: block must carry runs, indices
 * must be ordered 0 <= start <= end <= runCount, and the block must not be
 * locked. Returns issue lines (empty = valid) for preview-level reporting;
 * command paths use assertTextRange for hard failures.
 */
export function validateTextRange(
  doc: WordDocument,
  range: TextRange,
  options: { allowLocked?: boolean } = {},
): string[] {
  const issues: string[] = [];
  const block = getBlock(doc, range.containerId);
  if (!block) return [`块不存在: ${range.containerId}`];
  const runs = textBlockRuns(block);
  if (!runs) return [`块 "${range.containerId}" 不包含可编辑文本`];
  if (range.start < 0 || range.end < range.start) issues.push(`文本范围无效: start=${range.start}, end=${range.end}`);
  else if (range.end > runs.length) issues.push(`文本范围越界: end=${range.end} 超过 runs 数量 ${runs.length}`);
  if (!options.allowLocked && block.locked) issues.push(`块 "${range.containerId}" 已锁定`);
  return issues;
}

export function assertTextRange(doc: WordDocument, range: TextRange): void {
  const issues = validateTextRange(doc, range);
  if (issues.length > 0) throw new WordSelectionError(issues[0]!);
}

/**
 * Full selection validation: references resolvable, range indices in bounds,
 * and no directly locked target. Section/block text is ignored.
 */
export function validateSelection(doc: WordDocument, scope: SelectionScope): string[] {
  const selection = resolveWordSelection(doc, scope);
  const issues: string[] = [];
  if (selection.kind === "range" && selection.range) {
    issues.push(...validateTextRange(doc, selection.range));
  }
  for (const blockId of selection.blockIds) {
    const block = getBlock(doc, blockId);
    if (block?.locked) issues.push(`块 "${blockId}" 已锁定`);
  }
  for (const sectionId of selection.sectionIds) {
    const section = getSection(doc, sectionId);
    if (section) {
      const lockedBlocks = section.blockIds.filter((blockId) => getBlock(doc, blockId)?.locked);
      issues.push(...lockedBlocks.map((blockId) => `章节 "${sectionId}" 内块 "${blockId}" 已锁定`));
    }
  }
  return issues;
}

/** keepWithNext preview helper: does this block demand same-page continuation? */
export function blockKeepsWithNext(doc: WordDocument, blockId: string): boolean {
  const block = getBlock(doc, blockId);
  return block !== undefined && deriveResolvedBlockStyle(doc.styles, block).keepWithNext;
}
