import { useState } from "react";

export interface RadioProps {
  /** Tolerant: non-string or empty entries are dropped, never throws. */
  items?: string[];
  value?: string;
  studioId?: string;
}

export const componentType = "Radio";

function normalizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/** Vertical radio group: 16px circle with brand ring and dot when selected. */
export default function Radio({ items, value, studioId }: RadioProps) {
  const options = normalizeItems(items ?? ["选项一", "选项二", "选项三"]);
  const [selected, setSelected] = useState(() =>
    typeof value === "string" && value.trim() !== "" ? value : (options[0] ?? ""),
  );
  if (options.length === 0) return null;
  return (
    <div
      role="radiogroup"
      data-component={componentType}
      data-studio-id={studioId}
      className="inline-flex flex-col gap-2"
    >
      {options.map((label) => {
        const active = label === selected;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setSelected(label)}
            className="flex cursor-pointer items-center gap-2"
          >
            <span
              className="flex size-4 items-center justify-center rounded-full border"
              style={{ borderColor: active ? "var(--studio-color-brand)" : "var(--studio-color-border)" }}
            >
              {active && (
                <span className="size-2 rounded-full" style={{ backgroundColor: "var(--studio-color-brand)" }} />
              )}
            </span>
            <span className="text-[13px]" style={{ color: "var(--studio-color-text)" }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
