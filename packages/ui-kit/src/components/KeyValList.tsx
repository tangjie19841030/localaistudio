export interface KeyValItem {
  key: string;
  value: string;
}

export interface KeyValListProps {
  items?: KeyValItem[];
  studioId?: string;
}

export const componentType = "KeyValList";

interface NormalizedPair {
  key: string;
  value: string;
}

/** Values tolerate numbers (finite only); everything else degrades to "". */
function normalizeValue(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Keep only pairs with a non-empty string key; drop junk silently. */
function normalizeItems(items: unknown): NormalizedPair[] {
  if (!Array.isArray(items)) return [];
  const rows: NormalizedPair[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    if (key === "") continue;
    rows.push({ key, value: normalizeValue(o.value) });
  }
  return rows;
}

/** Definition rows: muted key left, medium ink value right, thin dividers. */
export default function KeyValList({ items, studioId }: KeyValListProps) {
  const rows = normalizeItems(items);
  if (rows.length === 0) return null;
  return (
    <div data-component={componentType} data-studio-id={studioId}>
      {rows.map((row, i) => (
        <div
          key={`${row.key}-${i}`}
          className={`flex items-center justify-between gap-3 py-1.5 ${i < rows.length - 1 ? "border-b" : ""}`}
          style={i < rows.length - 1 ? { borderColor: "var(--studio-color-border)" } : undefined}
        >
          <span className="text-xs text-[var(--studio-color-muted)]">{row.key}</span>
          <span className="text-xs font-medium text-[var(--studio-color-text)]">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
