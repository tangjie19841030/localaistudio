export interface NavItemObject {
  key?: string;
  label?: string;
  text?: string;
  title?: string;
}
export type NavItem = string | NavItemObject;

export interface NavProps {
  /** Model-facing tolerant shape: plain strings or {key,label} objects. */
  items?: NavItem[];
  studioId?: string;
}

export const componentType = "Nav";

interface NormalizedItem {
  key: string;
  label: string;
}

/**
 * Models emit either string[] or {key,label}-style objects depending on the
 * prompt and model family. Normalize both; drop anything non-renderable so a
 * malformed payload degrades to fewer nav entries instead of crashing.
 */
function normalizeItems(items: unknown): NormalizedItem[] {
  if (!Array.isArray(items)) return [];
  const out: NormalizedItem[] = [];
  for (const [i, raw] of items.entries()) {
    if (typeof raw === "string") {
      if (raw.trim() !== "") out.push({ key: `nav-${i}`, label: raw });
    } else if (raw && typeof raw === "object") {
      const o = raw as NavItemObject;
      const label = [o.label, o.text, o.title, o.key].find(
        (v) => typeof v === "string" && v.trim() !== "",
      );
      if (label) out.push({ key: o.key ?? `nav-${i}`, label });
    }
  }
  return out;
}

/** Sidebar navigation list. */
export default function Nav({ items, studioId }: NavProps) {
  const normalized = normalizeItems(items);
  if (normalized.length === 0) return null;
  return (
    <nav
      data-component={componentType}
      data-studio-id={studioId}
      aria-label="导航"
      className="flex flex-col gap-1"
    >
      {normalized.map((item) => (
        <a
          key={item.key}
          href="#"
          onClick={(e) => e.preventDefault()}
          className="block rounded-[var(--studio-radius-control)] px-3 py-2 text-sm hover:bg-[var(--studio-color-accent)]/10"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
