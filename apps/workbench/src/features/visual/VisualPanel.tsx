import { useEffect } from "react";
import { useVisualStore } from "../../state/visualStore";
import { IssueList } from "./IssueList";
import { ShotViewer } from "./ShotViewer";
import { useVisualRepair } from "./useVisualRepair";

export interface VisualPanelProps {
  projectId: string | null;
}

/**
 * Bottom dock "本地质检" tab body: layout + store wiring only.
 * The dock is h-44 (176px) so the content region scrolls internally and never
 * assumes a height. "发给 AI 修复" hands the multimodal patch request to the
 * existing aiStore confirm-card flow (never auto-applies).
 */
export function VisualPanel({ projectId }: VisualPanelProps) {
  const runState = useVisualStore((s) => s.runState);
  const currentRun = useVisualStore((s) => s.currentRun);
  const selectedViewport = useVisualStore((s) => s.selectedViewport);
  const error = useVisualStore((s) => s.error);
  const { repairing, repairError, repair } = useVisualRepair();

  useEffect(() => {
    if (!projectId) return;
    void useVisualStore.getState().loadRuns(projectId);
  }, [projectId]);

  const running = runState === "running";
  const issues = currentRun?.issues ?? [];
  const onRun = () => {
    if (!projectId) return;
    void useVisualStore.getState().run(projectId);
  };
  const alertText = repairError ?? error;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-left">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={running || !projectId}
          className="studio-transition inline-flex h-7 items-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
        >
          {running ? "检查中…" : "开始本地质检"}
        </button>
        <button
          type="button"
          onClick={() => void repair(projectId, currentRun)}
          disabled={issues.length === 0 || repairing || !projectId}
          className="studio-transition inline-flex h-7 items-center rounded-md border border-hairline-strong px-3 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-40"
        >
          {repairing ? "发送中…" : "发给 AI 修复"}
        </button>
        {currentRun && (
          <span className="truncate text-xs text-ink-muted">{currentRun.url}</span>
        )}
        {alertText && (
          <p role="alert" className="truncate text-xs text-danger">
            {alertText}
          </p>
        )}
      </div>
      {currentRun ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-y-auto">
          <div className="w-64 shrink-0">
            <ShotViewer
              projectId={projectId ?? ""}
              run={currentRun}
              selected={selectedViewport}
              onSelect={(v) => useVisualStore.getState().selectViewport(v)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <IssueList issues={issues} summary={currentRun.summary} />
          </div>
        </div>
      ) : (
        <p className="py-4 text-xs text-ink-muted">
          请先启动项目预览，再点击“开始本地质检”。
        </p>
      )}
    </div>
  );
}
