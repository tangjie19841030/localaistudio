import { useState } from "react";

export interface SwitchProps {
  /** Tolerant: null/undefined defaults to on, other values coerce via Boolean. */
  checked?: boolean;
  label?: string;
  studioId?: string;
}

export const componentType = "Switch";

function toBool(v: unknown, fallback: boolean): boolean {
  if (v == null) return fallback;
  return Boolean(v);
}

/** Toggle switch: 40x20 pill track with 16px knob, label on the right. */
export default function Switch({ checked, label = "通知", studioId }: SwitchProps) {
  const [on, setOn] = useState(() => toBool(checked, true));
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-component={componentType}
      data-studio-id={studioId}
      onClick={() => setOn((v) => !v)}
      className="studio-transition inline-flex cursor-pointer items-center gap-2"
    >
      <span
        className="flex h-5 w-10 items-center rounded-full border p-0.5"
        style={{
          backgroundColor: on ? "var(--studio-color-brand)" : "var(--studio-color-surface)",
          borderColor: on ? "var(--studio-color-brand)" : "var(--studio-color-border)",
        }}
      >
        <span
          className="studio-transition size-4 rounded-full bg-white"
          style={{ transform: on ? "translateX(20px)" : "translateX(0px)" }}
        />
      </span>
      <span className="text-[13px]" style={{ color: "var(--studio-color-text)" }}>
        {label}
      </span>
    </button>
  );
}
