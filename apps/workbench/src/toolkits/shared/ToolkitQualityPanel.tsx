import { useCallback, useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import { saveBeforeExport } from "../../state/saveBeforeExport";

/**
 * Issue shape shared by POST /inspect/ppt and /inspect/word: inspectorId +
 * message always present; the location anchor fields differ per toolkit.
 */
export interface ToolkitIssue {
  inspectorId: string;
  message: string;
  slideId?: string;
  objectId?: string;
  blockId?: string;
  commentId?: string;
}

export interface ToolkitQualityPanelProps {
  /** Toolkit path segment: the panel POSTs /api/projects/:id/inspect/<segment>. */
  inspectPath: "ppt" | "word";
  /** Inspector ids whose findings are errors (danger) rather than warnings. */
  dangerInspectors: string[];
  /** Human-readable location suffix, e.g. "幻灯片 slide-1 · 对象 obj-1". */
  describeLocation: (issue: ToolkitIssue) => string;
}

/**
 * Shared toolkit quality panel (ppt + word unified lifecycle): flushes
 * unsaved edits first (the inspectors read the SAVED document — the word
 * panel used to skip this and silently report on an older revision), then
 * POSTs the inspect endpoint and lists issues. The panel never mutates.
 */
export function ToolkitQualityPanel({ inspectPath, dangerInspectors, describeLocation }: ToolkitQualityPanelProps) {
  const projectId = useEditorStore((s) => s.projectId);
  const [issues, setIssues] = useState<ToolkitIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!projectId) return;
    setChecking(true);
    setError(null);
    // The inspectors read the SAVED document on disk; flush unsaved edits
    // first, otherwise the report silently describes an older revision.
    const saved = await saveBeforeExport(projectId);
    if (!saved.ok) {
      setError(saved.message ?? "检查前保存失败");
      setChecking(false);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/inspect/${inspectPath}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `检查失败（${res.status}）`);
        return;
      }
      const body = (await res.json()) as { issues: ToolkitIssue[] };
      setIssues(body.issues);
    } catch {
      setError("检查请求失败，请确认服务已启动");
    } finally {
      setChecking(false);
    }
  }, [projectId, inspectPath]);

  const issueStyle = (inspectorId: string) =>
    dangerInspectors.includes(inspectorId) ? "text-danger" : "text-warn";

  return (
    <section aria-label="质检面板" className="flex flex-col gap-2 border-t border-hairline bg-rail px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">质检</span>
        <button
          type="button"
          aria-label="重新检查"
          disabled={!projectId || checking}
          className="rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-faint"
          onClick={() => void check()}
        >
          {checking ? "检查中…" : issues === null ? "开始检查" : "重新检查"}
        </button>
        {issues !== null && !checking && (
          <span className="text-xs text-ink-muted">
            {issues.length === 0 ? "未发现问题" : `发现 ${issues.length} 个问题`}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" aria-label="质检错误" className="text-xs text-danger">
          {error}
        </p>
      )}
      {issues !== null && issues.length > 0 && (
        <ul aria-label="质检问题列表" className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {issues.map((issue, index) => {
            const location = describeLocation(issue);
            return (
              <li key={`${issue.inspectorId}-${location}-${index}`} className="text-xs leading-5">
                <span className={`mr-1.5 rounded px-1 py-0.5 ${issueStyle(issue.inspectorId)}`}>
                  {issue.inspectorId}
                </span>
                <span className="text-ink">{issue.message}</span>
                {location && <span className="ml-1 text-ink-faint">{location}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
