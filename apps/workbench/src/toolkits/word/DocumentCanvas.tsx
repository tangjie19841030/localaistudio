import type { Block, Section, WordDocument } from "@studio/word-toolkit";
import { getBlock, paginate } from "@studio/word-toolkit";
import type { CommandInvocation } from "@studio/studio-core";
import { useEffect, useMemo, useState } from "react";
import { BlockView, blockPlainText, isEditableTextBlock } from "./BlockRenderer";
import { manualInvocation, runWordCommands, useWordEditorStore } from "./state";

/** pt → px for page card dimensions (A4 595.3 x 841.9pt at 1:1). */
const PT = 1;

const EMPTY_IDS: readonly string[] = [];

/** Inline editor state for one block (heading/paragraph only). */
interface EditingState {
  blockId: string;
  text: string;
}

function submitText(editing: EditingState): void {
  // runs normalization: single plain-text run (direct formats reset on edit)
  runWordCommands([
    manualInvocation("word.block.update-text", { blockId: editing.blockId, runs: [{ text: editing.text }] }),
  ]);
}

function moveBlockWithin(blockId: string, offset: -1 | 1): void {
  // Always resolve the position from the live store document — the toolbar
  // may re-render lazily after consecutive clicks.
  const doc = useWordEditorStore.getState().doc;
  const section = doc?.sections.find((candidate) => candidate.blockIds.includes(blockId));
  if (!doc || !section) return;
  const at = section.blockIds.indexOf(blockId);
  runWordCommands([
    manualInvocation("word.block.move", { blockId, targetSectionId: section.id, index: at + offset }),
  ]);
}

/** Floating mini toolbar for the selected block: move/duplicate/delete (+ locked). */
function SelectedToolbar({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const block = getBlock(useWordEditorStore.getState().doc!, blockId);
  if (!block) return null;
  const remove = () => {
    runWordCommands([manualInvocation("word.block.remove", { blockId })]);
    onClose();
  };
  const duplicate = () => {
    runWordCommands([manualInvocation("word.block.duplicate", { blockId })]);
  };
  return (
    <div
      role="toolbar"
      aria-label={`块工具条 ${blockId}`}
      className="absolute -top-7 left-2 z-10 flex items-center gap-1 rounded-lg border border-hairline bg-overlay px-1 py-0.5 text-xs shadow-card"
    >
      {block.locked ? (
        <span className="px-1 text-[10px] text-warn">已锁定</span>
      ) : (
        <>
          <button type="button" aria-label="上移块" className="rounded-sm px-1.5 py-0.5 text-ink-soft hover:bg-surface" onClick={() => moveBlockWithin(blockId, -1)}>
            ↑
          </button>
          <button type="button" aria-label="下移块" className="rounded-sm px-1.5 py-0.5 text-ink-soft hover:bg-surface" onClick={() => moveBlockWithin(blockId, 1)}>
            ↓
          </button>
          <button type="button" aria-label="复制块" className="rounded-sm px-1.5 py-0.5 text-ink-soft hover:bg-surface" onClick={duplicate}>
            复制
          </button>
          <button type="button" aria-label="删除块" className="rounded-sm px-1.5 py-0.5 text-danger hover:bg-danger-soft" onClick={remove}>
            删除
          </button>
        </>
      )}
    </div>
  );
}

/** Inline textarea editor for a heading/paragraph block; blur commits the text. */
function InlineEditor({ block, onDone }: { block: Block; onDone: () => void }) {
  const sourceText = blockPlainText(block);
  const [text, setText] = useState(sourceText);

  // An AI update may replace the block while the inline editor is open.
  useEffect(() => {
    setText(sourceText);
  }, [block.id, sourceText]);

  const commit = () => {
    if (text !== blockPlainText(block)) submitText({ blockId: block.id, text });
    onDone();
  };

  return (
    <textarea
      autoFocus
      aria-label={`编辑块文本 ${block.id}`}
      className="w-full resize-none rounded-sm bg-white/90 text-ink outline-none ring-2 ring-accent"
      rows={Math.max(1, text.split("\n").length)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** Inline list editor: one line per item. */
function ListInlineEditor({ block, onDone }: { block: Extract<Block, { type: "list" }>; onDone: () => void }) {
  const source = block.items.map((item) => item.runs.map((r) => r.text).join("")).join("\n");
  const [text, setText] = useState(source);
  const commit = () => {
    const items = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({ runs: [{ text: line }] }));
    if (items.length > 0 && text !== source) {
      runWordCommands([manualInvocation("word.list.update", { blockId: block.id, items })]);
    }
    onDone();
  };
  return (
    <textarea
      autoFocus
      aria-label={`编辑列表 ${block.id}`}
      className="w-full resize-none rounded-sm bg-white/90 text-ink outline-none ring-2 ring-accent"
      rows={Math.max(2, text.split("\n").length)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    />
  );
}

/** Inline table editor: one line per row, cells separated by Tab. */
function TableInlineEditor({ block, onDone }: { block: Extract<Block, { type: "table" }>; onDone: () => void }) {
  const source = block.rows
    .map((row) => row.cells.map((cell) => cell.runs.map((r) => r.text).join("")).join("\t"))
    .join("\n");
  const [text, setText] = useState(source);
  const commit = () => {
    const colCount = block.rows[0]?.cells.length ?? 1;
    const invocations: CommandInvocation[] = [];
    text.split("\n").forEach((line, ri) => {
      const cells = line.split("\t");
      for (let ci = 0; ci < Math.min(cells.length, colCount); ci += 1) {
        const oldText = block.rows[ri]?.cells[ci]?.runs.map((r) => r.text).join("") ?? "";
        if (cells[ci] !== oldText) {
          invocations.push(
            manualInvocation("word.block.update-table-cell", {
              blockId: block.id,
              row: ri,
              col: ci,
              runs: [{ text: cells[ci] ?? "" }],
            }),
          );
        }
      }
    });
    if (invocations.length > 0) runWordCommands(invocations);
    onDone();
  };
  return (
    <textarea
      autoFocus
      aria-label={`编辑表格 ${block.id}`}
      title="每行一条，单元格之间按 Tab"
      className="w-full resize-none rounded-sm bg-white/90 text-ink outline-none ring-2 ring-accent"
      rows={Math.max(2, text.split("\n").length)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    />
  );
}

/** Whether a block supports double-click inline editing. */
function isInlineEditable(block: Block): boolean {
  return block.type === "heading" || block.type === "paragraph" || block.type === "list" || block.type === "table";
}

/** Blocks of one section that belong to the given page, in document order. */
function SectionBlocksOnPage({ doc, section, blockIds, editing, onStartEdit }: {
  doc: WordDocument;
  section: Section;
  blockIds: readonly string[];
  editing: string | null;
  onStartEdit: (blockId: string | null) => void;
}) {
  // Select stable references only (a selector that builds a fresh [] each
  // render makes useSyncExternalStore loop forever).
  const multiIds = useWordEditorStore((s) => s.selection.blockIds);
  const primaryId = useWordEditorStore((s) => s.selection.blockId);
  const selectedIds = multiIds.length > 0 ? multiIds : primaryId ? [primaryId] : EMPTY_IDS;
  const selectBlock = useWordEditorStore((s) => s.selectBlock);
  const toggleBlock = useWordEditorStore((s) => s.toggleBlock);
  const visible = section.blockIds.filter((id) => blockIds.includes(id));
  return (
    <>
      {visible.map((blockId) => {
        const block = getBlock(doc, blockId);
        if (!block) return null;
        const selected = selectedIds.includes(blockId);
        const primary = selectedIds[0] === blockId;
        return (
          <div
            key={blockId}
            data-block-id={blockId}
            aria-label={`文档块 ${blockId}`}
            className={`relative rounded-sm ${selected ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-hairline"}`}
            onClick={(e) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) toggleBlock(blockId);
              else selectBlock(blockId);
            }}
            onDoubleClick={() => {
              if (isInlineEditable(block) && !block.locked) onStartEdit(blockId);
            }}
          >
            {primary && selected && <SelectedToolbar blockId={blockId} onClose={() => selectBlock(null)} />}
            {editing === blockId && block.type === "list" ? (
              <ListInlineEditor block={block} onDone={() => onStartEdit(null)} />
            ) : editing === blockId && block.type === "table" ? (
              <TableInlineEditor block={block} onDone={() => onStartEdit(null)} />
            ) : editing === blockId && isEditableTextBlock(block) ? (
              <InlineEditor block={block} onDone={() => onStartEdit(null)} />
            ) : (
              <BlockView block={block} styles={doc.styles} />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Center A4 paged view: paginate() estimates the split; each page card renders
 * only the blocks the estimator placed on it (a section may span pages).
 */
export function DocumentCanvas({ doc }: { doc: WordDocument }) {
  const selectedId = useWordEditorStore((s) => s.selection.blockId);
  const [editing, setEditing] = useState<string | null>(null);
  const pages = useMemo(() => paginate(doc).pages, [doc]);

  // Scroll the selected block into view (outline click → canvas locate).
  useEffect(() => {
    if (!selectedId) return;
    const node = document.querySelector(`[data-block-id="${selectedId}"]`);
    // jsdom lacks scrollIntoView; guard so tests never stub it.
    if (typeof node?.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
  }, [selectedId]);

  // Keyboard: Delete removes every selected block; Escape clears selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      const store = useWordEditorStore.getState();
      const ids =
        store.selection.blockIds.length > 0
          ? store.selection.blockIds
          : store.selection.blockId
            ? [store.selection.blockId]
            : [];
      if (e.key === "Escape") {
        store.selectBlock(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && ids.length > 0) {
        const doc = store.doc;
        const removable = ids.filter((id) => doc?.blocks.some((b) => b.id === id && !b.locked));
        if (removable.length === 0) return;
        runWordCommands(removable.map((id) => manualInvocation("word.block.remove", { blockId: id })));
        store.selectBlock(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D") && ids.length === 1) {
        e.preventDefault();
        runWordCommands([manualInvocation("word.block.duplicate", { blockId: ids[0] })]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { width, height, margin } = doc.pageSettings;
  const pageStyle: React.CSSProperties = {
    width: `${width * PT}px`,
    minHeight: `${height * PT}px`,
    padding: `${margin.top * PT}px ${margin.right * PT}px ${margin.bottom * PT}px ${margin.left * PT}px`,
  };

  return (
    <div aria-label="文档画布" className="flex min-h-0 min-w-0 flex-1 overflow-auto bg-rail p-6">
      <div className="mx-auto flex w-max min-w-full flex-col items-center gap-6" style={{ minWidth: `${width * PT}px` }}>
        {pages.map((page) => (
          <section
            key={page.index}
            aria-label={`第 ${page.index + 1} 页`}
            data-page-index={page.index}
            className="relative bg-white text-black shadow-card"
            style={pageStyle}
          >
            <span className="absolute right-2 top-1 text-[10px] text-[#999]">第 {page.index + 1} 页</span>
            {doc.sections.map((section) =>
              section.blockIds.some((id) => page.blockIds.includes(id)) ? (
                <SectionBlocksOnPage
                  key={section.id}
                  doc={doc}
                  section={section}
                  blockIds={page.blockIds}
                  editing={editing}
                  onStartEdit={setEditing}
                />
              ) : null,
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
