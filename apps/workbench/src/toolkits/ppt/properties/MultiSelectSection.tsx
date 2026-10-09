import type { PptSlide, PptSlideObject } from "@studio/ppt-toolkit";
import { manualInvocation, runPptCommands } from "../state";
import { LayerOrderRow } from "./LayerOrderRow";

/** Multi-selection: batch actions built entirely from existing commands. */
export function MultiSelectSection({ slide, objectIds }: { slide: PptSlide; objectIds: string[] }) {
  const objects = objectIds
    .map((id) => slide.objects.find((o) => o.id === id))
    .filter((o): o is PptSlideObject => Boolean(o));
  const allLocked = objects.length > 0 && objects.every((o) => o.locked === true);
  const batch = (commandId: string, argsFor: (id: string) => unknown) =>
    runPptCommands(objects.map((o) => manualInvocation(commandId, argsFor(o.id))));
  const align = (edge: "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter") =>
    runPptCommands([manualInvocation("object.alignMany", { slideId: slide.id, objectIds, edge })]);
  const group = () =>
    runPptCommands([manualInvocation("object.group", { slideId: slide.id, objectIds })]);
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">多选对象</h3>
        <span className="text-xs text-ink-muted">已选 {objects.length} 个</span>
      </header>
      <div className="grid grid-cols-3 gap-1">
        {([
          ["left", "左对齐"],
          ["hcenter", "水平居中"],
          ["right", "右对齐"],
          ["top", "顶对齐"],
          ["vcenter", "垂直居中"],
          ["bottom", "底对齐"],
        ] as const).map(([edge, label]) => (
          <button
            key={edge}
            type="button"
            className="rounded-md border border-hairline bg-surface px-1 py-1 text-xs text-ink-soft hover:border-accent"
            onClick={() => align(edge)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          className="rounded-md border border-hairline bg-surface px-1 py-1 text-xs text-ink-soft hover:border-accent disabled:opacity-40"
          onClick={() =>
            runPptCommands([manualInvocation("object.distribute", { slideId: slide.id, objectIds, axis: "horizontal" })])
          }
          disabled={objects.length < 3}
        >
          水平等距
        </button>
        <button
          type="button"
          className="rounded-md border border-hairline bg-surface px-1 py-1 text-xs text-ink-soft hover:border-accent"
          onClick={() =>
            runPptCommands([manualInvocation("object.distribute", { slideId: slide.id, objectIds, axis: "vertical" })])
          }
          disabled={objects.length < 3}
        >
          垂直等距
        </button>
        <button
          type="button"
          className="rounded-md border border-hairline bg-surface px-1 py-1 text-xs text-ink-soft hover:border-accent disabled:opacity-40"
          onClick={group}
          disabled={objects.length < 2 || objects.some((o) => o.kind === "group")}
        >
          组合
        </button>
      </div>
      <LayerOrderRow objectIds={objectIds} withDuplicate />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong"
          onClick={() => batch("object.lock", () => ({ locked: !allLocked }))}
        >
          {allLocked ? "全部解锁" : "全部锁定"}
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-danger hover:border-hairline-strong"
          onClick={() => batch("object.remove", () => ({}))}
        >
          全部删除
        </button>
      </div>
    </div>
  );
}
