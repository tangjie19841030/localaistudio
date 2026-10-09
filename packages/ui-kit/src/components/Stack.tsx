import type { CSSProperties, ReactNode } from "react";

export interface StackProps {
  gap: number;
  align?: "start" | "center" | "end" | "stretch";
  children?: ReactNode;
  studioId?: string;
}

export const componentType = "Stack";

/** Vertical flex stack; gap in spacing units (x4 px). */
export default function Stack({ gap, align, children, studioId }: StackProps) {
  const style: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: `${gap * 4}px`,
    alignItems: align,
  };
  return (
    <div data-component={componentType} data-studio-id={studioId} style={style}>
      {children}
    </div>
  );
}
