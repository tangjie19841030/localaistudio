import type { CommandDefinition, CommandResult, DocumentEnvelope } from "@studio/studio-core";
import { z } from "zod";
import type { WordComment, WordDocument } from "./document.js";
import { getBlock, sectionOfBlock } from "./document.js";
import { WordOpError, assertValid } from "./documentOps.js";

/** Comments CRUD with target validation. Pure: input doc never mutated. */
export function addComment(
  doc: WordDocument,
  comment: { id: string; author: string; text: string; targetBlockId: string },
): WordDocument {
  if (doc.comments.some((candidate) => candidate.id === comment.id)) {
    throw new WordOpError(`批注 ID "${comment.id}" 已存在`);
  }
  if (!doc.blocks.some((block) => block.id === comment.targetBlockId)) {
    throw new WordOpError(`批注目标块 "${comment.targetBlockId}" 不存在`);
  }
  const trimmed = comment.text.trim();
  if (trimmed.length === 0) throw new WordOpError("批注内容不能为空");
  const next = { ...doc, comments: [...doc.comments, { ...comment, text: trimmed }] };
  assertValid(next);
  return next;
}

export function removeComment(doc: WordDocument, commentId: string): WordDocument {
  if (!doc.comments.some((candidate) => candidate.id === commentId)) {
    throw new WordOpError(`批注 "${commentId}" 不存在`);
  }
  const next = { ...doc, comments: doc.comments.filter((candidate) => candidate.id !== commentId) };
  assertValid(next);
  return next;
}

export function updateComment(doc: WordDocument, commentId: string, text: string): WordDocument {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new WordOpError("批注内容不能为空");
  if (!doc.comments.some((candidate) => candidate.id === commentId)) {
    throw new WordOpError(`批注 "${commentId}" 不存在`);
  }
  const next = {
    ...doc,
    comments: doc.comments.map((candidate) => (candidate.id === commentId ? { ...candidate, text: trimmed } : candidate)),
  };
  assertValid(next);
  return next;
}

export function commentsForBlock(doc: WordDocument, blockId: string): WordComment[] {
  return doc.comments.filter((comment) => comment.targetBlockId === blockId);
}

function commentResult(
  envelope: DocumentEnvelope<WordDocument>,
  document: WordDocument,
  summary: string,
  affectedIds: string[],
  scopeIds: string[],
): CommandResult<WordDocument> {
  return { nextEnvelope: { ...envelope, document }, summary, affectedIds, scopeIds };
}

/** Owning section id of the anchored block, for scope enforcement. */
function sectionIdOfBlock(doc: WordDocument, blockId: string): string {
  const sectionId = sectionOfBlock(doc, blockId)?.id;
  if (!sectionId) throw new WordOpError(`块 "${blockId}" 不属于任何章节`);
  return sectionId;
}

const commentAddArgs = z
  .object({ commentId: z.string().min(1), targetBlockId: z.string().min(1), author: z.string().min(1), text: z.string().min(1) })
  .strict();

const addCommentCommand: CommandDefinition<WordDocument, z.infer<typeof commentAddArgs>> = {
  id: "word.comment.add",
  title: "添加批注",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection", "range"],
  parameters: commentAddArgs,
  execute(envelope, args) {
    if (!getBlock(envelope.document, args.targetBlockId)) {
      throw new WordOpError(`块 "${args.targetBlockId}" 不存在`);
    }
    const sectionId = sectionIdOfBlock(envelope.document, args.targetBlockId);
    const document = addComment(envelope.document, {
      id: args.commentId,
      author: args.author,
      text: args.text,
      targetBlockId: args.targetBlockId,
    });
    return {
      ...commentResult(
        envelope,
        document,
        `已在块 ${args.targetBlockId} 添加批注`,
        [args.commentId, args.targetBlockId],
        [args.targetBlockId, sectionId],
      ),
      createdIds: [args.commentId],
    };
  },
};

const commentUpdateArgs = z.object({ commentId: z.string().min(1), text: z.string().min(1) }).strict();

const updateCommentCommand: CommandDefinition<WordDocument, z.infer<typeof commentUpdateArgs>> = {
  id: "word.comment.update",
  title: "更新批注",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: commentUpdateArgs,
  execute(envelope, args) {
    const document = updateComment(envelope.document, args.commentId, args.text);
    return commentResult(envelope, document, `已更新批注 ${args.commentId}`, [args.commentId], [args.commentId]);
  },
};

const commentRemoveArgs = z.object({ commentId: z.string().min(1) }).strict();

const removeCommentCommand: CommandDefinition<WordDocument, z.infer<typeof commentRemoveArgs>> = {
  id: "word.comment.remove",
  title: "删除批注",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: commentRemoveArgs,
  execute(envelope, args) {
    const document = removeComment(envelope.document, args.commentId);
    return commentResult(envelope, document, `已删除批注 ${args.commentId}`, [args.commentId], [args.commentId]);
  },
};

export const WORD_COMMENT_COMMANDS: CommandDefinition<WordDocument>[] = [
  addCommentCommand,
  updateCommentCommand,
  removeCommentCommand,
];
