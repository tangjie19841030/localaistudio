export interface LineChartProps {
  data?: { label: string; value: number }[];
  studioId?: string;
}

export const componentType = "LineChart";

interface Point {
  label: string;
  value: number;
}

const DEFAULT_DATA: Point[] = [
  { label: "1 月", value: 20 },
  { label: "2 月", value: 38 },
  { label: "3 月", value: 30 },
  { label: "4 月", value: 52 },
];

/** Tolerant normalize: coerce label/value, drop non-object or NaN rows. */
function normalizePoints(data: unknown): Point[] {
  const raw = Array.isArray(data) ? data : [];
  const pts: Point[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { label?: unknown; value?: unknown };
    const value = Number(o.value);
    if (!Number.isFinite(value)) continue;
    pts.push({ label: o.label == null ? "" : String(o.label), value });
  }
  return pts;
}

const W = 400;
const H = 160;
const PAD = 20;

/** Polyline chart: brand stroke, dotted vertices, muted x labels. */
export default function LineChart({ data, studioId }: LineChartProps) {
  const pts = data === undefined ? DEFAULT_DATA : normalizePoints(data);
  if (pts.length === 0) return null;
  const values = pts.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = pts.length > 1 ? (W - PAD * 2) / (pts.length - 1) : 0;
  const at = (i: number, v: number): [number, number] => [
    PAD + i * stepX,
    PAD + (1 - (v - min) / span) * (H - PAD * 2),
  ];
  const polyline = pts.map((p, i) => at(i, p.value).join(",")).join(" ");
  return (
    <div data-component={componentType} data-studio-id={studioId}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`折线图，共 ${pts.length} 个点`}>
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--studio-color-brand)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => {
          const [cx, cy] = at(i, p.value);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={3} fill="var(--studio-color-brand)" stroke="#fff" strokeWidth={1.5} />
              <text x={cx} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--studio-color-muted)">
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
