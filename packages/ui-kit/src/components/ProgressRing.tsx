export interface ProgressRingProps {
  /** Percent 0-100; clamped. */
  value?: number;
  /** Rendered box size in px (viewbox stays 96 for crisp scaling). */
  size?: number;
  studioId?: string;
}

export const componentType = "ProgressRing";

const RADIUS = 40;
const STROKE = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clampNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Circular progress: muted track + brand arc (rotated -90) with a bold center percent. */
export default function ProgressRing({ value = 72, size = 96, studioId }: ProgressRingProps) {
  const pct = clampNumber(value, 72, 0, 100);
  const px = clampNumber(size, 96, 24, 480);
  const offset = CIRCUMFERENCE * (1 - pct / 100);
  const shown = Math.round(pct);
  return (
    <div data-component={componentType} data-studio-id={studioId} className="inline-flex">
      <svg width={px} height={px} viewBox="0 0 96 96" role="img" aria-label={`${shown}%`}>
        <circle
          cx="48"
          cy="48"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          stroke="color-mix(in srgb, var(--studio-color-muted) 15%, transparent)"
        />
        <circle
          cx="48"
          cy="48"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          stroke="var(--studio-color-brand)"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 48 48)"
        />
        <text
          x="48"
          y="48"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="14"
          fontWeight="700"
          fill="var(--studio-color-text)"
        >
          {shown}%
        </text>
      </svg>
    </div>
  );
}
