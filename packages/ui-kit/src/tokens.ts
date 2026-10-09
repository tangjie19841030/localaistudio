import type { Tokens } from "@studio/schema-core";

/** Semantic tone enum shared by StatCard/Badge/Button(danger). */
export type Tone = "brand" | "neutral" | "success" | "warning" | "danger";

/**
 * Map Tokens into flat CSS custom properties for style injection.
 * Soft (12%) variants use color-mix so tone chips/backgrounds render without
 * Tailwind's /N opacity modifier (which cannot target CSS variables).
 */
export function tokensToCssVars(tokens: Tokens): Record<string, string> {
  return {
    "--studio-color-brand": tokens.color.brand,
    "--studio-color-surface": tokens.color.surface,
    "--studio-color-text": tokens.color.text,
    "--studio-color-muted": tokens.color.muted,
    "--studio-color-border": tokens.color.border,
    "--studio-color-accent": tokens.color.accent,
    "--studio-color-success": tokens.color.success,
    "--studio-color-warning": tokens.color.warning,
    "--studio-color-danger": tokens.color.danger,
    // 12% tint for chips / table headers / hover washes
    "--studio-color-brand-soft": `color-mix(in srgb, ${tokens.color.brand} 12%, transparent)`,
    "--studio-color-success-soft": `color-mix(in srgb, ${tokens.color.success} 12%, transparent)`,
    "--studio-color-warning-soft": `color-mix(in srgb, ${tokens.color.warning} 12%, transparent)`,
    "--studio-color-danger-soft": `color-mix(in srgb, ${tokens.color.danger} 12%, transparent)`,
    "--studio-color-muted-soft": `color-mix(in srgb, ${tokens.color.muted} 10%, transparent)`,
    "--studio-radius-card": `${tokens.radius.card}px`,
    "--studio-radius-control": `${tokens.radius.control}px`,
    "--studio-spacing-unit": `${tokens.spacing.unit}px`,
    "--studio-font-sans": tokens.font.sans,
  };
}

/** Raw CSS var reference for a tone's solid color. */
export function toneColorVar(tone: Tone): string {
  switch (tone) {
    case "brand":
      return "var(--studio-color-brand)";
    case "success":
      return "var(--studio-color-success)";
    case "warning":
      return "var(--studio-color-warning)";
    case "danger":
      return "var(--studio-color-danger)";
    case "neutral":
      return "var(--studio-color-text)";
  }
}

/**
 * STATIC class lookup (never a runtime template). Tailwind's scanner only
 * emits CSS for class names that appear as complete literals in source —
 * `text-[${var}]` built at runtime produced zero rules (pages looked colorless).
 */
export const TONE_TEXT_CLASS: Record<Tone, string> = {
  brand: "text-[var(--studio-color-brand)]",
  success: "text-[var(--studio-color-success)]",
  warning: "text-[var(--studio-color-warning)]",
  danger: "text-[var(--studio-color-danger)]",
  neutral: "text-[var(--studio-color-text)]",
};

export const TONE_SOFT_BG_CLASS: Record<Tone, string> = {
  brand: "bg-[var(--studio-color-brand-soft)]",
  success: "bg-[var(--studio-color-success-soft)]",
  warning: "bg-[var(--studio-color-warning-soft)]",
  danger: "bg-[var(--studio-color-danger-soft)]",
  neutral: "bg-[var(--studio-color-muted-soft)]",
};

/** Tailwind text color class for a semantic tone (static literal). */
export function toneTextClass(tone: Tone): string {
  return TONE_TEXT_CLASS[tone];
}

/** Tailwind soft-tint background class for a semantic tone (static literal). */
export function toneBgClass(tone: Tone): string {
  return TONE_SOFT_BG_CLASS[tone];
}
