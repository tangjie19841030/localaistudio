import type { ReactNode } from "react";

export interface SectionProps {
  title: string;
  description?: string;
  children?: ReactNode;
  studioId?: string;
}

export const componentType = "Section";

/** Titled content block with optional description. */
export default function Section({ title, description, children, studioId }: SectionProps) {
  return (
    <section data-component={componentType} data-studio-id={studioId} className="mb-7">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--studio-color-text)" }}>
          {title}
        </h2>
        {description && (
          <p className="text-sm" style={{ color: "var(--studio-color-muted)" }}>
            {description}
          </p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}
