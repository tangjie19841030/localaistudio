import { useState } from "react";

export function RectFields({ rect, onCommit }: { rect: { x: number; y: number; w: number; h: number }; onCommit: (field: "x" | "y" | "w" | "h", value: number) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["x", "y", "w", "h"] as const).map((field) => (
        <RectNumberField key={field} field={field} value={rect[field]} onCommit={onCommit} />
      ))}
    </div>
  );
}

/**
 * Number input with a local string draft: committing per keystroke fired a
 * transaction per character (and clearing the box jumped to 0/1 mid-typing).
 * Commit happens on blur / Enter; empty/NaN leaves the rect untouched.
 */
function RectNumberField({
  field,
  value,
  onCommit,
}: {
  field: "x" | "y" | "w" | "h";
  value: number;
  onCommit: (field: "x" | "y" | "w" | "h", value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onCommit(field, n);
    setDraft(null);
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-ink-muted" htmlFor={`ppt-rect-${field}`}>{rectFieldLabel[field]}</label>
      <input
        id={`ppt-rect-${field}`}
        aria-label={rectFieldLabel[field]}
        type="number"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    </div>
  );
}

const rectFieldLabel = { x: "X 坐标", y: "Y 坐标", w: "宽度", h: "高度" } as const;
