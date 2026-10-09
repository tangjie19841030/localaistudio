import type { NodeRecord, StudioDocument } from "@studio/schema-core";
import type { TokenPath } from "@studio/schema-core";
import { replacePage, unpin, getComponentDef, getNode } from "@studio/schema-core";
import type { Page } from "@studio/schema-core";
import { useState } from "react";
import { InsertMenu } from "../editor/InsertMenu";
import { LayerTree } from "../editor/LayerTree";
import { PropsForm } from "../editor/PropsForm";
import { TokenEditor } from "../editor/TokenEditor";
import { InspectPanel } from "../../features/inspect/InspectPanel";
import { useEditorStore } from "../../state/editorStore";

export interface RightPanelProps {
  /** Current document; null/omitted renders a placeholder (no project open yet). */
  doc?: StudioDocument | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onSetToken?: (path: TokenPath, value: string | number) => void;
  onPropsChange?: (props: Record<string, unknown>) => void;
  onInsert?: (type: string) => void;
  onRemove?: (id: string) => void;
  onMove?: (id: string, newParentId: string, index: number) => void;
}

type TabKey = "props" | "token" | "layers" | "inspect";

const TABS: { key: TabKey; label: string }[] = [
  { key: "props", label: "属性" },
  { key: "token", label: "Token" },
  { key: "layers", label: "图层" },
  { key: "inspect", label: "检查" },
];

const noop = (): void => {};

/** Props-tab header for the selected node: component title, type + parent below. */
function SelectedNodeHeader({ node, parentTitle }: { node: NodeRecord; parentTitle?: string }) {
  return (
    <div className="mb-3">
      <p className="text-[13px] font-medium leading-tight text-ink">
        {getComponentDef(node.type)?.title ?? node.type}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-muted">
        {node.type}
        {parentTitle ? ` · 位于 ${parentTitle} 内` : ""}
      </p>
    </div>
  );
}

/** Right rail body (WorkbenchLayout owns the <aside> chrome). */
export function RightPanel(props: RightPanelProps) {
  const [tab, setTab] = useState<TabKey>("props");
  const doc = props.doc ?? null;
  // Node ops are page-scoped (T19): the active page is the single-page doc today.
  const page: StudioDocument | Page | null =
    doc && "pages" in doc ? doc.pages[0]! : doc;
  const selectedId = props.selectedId ?? null;
  const onSelect = props.onSelect ?? noop;
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const multiCount = selectedIds.length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selected: NodeRecord | undefined =
    doc && selectedId !== null ? getNode(page as never, selectedId) : undefined;
  // Parent chain via one cheap scan over flat nodes (same pattern as LayerTree).
  const parent = doc && selected ? (page as { nodes: NodeRecord[] }).nodes.find((n) => n.children.includes(selected.id)) : undefined;
  const parentTitle = parent ? (getComponentDef(parent.type)?.title ?? parent.type) : undefined;

  return (
    <div role="complementary" aria-label="属性" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label="右栏页签"
        className="flex shrink-0 items-center gap-0.5 border-b border-hairline bg-rail px-2 h-10"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`studio-transition h-7 self-center rounded-lg px-2.5 text-xs font-medium ${
              tab === t.key
                ? "bg-accent-soft text-accent"
                : "text-ink-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-3 py-3 text-[13px]">
        {!doc && <p className="text-xs text-ink-muted">尚未打开项目。</p>}
        {tab === "props" && doc && (
          <div className="space-y-5">
            {multiCount > 1 ? (
              <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-ink">
                <p className="font-medium text-accent">已选中 {multiCount} 个对象</p>
                <p className="mt-1 text-ink-muted">
                  画布可整体拖动/删除；属性按主选中节点编辑。
                  {selected ? ` 当前：${selected.type}` : ""}
                </p>
              </div>
            ) : selected ? (
              <div>
                <SelectedNodeHeader node={selected} parentTitle={parentTitle} />
                {/*
                  key=node.id：PropsForm 的本地 state 仅在挂载时从 node.props 取初值，
                  节点切换必须强制重挂载，否则上一个节点的表单值会串到下一个节点。
                */}
                <PropsForm
                  key={selected.id}
                  node={selected}
                  onPropsChange={props.onPropsChange ?? noop}
                  // Plan C unpin: through editorStore.applyOp so it is undoable
                  // like every other document op (RightPanel has no applyOp prop).
                  onUnpin={(id) => useEditorStore.getState().applyOp((d) => replacePage(d, d.pages[0]!.id, unpin(d.pages[0]!, id)))}
                />
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-ink-muted">
                请选择一个组件节点（点击预览或图层树）。
              </p>
            )}
            {/*
              Props-first: the insert catalog is collapsed while a node is selected
              and expanded by default with no selection. key resets the open state
              on node switch so the selected node stays the visual priority.
            */}
            <InsertMenu
              key={selected ? selected.id : "none"}
              defaultOpen={!selected}
              onInsert={props.onInsert ?? noop}
            />
          </div>
        )}
        {tab === "token" && doc && <TokenEditor doc={doc} onSetToken={props.onSetToken ?? noop} />}
        {/* T51 read-only inspect tab: InspectPanel reads editorStore itself. */}
        {tab === "inspect" && doc && <InspectPanel />}
        {tab === "layers" && doc && (
          <LayerTree
            doc={page as never}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onToggleSelect={(id) => {
              const current = useEditorStore.getState().selectedIds;
              const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
              useEditorStore.getState().selectNodes(next);
            }}
            onRemove={props.onRemove ?? noop}
            onMove={props.onMove}
          />
        )}
      </div>
    </div>
  );
}
