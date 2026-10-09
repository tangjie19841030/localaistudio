import type { ReactNode } from "react";

export interface MetricGridProps {
  columns: number;
  children?: ReactNode;
  studioId?: string;
}

export const componentType = "MetricGrid";

/** Preset grid for metric tiles: equal columns, 1-unit gap, min column width. */
export default function MetricGrid({ columns, children, studioId }: MetricGridProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      // Hook for container-query reflow rules (previewDevice.css).
      data-columns={columns}
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
        gap: "var(--studio-spacing-unit)",
      }}
    >
      {children}
    </div>
  );
}
