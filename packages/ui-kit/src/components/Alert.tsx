export type AlertTone = "info" | "success" | "warning" | "danger";

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  description?: string;
  studioId?: string;
}

export const componentType = "Alert";

const TONE_STYLE: Record<AlertTone, { bg: string; border: string; text: string; icon: string }> = {
  info: { bg: "var(--color-accent-soft)", border: "var(--color-accent)", text: "var(--color-accent)", icon: "ⓘ" },
  success: { bg: "var(--color-success-soft)", border: "var(--color-success)", text: "var(--color-success)", icon: "✓" },
  warning: { bg: "var(--color-warn-soft)", border: "var(--color-warn)", text: "var(--color-warn)", icon: "!" },
  danger: { bg: "var(--color-danger-soft)", border: "var(--color-danger)", text: "var(--color-danger)", icon: "×" },
};

/** Semantic alert banner: tinted background, tone-colored border and icon. */
export default function Alert({ tone = "info", title, description, studioId }: AlertProps) {
  const s = TONE_STYLE[tone] ?? TONE_STYLE.info;
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      role="alert"
      className="flex gap-2.5 rounded-xl border p-3"
      style={{ backgroundColor: s.bg, borderColor: s.border }}
    >
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ backgroundColor: s.border, color: "#fff" }}
      >
        {s.icon}
      </span>
      <div className="min-w-0">
        {title && <p className="text-sm font-semibold" style={{ color: s.text }}>{title}</p>}
        {description && <p className="mt-0.5 text-xs leading-5 text-[var(--studio-color-text)]">{description}</p>}
      </div>
    </div>
  );
}
