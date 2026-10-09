import type { ReactNode } from "react";

export interface FormFieldProps {
  label: string;
  required?: boolean;
  helpText?: string;
  children?: ReactNode;
  studioId?: string;
}

export const componentType = "FormField";

/** Field wrapper: label + control slot + help text. */
export default function FormField({
  label,
  required,
  helpText,
  children,
  studioId,
}: FormFieldProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="flex flex-col"
      style={{ gap: "calc(var(--studio-spacing-unit) / 2)" }}
    >
      <label className="text-sm font-medium">
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--studio-color-danger)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div>{children}</div>
      {helpText && <div className="text-xs text-[var(--studio-color-muted)]">{helpText}</div>}
    </div>
  );
}
