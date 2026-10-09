import { useState } from "react";

export type BottomNavItem = string | { key?: string; label?: string };

export interface BottomNavProps {
  /** Model-facing tolerant shape: strings or {key, label} objects. */
  items?: BottomNavItem[];
  /** Zero-based index of the active item (uncontrolled after mount). */
  activeIndex?: number;
  studioId?: string;
}

export const componentType = "BottomNav";

interface NormalizedItem {
  key: string;
  label: string;
}

function normalizeItems(items: unknown): NormalizedItem[] {
  const raw = Array.isArray(items) ? items : [];
  const entries: NormalizedItem[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item === "string" && item.trim() !== "") {
      entries.push({ key: `nav-${i}`, label: item });
    } else if (item && typeof item === "object") {
      const o = item as { key?: string; label?: string };
      const label = [o.label, o.key].find((v) => typeof v === "string" && v.trim() !== "");
      if (label) entries.push({ key: o.key ?? `nav-${i}`, label });
    }
  }
  return entries;
}

/** Mobile bottom bar: full-width 56px rail; active item turns brand-colored with a filled icon. */
export default function BottomNav({ items, activeIndex = 0, studioId }: BottomNavProps) {
  const entries = normalizeItems(items);
  const maxIndex = Math.max(0, entries.length - 1);
  const [active, setActive] = useState(() => Math.min(Math.max(0, activeIndex), maxIndex));
  if (entries.length === 0) return null;
  const current = Math.min(active, maxIndex);
  return (
    <nav
      data-component={componentType}
      data-studio-id={studioId}
      className="flex h-14 w-full items-stretch border-t border-[var(--studio-color-border)] bg-[var(--studio-color-surface)]"
    >
      {entries.map((entry, i) => {
        const isActive = i === current;
        return (
          <button
            key={entry.key}
            type="button"
            onClick={() => setActive(i)}
            className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 ${
              isActive
                ? "text-[var(--studio-color-brand)]"
                : "text-[var(--studio-color-muted)]"
            }`}
          >
            <span
              aria-hidden
              className={`h-4 w-4 rounded-md ${
                isActive ? "bg-[var(--studio-color-brand)]" : "border border-[var(--studio-color-muted)]"
              }`}
            />
            <span className="text-[10px] leading-none">{entry.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
