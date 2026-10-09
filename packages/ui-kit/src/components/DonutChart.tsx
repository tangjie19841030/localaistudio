export interface DonutChartProps {
  data?: { label: string; value: number }[];
  studioId?: string;
}

export const componentType = "DonutChart";

interface Slice {
  label: string;
  value: number;
}

const PALETTE = [
  "var(--studio-color-brand)",
  "var(--studio-color-success)",
  "var(--studio-color-warning)",
  "var(--studio-color-danger)",
  "var(--studio-color-muted)",
];

const DEFAULT_DATA: Slice[] = [
  { label: "直接访问", value: 40 },
  { label: "搜索引擎", value: 35 },
  { label: "社交媒体", value: 25 },
];

/** Tolerant normalize: coerce label/value, drop non-object or NaN rows. */
function normalizeSlices(data: unknown): Slice[] {
  const raw = Array.isArray(data) ? data : [];
  const slices: Slice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { label?: unknown; value?: unknown };
    const value = Number(o.value);
    if (!Number.isFinite(value)) continue;
    slices.push({ label: o.label == null ? "" : String(o.label), value });
  }
  return slices;
}

const CX = 56;
const CY = 60;
const R = 40;
const SW = 16;
const CIRC = 2 * Math.PI * R;
const VB_W = 208;

/** Cumulative stroke-dasharray donut segments. */
function buildSegments(slices: Slice[], total: number) {
  const segs = [];
  let acc = 0;
  for (const [i, s] of slices.entries()) {
    const dash = total > 0 ? (s.value / total) * CIRC : 0;
    segs.push({
      ...s,
      color: PALETTE[i % PALETTE.length] ?? PALETTE[0] ?? "var(--studio-color-brand)",
      dash,
      offset: acc,
      percent: total > 0 ? Math.round((s.value / total) * 100) : 0,
    });
    acc += dash;
  }
  return segs;
}

/** Donut chart: dashed stroke circles, center total, right-side legend. */
export default function DonutChart({ data, studioId }: DonutChartProps) {
  const slices = data === undefined ? DEFAULT_DATA : normalizeSlices(data);
  if (slices.length === 0) return null;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const segs = buildSegments(slices, total);
  const firstY = CY - ((segs.length - 1) * 18) / 2;
  return (
    <div data-component={componentType} data-studio-id={studioId}>
      <svg viewBox={`0 0 ${VB_W} ${CY * 2}`} width="100%" role="img" aria-label={`环形图，总计 ${total}`}>
        {segs.map((s, i) => (
          <circle
            key={i}
            className="studio-donut-seg"
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={SW}
            strokeDasharray={`${s.dash} ${CIRC - s.dash}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
        <text x={CX} y={CY + 2} textAnchor="middle" fontSize={16} fontWeight="bold" fill="var(--studio-color-text)">
          {total}
        </text>
        <text x={CX} y={CY + 18} textAnchor="middle" fontSize={9} fill="var(--studio-color-muted)">
          总计
        </text>
        {segs.map((s, i) => {
          const y = firstY + i * 18;
          return (
            <g key={`legend-${i}`}>
              <circle cx={116} cy={y - 3.5} r={3.5} fill={s.color} />
              <text x={124} y={y} fontSize={11} fill="var(--studio-color-text)">
                {s.label}
              </text>
              <text x={VB_W - 4} y={y} textAnchor="end" fontSize={11} fill="var(--studio-color-muted)">
                {s.percent}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
