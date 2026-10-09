import type { Page, StudioDocument, Tokens } from "@studio/schema-core";
import { useEffect, useRef, useState } from "react";
import { DEVICE_PAGE } from "../features/canvas/devicePresets";
import { CanvasSurface } from "../features/canvas/CanvasSurface";
import { PageTabs } from "../features/canvas/PageTabs";
import type { PageTabsApi } from "../features/canvas/usePageTabs";
import { useEditorStore } from "../state/editorStore";
import { ProjectPreview } from "./ProjectPreview";
import "./previewDevice.css";
import { NodeQuickEdit } from "./NodeQuickEdit";
import { SchemaRenderer } from "./SchemaRenderer";
import { ViewportStrip } from "./ViewportStrip";

export type Viewport = "desktop" | "tablet" | "mobile";
export type PreviewMode = "schema" | "project" | "canvas";

export interface PreviewSurfaceProps {
  doc: Page;
  tokens: Tokens;
  projectId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  viewport: Viewport;
  onViewportChange: (v: Viewport) => void;
  /** Schema 预览 / 项目预览（P3-4：isolated vite iframe）/ 自由画布（P5-2）。 */
  mode: PreviewMode;
  onModeChange: (m: PreviewMode) => void;
  /** P5-2: canvas mode doc mutations (one call = one undo entry).
   *  Optional because CenterPanel (components/layout) does not thread it —
   *  defaults to editorStore.applyOp so no layout-file changes are needed. */
  onApplyOp?: (fn: (doc: StudioDocument) => StudioDocument) => boolean;
  /** Page-scoped mutation callback; defaults to editorStore.applyPageOp. */
  onApplyPageOp?: (fn: (page: Page) => Page) => boolean;
  /** T19 §3.4: page tabs (all three modes share the active page). Absent ->
   *  no tab row renders (existing tests feed a bare Page without tabs). */
  tabs?: PageTabsApi;
}

/** Fixed pixel width per viewport preset (single source: devicePresets). */
const viewportWidth = (v: Viewport): number => DEVICE_PAGE[v].w;

const VIEWPORT_LABEL: Record<Viewport, string> = {
  desktop: "桌面",
  tablet: "平板",
  mobile: "手机",
};

const MODE_LABEL: Record<PreviewMode, string> = {
  schema: "Schema 预览",
  project: "项目预览",
  canvas: "画布",
};

/** 通用 segmented 控件（单列按钮组，激活态 accent 底白字）。 */
function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { key: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={props.ariaLabel}
      className="inline-flex h-7 items-center rounded-md border border-hairline bg-canvas p-0.5"
    >
      {props.options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={props.value === o.key}
          onClick={() => props.onChange(o.key)}
          className={`studio-transition h-7 rounded-lg px-2.5 text-xs font-medium ${
            props.value === o.key
              ? "bg-accent-soft text-accent"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PreviewSurface(props: PreviewSurfaceProps) {
  const { doc, tokens, projectId, selectedId, onSelect, viewport, onViewportChange, mode, onModeChange } = props;
  // U6: single/three-viewport layout is local preview chrome (never persisted,
  // never store state); it only exists in the schema branch.
  const [strip, setStrip] = useState(false);
  // Default to the store's applyOp when the caller does not thread one.
  const applyOp = props.onApplyOp ?? ((fn: (d: StudioDocument) => StudioDocument) => useEditorStore.getState().applyOp(fn));
  const applyPageOp =
    props.onApplyPageOp ?? ((fn: (page: Page) => Page) => useEditorStore.getState().applyPageOp(fn));
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* T19 §3.4: page tabs above the mode row; all three modes share the active page. */}
      {props.tabs && <PageTabs {...props.tabs} />}
      {/* 紧凑工具栏：左侧 segment 切换预览模式，右侧视口选择 */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-canvas px-4 h-10"
      >
        <div className="flex items-center gap-3">
          <Segmented<PreviewMode>
            ariaLabel="预览模式"
            value={mode}
            onChange={onModeChange}
            options={[
              { key: "schema", label: MODE_LABEL.schema },
              { key: "project", label: MODE_LABEL.project },
              { key: "canvas", label: MODE_LABEL.canvas },
            ]}
          />
          {/* U6: single vs three-viewport strip; schema branch only (the strip
              renders the same doc read-only at all three preset widths). */}
          {mode === "schema" && (
            <Segmented<"single" | "triple">
              ariaLabel="视口排布"
              value={strip ? "triple" : "single"}
              onChange={(v) => setStrip(v === "triple")}
              options={[
                { key: "single", label: "单视口" },
                { key: "triple", label: "三视口" },
              ]}
            />
          )}
        </div>
        <Segmented<Viewport>
          ariaLabel="视口切换"
          value={viewport}
          onChange={onViewportChange}
          options={[
            { key: "desktop", label: VIEWPORT_LABEL.desktop },
            { key: "tablet", label: VIEWPORT_LABEL.tablet },
            { key: "mobile", label: VIEWPORT_LABEL.mobile },
          ]}
        />
      </div>
      {/* 画布模式占满中部（自管 pan/zoom，不要外层滚动），其余模式保留滚动容器 */}
      <div className={mode === "canvas" ? "flex-1 min-h-0 overflow-hidden bg-rail" : "relative flex-1 overflow-auto bg-rail p-6"}>
        {mode === "canvas" ? (
          <CanvasSurface
            doc={doc}
            tokens={tokens}
            selectedId={selectedId}
            device={viewport}
            onSelect={(id) => {
              // Clearing the canvas selection goes through the store directly:
              // PreviewSurfaceProps.onSelect is string-only by historical contract.
              if (id === null) useEditorStore.getState().selectNode(null);
              else onSelect(id);
            }}
            applyOp={applyOp}
          />
        ) : mode === "project" ? (
          <ProjectPreview projectId={projectId} viewport={viewport} />
        ) : strip ? (
          // U6: three read-only columns render the same page via the same
          // SchemaRenderer; zero schema/render-source changes (read-only parity).
          <ViewportStrip page={doc} tokens={tokens} />
        ) : mode === "schema" ? (
          <>
          <FitWidth viewportWidth={viewportWidth(viewport)}>
            <div
              data-testid="preview-frame"
              className="overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-hairline"
              style={{ width: `${viewportWidth(viewport)}px` }}
            >
              <SchemaRenderer
                doc={doc}
                tokens={tokens}
                selectedId={selectedId}
                onSelect={onSelect}
                // W3-A: an action node switches the active page (store guards
                // unknown ids); project/canvas views keep their own behavior.
                onNavigate={(pageId) => useEditorStore.getState().setActivePage(pageId)}
                // W4-A: schema view resolves per-node breakpoints against the
                // selected device preset; project (generated CSS) and canvas
                // (editing geometry) views keep their own semantics.
                viewport={viewport}
              />

            </div>
          </FitWidth>
            <NodeQuickEdit
              page={doc}
              selectedId={selectedId}
              viewport={viewport}
              onApplyPageOp={applyPageOp}
              onClose={() => useEditorStore.getState().selectNode(null)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}


/**
 * Scale-to-fit wrapper for the schema-preview paper: a 1440px desktop viewport
 * almost never fits the center column, and clipping it behind a horizontal
 * scrollbar hides most of the design. The paper scales down to the container
 * width (never up), keeping the full viewport width visible at all times.
 */
function FitWidth(p: { viewportWidth: number; children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const available = host.clientWidth - 24; // breathing room, matches p-3
      setScale(Math.min(1, available / p.viewportWidth));
    };
    update();
    // jsdom lacks ResizeObserver — skip the dynamic part there; the initial
    // update above still picks up the test environment's clientWidth.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [p.viewportWidth]);

  return (
    <div ref={hostRef} className="min-h-full w-full overflow-auto p-3">
      <div
        style={{
          width: `${p.viewportWidth * scale}px`,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: `${p.viewportWidth}px`,
          }}
        >
          {p.children}
        </div>
      </div>
    </div>
  );
}
