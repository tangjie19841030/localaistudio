export interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  studioId?: string;
}

export const componentType = "Button";

const VARIANT_CLASS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-[var(--studio-color-brand)] text-white border-transparent",
  secondary: "bg-transparent text-[var(--studio-color-text)] border-[var(--studio-color-border)]",
  ghost: "bg-transparent text-[var(--studio-color-text)] border-transparent",
  danger: "bg-[var(--studio-color-danger)] text-white border-transparent",
};

const SIZE_CLASS: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

/** Native button with semantic variants and sizes. */
export default function Button({
  label,
  variant = "primary",
  size = "md",
  onClick,
  studioId,
}: ButtonProps) {
  return (
    <button
      type="button"
      data-component={componentType}
      data-studio-id={studioId}
      onClick={onClick}
      className={`cursor-pointer rounded-[var(--studio-radius-control)] border font-medium transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-color-brand)] ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}`}
    >
      {label}
    </button>
  );
}
