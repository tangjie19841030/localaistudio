import { useState } from "react";

export type TabItem = string | { key?: string; label?: string };

export interface TabsProps {
  /** Model-facing tolerant shape: strings or {key,label} objects. */
  items?: TabItem[];
  /** Zero-based index of the active tab (uncontrolled after mount). */
  activeIndex?: number;
  studioId?: string;
}

export const componentType = "Tabs";

interface NormalizedTab {
  key: string;
  label: string;
}

function normalizeItems(items: unknown, activeIndex: number): { tabs: NormalizedTab[]; active: number } {
  const raw = Array.isArray(items) ? items : [];
  const tabs: NormalizedTab[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item === "string" && item.trim() !== "") {
      tabs.push({ key: `tab-${i}`, label: item });
    } else if (item && typeof item === "object") {
      const o = item as { key?: string; label?: string };
      const label = [o.label, o.key].find((v) => typeof v === "string" && v.trim() !== "");
      if (label) tabs.push({ key: o.key ?? `tab-${i}`, label });
    }
  }
  const active = Math.min(Math.max(0, activeIndex), Math.max(0, tabs.length - 1));
  return { tabs, active };
}

/** Segmented tab strip: pill container, active tab uses the tinted accent. */
export default function Tabs({ items, activeIndex = 0, studioId }: TabsProps) {
  const { tabs, active } = normalizeItems(items, activeIndex);
  const [selected, setSelected] = useState(active);
  if (tabs.length === 0) return null;
  const current = Math.min(selected, tabs.length - 1);
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--studio-color-border)] bg-[var(--studio-color-surface)] p-0.5"
    >
      {tabs.map((tab, i) => (
        <button
          key={tab.key}
          type="button"
          aria-selected={i === current}
          role="tab"
          onClick={() => setSelected(i)}
          className={`studio-transition rounded-md px-3 py-1 text-xs font-medium ${
            i === current
              ? "bg-[var(--studio-color-brand)] text-white"
              : "text-[var(--studio-color-muted)] hover:text-[var(--studio-color-text)]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
