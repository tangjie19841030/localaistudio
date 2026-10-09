import { activePageOf } from "@studio/schema-core";
import type { StudioDocument } from "@studio/schema-core";
import { PreviewSurface, type PreviewMode } from "../../preview/PreviewSurface";
import type { Viewport } from "../../state/editorStore";
import type { PageTabsApi } from "../../features/canvas/usePageTabs";

export interface CenterPanelProps {
  document: StudioDocument | null;
  projectId: string;
  selectedId: string | null;
  viewport: Viewport;
  onSelect: (id: string) => void;
  onSetViewport: (v: Viewport) => void;
  /** P3-4: schema preview vs isolated vite project preview. */
  previewMode: PreviewMode;
  onSetPreviewMode: (m: PreviewMode) => void;
  /** T19 §3.4: multi-page tabs threaded from App (usePageTabs). */
  tabs?: PageTabsApi;
  /** P7.3: 非 ui 项目的编辑器占位（非空时替代 UI 预览面）。 */
  editorSlot?: React.ReactNode;
  /** 非 ui 项目：document=null 时空态说明该类型在中央编辑器内编辑（默认 ui 不变）。 */
  projectType?: "ui" | "ppt" | "word";
}

const NON_UI_LABEL = { ppt: "PPT 演示", word: "Word 文档" } as const;

export function CenterPanel({
  document,
  projectId,
  selectedId,
  viewport,
  onSelect,
  onSetViewport,
  previewMode,
  onSetPreviewMode,
  tabs,
  editorSlot,
  projectType = "ui",
}: CenterPanelProps) {
  const doc = document as StudioDocument | null;
  return (
    <main aria-label="预览" className="flex min-w-0 flex-1 flex-col bg-rail">
      {editorSlot ? (
        editorSlot
      ) : doc ? (
        <PreviewSurface
          doc={activePageOf(doc, tabs?.activeId ?? null)}
          tokens={doc.tokens}
          projectId={projectId}
          selectedId={selectedId}
          onSelect={onSelect}
          viewport={viewport}
          onViewportChange={onSetViewport}
          mode={previewMode}
          onModeChange={onSetPreviewMode}
          tabs={tabs}
        />
      ) : projectType !== "ui" ? (
        <div className="m-auto flex max-w-md flex-col items-center gap-2 px-6 text-center">
          <p className="text-sm font-medium text-ink">正在使用 {NON_UI_LABEL[projectType]}编辑器</p>
        </div>
      ) : (
        <div className="m-auto flex max-w-md flex-col items-center gap-2 px-6 text-center">
          <p className="text-sm font-medium text-ink">尚未打开项目</p>
          <p className="text-xs leading-relaxed text-ink-muted">
            从左侧项目列表进入后，这里会显示 Schema 预览、项目预览与自由画布。
          </p>
        </div>
      )}
    </main>
  );
}
