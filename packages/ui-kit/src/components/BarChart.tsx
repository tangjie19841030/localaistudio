export interface BarChartProps {
  data?: { label: string; value: number }[];
  showValues?: boolean;
  studioId?: string;
}

export const componentType = "BarChart";

interface Bar {
  label: string;
  value: number;
}

const DEFAULT_DATA: Bar[] = [
  { label: "周一", value: 32 },
  { label: "周二", value: 48 },
  { label: "周三", value: 26 },
  { label: "周四", value: 60 },
  { label: "周五", value: 44 },
];

/** Tolerant normalize: coerce label/value, drop non-object or NaN rows. */
function normalizeBars(data: unknown): Bar[] {
  const raw = Array.isArray(data) ? data : [];
  const bars: Bar[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { label?: unknown; value?: unknown };
    const value = Number(o.value);
    if (!Number.isFinite(value)) continue;
    bars.push({ label: o.label == null ? "" : String(o.label), value });
  }
  return bars;
}

const W = 400;
const H = 200;
const TOP = 18;
const BASE = 172;
const PAD = 24;

/** Bar path with 2px rounded top corners (r clamped to bar height). */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(2, h);
  return (
    `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y}` +
    ` H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
  );
}

/** Vertical bar chart: brand bars, optional value labels, muted x labels. */
export default function BarChart({ data, showValues = true, studioId }: BarChartProps) {
  const bars = data === undefined ? DEFAULT_DATA : normalizeBars(data);
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  const slot = (W - PAD * 2) / bars.length;
  const barW = Math.min(slot * 0.55, 44);
  return (
    <div data-component={componentType} data-studio-id={studioId}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`柱状图，共 ${bars.length} 项`}>
        {bars.map((b, i) => {
          const h = Math.max((b.value / max) * (BASE - TOP), 0);
          const x = PAD + i * slot + (slot - barW) / 2;
          const y = BASE - h;
          return (
            <g key={i}>
              <path className="studio-bar" d={barPath(x, y, barW, h)} fill="var(--studio-color-brand)" />
              {showValues && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={10} fill="var(--studio-color-muted)">
                  {b.value}
                </text>
              )}
              <text x={PAD + i * slot + slot / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--studio-color-muted)">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
