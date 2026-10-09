export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastProps {
  tone?: ToastTone;
  text?: string;
  studioId?: string;
}

export const componentType = "Toast";

/** Tone-soft surface + tone border/dot; var names mirror the Alert exemplar. */
const TONE_STYLE: Record<ToastTone, { bg: string; border: string; dot: string }> = {
  info: { bg: "var(--color-accent-soft)", border: "var(--color-accent)", dot: "var(--color-accent)" },
  success: { bg: "var(--color-success-soft)", border: "var(--color-success)", dot: "var(--color-success)" },
  warning: { bg: "var(--color-warn-soft)", border: "var(--color-warn)", dot: "var(--color-warn)" },
  danger: { bg: "var(--color-danger-soft)", border: "var(--color-danger)", dot: "var(--color-danger)" },
};

/** Non-floating toast display card: tone dot + message on a tinted surface. */
export default function Toast({ tone = "success", text = "已保存", studioId }: ToastProps) {
  const s = TONE_STYLE[tone] ?? TONE_STYLE.success;
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      role="status"
      className="flex w-64 items-center gap-2.5 rounded-lg border p-3"
      style={{
        backgroundColor: s.bg,
        borderColor: s.border,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.dot }} />
      <span className="min-w-0 truncate text-xs" style={{ color: "var(--studio-color-text)" }}>
        {text}
      </span>
    </div>
  );
}
