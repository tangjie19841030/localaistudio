import type { PptSlideObject, ShapeKind } from "@studio/ppt-toolkit";
import { manualInvocation, runPptCommands } from "../state";
import { FieldLabel } from "./FieldLabel";

/** shape: kind select + fill/stroke color pickers (object.editShape). */
export function ShapeDetailFields({ object }: { object: Extract<PptSlideObject, { kind: "shape" }> }) {
  const shapes: { value: ShapeKind; label: string }[] = [
    { value: "rect", label: "矩形" },
    { value: "round", label: "圆角矩形" },
    { value: "ellipse", label: "椭圆" },
    { value: "triangle", label: "三角形" },
    { value: "arrow", label: "箭头" },
  ];
  const patch = (args: Record<string, unknown>) =>
    runPptCommands([manualInvocation("object.editShape", { objectId: object.id, ...args })]);
  return (
    <div className="flex flex-col gap-2">
      {object.gradient && (
        <p className="rounded-md bg-canvas px-2 py-1 text-[10px] text-ink-muted">
          渐变填充（{object.gradient.stops.length} 色）；在下方选纯色会替换为单色
        </p>
      )}
      <FieldLabel htmlFor="ppt-shape-kind">形状</FieldLabel>
      <select
        id="ppt-shape-kind"
        aria-label="形状类型"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={object.shape}
        onChange={(e) => patch({ shape: e.target.value })}
      >
        {shapes.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <FieldLabel>填充</FieldLabel>
        <input
          type="color"
          aria-label="填充颜色"
          value={object.fill ?? "#E4E4E7"}
          onChange={(e) => patch({ fill: e.target.value })}
          className="h-7 w-12 cursor-pointer rounded border border-hairline bg-surface"
        />
        <button type="button" className="text-xs text-ink-muted underline" onClick={() => patch({ fill: null })}>
          清除
        </button>
      </div>
      <div className="flex items-center gap-2">
        <FieldLabel>描边</FieldLabel>
        <input
          type="color"
          aria-label="描边颜色"
          value={object.stroke ?? "#000000"}
          onChange={(e) => patch({ stroke: e.target.value })}
          className="h-7 w-12 cursor-pointer rounded border border-hairline bg-surface"
        />
        <button type="button" className="text-xs text-ink-muted underline" onClick={() => patch({ stroke: null })}>
          清除
        </button>
      </div>
      <div className="flex items-center gap-2">
        <FieldLabel htmlFor="ppt-shape-opacity">不透明度</FieldLabel>
        <input
          id="ppt-shape-opacity"
          aria-label="形状不透明度"
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={object.opacity ?? 1}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
          className="flex-1"
        />
        <span className="w-9 text-right text-[10px] text-ink-muted">{Math.round((object.opacity ?? 1) * 100)}%</span>
      </div>
    </div>
  );
}
