import type { ReactNode } from "react";

export interface FormProps {
  title?: string;
  children?: ReactNode;
  studioId?: string;
}

export const componentType = "Form";

/** Form container: optional title + vertical stack of fields. */
export default function Form({ title, children, studioId }: FormProps) {
  return (
    <form
      data-component={componentType}
      data-studio-id={studioId}
      className="flex flex-col"
      style={{ gap: "calc(var(--studio-spacing-unit) * 4)" }}
      onSubmit={(e) => e.preventDefault()}
    >
      {title && <div className="text-base font-semibold">{title}</div>}
      {children}
    </form>
  );
}
