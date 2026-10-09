export interface CheckboxProps {
  label: string;
  checked?: boolean;
  studioId?: string;
}

export const componentType = "Checkbox";

/** Native checkbox with adjacent label (uncontrolled via defaultChecked). */
export default function Checkbox({ label, checked = false, studioId }: CheckboxProps) {
  return (
    <label
      data-component={componentType}
      data-studio-id={studioId}
      className="inline-flex cursor-pointer items-center gap-2 text-sm"
    >
      <input type="checkbox" defaultChecked={checked} className="size-4 accent-[var(--studio-color-brand)]" />
      <span>{label}</span>
    </label>
  );
}
