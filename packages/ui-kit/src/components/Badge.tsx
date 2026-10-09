import type { Tone } from "../tokens";
import { toneBgClass, toneTextClass } from "../tokens";

export interface BadgeProps {
  label: string;
  tone?: Tone;
  studioId?: string;
}

export const componentType = "Badge";

/** Small rounded label chip with tone-tinted background. */
export default function Badge({ label, tone = "neutral", studioId }: BadgeProps) {
  return (
    <span
      data-component={componentType}
      data-studio-id={studioId}
      className={`inline-flex items-center rounded-[var(--studio-radius-control)] px-2 py-0.5 text-xs font-medium ${toneBgClass(tone)} ${toneTextClass(tone)}`}
    >
      {label}
    </span>
  );
}
