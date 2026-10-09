export interface CalendarProps {
  /** "YYYY-MM"; anything unparseable falls back to 2026-09. */
  month?: string;
  studioId?: string;
}

export const componentType = "Calendar";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const FALLBACK: MonthSpec = { year: 2026, month: 9 };

interface MonthSpec {
  year: number;
  month: number;
}

/** Strict YYYY-MM parse; year 0000-9999 and month 1-12 only. */
function parseMonth(value: unknown): MonthSpec {
  if (typeof value !== "string") return { ...FALLBACK };
  const m = /^(\d{4})-(\d{1,2})$/.exec(value.trim());
  if (!m) return { ...FALLBACK };
  const month = Number(m[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return { ...FALLBACK };
  return { year: Number(m[1]), month };
}

/** Static month grid: weekday header, leading blanks, centered 32px cells. */
export default function Calendar({ month = "2026-09", studioId }: CalendarProps) {
  const { year, month: m } = parseMonth(month);
  const firstWeekday = new Date(year, m - 1, 1).getDay();
  const dayCount = new Date(year, m, 0).getDate();
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="rounded-[var(--studio-radius-card)] border p-3"
      style={{ borderColor: "var(--studio-color-border)" }}
    >
      <p className="mb-2 text-center text-[13px] font-medium text-[var(--studio-color-text)]">
        {year} 年 {m} 月
      </p>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="flex h-8 items-center justify-center text-[10px] text-[var(--studio-color-muted)]"
          >
            {w}
          </span>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <span key={`blank-${i}`} className="h-8" />
        ))}
        {Array.from({ length: dayCount }, (_, i) => (
          <span
            key={`day-${i + 1}`}
            className="flex h-8 w-8 items-center justify-center justify-self-center text-xs text-[var(--studio-color-text)]"
          >
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
