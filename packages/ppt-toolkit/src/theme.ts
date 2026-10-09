import type { PptTheme } from "./document.js";

/**
 * Built-in themes use semantic token slots (primary/secondary/accent/
 * background/fonts) so decks stay re-themeable without touching objects.
 */
export const PPT_THEME_IDS = ["brand", "professional", "minimal"] as const;
export type PptThemeId = (typeof PPT_THEME_IDS)[number];

export const PPT_THEMES: Record<PptThemeId, PptTheme> = {
  brand: {
    primary: "#0F766E",
    secondary: "#134E4A",
    accent: "#F59E0B",
    background: "#F8FAFC",
    fontTitle: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif",
    fontBody: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  },
  professional: {
    primary: "#1E3A8A",
    secondary: "#0F172A",
    accent: "#0EA5E9",
    background: "#FFFFFF",
    fontTitle: "'Segoe UI', 'Microsoft YaHei', sans-serif",
    fontBody: "'Segoe UI', 'Microsoft YaHei', sans-serif",
  },
  minimal: {
    primary: "#171717",
    secondary: "#525252",
    accent: "#DC2626",
    background: "#FAFAFA",
    fontTitle: "'Helvetica Neue', Arial, 'Microsoft YaHei', sans-serif",
    fontBody: "'Helvetica Neue', Arial, 'Microsoft YaHei', sans-serif",
  },
};


export function defaultTheme(): PptTheme {
  return cloneTheme(PPT_THEMES.brand);
}

export function getTheme(id: string): PptTheme | undefined {
  const theme = PPT_THEMES[id as PptThemeId];
  return theme ? cloneTheme(theme) : undefined;
}

/** Explicit field copy keeps PptTheme required-key-safe for consumers (no index access). */
function cloneTheme(theme: PptTheme): PptTheme {
  return {
    primary: theme.primary,
    secondary: theme.secondary,
    accent: theme.accent,
    background: theme.background,
    fontTitle: theme.fontTitle,
    fontBody: theme.fontBody,
  };
}

export function isThemeId(value: string): value is PptThemeId {
  return Object.prototype.hasOwnProperty.call(PPT_THEMES, value);
}

/**
 * Whole-deck theme swap. Deliberately ONLY replaces deck.theme — objects
 * with explicit colors keep them (PowerPoint masters behave the same: explicit
 * overrides survive a theme change). Objects wanting theme-following colors
 * simply omit explicit ones.
 */
export function applyTheme<T extends { theme: PptTheme }>(deck: T, theme: PptTheme): T {
  return { ...deck, theme: cloneTheme(theme) };
}
