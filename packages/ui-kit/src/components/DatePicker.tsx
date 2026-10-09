export interface DatePickerProps {
  value?: string;
  placeholder?: string;
  studioId?: string;
}

export const componentType = "DatePicker";

function toStr(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  return typeof v === "string" ? v : String(v);
}

/** Display-only date trigger: bordered 32px field with a calendar icon. */
export default function DatePicker({
  value = "2026-09-10",
  placeholder = "选择日期",
  studioId,
}: DatePickerProps) {
  const text = toStr(value, "").trim();
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="flex h-8 w-48 cursor-pointer items-center gap-2 rounded-[var(--studio-radius-control)] border px-3"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
      }}
    >
      <span aria-hidden className="flex items-center" style={{ color: "var(--studio-color-muted)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 9.5h17M8 2.5V6m8-3.5V6" strokeLinecap="round" />
        </svg>
      </span>
      <span
        className="truncate text-[13px]"
        style={{ color: text ? "var(--studio-color-text)" : "var(--studio-color-muted)" }}
      >
        {text || placeholder}
      </span>
    </div>
  );
}
