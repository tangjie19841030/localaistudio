export interface TestimonialProps {
  quote?: string;
  author?: string;
  role?: string;
  studioId?: string;
}

export const componentType = "Testimonial";

function safeText(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/** Quote card: oversized serif quote mark, quote body, divider, author row. */
export default function Testimonial({
  quote,
  author,
  role,
  studioId,
}: TestimonialProps) {
  const quoteText = safeText(quote, "这个工具彻底改变了我们的工作方式。");
  const authorText = safeText(author, "王小姐");
  const roleText = safeText(role, "产品经理");
  const initial = authorText.trim().charAt(0);
  return (
    <figure
      data-component={componentType}
      data-studio-id={studioId}
      className="rounded-[var(--studio-radius-card)] border bg-[var(--studio-color-surface)] p-6"
      style={{ borderColor: "var(--studio-color-border)" }}
    >
      <span aria-hidden className="block font-serif text-[24px] leading-none" style={{ color: "var(--studio-color-accent)" }}>
        “
      </span>
      <blockquote className="mt-2 text-[13px] leading-6" style={{ color: "var(--studio-color-text)" }}>
        {quoteText}
      </blockquote>
      <figcaption
        className="mt-4 flex items-center gap-3 border-t pt-4"
        style={{ borderColor: "var(--studio-color-border)" }}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={{
            backgroundColor: "color-mix(in srgb, var(--studio-color-accent) 12%, transparent)",
            color: "var(--studio-color-accent)",
          }}
        >
          {initial}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium" style={{ color: "var(--studio-color-text)" }}>
            {authorText}
          </span>
          <span className="block text-[11px] text-[var(--studio-color-muted)]">{roleText}</span>
        </span>
      </figcaption>
    </figure>
  );
}
