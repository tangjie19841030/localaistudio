export interface ListItem {
  title: string;
  description?: string;
  meta?: string;
}

export interface ListProps {
  items?: ListItem[];
  studioId?: string;
}

export const componentType = "List";

interface NormalizedRow {
  title: string;
  description: string;
  meta: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Keep only rows with a non-empty string title; drop junk silently. */
function normalizeItems(items: unknown): NormalizedRow[] {
  if (!Array.isArray(items)) return [];
  const rows: NormalizedRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = str(o.title).trim();
    if (title === "") continue;
    rows.push({ title, description: str(o.description), meta: str(o.meta) });
  }
  return rows;
}

/** List rows: title/description left, meta right, hairline dividers. */
export default function List({ items, studioId }: ListProps) {
  const rows = normalizeItems(items);
  if (rows.length === 0) return null;
  return (
    <div data-component={componentType} data-studio-id={studioId}>
      {rows.map((row, i) => (
        <div
          key={`${row.title}-${i}`}
          className={`flex items-start justify-between gap-3 py-2.5 ${i < rows.length - 1 ? "border-b" : ""}`}
          style={i < rows.length - 1 ? { borderColor: "var(--studio-color-border)" } : undefined}
        >
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-[var(--studio-color-text)]">{row.title}</p>
            {row.description && (
              <p className="mt-0.5 text-[11px] text-[var(--studio-color-muted)]">{row.description}</p>
            )}
          </div>
          {row.meta && <span className="shrink-0 text-[11px] text-[var(--studio-color-muted)]">{row.meta}</span>}
        </div>
      ))}
    </div>
  );
}
