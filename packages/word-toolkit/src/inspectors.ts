import type { QualityInspector } from "@studio/studio-core";
import type { Block, WordDocument } from "./document.js";
import { getBlock } from "./document.js";
import { paginate } from "./pagination.js";

/**
 * P10.2 quality inspectors (pure functions over WordDocument): heading level
 * jumps, runs of >3 consecutive empty paragraphs, widow/orphan pagination
 * hints (reusing the estimated paginate() model), and comments pointing at
 * missing blocks. Issues locate blocks (or comments) by id only.
 */

export interface WordQualityIssue {
  inspectorId: string;
  /** Anchor block id when the issue is about a block (comment refs: the target). */
  blockId?: string;
  /** Set when the issue is about a comment itself. */
  commentId?: string;
  message: string;
}

/** studio-core QualityInspector ({ id, title }) + the pure inspect step. */
export interface WordInspector extends QualityInspector {
  inspect(doc: WordDocument): WordQualityIssue[];
}

/** Flat blocks in reading order (sections -> blockIds -> block table). */
function blocksInOrder(doc: WordDocument): Block[] {
  const found: Block[] = [];
  for (const section of doc.sections) {
    for (const blockId of section.blockIds) {
      const block = getBlock(doc, blockId);
      if (block) found.push(block);
    }
  }
  return found;
}

/** Heading level jump: consecutive headings skipping a level (1 -> 3). */
function headingJumpIssues(doc: WordDocument): WordQualityIssue[] {
  const issues: WordQualityIssue[] = [];
  let previousLevel: number | null = null;
  for (const block of blocksInOrder(doc)) {
    if (block.type !== "heading") continue;
    if (previousLevel !== null && block.level > previousLevel + 1) {
      issues.push({
        inspectorId: "word.qc.heading-jump",
        blockId: block.id,
        message: `标题 "${block.id}" 从 ${previousLevel} 级直接跳到 ${block.level} 级`,
      });
    }
    previousLevel = block.level;
  }
  return issues;
}

function isBlankParagraph(block: Block): boolean {
  if (block.type !== "paragraph") return false;
  return block.runs.every((run) => run.text.trim().length === 0);
}

/** More than 3 consecutive empty paragraphs; the 4th one carries the issue. */
function emptyParagraphIssues(doc: WordDocument): WordQualityIssue[] {
  const issues: WordQualityIssue[] = [];
  let runLength = 0;
  for (const block of blocksInOrder(doc)) {
    if (!isBlankParagraph(block)) {
      runLength = 0;
      continue;
    }
    runLength += 1;
    if (runLength === 4) {
      issues.push({
        inspectorId: "word.qc.empty-paragraphs",
        blockId: block.id,
        message: `块 "${block.id}" 处连续空段落超过 3 个`,
      });
    }
  }
  return issues;
}

/** Widow/orphan hints straight from the estimated pagination model. */
function paginationIssues(doc: WordDocument): WordQualityIssue[] {
  return paginate(doc).issues.map((issue) => ({
    inspectorId: "word.qc.widow-orphan",
    blockId: issue.blockId,
    message: issue.message,
  }));
}

/** Comments anchored at blocks that no longer exist. */
function commentRefIssues(doc: WordDocument): WordQualityIssue[] {
  const blockIds = new Set(doc.blocks.map((block) => block.id));
  return doc.comments
    .filter((comment) => !blockIds.has(comment.targetBlockId))
    .map((comment) => ({
      inspectorId: "word.qc.comment-ref",
      blockId: comment.targetBlockId,
      commentId: comment.id,
      message: `批注 "${comment.id}" 引用了不存在的块 "${comment.targetBlockId}"`,
    }));
}

export const WORD_INSPECTORS: WordInspector[] = [
  {
    id: "word.qc.heading-jump",
    title: "标题层级跳跃检查",
    inspect: headingJumpIssues,
  },
  {
    id: "word.qc.empty-paragraphs",
    title: "连续空段落检查",
    inspect: emptyParagraphIssues,
  },
  {
    id: "word.qc.widow-orphan",
    title: "孤行检查",
    inspect: paginationIssues,
  },
  {
    id: "word.qc.comment-ref",
    title: "批注引用检查",
    inspect: commentRefIssues,
  },
];

/** Run every inspector (or a given subset) and flatten the issues. */
export function runWordInspectors(
  doc: WordDocument,
  inspectors: readonly WordInspector[] = WORD_INSPECTORS,
): WordQualityIssue[] {
  return inspectors.flatMap((inspector) => inspector.inspect(doc));
}
