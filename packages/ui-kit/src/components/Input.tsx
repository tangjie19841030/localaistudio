export interface InputProps {
  placeholder?: string;
  type?: string;
  studioId?: string;
}

export const componentType = "Input";

/** Native text input bound to control radius token. */
export default function Input({ placeholder, type = "text", studioId }: InputProps) {
  return (
    <input
      data-component={componentType}
      data-studio-id={studioId}
      type={type}
      placeholder={placeholder}
      className="w-full rounded-[var(--studio-radius-control)] border px-3 py-2 text-sm outline-none focus:border-[var(--studio-color-brand)]"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
      }}
    />
  );
}
