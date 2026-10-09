import type { WordDocument } from "@studio/word-toolkit";
import { getBlock } from "@studio/word-toolkit";
import { useState } from "react";
import { manualInvocation, runWordCommands, useWordEditorStore } from "./state";

/** Review tab callbacks. The draft props are optional so the panel remains
 * usable in isolation while WordEditorPanel can keep drafts alive when the
 * rail is temporarily unmounted. */
export type ReviewPanelProps = {
  onLocateBlock: (blockId: string) => void;
  draft?: string;
  onDraftChange?: (draft: string) => void;
};

const DEFAULT_AUTHOR = "我";
let commentSeq = 0;

/** Fresh comment id; stable prefix + counter keeps it unique in-session. */
function newCommentId(): string {
  commentSeq += 1;
  return `cmt_${Date.now().toString(36)}_${commentSeq}`;
}

function addComment(targetBlockId: string, text: string): boolean {
  return runWordCommands([
    manualInvocation("word.comment.add", { commentId: newCommentId(), targetBlockId, author: DEFAULT_AUTHOR, text }),
  ]);
}

function removeComment(commentId: string): void {
  runWordCommands([manualInvocation("word.comment.remove", { commentId })]);
}

function updateComment(commentId: string, text: string): void {
  runWordCommands([manualInvocation("word.comment.update", { commentId, text })]);
}

/** Human label for a comment's target block (author/text/target shown in list). */
function targetLabel(doc: WordDocument, blockId: string): string {
  const block = getBlock(doc, blockId);
  if (!block) return blockId;
  const order = doc.sections.flatMap((section) => section.blockIds);
  return `第 ${order.indexOf(blockId) + 1} 块`;
}

/** One comment row: click locates the block; inline edit + delete. */
function CommentRow({ doc, commentId, author, text, targetBlockId, onLocate }: {
  doc: WordDocument;
  commentId: string;
  author: string;
  text: string;
  targetBlockId: string;
  onLocate: (blockId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== text) updateComment(commentId, draft);
  };

  return (
    <li
      aria-label={`批注 ${text}`}
      className="flex flex-col gap-1 rounded-lg border border-hairline bg-rail p-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="font-semibold text-ink-soft hover:text-accent" onClick={() => onLocate(targetBlockId)}>
          {author} · {targetLabel(doc, targetBlockId)}
        </button>
        <span className="flex gap-1">
          <button type="button" aria-label={`编辑批注 ${commentId}`} className="rounded-sm px-1 text-ink-muted hover:bg-surface hover:text-ink" onClick={() => { setDraft(text); setEditing(true); }}>
            改
          </button>
          <button type="button" aria-label={`删除批注 ${commentId}`} className="rounded-sm px-1 text-danger hover:bg-danger-soft" onClick={() => removeComment(commentId)}>
            删
          </button>
        </span>
      </div>
      {editing ? (
        <input
          aria-label="批注文本输入"
          className="rounded-sm bg-surface px-1 text-xs text-ink outline-none ring-1 ring-hairline focus:ring-accent"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
        />
      ) : (
        <p className="text-ink-muted">{text}</p>
      )}
    </li>
  );
}

/** Review tab body (WordAuxRail owns the rail chrome): comment list anchored
 *  at the selected block. */
export function ReviewPanel({ onLocateBlock, draft: controlledDraft, onDraftChange }: ReviewPanelProps) {
  // Nullable: the props->store sync runs in an effect, so the FIRST render can
  // still see the store's initial null doc — never assert it non-null here.
  const doc = useWordEditorStore((s) => s.doc);
  const selectedBlockId = useWordEditorStore((s) => s.selection.blockId);
  const [uncontrolledDraft, setUncontrolledDraft] = useState("");
  const draft = controlledDraft ?? uncontrolledDraft;
  const updateDraft = onDraftChange ?? setUncontrolledDraft;

  const submit = () => {
    if (!selectedBlockId || !draft.trim()) return;
    if (addComment(selectedBlockId, draft)) updateDraft("");
  };

  if (!doc) {
    return (
      <section aria-label="批注面板" className="flex min-h-0 flex-1 flex-col text-xs text-ink-muted">
        批注加载中…
      </section>
    );
  }

  return (
    <section aria-label="批注面板" className="flex min-h-0 flex-1 flex-col gap-2">
      <h2 className="text-xs font-semibold text-ink-soft">批注（{doc.comments.length}）</h2>
      <div className="flex flex-col gap-1">
        <textarea
          aria-label="新批注内容"
          rows={2}
          className="w-full resize-none rounded-md border border-hairline bg-overlay px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder={selectedBlockId ? `评论选中块（${selectedBlockId}）…` : "先在文档中选中一个块"}
          value={draft}
          disabled={!selectedBlockId}
          onChange={(e) => updateDraft(e.target.value)}
        />
        <button
          type="button"
          aria-label="添加批注"
          disabled={!selectedBlockId || !draft.trim()}
          className="self-end rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          onClick={submit}
        >
          添加批注
        </button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {doc.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            doc={doc}
            commentId={comment.id}
            author={comment.author}
            text={comment.text}
            targetBlockId={comment.targetBlockId}
            onLocate={onLocateBlock}
          />
        ))}
      </ul>
    </section>
  );
}
