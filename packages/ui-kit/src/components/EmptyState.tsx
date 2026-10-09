export interface EmptyStateProps {
  title: string;
  description?: string;
  studioId?: string;
}

export const componentType = "EmptyState";

/** Centered dashed empty-state box. */
export default function EmptyState({ title, description, studioId }: EmptyStateProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="flex flex-col items-center justify-center rounded-[var(--studio-radius-card)] border border-dashed px-6 py-10 text-center"
      style={{ borderColor: "var(--studio-color-border)" }}
    >
      <div className="text-base font-medium">{title}</div>
      {description && (
        <div className="mt-1 text-sm text-[var(--studio-color-muted)]">{description}</div>
      )}
    </div>
  );
}
