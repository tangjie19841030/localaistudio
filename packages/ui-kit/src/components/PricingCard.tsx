export interface PricingCardProps {
  plan?: string;
  price?: string;
  period?: string;
  features?: string[];
  ctaText?: string;
  /** Accent border, badge and stronger shadow when true. */
  featured?: boolean;
  studioId?: string;
}

export const componentType = "PricingCard";

/** Pricing card: plan/price header, check-listed features, full-width CTA. */
export default function PricingCard({
  plan = "专业版",
  price = "¥99",
  period = "/月",
  features = ["无限项目", "优先支持", "专属客服"],
  ctaText = "立即订阅",
  featured = false,
  studioId,
}: PricingCardProps) {
  const accent = "var(--studio-color-accent)";
  const list = Array.isArray(features)
    ? features.filter((f): f is string => typeof f === "string" && f.trim() !== "")
    : [];
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="relative w-[280px] rounded-2xl border bg-[var(--studio-color-surface)] p-6"
      style={{
        borderColor: featured ? accent : "var(--studio-color-border)",
        boxShadow: featured ? "0 8px 24px rgba(0,0,0,0.12)" : undefined,
      }}
    >
      {featured && (
        <span
          className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          荐
        </span>
      )}
      <div className="text-xs uppercase tracking-wide text-[var(--studio-color-muted)]">{plan}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[28px] font-bold leading-8" style={{ color: "var(--studio-color-text)" }}>
          {price}
        </span>
        <span className="text-xs text-[var(--studio-color-muted)]">{period}</span>
      </div>
      {list.length > 0 && (
        <ul className="mt-4 space-y-2">
          {list.map((f) => (
            <li key={f} className="flex items-center gap-2 text-xs" style={{ color: "var(--studio-color-text)" }}>
              <span aria-hidden className="font-semibold" style={{ color: "var(--studio-color-brand)" }}>
                ✓
              </span>
              {f}
            </li>
          ))}
        </ul>
      )}
      <div
        className="mt-6 flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium"
        style={
          featured
            ? { backgroundColor: accent, color: "#fff" }
            : { border: "1px solid var(--studio-color-border)", color: "var(--studio-color-text)" }
        }
      >
        {ctaText}
      </div>
    </div>
  );
}
