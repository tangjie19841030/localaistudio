export type PanelToggleVariant = "edge" | "strip";

export interface PanelToggleButtonProps {
  side: "left" | "right";
  /** Accessible name, e.g. "切换需求栏". */
  label: string;
  /** Whether the target rail is currently visible (drives aria-expanded + chevron). */
  expanded: boolean;
  onClick: () => void;
  /**
   * "edge": 32px chevron button shown in place of a collapsed rail (medium/wide).
   * "strip": slim always-visible entry pinned to the content edge (narrow).
   */
  variant?: PanelToggleVariant;
}

function Chevron({ pointRight }: { pointRight: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={pointRight ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M10 4l-4 4 4 4" />
    </svg>
  );
}

/**
 * Chevron toggle for a workbench rail. Chevron points toward the hidden rail
 * when collapsed (invites expanding) and away when expanded (invites closing).
 */
export function PanelToggleButton({
  side,
  label,
  expanded,
  onClick,
  variant = "edge",
}: PanelToggleButtonProps) {
  // The path is drawn left by default.  A left rail mirrors only when it is
  // open (the close direction is toward the work area); a right rail mirrors
  // only while collapsed (the entry points toward the hidden rail).
  const pointRight = side === "left" ? expanded : !expanded;
  if (variant === "strip") {
    return (
      <button
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        title={label}
        onClick={onClick}
        className={`studio-transition absolute top-2 z-50 flex h-10 w-7 items-center justify-center rounded-md border border-hairline bg-rail text-ink-soft shadow-pop hover:text-ink ${
          side === "left" ? "left-1" : "right-1"
        }`}
      >
        <Chevron pointRight={pointRight} />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
      className="studio-transition flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-md border border-hairline bg-rail text-ink-soft hover:text-ink"
    >
      <Chevron pointRight={pointRight} />
    </button>
  );
}
