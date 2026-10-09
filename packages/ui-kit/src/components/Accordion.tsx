import { useState } from "react";

export interface AccordionItem {
  title?: string;
  content?: string;
}

export interface AccordionProps {
  /** Model-facing tolerant shape: non-object or title-less entries are skipped. */
  items?: AccordionItem[];
  /** Index of the open row; -1 means all closed (uncontrolled after mount). */
  openIndex?: number;
  studioId?: string;
}

export const componentType = "Accordion";

interface NormalizedRow {
  key: string;
  title: string;
  content: string;
}

function normalizeRows(items: unknown): NormalizedRow[] {
  const raw = Array.isArray(items) ? items : [];
  const rows: NormalizedRow[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const o = item as AccordionItem;
    if (typeof o.title !== "string" || o.title.trim() === "") continue;
    rows.push({
      key: `row-${i}`,
      title: o.title,
      content: typeof o.content === "string" ? o.content : "",
    });
  }
  return rows;
}

/** Bordered accordion stack: one row open at a time; the chevron rotates when open. */
export default function Accordion({ items, openIndex = 0, studioId }: AccordionProps) {
  const rows = normalizeRows(items);
  const [open, setOpen] = useState(() => {
    const initial = Math.floor(openIndex);
    return initial >= 0 && initial < rows.length ? initial : -1;
  });
  if (rows.length === 0) return null;
  return (
    <div data-component={componentType} data-studio-id={studioId} className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const isOpen = i === open;
        return (
          <div
            key={row.key}
            className="rounded-lg border border-[var(--studio-color-border)] bg-[var(--studio-color-surface)] px-3 py-2"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? -1 : i)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
            >
              <span className="text-[13px] font-medium text-[var(--studio-color-text)]">{row.title}</span>
              <span
                aria-hidden
                className={`text-xs text-[var(--studio-color-muted)] transition-transform duration-200 ${
                  isOpen ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </button>
            {isOpen && row.content !== "" && (
              <p className="pb-1 pt-1 text-xs leading-5 text-[var(--studio-color-muted)]">{row.content}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
