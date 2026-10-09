export interface SelectProps {
  options: string[];
  placeholder?: string;
  studioId?: string;
}

export const componentType = "Select";

/** Native select with optional placeholder option. */
export default function Select({ options, placeholder, studioId }: SelectProps) {
  return (
    <select
      data-component={componentType}
      data-studio-id={studioId}
      className="w-full rounded-[var(--studio-radius-control)] border px-3 py-2 text-sm"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
