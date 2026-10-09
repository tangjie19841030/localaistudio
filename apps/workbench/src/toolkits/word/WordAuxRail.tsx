import { useState } from "react";
import type { WordDocument } from "@studio/word-toolkit";
import { ReviewPanel } from "./ReviewPanel";
import { StylePanel } from "./StylePanel";

type AuxTab = "style" | "review";

const TABS: { key: AuxTab; label: string }[] = [
  { key: "style", label: "样式" },
  { key: "review", label: "批注" },
];

export interface WordAuxRailProps {
  doc: WordDocument;
  onLocateBlock: (blockId: string) => void;
  commentDraft?: string;
  onCommentDraftChange?: (draft: string) => void;
  /** Remove desktop rail sizing when the auxiliary rail is hosted in a drawer. */
  embedded?: boolean;
}

/**
 * Word 右侧单一辅助栏：样式与批注分标签切换，不再同时占两列，
 * 给正文阅读区让出宽度。样式/批注面板本体仍是独立组件（本栏只做外壳）。
 */
export function WordAuxRail({ doc, onLocateBlock, commentDraft, onCommentDraftChange, embedded = false }: WordAuxRailProps) {
  const [tab, setTab] = useState<AuxTab>("style");
  return (
    <aside
      aria-label="辅助栏"
      className={embedded
        ? "flex min-h-0 min-w-0 w-full flex-1 flex-col border-l border-hairline bg-surface"
        : "flex h-full w-60 shrink-0 flex-col border-l border-hairline bg-surface"}
    >
      <div
        role="tablist"
        aria-label="辅助栏页签"
        className="flex shrink-0 items-center gap-0.5 border-b border-hairline px-2 py-1.5"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`studio-transition h-7 rounded-lg px-2.5 text-xs font-medium ${
              tab === t.key
                ? "bg-accent-soft text-accent"
                : "text-ink-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        {tab === "style" ? (
          <StylePanel doc={doc} />
        ) : (
          <ReviewPanel
            onLocateBlock={onLocateBlock}
            draft={commentDraft}
            onDraftChange={onCommentDraftChange}
          />
        )}
      </div>
    </aside>
  );
}
