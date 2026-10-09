export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-ink-muted" htmlFor={htmlFor}>{children}</label>
  );
}
