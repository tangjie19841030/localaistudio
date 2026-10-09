import { useEffect, useState } from "react";
import type { PptSlideObject } from "@studio/ppt-toolkit";
import { manualInvocation, runPptCommands } from "../state";
import { FieldLabel } from "./FieldLabel";

/** table: textarea matrix (one row per line, tab-separated) → object.editTable. */
export function TableDetailFields({ object }: { object: Extract<PptSlideObject, { kind: "table" }> }) {
  const initial = object.cells.map((row) => row.map((cell) => cell.text).join("\t")).join("\n");
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const commit = () => {
    const cells = draft.split("\n").map((line) => line.split("\t").map((text) => ({ text })));
    if (cells.length === 0 || cells[0]!.length === 0) return;
    runPptCommands([manualInvocation("object.editTable", { objectId: object.id, cells })]);
  };
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>表格内容（每行一条，Tab 分列，失焦提交）</FieldLabel>
      <textarea
        aria-label="表格内容"
        className="min-h-24 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}
