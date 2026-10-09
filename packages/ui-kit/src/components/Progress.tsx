export interface ProgressProps {
  /** Percent 0-100; non-finite or out-of-range values are clamped. */
  value?: number;
  /** Optional left-side caption. */
  label?: string;
  studioId?: string;
}

export const componentType = "Progress";

const TRACK_BG = "color-mix(in srgb, var(--studio-color-muted) 15%, transparent)";

function clampPercent(value: unknown, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, n));
}

/** Linear progress: muted label + percent row above a brand fill on a hairline track. */
export default function Progress({ value = 68, label, studioId }: ProgressProps) {
  const pct = clampPercent(value, 68);
  return (
    <div data-component={componentType} data-studio-id={studioId} className="w-full">
      <div className="flex items-center justify-between text-[11px] text-[var(--studio-color-muted)]">
        <span className="truncate">{label}</span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: TRACK_BG }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, backgroundColor: "var(--studio-color-brand)" }}
        />
      </div>
    </div>
  );
}
