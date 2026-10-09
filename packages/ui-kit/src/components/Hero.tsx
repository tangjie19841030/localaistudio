export interface HeroProps {
  title?: string;
  subtitle?: string;
  ctaText?: string;
  studioId?: string;
}

export const componentType = "Hero";

/** Subtle surface-to-canvas wash; color-mix stands in for the canvas token. */
const PANEL_BG =
  "linear-gradient(to bottom, var(--studio-color-surface), color-mix(in srgb, var(--studio-color-muted) 8%, var(--studio-color-surface)))";

/** Centered marketing hero panel with a display-only CTA button. */
export default function Hero({
  title = "构建下一代产品",
  subtitle = "从想法到上线，一站式完成",
  ctaText = "立即开始",
  studioId,
}: HeroProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="rounded-2xl border p-10 text-center"
      style={{ borderColor: "var(--studio-color-border)", background: PANEL_BG }}
    >
      <h2 className="text-3xl font-bold" style={{ color: "var(--studio-color-text)" }}>
        {title}
      </h2>
      <p className="mt-2 text-sm text-[var(--studio-color-muted)]">{subtitle}</p>
      <span
        className="mt-6 inline-flex h-10 cursor-default items-center justify-center rounded-lg px-5 text-sm font-medium text-white"
        style={{ backgroundColor: "var(--studio-color-accent)" }}
      >
        {ctaText}
      </span>
    </div>
  );
}
