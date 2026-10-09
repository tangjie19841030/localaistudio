import { useState } from "react";

export interface PaginationProps {
  /** Current page (uncontrolled after mount), clamped into [1, pageCount]. */
  page?: number;
  pageCount?: number;
  studioId?: string;
}

export const componentType = "Pagination";

function normalizePageCount(pageCount: unknown): number {
  if (typeof pageCount === "number" && Number.isFinite(pageCount) && pageCount >= 1) {
    return Math.floor(pageCount);
  }
  return 12;
}

function clampPage(page: unknown, pageCount: number): number {
  const value = typeof page === "number" && Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, value), pageCount);
}

const NAV_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded-md text-sm text-[var(--studio-color-muted)] hover:bg-[var(--studio-color-border)]";

/** White pill pager: prev button, "page / pageCount" indicator, next button; clamped to bounds. */
export default function Pagination({ page = 1, pageCount = 12, studioId }: PaginationProps) {
  const total = normalizePageCount(pageCount);
  const [current, setCurrent] = useState(() => clampPage(page, total));
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--studio-color-border)] bg-[var(--studio-color-surface)] px-2 py-1"
    >
      <button
        type="button"
        aria-label="上一页"
        className={NAV_BUTTON}
        onClick={() => setCurrent((p) => Math.max(1, p - 1))}
      >
        ‹
      </button>
      <span className="min-w-[40px] text-center text-xs text-[var(--studio-color-text)]">
        {current} / {total}
      </span>
      <button
        type="button"
        aria-label="下一页"
        className={NAV_BUTTON}
        onClick={() => setCurrent((p) => Math.min(total, p + 1))}
      >
        ›
      </button>
    </div>
  );
}
