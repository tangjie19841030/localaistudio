import type { CSSProperties, ReactNode } from "react";

export interface ContainerProps {
  maxWidth: "sm" | "md" | "lg" | "xl" | "full";
  children?: ReactNode;
  studioId?: string;
}

const WIDTH_PX: Record<ContainerProps["maxWidth"], string> = {
  sm: "384px",
  md: "512px",
  lg: "768px",
  xl: "1024px",
  full: "100%",
};

export const componentType = "Container";

/** Centered horizontal container with semantic max-width. */
export default function Container({ maxWidth, children, studioId }: ContainerProps) {
  const style: CSSProperties = {
    maxWidth: WIDTH_PX[maxWidth],
    marginLeft: "auto",
    marginRight: "auto",
  };
  return (
    <div data-component={componentType} data-studio-id={studioId} style={style}>
      {children}
    </div>
  );
}
