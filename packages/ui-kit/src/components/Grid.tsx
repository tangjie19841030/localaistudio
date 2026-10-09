import type { CSSProperties, ReactNode } from "react";

export interface GridProps {
  columns: number;
  gap: number;
  children?: ReactNode;
  studioId?: string;
}

export const componentType = "Grid";

/** CSS grid layout: N equal columns, gap in spacing units (x4 px). */
export default function Grid({ columns, gap, children, studioId }: GridProps) {
  const style: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
    gap: `${gap * 4}px`,
  };
  // data-columns: hook for container-query reflow rules (previewDevice.css).
  return (
    <div data-component={componentType} data-studio-id={studioId} data-columns={columns} style={style}>
      {children}
    </div>
  );
}
