import { useEffect, useState } from "react";
import type { PptLayoutId, PptSlide } from "@studio/ppt-toolkit";
import { manualInvocation, runPptCommands } from "../state";

const layoutLabel: Record<PptLayoutId, string> = { title: "标题页", titleContent: "标题+内容", blank: "空白页" };

/** Slide selected: title, lock, layout templates. */
export function SlideSection({ slide, titleDraft, onTitleDraftChange }: {
  slide: PptSlide;
  titleDraft?: string;
  onTitleDraftChange?: (draft: string | undefined) => void;
}) {
  const [localTitle, setLocalTitle] = useState(slide.title);
  const title = titleDraft ?? localTitle;

  // Keep the draft aligned with toolkit/AI updates for the same slide.
  useEffect(() => {
    if (titleDraft === undefined) setLocalTitle(slide.title);
  }, [slide.id, slide.title, titleDraft]);

  const commitTitle = () => {
    if (title.trim().length === 0) {
      setLocalTitle(slide.title);
      onTitleDraftChange?.(undefined);
      return;
    }
    if (runPptCommands([manualInvocation("slide.rename", { slideId: slide.id, title })])) {
      onTitleDraftChange?.(undefined);
      setLocalTitle(title);
    }
  };
  const toggleLock = () => {
    runPptCommands([manualInvocation("slide.lock", { slideId: slide.id, locked: slide.locked !== true })]);
  };
  const applyLayout = (layout: PptLayoutId) => {
    runPptCommands([manualInvocation("slide.applyLayout", { slideId: slide.id, layout })]);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">幻灯片属性</h3>
        <span className="text-xs text-ink-muted">{slide.id}</span>
      </header>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-muted" htmlFor="ppt-slide-title">幻灯片标题</label>
        <input
          id="ppt-slide-title"
          aria-label="幻灯片标题"
          className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
          value={title}
          onChange={(e) => {
            const value = e.target.value;
            if (onTitleDraftChange) onTitleDraftChange(value);
            else setLocalTitle(value);
          }}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            // Enter commits immediately; Shift+Enter is ignored (single-line input).
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitTitle();
            }
          }}
        />
      </div>
      <button
        type="button"
        aria-label={slide.locked === true ? "解锁幻灯片" : "锁定幻灯片"}
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong"
        onClick={toggleLock}
      >
        {slide.locked === true ? "解锁幻灯片" : "锁定幻灯片"}
      </button>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">布局模板</span>
        {(["title", "titleContent", "blank"] as const).map((layout) => (
          <button
            key={layout}
            type="button"
            aria-label={`应用布局 ${layoutLabel[layout]}`}
            className="rounded-lg border border-hairline bg-surface px-2 py-1 text-left text-xs text-ink-soft hover:border-hairline-strong"
            onClick={() => applyLayout(layout)}
          >
            {layoutLabel[layout]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">背景色</span>
        <input
          type="color"
          aria-label="幻灯片背景色"
          value={slide.background ?? "#FFFFFF"}
          onChange={(e) => runPptCommands([manualInvocation("slide.setBackground", { slideId: slide.id, color: e.target.value })])}
          className="h-7 w-12 cursor-pointer rounded border border-hairline bg-surface"
        />
        {slide.background && (
          <button
            type="button"
            className="text-xs text-ink-muted underline"
            onClick={() => runPptCommands([manualInvocation("slide.setBackground", { slideId: slide.id, color: null })])}
          >
            恢复主题背景
          </button>
        )}
      </div>
    </div>
  );
}
