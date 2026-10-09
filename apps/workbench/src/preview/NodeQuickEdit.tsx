import {
  clearNodeBreakpoints,
  updateNodeBreakpoints,
  updateProps,
  type NodeRecord,
  type OverlayViewport,
  type Page,
} from "@studio/schema-core";
import { BreakpointFields } from "../components/editor/BreakpointFields";
import { PropsForm } from "../components/editor/PropsForm";
import type { Viewport } from "./PreviewSurface";

export interface NodeQuickEditProps {
  page: Page;
  selectedId: string | null;
  viewport: Viewport;
  onApplyPageOp: (fn: (page: Page) => Page) => boolean;
  onClose: () => void;
}

const VIEWPORT_LABEL: Record<OverlayViewport, string> = {
  tablet: "平板",
  mobile: "手机",
};

function QuickEditHeader({ node, onClose }: { node: NodeRecord; onClose: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-hairline px-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-ink">{node.type}</p>
        <p className="truncate text-[11px] text-ink-muted">{node.id}</p>
      </div>
      <button
        type="button"
        aria-label="关闭快捷编辑"
        onClick={onClose}
        className="studio-transition flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-rail hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        ×
      </button>
    </div>
  );
}

interface QuickEditBodyProps {
  node: NodeRecord;
  viewport: Viewport;
  onBaseChange: (next: Record<string, unknown>) => void;
  onOverlayChange: (patch: Record<string, unknown>) => void;
  onClearOverlay: () => void;
}

function QuickEditBody({
  node,
  viewport,
  onBaseChange,
  onOverlayChange,
  onClearOverlay,
}: QuickEditBodyProps) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      <section>
        <h3 className="mb-2 text-xs font-semibold text-ink">基础 props</h3>
        <PropsForm key={node.id} node={node} onPropsChange={onBaseChange} />
      </section>
      {viewport !== "desktop" && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-ink">当前视口差异（{VIEWPORT_LABEL[viewport]}）</h3>
          {node.pinned === true ? (
            <p className="text-xs text-ink-muted">pinned 节点不支持断点差异。</p>
          ) : (
            <BreakpointFields node={node} viewport={viewport} onChange={onOverlayChange} onClear={onClearOverlay} />
          )}
        </section>
      )}
    </div>
  );
}

export function NodeQuickEdit({
  page,
  selectedId,
  viewport,
  onApplyPageOp,
  onClose,
}: NodeQuickEditProps) {
  if (!selectedId) return null;
  const node = page.nodes.find((item) => item.id === selectedId);
  if (!node) return null;

  const commitBase = (next: Record<string, unknown>) =>
    onApplyPageOp((current) => updateProps(current, selectedId, next));
  const commitOverlay = (patch: Record<string, unknown>) =>
    onApplyPageOp((current) => updateNodeBreakpoints(current, selectedId, viewport as OverlayViewport, patch));
  const clearOverlay = () =>
    onApplyPageOp((current) => clearNodeBreakpoints(current, selectedId, viewport as OverlayViewport));

  return (
    <aside
      aria-label="快捷编辑"
      data-testid="node-quick-edit"
      className="absolute right-8 top-8 z-20 flex max-h-[calc(100%-4rem)] w-80 flex-col overflow-hidden rounded-xl border border-hairline bg-white shadow-card"
    >
      <QuickEditHeader node={node} onClose={onClose} />
      <QuickEditBody
        node={node}
        viewport={viewport}
        onBaseChange={commitBase}
        onOverlayChange={commitOverlay}
        onClearOverlay={clearOverlay}
      />
    </aside>
  );
}
