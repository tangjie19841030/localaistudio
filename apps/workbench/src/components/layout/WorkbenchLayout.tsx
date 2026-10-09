import { useEffect, useState } from "react";
import type { StudioDocument, ProjectMeta } from "@studio/schema-core";
import type { TokenPath } from "@studio/schema-core";
import type { PreviewMode } from "../../preview/PreviewSurface";
import type { PageTabsApi } from "../../features/canvas/usePageTabs";
import { useBreakpoint } from "../../utils/useBreakpoint";
import { BottomDock } from "./BottomDock";
import { CenterPanel } from "./CenterPanel";
import { LeftPanel } from "./LeftPanel";
import { Presence } from "../motion";
import { NarrowDrawer } from "./NarrowDrawer";
import { PanelToggleButton } from "./PanelToggleButton";
import { PanelResizer, usePanelWidth } from "./PanelResizer";
import { RightPanel } from "./RightPanel";
import { TopBar } from "./TopBar";
import type { TopBarProps } from "./TopBar";
import type { Viewport } from "../../state/editorStore";

export interface WorkbenchLayoutProps extends TopBarProps {
  meta: ProjectMeta | null;
  /** Editor wiring (controlled display component; App owns the store). */
  document: StudioDocument | null;
  selectedId: string | null;
  /** Canvas multi-select ids, threaded to the AI chat scope. */
  selectedIds?: string[];
  viewport: Viewport;
  onSelect: (id: string) => void;
  onSetViewport: (v: Viewport) => void;
  onSetToken: (path: TokenPath, value: string | number) => void;
  onPropsChange: (props: Record<string, unknown>) => void;
  onInsert: (type: string) => void;
  onRemove: (id: string) => void;
  /** Layer-tree drag reorder; resolves to applyOp(moveNode). */
  onMove: (id: string, newParentId: string, index: number) => void;
  /** Bottom dock "Diff" tab content (App-owned CodePanel). */
  codePanel?: React.ReactNode;
  /** Bottom dock "版本历史" tab content (App-owned VersionPanel). */
  versionPanel?: React.ReactNode;
  /** P4-3: bottom dock "本地质检" tab content (App-owned visual-check panel). */
  visualPanel?: React.ReactNode;
  /** P2-5: AI chat lives in the left panel (projectId + confirm wiring). */
  projectId: string | null;
  onConfirmPlan: (projectId: string) => void;
  /** P2-5: App-owned settings dialog node. */
  settingsDialog?: React.ReactNode;
  /** P3-4: center panel preview mode (schema vs vite project iframe). */
  previewMode: PreviewMode;
  onSetPreviewMode: (m: PreviewMode) => void;
  /** T19 §3.4: multi-page tabs (App-owned usePageTabs view model). */
  tabs?: PageTabsApi;
  /**
   * P7.3: 非 ui 项目的编辑器占位槽位（App 提供）。非空时 CenterPanel 渲染它，
   * 代替 UI 预览面（PreviewSurface 只吃 StudioDocument）。
   */
  editorSlot?: React.ReactNode;
  /** Command palette open handler (Ctrl/Cmd+K). */
  onOpenPalette?: () => void;
}

type NarrowPane = "left" | "right";

/**
 * 响应式栏可见性（批次 E）：
 * - wide：双栏内联；medium：左栏内联、右栏折叠；narrow：双栏变覆盖抽屉。
 * - 会话内保留用户手动开合；断点变化只切换默认视图，不覆盖显式选择。
 * - 折叠态显示开关按钮，展开态在栏头部显示关闭按钮。
 */
function useResponsiveRails(breakpoint: "wide" | "medium" | "narrow") {
  const [leftOverride, setLeftOverride] = useState<boolean | null>(null);
  const [rightOverride, setRightOverride] = useState<boolean | null>(null);
  const [narrowPane, setNarrowPane] = useState<NarrowPane | null>(null);

  useEffect(() => {
    setNarrowPane(null);
  }, [breakpoint]);

  const leftOpen = leftOverride ?? breakpoint !== "narrow";
  const rightOpen = rightOverride ?? breakpoint === "wide";

  const toggleNarrowPane = (pane: NarrowPane): void =>
    setNarrowPane((cur) => (cur === pane ? null : pane));

  return {
    leftOpen,
    setLeftOpen: setLeftOverride,
    rightOpen,
    setRightOpen: setRightOverride,
    narrowPane,
    toggleNarrowPane,
  };
}

export function WorkbenchLayout(props: WorkbenchLayoutProps) {
  const [leftW, setLeftW] = usePanelWidth("left", 288);
  const [rightW, setRightW] = usePanelWidth("right", 280);
  const breakpoint = useBreakpoint();
  const isNarrow = breakpoint === "narrow";
  const rails = useResponsiveRails(breakpoint);
  // PPT/Word 的属性编辑在各自中央编辑器内，外层右栏只会留一条空说明栏挤占正文。
  const projectType = props.meta?.projectType ?? "ui";
  const showRightRail = projectType === "ui";

  // Shared by the inline aside (medium/wide) and the narrow overlay drawer.
  const leftRail = (
    <LeftPanel
      meta={props.meta}
      projectId={props.projectId}
      selectedId={props.selectedId}
      selectedIds={props.selectedIds}
      onConfirmPlan={() => props.projectId && props.onConfirmPlan(props.projectId)}
    />
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <TopBar
        projectName={props.projectName}
        documentName={props.documentName}
        dirty={props.dirty}
        saving={props.saving}
        error={props.error}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onDocumentNameChange={props.onDocumentNameChange}
        onSave={props.onSave}
        onBack={props.onBack}
        onOpenSettings={props.onOpenSettings}
        onOpenPalette={props.onOpenPalette}
      />
      <div className="relative flex min-h-0 flex-1">
        {/* Left rail: inline on medium/wide, drawer on narrow. */}
        {!isNarrow && !rails.leftOpen && (
          <PanelToggleButton
            side="left"
            label="切换需求栏"
            expanded={false}
            onClick={() => rails.setLeftOpen(true)}
          />
        )}
        {!isNarrow && rails.leftOpen && (
          <>
            <aside
              aria-label="需求"
              className="flex shrink-0 flex-col border-r border-hairline bg-rail text-sm"
              style={{ width: leftW }}
            >
              <div className="flex shrink-0 justify-end border-b border-hairline px-2 py-1">
                <PanelToggleButton
                  side="left"
                  label="关闭需求栏"
                  expanded
                  onClick={() => rails.setLeftOpen(false)}
                />
              </div>
              {leftRail}
            </aside>
            <PanelResizer side="left" width={leftW} onWidth={setLeftW} label="调整需求栏宽度" />
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <CenterPanel
              projectType={props.meta?.projectType ?? "ui"}
              document={props.document}
              projectId={props.projectId ?? ""}
              selectedId={props.selectedId}
              viewport={props.viewport}
              onSelect={props.onSelect}
              onSetViewport={props.onSetViewport}
              previewMode={props.previewMode}
              onSetPreviewMode={props.onSetPreviewMode}
              tabs={props.tabs}
              editorSlot={props.editorSlot}
            />
            {/* Right rail: inline on wide / opt-in on medium, drawer on narrow. */}
            {showRightRail && !isNarrow && !rails.rightOpen && (
              <PanelToggleButton
                side="right"
                label="切换属性栏"
                expanded={false}
                onClick={() => rails.setRightOpen(true)}
              />
            )}
            {showRightRail && !isNarrow && rails.rightOpen && (
              <>
                <PanelResizer side="right" width={rightW} onWidth={setRightW} label="调整属性栏宽度" />
                <aside
                  className="flex shrink-0 flex-col overflow-hidden border-l border-hairline bg-rail text-sm"
                  style={{ width: rightW }}
                >
                  <div className="flex shrink-0 justify-start border-b border-hairline px-2 py-1">
                    <PanelToggleButton
                      side="right"
                      label="关闭属性栏"
                      expanded
                      onClick={() => rails.setRightOpen(false)}
                    />
                  </div>
                  <RightPanel
                    doc={props.document}
                    selectedId={props.selectedId}
                    onSelect={props.onSelect}
                    onSetToken={props.onSetToken}
                    onPropsChange={props.onPropsChange}
                    onInsert={props.onInsert}
                    onRemove={props.onRemove}
                    onMove={props.onMove}
                  />
                </aside>
              </>
            )}
          </div>
          <BottomDock
            projectType={projectType}
            codePanel={props.codePanel}
            versionPanel={props.versionPanel}
            visualPanel={props.visualPanel}
          />
        </div>
        {/* Narrow-only overlay entries: two persistent edge strips + one drawer at a time. */}
        {isNarrow && (
          <>
            <PanelToggleButton
              side="left"
              variant="strip"
              label="切换需求栏"
              expanded={rails.narrowPane === "left"}
              onClick={() => rails.toggleNarrowPane("left")}
            />
            {showRightRail && (
              <PanelToggleButton
                side="right"
                variant="strip"
                label="切换属性栏"
                expanded={rails.narrowPane === "right"}
                onClick={() => rails.toggleNarrowPane("right")}
              />
            )}
            <Presence when={rails.narrowPane === "left"}>
              <NarrowDrawer
                key="narrow-left"
                side="left"
                label="需求"
                onClose={() => rails.toggleNarrowPane("left")}
                focusFallback={() =>
                  document.querySelector<HTMLElement>('aside[aria-label="需求"] button')
                    ?? document.querySelector<HTMLElement>('button[aria-label="切换需求栏"]')
                }
              >
                {leftRail}
              </NarrowDrawer>
            </Presence>
            <Presence when={rails.narrowPane === "right" && showRightRail}>
              <NarrowDrawer
                key="narrow-right"
                side="right"
                label="属性"
                onClose={() => rails.toggleNarrowPane("right")}
                focusFallback={() =>
                  document.querySelector<HTMLElement>('[role="complementary"][aria-label="属性"] button')
                    ?? document.querySelector<HTMLElement>('button[aria-label="切换属性栏"]')
                }
              >
                <RightPanel
                  doc={props.document}
                  selectedId={props.selectedId}
                  onSelect={props.onSelect}
                  onSetToken={props.onSetToken}
                  onPropsChange={props.onPropsChange}
                  onInsert={props.onInsert}
                  onRemove={props.onRemove}
                  onMove={props.onMove}
                />
              </NarrowDrawer>
            </Presence>
          </>
        )}
      </div>
      {props.settingsDialog}
    </div>
  );
}
