export interface HeaderProps {
  title: string;
  subtitle?: string;
  studioId?: string;
}

export const componentType = "Header";

/** Page-level header with brand accent rule, title and optional subtitle. */
export default function Header({ title, subtitle, studioId }: HeaderProps) {
  return (
    <div data-component={componentType} data-studio-id={studioId} className="mb-5">
      <div
        aria-hidden
        className="mb-3 h-1 w-10 rounded-full"
        style={{ backgroundColor: "var(--studio-color-brand)" }}
      />
      <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--studio-color-text)" }}>
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 text-sm" style={{ color: "var(--studio-color-muted)" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
