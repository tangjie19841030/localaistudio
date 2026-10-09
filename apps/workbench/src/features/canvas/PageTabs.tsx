import { useEffect, useRef, useState } from "react";
import type { PageTabsApi } from "./usePageTabs";

/**
 * Page tabs (T19 §3.4): switch / add / rename (double-click, Enter commits,
 * Esc cancels) / duplicate / remove. Style follows CanvasToolbar (h-7/text-xs).
 * Rendered by PreviewSurface above the mode row — never inside CanvasSurface.
 */

export interface PageTabsProps extends PageTabsApi {}

/** One editable tab: double-click swaps the label for an inline input. */
function PageTab(props: {
  id: string;
  name: string;
  index: number;
  active: boolean;
  canRemove: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== props.name) props.onRename(props.id, name);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(props.name);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid={`page-tab-input-${props.index}`}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        onBlur={commit}
        aria-label="页面名称"
        className="h-6 w-24 rounded border border-hairline bg-canvas px-1.5 text-xs text-ink outline-none focus:border-accent"
      />
    );
  }

  return (
    <div
      data-testid={`page-tab-${props.index}`}
      className={`inline-flex h-7 items-center gap-0.5 rounded-md border px-1 studio-transition ${
        props.active ? "border-hairline bg-accent-soft" : "border-transparent hover:bg-surface"
      }`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.active}
        onDoubleClick={() => setEditing(true)}
        onClick={() => props.onSelect(props.id)}
        title="点击切换页面，双击重命名"
        className="max-w-32 truncate rounded px-1.5 text-xs font-medium text-ink"
      >
        {props.name}
      </button>
      <button
        type="button"
        aria-label={`复制页面 ${props.name}`}
        title="复制页面"
        onClick={() => props.onDuplicate(props.id)}
        className="h-5 rounded px-1 text-xs text-ink-muted hover:bg-surface hover:text-ink"
      >
        ⧉
      </button>
      <button
        type="button"
        aria-label={`删除页面 ${props.name}`}
        title={props.canRemove ? "删除页面" : "至少保留一个页面"}
        disabled={!props.canRemove}
        onClick={() => props.onRemove(props.id)}
        className="h-5 rounded px-1 text-xs text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
      >
        ×
      </button>
    </div>
  );
}

export function PageTabs(props: PageTabsProps) {
  return (
    <div
      data-testid="page-tabs"
      role="tablist"
      aria-label="页面"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline bg-canvas px-4 py-1"
    >
      {props.pages.map((p, i) => (
        <PageTab
          key={p.id}
          id={p.id}
          name={p.name}
          index={i}
          active={p.id === props.activeId}
          canRemove={props.canRemove}
          onSelect={props.onSelect}
          onRename={props.onRename}
          onDuplicate={props.onDuplicate}
          onRemove={props.onRemove}
        />
      ))}
      <button
        type="button"
        data-testid="page-add"
        aria-label="新建页面"
        title="新建页面"
        onClick={props.onAdd}
        className="h-7 shrink-0 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-surface hover:text-ink"
      >
        +
      </button>
    </div>
  );
}
