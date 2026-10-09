import { RevealItem } from "../../components/motion";
import { SOURCE_LABEL, useLogStore, type LogLevel } from "../../state/logStore";

const LEVEL_STYLE: Record<LogLevel, { dot: string; label: string }> = {
  info: { dot: "bg-ink-faint", label: "text-ink-muted" },
  success: { dot: "bg-success", label: "text-success" },
  warn: { dot: "bg-warn", label: "text-warn" },
  error: { dot: "bg-danger", label: "text-danger" },
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  info: "信息",
  success: "成功",
  warn: "警告",
  error: "错误",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Bottom dock "运行日志" tab body: a flat, monospace time → source → level →
 * message log of every AI / codegen / preview / export / visual action.
 */
export function RunLogPanel() {
  const entries = useLogStore((s) => s.entries);
  const clear = useLogStore((s) => s.clear);

  return (
    <div className="flex h-full min-h-0 flex-col text-left">
      <div className="mb-1 flex shrink-0 items-center justify-between">
        <span className="text-xs text-ink-muted">
          最近 {entries.length} 条
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={entries.length === 0}
          className="studio-transition h-6 rounded-md px-2 text-xs font-medium text-ink-soft hover:bg-rail hover:text-ink disabled:opacity-40"
        >
          清空
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="py-4 text-xs text-ink-muted">
          暂无运行日志。执行生成、预览、导出或本地质检后，此处会记录操作时间线。
        </p>
      ) : (
        <ul
          aria-label="运行日志"
          className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed"
        >
          {entries.map((e) => {
            const style = LEVEL_STYLE[e.level];
            const rowBg =
              e.level === "error"
                ? "bg-danger-soft/40"
                : e.level === "warn"
                  ? "bg-warn-soft/40"
                  : "";
            return (
              <RevealItem
                key={e.id}
                variant="fade"
                className={`flex items-start gap-2 border-b border-hairline/60 px-1 py-1 ${rowBg}`}
              >
                <span className="shrink-0 tabular-nums text-ink-faint">{formatTime(e.ts)}</span>
                <span className="shrink-0 rounded bg-rail px-1 text-ink-soft">
                  {SOURCE_LABEL[e.source]}
                </span>
                <span className={`flex shrink-0 items-center gap-1 ${style.label}`}>
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  {LEVEL_TEXT[e.level]}
                </span>
                <span className="min-w-0 flex-1 break-all text-ink">{e.message}</span>
              </RevealItem>
            );
          })}
        </ul>
      )}
    </div>
  );
}
