import type { Block } from "@studio/word-toolkit";
import { paginate } from "@studio/word-toolkit";
import { useWordEditorStore } from "./state";

/**
 * P10.2 print preview: estimated pagination over the local document (the
 * word-toolkit paginate model — block-granular, NOT exact Word layout).
 * Each estimated page renders as an A4-proportioned sheet with its blocks in
 * reading order. Purely presentational; never mutates the document.
 */

function BlockView({ block }: { block: Block }) {
  // Body text must never be clipped: pre-wrap keeps explicit newlines and
  // break-words wraps long URLs inside the fixed-width preview sheet.
  const safeText = "whitespace-pre-wrap break-words";
  if (block.type === "pageBreak") {
    return <div aria-label="分页符" className="my-1 border-t border-dashed border-ink-ghost text-center text-[8px] text-neutral-400">— 分页 —</div>;
  }
  if (block.type === "image") {
    return <p className={`my-1 text-center text-[9px] italic text-neutral-500 ${safeText}`}>[图片] {block.caption ?? block.src}</p>;
  }
  if (block.type === "tocPlaceholder") {
    return (
      <div className="my-1">
        {(block.entries ?? []).map((entry) => (
          <p key={entry.headingBlockId} className={`${safeText} text-[9px] text-neutral-600`} style={{ paddingLeft: `${(entry.level - 1) * 10}px` }}>
            {entry.text}
          </p>
        ))}
      </div>
    );
  }
  if (block.type === "list") {
    return (
      <ul className="my-1 list-disc pl-4">
        {block.items.map((item, at) => (
          <li key={at} className={`${safeText} text-[9px] text-neutral-800`}>{item.runs.map((run) => run.text).join("")}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "table") {
    return (
      <div className="my-1 border border-neutral-300">
        {block.rows.map((row, at) => (
          <div key={at} className={`flex border-b border-neutral-300 last:border-b-0 ${at === 0 && block.headerRowCount > 0 ? "font-bold" : ""}`}>
            {row.cells.map((cell, cellAt) => (
              <span key={cellAt} className={`min-w-0 flex-1 px-1 text-[9px] text-neutral-800 ${safeText}`}>{cell.runs.map((run) => run.text).join("")}</span>
            ))}
          </div>
        ))}
      </div>
    );
  }
  const text = block.runs.map((run) => run.text).join("");
  const headingStyle = (size: number) => ({ fontSize: `${size}px` });
  return (
    <p
      className={`my-1 leading-snug text-neutral-900 ${safeText} ${block.type === "heading" ? "font-bold" : ""}`}
      style={block.type === "heading" ? headingStyle(15 - block.level) : undefined}
    >
      {text}
    </p>
  );
}

/** A4 proportion at preview scale: 595.3 x 841.9pt -> 300 x ~424px. */
const PAGE_W = 300;
const PAGE_H = Math.round((300 * 841.9) / 595.3);

export function PrintPreview() {
  const doc = useWordEditorStore((s) => s.doc);

  if (!doc) {
    return (
      <section aria-label="打印预览" className="border-t border-hairline bg-rail px-3 py-2 text-xs text-ink-muted">
        无文档
      </section>
    );
  }

  const { pages } = paginate(doc);

  return (
    <section aria-label="打印预览" className="flex min-w-0 max-w-full flex-col gap-2 border-t border-hairline bg-rail px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="min-w-0 truncate text-xs text-ink-muted">打印预览（估算分页，非精确排版）</span>
        <span className="shrink-0 text-xs text-ink-faint">共 {pages.length} 页</span>
      </div>
      <div className="flex min-w-0 max-w-full max-h-80 flex-wrap gap-3 overflow-x-auto overflow-y-auto" data-testid="print-preview-pages">
        {pages.map((page) => (
          <div
            key={page.index}
            aria-label={`第 ${page.index + 1} 页`}
            className="shrink-0 overflow-hidden rounded border border-hairline-strong bg-white p-3 shadow-sm"
            style={{ width: PAGE_W, height: PAGE_H }}
          >
            {page.blockIds.map((blockId) => {
              const block = doc.blocks.find((candidate) => candidate.id === blockId);
              return block ? <BlockView key={blockId} block={block} /> : null;
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
