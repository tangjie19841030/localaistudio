export interface FooterColumn {
  title?: string;
  links?: string[];
}

export interface FooterProps {
  columns?: FooterColumn[];
  copyright?: string;
  studioId?: string;
}

export const componentType = "Footer";

function normalizeColumns(columns: unknown): { title: string; links: string[] }[] {
  if (!Array.isArray(columns)) return [];
  return columns
    .filter((c): c is FooterColumn => !!c && typeof c === "object")
    .map((c) => ({
      title: typeof c.title === "string" ? c.title : "",
      links: Array.isArray(c.links)
        ? c.links.filter((l): l is string => typeof l === "string" && l.trim() !== "")
        : [],
    }))
    .filter((c) => c.title !== "" || c.links.length > 0);
}

const DEFAULT_COLUMNS: FooterColumn[] = [
  { title: "产品", links: ["功能", "定价"] },
  { title: "公司", links: ["关于", "招聘"] },
];

/** Page footer: link columns over a hairline top border, copyright row below. */
export default function Footer({
  columns = DEFAULT_COLUMNS,
  copyright = "© 2026 Studio",
  studioId,
}: FooterProps) {
  const cols = normalizeColumns(columns);
  return (
    <footer
      data-component={componentType}
      data-studio-id={studioId}
      className="border-t p-8"
      style={{ borderColor: "var(--studio-color-border)" }}
    >
      {cols.length > 0 && (
        <div
          className="grid gap-8"
          style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
        >
          {cols.map((c, i) => (
            <div key={i}>
              <div className="text-xs font-semibold" style={{ color: "var(--studio-color-text)" }}>
                {c.title}
              </div>
              <ul className="mt-3 space-y-2">
                {c.links.map((l) => (
                  <li key={l} className="text-[11px] text-[var(--studio-color-muted)]">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div
        className={`border-t pt-4 text-[11px] text-[var(--studio-color-muted)]${cols.length > 0 ? " mt-6" : ""}`}
        style={{ borderColor: "var(--studio-color-border)" }}
      >
        {copyright}
      </div>
    </footer>
  );
}
