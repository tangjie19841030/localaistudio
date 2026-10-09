export interface TextareaProps {
  placeholder?: string;
  rows?: number;
  studioId?: string;
}

export const componentType = "Textarea";

/** Multi-line text input. */
export default function Textarea({ placeholder, rows = 3, studioId }: TextareaProps) {
  return (
    <textarea
      data-component={componentType}
      data-studio-id={studioId}
      rows={rows}
      placeholder={placeholder}
      className="w-full rounded-[var(--studio-radius-control)] border px-3 py-2 text-sm outline-none focus:border-[var(--studio-color-brand)]"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
      }}
    />
  );
}
