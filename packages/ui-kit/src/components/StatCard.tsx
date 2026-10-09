import type { Tone } from "../tokens";
import { toneTextClass } from "../tokens";

export interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  tone?: Tone;
  studioId?: string;
}

export const componentType = "StatCard";

/** Metric tile: card surface, muted label, large value, tone-colored delta. */
export default function StatCard({ label, value, delta, tone = "brand", studioId }: StatCardProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="rounded-[var(--studio-radius-card)] border p-4"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div className="text-xs font-medium" style={{ color: "var(--studio-color-muted)" }}>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight" style={{ color: "var(--studio-color-text)" }}>
        {value}
      </div>
      {delta && (
        <div className={`mt-1.5 text-xs font-medium ${toneTextClass(tone)}`}>{delta}</div>
      )}
    </div>
  );
}
