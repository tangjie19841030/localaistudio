import { useRef, useState } from "react";
import { RunLogPanel } from "../../features/logs/RunLogPanel";

type TabKey = "diff" | "logs" | "shots" | "versions";

const TABS: { key: TabKey; label: string }[] = [
  { key: "diff", label: "Diff" },
  { key: "logs", label: "运行日志" },
  { key: "shots", label: "本地质检" },
  { key: "versions", label: "版本历史" },
];

const PLACEHOLDER = "Diff / 日志 / 本地质检内容将在对应阶段接入。";

/** Collapsed strip keeps the tablist reachable; drag handle grows the body. */
const DOCK_MIN = 120;
const DOCK_MAX = 420;
const DOCK_DEFAULT = 176;
const DOCK_COLLAPSED = 44;

export interface BottomDockProps {
  /** "Diff" tab content: generated-file browser + doc diff (App-owned). */
  codePanel?: React.ReactNode;
  /** Version history panel content (owned by App; BottomDock stays a layout shell). */
  versionPanel: React.ReactNode;
  /** "本地质检" tab content: visual-check panel (App-owned; slot only here). */
  visualPanel?: React.ReactNode;
  /** 非 ui 项目没有代码生成/本地质检管线：隐藏不适用页签并默认折叠。 */
  projectType?: "ui" | "ppt" | "word";
}

/**
 * Resolve the tab index selected by a keyboard event, or null when the key is
 * not a tablist navigation key. ArrowLeft/ArrowRight wrap around; Home/End jump.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={up ? undefined : { transform: "rotate(180deg)" }}
    >
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

export function BottomDock(props: BottomDockProps) {
  const isToolkit = props.projectType === "ppt" || props.projectType === "word";
  // Filter tabs by project type: ppt/word have no Diff/local quality pipeline.
  const tabs = TABS.filter((t) => !isToolkit || (t.key !== "diff" && t.key !== "shots"));
  const [rawTab, setTab] = useState<TabKey>("diff");
  const [height, setHeight] = useState(DOCK_DEFAULT);
  const [collapsed, setCollapsed] = useState(isToolkit);
  // 拖拽高度每帧 setState：此时必须关掉 height 过渡，否则跟手滞后；
  // 点击折叠/展开时才走 .dock-shell 的 180ms 过渡。
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 页签列表收窄后（如 ui→ppt 切换）保证选中项仍存在。
  const tab: TabKey = tabs.some((t) => t.key === rawTab) ? rawTab : (tabs[0]?.key ?? "diff");

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((t) => t.key === tab);
    const next = nextTabIndex(current, e.key, tabs.length);
    if (next === null) return;
    const target = tabs[next];
    if (!target) return;
    e.preventDefault();
    setTab(target.key);
    tabRefs.current[next]?.focus();
  }

  const dockHeight = collapsed ? DOCK_COLLAPSED : height;

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: height };
    setDragging(true);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.min(DOCK_MAX, Math.max(DOCK_MIN, drag.startH + (drag.startY - e.clientY)));
    setHeight(next);
    if (collapsed) setCollapsed(false);
  };
  const onHandleUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <footer
      role="region"
      aria-label="底部坞"
      className="dock-shell flex shrink-0 flex-col overflow-hidden border-t border-hairline bg-canvas"
      style={{ height: dockHeight, transition: dragging ? "none" : undefined }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整底部坞高度"
        className="h-1.5 shrink-0 cursor-row-resize bg-transparent hover:bg-accent-soft"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      />
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1">
        <div
          role="tablist"
          aria-label="底部页签"
          className="studio-transition flex flex-1 items-center gap-0.5 overflow-x-auto"
          onKeyDown={onKeyDown}
        >
          {tabs.map((t, i) => (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`dock-tab-${t.key}`}
              aria-selected={t.key === tab}
              aria-controls={`dock-panel-${t.key}`}
              tabIndex={t.key === tab ? 0 : -1}
              onClick={() => {
                setTab(t.key);
                if (collapsed) setCollapsed(false);
              }}
              className={`studio-transition h-7 shrink-0 self-center rounded-lg px-2.5 text-xs font-medium ${
                t.key === tab
                  ? "bg-accent-soft text-accent"
                  : "text-ink-muted hover:bg-rail hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={collapsed ? "展开底部坞" : "折叠底部坞"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开底部坞" : "折叠底部坞"}
          className="studio-transition inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-muted hover:bg-rail hover:text-ink"
          onClick={() => setCollapsed((v) => !v)}
        >
          <Chevron up={collapsed} />
        </button>
      </div>
      {/* body 常驻以便高度平滑过渡；折叠时 inert 移出 a11y 树并屏蔽指针，
          与"条件挂载"对 getByRole("tabpanel") 的行为保持一致。 */}
      <div
        role="tabpanel"
        id={`dock-panel-${tab}`}
        aria-labelledby={`dock-tab-${tab}`}
        aria-hidden={collapsed}
        tabIndex={collapsed ? -1 : 0}
        inert={collapsed}
        className={`min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-1 ${collapsed ? "pointer-events-none" : ""}`}
      >
        <DockBody tab={tab} {...props} />
      </div>
    </footer>
  );
}

function DockBody(props: BottomDockProps & { tab: TabKey }) {
  switch (props.tab) {
    case "diff":
      return (
        props.codePanel ?? (
          <p className="text-xs text-ink-muted">生成代码后此处展示文件与文档 diff。</p>
        )
      );
    case "logs":
      return <RunLogPanel />;
    case "versions":
      return <>{props.versionPanel}</>;
    case "shots":
      return <>{props.visualPanel ?? <p className="text-xs text-ink-muted">{PLACEHOLDER}</p>}</>;
    default:
      return <p className="text-xs text-ink-muted">{PLACEHOLDER}</p>;
  }
}
