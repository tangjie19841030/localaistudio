export interface BreadcrumbProps {
  /** Model-facing tolerant shape: strings or {label} objects. */
  items?: (string | { label?: string })[];
  studioId?: string;
}

export const componentType = "Breadcrumb";

interface Crumb {
  key: string;
  label: string;
}

function normalizeCrumbs(items: unknown): Crumb[] {
  const raw = Array.isArray(items) ? items : [];
  const crumbs: Crumb[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item === "string" && item.trim() !== "") {
      crumbs.push({ key: `crumb-${i}`, label: item });
    } else if (item && typeof item === "object") {
      const label = (item as { label?: string }).label;
      if (typeof label === "string" && label.trim() !== "") {
        crumbs.push({ key: `crumb-${i}`, label });
      }
    }
  }
  return crumbs;
}

/** White capsule strip: crumbs joined by muted separators; the last crumb is the current page. */
export default function Breadcrumb({ items, studioId }: BreadcrumbProps) {
  const crumbs = normalizeCrumbs(items);
  if (crumbs.length === 0) return null;
  return (
    <nav
      data-component={componentType}
      data-studio-id={studioId}
      aria-label="Breadcrumb"
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--studio-color-border)] bg-[var(--studio-color-surface)] px-2.5 py-1"
    >
      {crumbs.map((crumb, i) => (
        <span key={crumb.key} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-[11px] text-[var(--studio-color-muted)]">
              ›
            </span>
          )}
          <span
            className={`text-[11px] ${
              i === crumbs.length - 1
                ? "font-medium text-[var(--studio-color-text)]"
                : "text-[var(--studio-color-muted)]"
            }`}
          >
            {crumb.label}
          </span>
        </span>
      ))}
    </nav>
  );
}
