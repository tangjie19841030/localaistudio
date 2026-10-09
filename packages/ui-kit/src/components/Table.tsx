export interface TableColumnObject {
  key?: string;
  title?: string;
  width?: number | string;
}
export type TableColumn = string | TableColumnObject;
export type TableRow = (string | number)[] | Record<string, unknown>;

export interface TableProps {
  /** Model-facing tolerant shapes: string columns or {key,title} objects. */
  columns?: TableColumn[];
  /** Model-facing tolerant shapes: arrays of cells or objects keyed by column key. */
  rows?: TableRow[];
  studioId?: string;
}

export const componentType = "Table";

interface NormalizedColumn {
  key: string;
  title: string;
  width?: number | string;
}

function normalizeColumns(columns: unknown): NormalizedColumn[] {
  if (!Array.isArray(columns)) return [];
  const out: NormalizedColumn[] = [];
  for (const [i, raw] of columns.entries()) {
    if (typeof raw === "string") {
      if (raw.trim() !== "") out.push({ key: raw, title: raw });
    } else if (raw && typeof raw === "object") {
      const o = raw as TableColumnObject;
      const title = [o.title, o.key].find((v) => typeof v === "string" && v.trim() !== "");
      if (title) out.push({ key: o.key ?? title, title, width: o.width });
    }
  }
  return out;
}

function normalizeRows(rows: unknown, columns: NormalizedColumn[]): string[][] {
  if (!Array.isArray(rows)) return [];
  const out: string[][] = [];
  for (const raw of rows) {
    if (Array.isArray(raw)) {
      out.push(raw.map((cell) => (cell == null ? "" : String(cell))));
    } else if (raw && typeof raw === "object") {
      out.push(columns.map((c) => {
        const v = (raw as Record<string, unknown>)[c.key];
        return v == null ? "" : String(v);
      }));
    }
  }
  return out;
}

/** Data table with soft muted header and hairline row rules. */
export default function Table({ columns, rows, studioId }: TableProps) {
  const cols = normalizeColumns(columns);
  const data = normalizeRows(rows, cols);
  if (cols.length === 0 || data.length === 0) return null;
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="overflow-x-auto rounded-[var(--studio-radius-card)] border"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
      }}
    >
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "var(--studio-color-muted-soft)" }}>
            {cols.map((col) => (
              <th
                key={col.key}
                className="border-b px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                style={{
                  borderColor: "var(--studio-color-border)",
                  color: "var(--studio-color-muted)",
                  width: col.width,
                }}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={i % 2 === 1 ? { backgroundColor: "var(--studio-color-muted-soft)" } : undefined}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="border-b px-3 py-2.5"
                  style={{
                    borderColor: "var(--studio-color-border)",
                    color: "var(--studio-color-text)",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
