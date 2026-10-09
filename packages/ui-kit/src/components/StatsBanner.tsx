export interface StatItem {
  label?: string;
  value?: string;
}

export interface StatsBannerProps {
  stats?: StatItem[];
  studioId?: string;
}

export const componentType = "StatsBanner";

function normalizeStats(stats: unknown): { label: string; value: string }[] {
  if (!Array.isArray(stats)) return [];
  return stats
    .filter((s): s is StatItem => !!s && typeof s === "object")
    .map((s) => ({
      label: typeof s.label === "string" ? s.label : "",
      value: typeof s.value === "string" ? s.value : "",
    }))
    .filter((s) => s.label !== "" || s.value !== "");
}

const DEFAULT_STATS: StatItem[] = [
  { label: "活跃用户", value: "10k+" },
  { label: "企业客户", value: "500+" },
  { label: "满意度", value: "99%" },
];

/** Horizontal stats band: bold values over muted labels with hairline separators. */
export default function StatsBanner({ stats = DEFAULT_STATS, studioId }: StatsBannerProps) {
  const items = normalizeStats(stats);
  if (items.length === 0) return null;
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="flex rounded-xl border p-6"
      style={{ borderColor: "var(--studio-color-border)" }}
    >
      {items.map((s, i) => (
        <div
          key={i}
          className={`min-w-0 flex-1 text-center${i > 0 ? " border-l pl-4 pr-4" : ""}${i < items.length - 1 ? " pr-4" : ""}`}
          style={i > 0 ? { borderLeftColor: "var(--studio-color-border)" } : undefined}
        >
          <div className="text-[20px] font-bold leading-6" style={{ color: "var(--studio-color-text)" }}>
            {s.value}
          </div>
          <div className="mt-1 text-[11px] text-[var(--studio-color-muted)]">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
