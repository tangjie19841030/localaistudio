export type SparklineTone = "brand" | "success" | "danger";

export interface SparklineProps {
  values?: number[];
  tone?: SparklineTone;
  studioId?: string;
}

export const componentType = "Sparkline";

const TONE_COLOR: Record<SparklineTone, string> = {
  brand: "var(--studio-color-brand)",
  success: "var(--studio-color-success)",
  danger: "var(--studio-color-danger)",
};

const DEFAULT_VALUES = [3, 7, 4, 9, 6, 10];

const W = 96;
const H = 28;
const PAD = 2;

/** Tolerant normalize: coerce to Number, drop NaN entries. */
function normalizeValues(values: unknown): number[] {
  const raw = Array.isArray(values) ? values : [];
  const nums: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

/** Tiny trend line scaled to min/max of the values. */
export default function Sparkline({ values, tone = "brand", studioId }: SparklineProps) {
  const nums = values === undefined ? DEFAULT_VALUES : normalizeValues(values);
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const stepX = nums.length > 1 ? (W - PAD * 2) / (nums.length - 1) : 0;
  const points = nums
    .map((v, i) => `${(PAD + i * stepX).toFixed(1)},${(PAD + (1 - (v - min) / span) * (H - PAD * 2)).toFixed(1)}`)
    .join(" ");
  return (
    <div data-component={componentType} data-studio-id={studioId}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`迷你趋势图，${nums.length} 个数据点`}>
        <polyline
          points={points}
          fill="none"
          stroke={TONE_COLOR[tone] ?? TONE_COLOR.brand}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
