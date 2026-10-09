export type StepItem = string | { label?: string; description?: string };

export interface StepsProps {
  /** Model-facing tolerant shape: strings or {label, description} objects. */
  items?: StepItem[];
  /** Zero-based index of the current step; index < current renders the check state. */
  current?: number;
  studioId?: string;
}

export const componentType = "Steps";

interface NormalizedStep {
  key: string;
  label: string;
  description?: string;
}

function normalizeSteps(items: unknown): NormalizedStep[] {
  const raw = Array.isArray(items) ? items : [];
  const steps: NormalizedStep[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item === "string" && item.trim() !== "") {
      steps.push({ key: `step-${i}`, label: item });
    } else if (item && typeof item === "object") {
      const o = item as { label?: string; description?: string };
      if (typeof o.label === "string" && o.label.trim() !== "") {
        steps.push({ key: `step-${i}`, label: o.label, description: o.description });
      }
    }
  }
  return steps;
}

type StepState = "done" | "current" | "future";

const CIRCLE_BASE =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold";

function circleClass(state: StepState): string {
  if (state === "done") {
    return `${CIRCLE_BASE} border-[var(--studio-color-brand)] bg-[var(--studio-color-brand)] text-white`;
  }
  if (state === "current") {
    return `${CIRCLE_BASE} border-[var(--studio-color-brand)] bg-[var(--studio-color-surface)] text-[var(--studio-color-brand)]`;
  }
  return `${CIRCLE_BASE} border-[var(--studio-color-muted)] bg-[var(--studio-color-surface)] text-[var(--studio-color-muted)]`;
}

/** Vertical step list: numbered circles joined by a 2px rail at 16px indent. */
export default function Steps({ items, current = 1, studioId }: StepsProps) {
  const steps = normalizeSteps(items);
  if (steps.length === 0) return null;
  const currentStep = Math.min(Math.max(0, Math.floor(current)), steps.length);
  return (
    <ol data-component={componentType} data-studio-id={studioId} className="flex flex-col">
      {steps.map((step, i) => {
        const state: StepState = i < currentStep ? "done" : i === currentStep ? "current" : "future";
        return (
          <li key={step.key} className="flex gap-3 pb-5 last:pb-0">
            <div className="flex w-8 shrink-0 flex-col items-center">
              <span aria-hidden className={circleClass(state)}>
                {state === "done" ? "✓" : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden className="mt-1 w-0.5 flex-1 bg-[var(--studio-color-border)]" />
              )}
            </div>
            <div className="min-w-0 pt-0.5">
              <p
                className={`text-[13px] leading-6 ${
                  state === "future"
                    ? "text-[var(--studio-color-muted)]"
                    : "font-medium text-[var(--studio-color-text)]"
                }`}
              >
                {step.label}
              </p>
              {typeof step.description === "string" && step.description.trim() !== "" && (
                <p className="mt-0.5 text-[11px] text-[var(--studio-color-muted)]">{step.description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
