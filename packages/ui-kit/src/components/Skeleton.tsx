export type SkeletonVariant = "text" | "card" | "avatar";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** Bar count for the text variant (clamped 1-8). */
  rows?: number;
  studioId?: string;
}

export const componentType = "Skeleton";

const BAR_WIDTHS = ["100%", "80%", "60%"];
const BLOCK_BG = "color-mix(in srgb, var(--studio-color-muted) 15%, transparent)";

function normalizeVariant(v: unknown): SkeletonVariant {
  return v === "card" || v === "avatar" ? v : "text";
}

function normalizeRows(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 3;
  return Math.min(8, Math.max(1, n));
}

/** Pulsing placeholder blocks that mimic loading text, a card, or an avatar. */
export default function Skeleton({ variant = "text", rows = 3, studioId }: SkeletonProps) {
  const kind = normalizeVariant(variant);
  const bars = Array.from({ length: normalizeRows(rows) }, (_, i) => BAR_WIDTHS[i % BAR_WIDTHS.length]);
  return (
    <div data-component={componentType} data-studio-id={studioId} className="animate-pulse">
      {kind === "text" &&
        bars.map((width, i) => (
          <div
            key={i}
            className={`h-3 rounded-full${i > 0 ? " mt-2" : ""}`}
            style={{ width, backgroundColor: BLOCK_BG }}
          />
        ))}
      {kind === "card" && <div className="h-24 rounded-xl" style={{ backgroundColor: BLOCK_BG }} />}
      {kind === "avatar" && <div className="h-10 w-10 rounded-full" style={{ backgroundColor: BLOCK_BG }} />}
    </div>
  );
}
