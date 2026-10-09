import type { PptSlideObject } from "@studio/ppt-toolkit";
import { manualInvocation, runPptCommands } from "../state";
import { FieldLabel } from "./FieldLabel";

const FONT_FAMILIES = [
  "微软雅黑",
  "黑体",
  "宋体",
  "楷体",
  "仿宋",
  "Arial",
  "Times New Roman",
  "Georgia",
  "Inter, sans-serif",
];

/** text/placeholder: content, font family/size, align, bold/italic/run color. */
export function TextDetailFields({ object, text, onTextChange, onTextCommit }: {
  object: Extract<PptSlideObject, { kind: "text" }> | Extract<PptSlideObject, { kind: "placeholder" }>;
  text: string;
  onTextChange: (text: string) => void;
  onTextCommit: () => void;
}) {
  const textObject = object.kind === "text" ? object : null;
  const fontSize = textObject?.fontSize ?? 24;
  const align = textObject?.align ?? "left";
  const fontFamily = textObject?.fontFamily ?? "";
  const runs = textObject?.paragraphs.flatMap((p) => p.runs) ?? [];
  const allBold = runs.length > 0 && runs.every((r) => r.bold === true);
  const allItalic = runs.length > 0 && runs.every((r) => r.italic === true);
  const commonColor = runs[0]?.color ?? "#000000";
  const patch = (args: Record<string, unknown>) =>
    runPptCommands([manualInvocation("object.editText", { objectId: object.id, ...args })]);
  /** Map a run-level flag/color across the whole object, preserving text. */
  const patchRuns = (mut: (run: { bold?: boolean; italic?: boolean; color?: string; text: string }) => void) => {
    const paragraphs = (textObject?.paragraphs ?? [{ runs: [{ text }] }]).map((p) => ({
      runs: p.runs.map((r) => {
        const next = { ...r };
        mut(next);
        return next;
      }),
    }));
    patch({ paragraphs });
  };
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor="ppt-object-text">文本内容（换行 = 多段落）</FieldLabel>
      <textarea
        id="ppt-object-text"
        aria-label="文本内容"
        className="min-h-16 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onBlur={onTextCommit}
      />
      <div className="flex items-center gap-2">
        <FieldLabel htmlFor="ppt-object-font-family">字体</FieldLabel>
        <select
          id="ppt-object-font-family"
          aria-label="字体"
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
          value={fontFamily}
          onChange={(e) => patch({ fontFamily: e.target.value || undefined })}
        >
          <option value="">主题默认</option>
          {FONT_FAMILIES.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <FieldLabel htmlFor="ppt-object-fontsize">字号</FieldLabel>
        <input
          id="ppt-object-fontsize"
          aria-label="字号"
          type="number"
          min={4}
          max={400}
          className="w-20 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
          value={fontSize}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 4 && n <= 400) patch({ fontSize: n });
          }}
        />
        <button
          type="button"
          aria-label="加粗"
          aria-pressed={allBold}
          className={`h-7 w-7 rounded-md border text-xs font-bold ${allBold ? "border-accent bg-accent-soft text-accent" : "border-hairline bg-surface text-ink-soft"}`}
          onClick={() => patchRuns((r) => { r.bold = !allBold; })}
        >
          B
        </button>
        <button
          type="button"
          aria-label="斜体"
          aria-pressed={allItalic}
          className={`h-7 w-7 rounded-md border text-xs italic ${allItalic ? "border-accent bg-accent-soft text-accent" : "border-hairline bg-surface text-ink-soft"}`}
          onClick={() => patchRuns((r) => { r.italic = !allItalic; })}
        >
          I
        </button>
        <label className="flex items-center gap-1 text-xs text-ink-muted" title="文字颜色">
          <span>字色</span>
          <input
            type="color"
            aria-label="文字颜色"
            value={commonColor}
            onChange={(e) => patchRuns((r) => { r.color = e.target.value; })}
            className="h-7 w-9 cursor-pointer rounded border border-hairline bg-surface"
          />
        </label>
      </div>
      <div className="flex gap-1" role="group" aria-label="对齐方式">
        {([
          ["left", "左对齐"],
          ["center", "居中"],
          ["right", "右对齐"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={align === value}
            className={`flex-1 rounded-md border px-1 py-1 text-xs ${
              align === value ? "border-accent bg-accent-soft text-accent" : "border-hairline bg-surface text-ink-soft"
            }`}
            onClick={() => patch({ align: value })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
