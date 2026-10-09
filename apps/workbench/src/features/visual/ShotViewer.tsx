import { useState } from "react";
import { VIEWPORTS, type ViewportName } from "@studio/schema-core";
import { visualApi, type VisualRunResult } from "../../api/visual";
import { ModalSurface, OverlayBackdrop } from "../../components/motion";

/** Chinese viewport labels; also the prefix of each screenshot's alt text. */
const VIEWPORT_LABEL: Record<ViewportName, string> = {
  desktop: "桌面",
  tablet: "平板",
  mobile: "手机",
};

export interface ShotViewerProps {
  projectId: string;
  run: VisualRunResult | null;
  selected: ViewportName;
  onSelect: (v: ViewportName) => void;
}

/**
 * Screenshot pane: viewport tablist + the selected shot. Click opens a larger
 * overlay so the 176px dock does not force unreadable thumbnails.
 */
export function ShotViewer({ projectId, run, selected, onSelect }: ShotViewerProps) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const shot = run?.shots.find((s) => s.viewport === selected);
  const spec = VIEWPORTS.find((v) => v.name === selected);

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div role="tablist" aria-label="视口切换" className="flex shrink-0 gap-1">
        {VIEWPORTS.map((v) => (
          <button
            key={v.name}
            type="button"
            role="tab"
            aria-selected={selected === v.name}
            onClick={() => onSelect(v.name)}
            className={`studio-transition rounded-md px-2 h-6 text-xs ${
              selected === v.name
                ? "bg-rail font-medium text-ink"
                : "text-ink-muted hover:bg-rail hover:text-ink"
            }`}
          >
            {VIEWPORT_LABEL[v.name]}
          </button>
        ))}
      </div>
      <div className="min-h-0 overflow-auto rounded-md border border-hairline bg-surface p-1.5">
        {run && shot ? (
          <button
            type="button"
            className="block w-full text-left"
            title="点击放大查看"
            onClick={() => setZoomOpen(true)}
          >
            <img
              src={visualApi.shotUrl(projectId, run.runId, shot.file)}
              alt={`${VIEWPORT_LABEL[selected]} 截图`}
              width={spec?.width}
              height={spec?.height}
              className="h-auto w-full max-w-56 rounded-sm border border-hairline bg-white"
            />
            <span className="mt-1 block text-[11px] text-ink-muted">点击放大</span>
          </button>
        ) : (
          <p className="px-1 py-4 text-xs text-ink-muted">
            {run ? "该视口暂无截图。" : "尚未执行本地质检。"}
          </p>
        )}
      </div>
      <OverlayBackdrop
        open={zoomOpen && Boolean(run) && Boolean(shot)}
        z="z-50"
        role="dialog"
        aria-label={`${VIEWPORT_LABEL[selected]} 截图放大`}
        className="flex items-center justify-center bg-black/60 p-6"
        onBackdropClick={() => setZoomOpen(false)}
      >
        {run && shot && (
          <ModalSurface className="relative max-h-full max-w-5xl overflow-auto rounded-xl border border-hairline bg-canvas p-3 shadow-modal">
            <img
              src={visualApi.shotUrl(projectId, run.runId, shot.file)}
              alt={`${VIEWPORT_LABEL[selected]} 截图`}
              className="mx-auto max-h-[80vh] w-auto max-w-full rounded-md bg-white"
            />
            <button
              type="button"
              className="studio-transition absolute right-2 top-2 rounded-md border border-hairline bg-canvas/90 px-2 h-7 text-xs text-ink-soft hover:text-ink"
              onClick={() => setZoomOpen(false)}
            >
              关闭
            </button>
          </ModalSurface>
        )}
      </OverlayBackdrop>
    </div>
  );
}
