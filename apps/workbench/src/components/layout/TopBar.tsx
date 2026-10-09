import { ThemeToggle } from "./ThemeToggle";

export interface TopBarProps {
  projectName: string;
  documentName: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** Undo/redo button availability, mirrors store canUndo/canRedo. */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDocumentNameChange: (name: string) => void;
  onSave: () => void;
  onBack: () => void;
  /** P2-5: opens the settings dialog. */
  onOpenSettings: () => void;
  /** Opens the command palette (Ctrl/Cmd+K). */
  onOpenPalette?: () => void;
}

function UndoIcon({ mirrored }: { mirrored?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M3 7h7a3 3 0 0 1 0 6H7" />
      <path d="M5.5 4.5 3 7l2.5 2.5" />
    </svg>
  );
}

/**
 * 顶栏 = 工具身份条：左返回 + 项目/文档，中 ghost 操作，右主保存。
 * 未保存/保存中状态保留契约文案（role=status），视觉上用小圆点 + 短标签。
 * 错误独立成第二行完整展示（可滚动），不再截断进同一横行。
 */
export function TopBar(props: TopBarProps) {
  const status = props.saving
    ? { label: "保存中…", dot: "bg-warn" }
    : props.dirty
      ? { label: "未保存更改", dot: "bg-warn" }
      : { label: "已保存", dot: "bg-success" };
  return (
    <header className="flex shrink-0 flex-col border-b border-hairline bg-canvas">
      <div
        data-testid="topbar-main-row"
        className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 px-3 md:h-12 md:flex-nowrap md:gap-3 md:px-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            className="studio-transition -ml-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-ink-soft hover:bg-rail hover:text-ink"
            onClick={props.onBack}
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 4l-4 4 4 4" />
            </svg>
            返回项目列表
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink">{props.projectName}</span>
            <span aria-hidden className="text-ink-ghost">
              /
            </span>
            <label className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
              <span className="sr-only shrink-0">文档名称</span>
              <input
                aria-label="文档名称"
                className="studio-transition h-7 min-w-0 max-w-[10rem] truncate rounded-md border border-transparent bg-transparent px-2 text-sm text-ink-soft hover:border-hairline hover:bg-surface focus:border-accent focus:bg-canvas focus:outline-none md:max-w-[16rem]"
                value={props.documentName}
                onChange={(e) => props.onDocumentNameChange(e.target.value)}
              />
            </label>
            <span
              role="status"
              className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium text-ink-muted"
            >
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          </div>
        </div>

      <div
        data-testid="topbar-action-row"
        className="flex basis-full max-w-full shrink-0 flex-wrap items-center justify-end gap-1 md:basis-auto md:gap-0.5"
      >
        {props.onOpenPalette && (
          <button
            type="button"
            aria-label="命令面板"
            title="命令面板 (Ctrl+K)"
            className="studio-transition inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline px-2 text-xs text-ink-muted hover:border-hairline-strong hover:bg-rail hover:text-ink"
            onClick={props.onOpenPalette}
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <kbd className="hidden rounded border border-hairline bg-canvas px-1 font-mono text-[10px] md:inline">
              Ctrl K
            </kbd>
          </button>
        )}
        <button
          type="button"
          aria-label="撤销"
          title="撤销 (Ctrl+Z)"
          className="studio-transition inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-rail hover:text-ink disabled:opacity-40"
          disabled={!props.canUndo}
          onClick={props.onUndo}
        >
          <UndoIcon />
          <span className="hidden md:inline">撤销</span>
        </button>
        <button
          type="button"
          aria-label="重做"
          title="重做 (Ctrl+Shift+Z)"
          className="studio-transition inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-rail hover:text-ink disabled:opacity-40"
          disabled={!props.canRedo}
          onClick={props.onRedo}
        >
          <UndoIcon mirrored />
          <span className="hidden md:inline">重做</span>
        </button>
        <button
          type="button"
          aria-label="设置"
          title="设置"
          className="studio-transition inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-rail hover:text-ink"
          onClick={props.onOpenSettings}
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="8" cy="8" r="2.25" />
            <path d="M8 1.75v1.75M8 12.5v1.75M1.75 8h1.75M12.5 8h1.75M3.64 3.64l1.24 1.24M11.12 11.12l1.24 1.24M12.36 3.64l-1.24 1.24M4.88 11.12l-1.24 1.24" />
          </svg>
          <span className="hidden md:inline">设置</span>
        </button>
        <ThemeToggle />

      <button
        type="button"
        className="studio-transition h-7 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
        disabled={!props.dirty || props.saving}
        onClick={props.onSave}
      >
        {props.saving ? "保存中…" : "保存"}
      </button>

      </div>

      </div>

      {props.error && (
        <p
          role="alert"
          className="max-h-20 overflow-y-auto border-t border-danger/30 bg-danger-soft px-4 py-1.5 text-xs leading-relaxed break-all text-danger"
        >
          {props.error}
        </p>
      )}
    </header>
  );
}
