import { useCodegenStore } from "../state/codegenStore";
import { useEditorStore, type Viewport } from "../state/editorStore";
import { DEVICE_PAGE } from "../features/canvas/devicePresets";

export interface ProjectPreviewProps {
  projectId: string;
  /** Device preset for the iframe shell width (optional: defaults to desktop). */
  viewport?: Viewport;
}

/**
 * Center-panel "项目预览" mode body: start/stop the isolated vite preview and
 * render it in a sandboxed iframe (spec §6.3: sandbox without allow-top).
 * Starting always re-generates from the current editor document first, so a
 * freshly edited document never serves stale generated artifacts.
 *
 * The iframe shell is narrowed to the selected device preset width so the
 * 视口 control is not a no-op in this mode: the generated app's own media
 * queries respond to the iframe viewport (desktop keeps filling the column).
 */
export function ProjectPreview({ projectId, viewport = "desktop" }: ProjectPreviewProps) {
  const previewState = useCodegenStore((s) => s.previewState);
  const previewPort = useCodegenStore((s) => s.previewPort);
  const generateState = useCodegenStore((s) => s.generateState);
  const error = useCodegenStore((s) => s.error);
  const store = useCodegenStore;

  if (previewState === "running" && previewPort !== null) {
    return (
      <div
        data-testid="project-preview-shell"
        className="relative mx-auto h-full min-h-0 overflow-hidden rounded-md bg-white shadow-card ring-1 ring-hairline"
        style={{ width: `${DEVICE_PAGE[viewport].w}px`, maxWidth: "100%" }}
      >
        <button
          type="button"
          onClick={() => void store.getState().stopPreview(projectId)}
          className="studio-transition absolute right-2 top-2 z-10 rounded-md border border-hairline bg-canvas/90 px-2 h-7 text-xs font-medium text-ink-soft shadow-card hover:border-hairline-strong hover:text-ink"
        >
          停止预览
        </button>
        <iframe
          title="项目预览"
          data-testid="project-preview-frame"
          src={`http://127.0.0.1:${previewPort}`}
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="h-full w-full border-0 bg-white"
        />
      </div>
    );
  }

  // Generating and starting are both part of one "启动预览" step now.
  const busy = previewState === "starting" || generateState === "generating";

  // Sync the live editor document to disk before starting, so the vite
  // preview reflects the current document instead of the last manual generate.
  const startSyncedPreview = () => {
    const doc = useEditorStore.getState().document;
    void store
      .getState()
      .generateAndStartPreview(projectId, doc ? JSON.stringify(doc) : undefined);
  };

  const statusText =
    previewState === "starting"
      ? "启动中…（首次启动需安装依赖）"
      : generateState === "generating"
        ? "正在按当前文档生成代码…"
        : "预览未启动。启动时会自动按当前文档生成代码。";

  const hasError = (previewState === "error" || generateState === "error") && error !== null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <button
        type="button"
        onClick={startSyncedPreview}
        disabled={busy}
        className="studio-transition inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
      >
        {previewState === "starting" ? "启动中…" : generateState === "generating" ? "生成中…" : "启动预览"}
      </button>
      {hasError ? (
        <p role="alert" className="max-w-md text-center text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="max-w-sm text-xs leading-relaxed text-ink-muted">{statusText}</p>
      )}
    </div>
  );
}
