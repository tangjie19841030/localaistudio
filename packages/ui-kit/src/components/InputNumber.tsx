import { useState } from "react";

export interface InputNumberProps {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  studioId?: string;
}

export const componentType = "InputNumber";

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Stepper row: minus button, mono value, plus button; steps clamp to [min, max]. */
export default function InputNumber({ value = 1, min = 0, max = 99, step = 1, studioId }: InputNumberProps) {
  const lo = finite(min, 0);
  const hi = Math.max(lo, finite(max, 99));
  const rawStep = finite(step, 1);
  const stepSize = rawStep > 0 ? rawStep : 1;
  const [current, setCurrent] = useState(() => Math.min(Math.max(finite(value, 1), lo), hi));
  const clamp = (n: number) => Math.min(Math.max(n, lo), hi);
  const btnCls = "flex size-6 cursor-pointer items-center justify-center rounded border text-sm leading-none";
  const btnStyle = {
    borderColor: "var(--studio-color-border)",
    backgroundColor: "var(--studio-color-surface)",
    color: "var(--studio-color-text)",
  };
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="inline-flex items-center gap-2"
    >
      <button type="button" aria-label="减少" onClick={() => setCurrent(clamp(current - stepSize))} className={btnCls} style={btnStyle}>
        −
      </button>
      <span
        className="w-10 text-center font-mono text-[13px] tabular-nums"
        style={{ color: "var(--studio-color-text)" }}
      >
        {current}
      </span>
      <button type="button" aria-label="增加" onClick={() => setCurrent(clamp(current + stepSize))} className={btnCls} style={btnStyle}>
        +
      </button>
    </div>
  );
}
