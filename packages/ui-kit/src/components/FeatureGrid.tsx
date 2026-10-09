export interface FeatureItem {
  title?: string;
  description?: string;
}

export interface FeatureGridProps {
  features?: FeatureItem[];
  /** Grid column count, clamped 1-4. */
  columns?: number;
  studioId?: string;
}

export const componentType = "FeatureGrid";

function normalizeFeatures(features: unknown): { title: string; description: string }[] {
  if (!Array.isArray(features)) return [];
  return features
    .filter((f): f is FeatureItem => !!f && typeof f === "object")
    .map((f) => ({
      title: typeof f.title === "string" ? f.title : "",
      description: typeof f.description === "string" ? f.description : "",
    }))
    .filter((f) => f.title !== "" || f.description !== "");
}

function clampColumns(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 3;
  return Math.min(4, Math.max(1, n));
}

const DEFAULT_FEATURES: FeatureItem[] = [
  { title: "极速", description: "毫秒级响应" },
  { title: "安全", description: "端到端加密" },
  { title: "协作", description: "多人实时编辑" },
];

/** Feature grid: accent dot + title + muted description per cell. */
export default function FeatureGrid({
  features = DEFAULT_FEATURES,
  columns = 3,
  studioId,
}: FeatureGridProps) {
  const items = normalizeFeatures(features);
  if (items.length === 0) return null;
  const cols = clampColumns(columns);
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="grid gap-5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {items.map((f, i) => (
        <div key={i}>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--studio-color-accent)" }}
            />
            <span className="truncate text-[13px] font-semibold" style={{ color: "var(--studio-color-text)" }}>
              {f.title}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--studio-color-muted)]">{f.description}</p>
        </div>
      ))}
    </div>
  );
}
