export interface TimelineItem {
  title?: string;
  description?: string;
  time?: string;
}

export interface TimelineProps {
  items?: TimelineItem[];
  studioId?: string;
}

export const componentType = "Timeline";

interface NormalizedEntry {
  title: string;
  description: string;
  time: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Keep entries with at least one non-empty field (title-less still render). */
function normalizeItems(items: unknown): NormalizedEntry[] {
  if (!Array.isArray(items)) return [];
  const rows: NormalizedEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const entry = { title: str(o.title), description: str(o.description), time: str(o.time) };
    if (!entry.title && !entry.description && !entry.time) continue;
    rows.push(entry);
  }
  return rows;
}

/** Vertical timeline: brand dots on a border-token rail, content right. */
export default function Timeline({ items, studioId }: TimelineProps) {
  const rows = normalizeItems(items);
  if (rows.length === 0) return null;
  return (
    <div data-component={componentType} data-studio-id={studioId}>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex w-2 shrink-0 flex-col items-center">
            <span
              className="mt-1 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--studio-color-brand)" }}
            />
            {i < rows.length - 1 && (
              <span className="w-0.5 flex-1" style={{ backgroundColor: "var(--studio-color-border)" }} />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex items-baseline justify-between gap-2">
              {row.title ? (
                <p className="text-[13px] font-medium text-[var(--studio-color-text)]">{row.title}</p>
              ) : (
                <span />
              )}
              {row.time && <span className="text-[11px] text-[var(--studio-color-muted)]">{row.time}</span>}
            </div>
            {row.description && (
              <p className="mt-0.5 text-[11px] text-[var(--studio-color-muted)]">{row.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
