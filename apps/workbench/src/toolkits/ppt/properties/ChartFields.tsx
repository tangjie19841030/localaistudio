import { useState } from "react";
import type { PptSlideObject } from "@studio/ppt-toolkit";
import { manualInvocation, runPptCommands } from "../state";
import { FieldLabel } from "./FieldLabel";

/** chart: chart type + title (object.editChart). */
export function ChartDetailFields({ object }: { object: Extract<PptSlideObject, { kind: "chart" }> }) {
  const [title, setTitle] = useState(object.title ?? "");
  const patch = (args: Record<string, unknown>) =>
    runPptCommands([manualInvocation("object.editChart", { objectId: object.id, ...args })]);
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor="ppt-chart-type">图表类型</FieldLabel>
      <select
        id="ppt-chart-type"
        aria-label="图表类型"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={object.chartType}
        onChange={(e) => patch({ chartType: e.target.value })}
      >
        <option value="bar">柱状图</option>
        <option value="line">折线图</option>
        <option value="pie">饼图</option>
      </select>
      <FieldLabel htmlFor="ppt-chart-title">图表标题</FieldLabel>
      <input
        id="ppt-chart-title"
        aria-label="图表标题"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== (object.title ?? "") && patch({ title })}
      />
    </div>
  );
}
