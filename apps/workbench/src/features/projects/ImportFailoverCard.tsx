import type { ImportRetryKind } from "./createFlow";

interface ImportFailoverCardProps {
  /** Form-level error message; null renders nothing. */
  error: string | null;
  /** Id of the already-created blank project (failure anchor); null = bare error only. */
  blankProjectId: string | null;
  /** Whether a .pptx awaits retry (original `{pptxFile && …}` gate). */
  hasPptxFile: boolean;
  /** Which converted content can be retried into the blank project; null = none. */
  retryKind: ImportRetryKind | null;
  submitting: boolean;
  /** Failure flow: open the already-created blank project. */
  onOpenBlankProject: () => void;
  /** Failure flow: delete the blank project and reset for a fresh start. */
  onDiscardBlankProject: () => void;
  /** Failure flow: retry importing the same template into the same blank project. */
  onRetryImport: () => void;
  /** Failure flow: re-save the already-converted screenshot document into the same blank project. */
  onRetryImported?: () => void;
}

/**
 * Failure banner + blank-project fallback actions. Mounted unconditionally by
 * the form; returns null when there is no error (original `{error && …}` wrap).
 */
export function ImportFailoverCard({
  error,
  blankProjectId,
  hasPptxFile,
  retryKind,
  submitting,
  onOpenBlankProject,
  onDiscardBlankProject,
  onRetryImport,
  onRetryImported,
}: ImportFailoverCardProps) {
  if (error === null) return null;
  return (
    <div className="mt-4 space-y-1">
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
      {blankProjectId && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="w-full text-xs text-ink-muted">
            空白项目已创建。可直接进入后在编辑器工具栏「导入 .pptx」重试，或删除该项目重新创建。
          </p>
          <button
            type="button"
            onClick={onOpenBlankProject}
            className="inline-flex h-7 items-center rounded-md border border-hairline bg-surface px-2.5 text-xs text-ink hover:bg-canvas"
          >
            打开空白项目
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onDiscardBlankProject}
            className="inline-flex h-7 items-center rounded-md border border-hairline bg-surface px-2.5 text-xs text-danger hover:bg-canvas disabled:opacity-50"
          >
            删除空白项目
          </button>
          {hasPptxFile && (
            <button
              type="button"
              disabled={submitting}
              onClick={onRetryImport}
              className="inline-flex h-7 items-center rounded-md border border-accent px-2.5 text-xs text-accent hover:bg-accent-soft disabled:opacity-50"
            >
              {submitting ? "重试中…" : "重试导入此模板"}
            </button>
          )}
          {retryKind === "screenshot" && onRetryImported && (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={onRetryImported}
                className="inline-flex h-7 items-center rounded-md border border-accent px-2.5 text-xs text-accent hover:bg-accent-soft disabled:opacity-50"
              >
                {submitting ? "重试中…" : "重试保存已识别内容"}
              </button>
              <p className="w-full text-xs text-ink-faint">
                识别结果已保存在本地，重试只会重新保存，不会再次调用识别（无需再等 30–90 秒）。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
