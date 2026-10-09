import { useState } from "react";

export interface SliderProps {
  value?: number;
  min?: number;
  max?: number;
  studioId?: string;
}

export const componentType = "Slider";

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Native range slider with brand accent and a mono value readout. */
export default function Slider({ value = 40, min = 0, max = 100, studioId }: SliderProps) {
  const lo = finite(min, 0);
  const hi = Math.max(lo, finite(max, 100));
  const [current, setCurrent] = useState(() => Math.min(Math.max(finite(value, 40), lo), hi));
  const safe = Math.min(Math.max(current, lo), hi);
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="flex w-full items-center gap-3"
    >
      <input
        type="range"
        min={lo}
        max={hi}
        value={safe}
        aria-label="滑块"
        onChange={(e) => setCurrent(Number(e.target.value))}
        className="h-1.5 w-full flex-1 cursor-pointer"
        style={{ accentColor: "var(--studio-color-brand)" }}
      />
      <span
        className="w-8 shrink-0 text-right font-mono text-[12px] tabular-nums"
        style={{ color: "var(--studio-color-text)" }}
      >
        {safe}
      </span>
    </div>
  );
}
