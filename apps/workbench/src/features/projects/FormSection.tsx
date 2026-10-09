import type { ReactNode } from "react";

interface FormSectionProps {
  title: string;
  children: ReactNode;
}

/**
 * Grouped form section: hairline-outlined fieldset with a small uppercase
 * muted legend, matching the workbench section-header style.
 */
export function FormSection({ title, children }: FormSectionProps) {
  return (
    <fieldset className="rounded-lg border border-hairline px-3 pb-3 pt-1.5">
      <legend className="px-1 text-xs font-medium uppercase tracking-wider text-ink-muted">
        {title}
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}
