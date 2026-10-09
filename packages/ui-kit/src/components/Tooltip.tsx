export interface TooltipProps {
  /** Bubble body text. */
  text?: string;
  /** Dashed-underline anchor text below the bubble. */
  anchor?: string;
  studioId?: string;
}

export const componentType = "Tooltip";

/** gray-900 equivalent: high-contrast bubble surface. */
const BUBBLE_BG = "#111827";

/** Always-visible tooltip display: dark bubble with a small arrow above the anchor. */
export default function Tooltip({ text = "提示内容", anchor = "悬停查看", studioId }: TooltipProps) {
  return (
    <span
      data-component={componentType}
      data-studio-id={studioId}
      className="inline-flex flex-col items-start gap-1.5"
    >
      <span
        className="relative rounded-md px-2 py-1 text-[11px] leading-4 text-white"
        style={{ backgroundColor: BUBBLE_BG }}
      >
        {text}
        <span
          aria-hidden
          className="absolute left-4 top-full h-2 w-2 -translate-y-1/2 rotate-45"
          style={{ backgroundColor: BUBBLE_BG }}
        />
      </span>
      <span
        className="text-[11px] text-[var(--studio-color-muted)]"
        style={{ textDecoration: "underline dashed", textUnderlineOffset: 3 }}
      >
        {anchor}
      </span>
    </span>
  );
}
