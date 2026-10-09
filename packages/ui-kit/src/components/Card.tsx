import type { ReactNode } from "react";

export interface CardProps {
  title?: string;
  padded?: boolean;
  children?: ReactNode;
  studioId?: string;
}

export const componentType = "Card";

/** Surface card with optional title and padding. */
export default function Card({ title, padded, children, studioId }: CardProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="overflow-hidden rounded-[var(--studio-radius-card)] border"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 4px 12px -2px rgba(0,0,0,0.04)",
      }}
    >
      {title && (
        <div
          className="border-b px-4 py-3 text-sm font-semibold"
          style={{
            borderColor: "var(--studio-color-border)",
            color: "var(--studio-color-text)",
          }}
        >
          {title}
        </div>
      )}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </div>
  );
}
