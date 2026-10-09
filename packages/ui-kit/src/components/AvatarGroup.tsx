export interface AvatarGroupProps {
  names?: string[];
  overflowCount?: number;
  studioId?: string;
}

export const componentType = "AvatarGroup";

/** Surface ring so overlapping circles stay separable. */
const RING = "0 0 0 2px var(--studio-color-surface)";
const BRAND_SOFT_BG = "color-mix(in srgb, var(--studio-color-brand) 14%, var(--studio-color-surface))";
const RAIL_BG = "color-mix(in srgb, var(--studio-color-muted) 18%, var(--studio-color-surface))";

function normalizeNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return names.filter((n): n is string => typeof n === "string" && n.trim() !== "");
}

function normalizeOverflow(count: unknown): number {
  return typeof count === "number" && Number.isFinite(count) && count >= 1 ? Math.floor(count) : 5;
}

/** Self-contained mini circle (kept inline so AvatarGroup has no Avatar dep). */
function MiniAvatar({ name }: { name: string }) {
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
      style={{ backgroundColor: BRAND_SOFT_BG, color: "var(--studio-color-brand)", boxShadow: RING }}
    >
      {name.trim().charAt(0)}
    </span>
  );
}

/** Overlapping avatar stack; names beyond overflowCount collapse into +N. */
export default function AvatarGroup({ names = ["张三", "李四", "王五"], overflowCount = 5, studioId }: AvatarGroupProps) {
  const list = normalizeNames(names);
  if (list.length === 0) return null;
  const overflow = normalizeOverflow(overflowCount);
  const shown = list.slice(0, overflow);
  const extra = list.length - shown.length;
  return (
    <div data-component={componentType} data-studio-id={studioId} className="flex items-center">
      {shown.map((name, i) => (
        <span key={`${name}-${i}`} className={i > 0 ? "-ml-2" : undefined}>
          <MiniAvatar name={name} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="-ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-medium"
          style={{ backgroundColor: RAIL_BG, color: "var(--studio-color-muted)", boxShadow: RING }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
