import { manualInvocation, runPptCommands } from "../state";

/** Z-order (置顶/上移/下移/置底) + optional duplicate; works for 1 or many objects. */
export function LayerOrderRow({ objectIds, withDuplicate = false }: { objectIds: string[]; withDuplicate?: boolean }) {
  const reorder = (position: "front" | "back" | "forward" | "backward") =>
    runPptCommands(objectIds.map((id) => manualInvocation("object.reorder", { objectId: id, position })));
  const btn =
    "h-7 w-8 rounded-md border border-hairline bg-surface text-xs text-ink-soft hover:border-accent hover:text-accent";
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" title="置底" aria-label="置底" className={btn} onClick={() => reorder("back")}>⇤</button>
      <button type="button" title="下移一层" aria-label="下移一层" className={btn} onClick={() => reorder("backward")}>↓</button>
      <button type="button" title="上移一层" aria-label="上移一层" className={btn} onClick={() => reorder("forward")}>↑</button>
      <button type="button" title="置顶" aria-label="置顶" className={btn} onClick={() => reorder("front")}>⇥</button>
      {withDuplicate && (
        <button
          type="button"
          aria-label="复制对象"
          className="ml-auto rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-accent"
          onClick={() => runPptCommands(objectIds.map((id) => manualInvocation("object.duplicate", { objectId: id })))}
        >
          复制
        </button>
      )}
    </div>
  );
}
