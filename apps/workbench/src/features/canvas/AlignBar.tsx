import type { AlignMode, DistributeMode } from "./alignOps";
import type { CanvasAlignApi } from "./useCanvasAlign";

/**
 * Top-center floating bar (T13): 6 align + 2 distribute + group/ungroup.
 * Pure presentational — disabled logic is computed by useCanvasAlign and
 * passed in. Style mirrors CanvasToolbar (h-7 / text-xs / hover:bg-surface).
 */

export interface AlignBarProps extends Pick<CanvasAlignApi, "canDistribute" | "canGroup" | "canUngroup"> {
  onAlign: (mode: AlignMode) => void;
  onDistribute: (mode: DistributeMode) => void;
  onGroup: () => void;
  onUngroup: () => void;
}

const ALIGN_ACTIONS: { mode: AlignMode; label: string; title: string }[] = [
  { mode: "left", label: "左对齐", title: "左对齐：选中节点左缘对齐包围盒左缘" },
  { mode: "center-x", label: "水平居中", title: "水平居中：选中节点对齐包围盒竖直中线" },
  { mode: "right", label: "右对齐", title: "右对齐：选中节点右缘对齐包围盒右缘" },
  { mode: "top", label: "上对齐", title: "上对齐：选中节点上缘对齐包围盒上缘" },
  { mode: "center-y", label: "垂直居中", title: "垂直居中：选中节点对齐包围盒水平中线" },
  { mode: "bottom", label: "下对齐", title: "下对齐：选中节点下缘对齐包围盒下缘" },
];

const BTN_CLASS = "h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface disabled:opacity-40";

export function AlignBar({ canDistribute, canGroup, canUngroup, onAlign, onDistribute, onGroup, onUngroup }: AlignBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="对齐与编组"
      data-testid="canvas-align-bar"
      className="absolute top-4 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1 rounded-md border border-hairline bg-overlay p-0.5 shadow-pop"
    >
      {ALIGN_ACTIONS.map((action) => (
        <button
          key={action.mode}
          type="button"
          title={action.title}
          onClick={() => onAlign(action.mode)}
          className={BTN_CLASS}
        >
          {action.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />
      <button
        type="button"
        title="横向分布：选中节点水平间距均匀（≥3 个）"
        disabled={!canDistribute}
        onClick={() => onDistribute("horizontal")}
        className={BTN_CLASS}
      >
        横向分布
      </button>
      <button
        type="button"
        title="纵向分布：选中节点垂直间距均匀（≥3 个）"
        disabled={!canDistribute}
        onClick={() => onDistribute("vertical")}
        className={BTN_CLASS}
      >
        纵向分布
      </button>
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />
      <button
        type="button"
        title="编组：≥2 个顶层自由定位节点合为一个组容器（Ctrl+G）"
        disabled={!canGroup}
        onClick={onGroup}
        className={BTN_CLASS}
      >
        编组
      </button>
      <button
        type="button"
        title="解组：组成员回到页面层级（Ctrl+Shift+G）"
        disabled={!canUngroup}
        onClick={onUngroup}
        className={BTN_CLASS}
      >
        解组
      </button>
    </div>
  );
}
