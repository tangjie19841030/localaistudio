export interface DividerProps {
  /** Line direction; horizontal renders full-width, vertical stretches to parent height. */
  orientation?: "horizontal" | "vertical";
  /** Optional centered label shown between two line segments (horizontal only). */
  label?: string;
  studioId?: string;
}

export const componentType = "Divider";

const LINE_BG = { backgroundColor: "var(--studio-color-border)" } as const;

/** Hairline separator; the horizontal variant may carry a centered label between two lines. */
export default function Divider({ orientation = "horizontal", label, studioId }: DividerProps) {
  if (orientation === "vertical") {
    return (
      <div
        data-component={componentType}
        data-studio-id={studioId}
        aria-hidden
        className="w-px self-stretch"
        style={{ ...LINE_BG, minHeight: "inherit" }}
      />
    );
  }
  const text = typeof label === "string" ? label.trim() : "";
  if (text === "") {
    return (
      <div
        data-component={componentType}
        data-studio-id={studioId}
        aria-hidden
        className="h-px w-full"
        style={LINE_BG}
      />
    );
  }
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      role="separator"
      className="flex w-full items-center gap-3"
    >
      <span aria-hidden className="h-px flex-1" style={LINE_BG} />
      <span className="text-[11px] text-[var(--studio-color-muted)]">{text}</span>
      <span aria-hidden className="h-px flex-1" style={LINE_BG} />
    </div>
  );
}
