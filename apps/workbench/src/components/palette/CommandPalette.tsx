import { useEffect, useMemo, useRef, useState } from "react";
import { listComponentDefs } from "@studio/schema-core";
import { ModalSurface, OverlayBackdrop } from "../motion";

export interface PaletteCommand {
  id: string;
  /** Display title (Chinese). */
  title: string;
  /** Optional group header shown above the first item of the group. */
  group: string;
  /** Shortcut hint, e.g. "Ctrl+S". */
  hint?: string;
  /** When false, command is hidden/disabled. */
  enabled?: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}

function matches(q: string, title: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase().trim();
  return title.toLowerCase().includes(s);
}

/**
 * Modal command palette (Ctrl/Cmd+K). Pure presentational: parent supplies
 * the command list and open state; Enter runs the highlighted command.
 */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => commands.filter((c) => (c.enabled === false ? false : matches(query, c.title))),
    [commands, query],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      // Focus after paint so the dialog is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    // jsdom has no scrollIntoView
    el?.scrollIntoView?.({ block: "nearest" });
  }, [index, open, filtered.length]);

  const runAt = (i: number) => {
    const cmd = filtered[i];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runAt(index);
    }
  };

  let lastGroup = "";

  return (
    <OverlayBackdrop
      open={open}
      z="z-[60]"
      role="presentation"
      className="flex items-start justify-center bg-black/45 px-4 pt-[12vh]"
      onBackdropClick={onClose}
    >
      <ModalSurface
        palette
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-hairline bg-overlay shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-label="搜索命令"
          placeholder="搜索命令、插入组件…"
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div
          id="palette-list"
          ref={listRef}
          role="listbox"
          aria-label="命令列表"
          className="max-h-[min(360px,50vh)] overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-muted">无匹配命令</p>
          ) : (
            filtered.map((cmd, i) => {
              const showGroup = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              return (
                <div key={cmd.id}>
                  {showGroup && (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                      {cmd.group}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    data-idx={i}
                    aria-selected={i === index}
                    className={`studio-transition flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm ${
                      i === index ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-rail hover:text-ink"
                    }`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => runAt(i)}
                  >
                    <span className="truncate">{cmd.title}</span>
                    {cmd.hint && (
                      <kbd className="ml-3 shrink-0 rounded border border-hairline bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                        {cmd.hint}
                      </kbd>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <p className="border-t border-hairline px-3 py-2 text-[11px] text-ink-faint">
          ↑↓ 选择 · Enter 执行 · Esc 关闭
        </p>
      </ModalSurface>
    </OverlayBackdrop>
  );
}

/** Insert-component titles from the registry (shared by palette and tests). */
const CATEGORY_TITLE: Record<string, string> = {
  navigation: "导航",
  layout: "布局",
  content: "内容",
  form: "表单",
  data: "数据",
  chart: "图表",
  feedback: "反馈",
  marketing: "营销",
};

export function insertCommands(onInsert: (type: string) => void): PaletteCommand[] {
  return listComponentDefs().map((d) => ({
    id: `insert:${d.type}`,
    title: `插入 ${d.title}`,
    group: `插入 · ${CATEGORY_TITLE[d.category] ?? d.category}`,
    hint: d.type,
    run: () => onInsert(d.type),
  }));
}
