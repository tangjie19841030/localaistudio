import { useThemeStore, type ResolvedTheme } from "../state/themeStore";

/**
 * Monaco built-in theme id for the resolved app theme. Every Monaco mount
 * (CodePanel file editor, DocDiff, VersionDiff) shares this single source so
 * the code panes follow the [data-theme] chrome instead of hardcoding "vs".
 */
export function monacoThemeOf(theme: ResolvedTheme): "vs" | "vs-dark" {
  return theme === "dark" ? "vs-dark" : "vs";
}

/** Reactive variant for components: re-renders when the theme flips. */
export function useMonacoTheme(): "vs" | "vs-dark" {
  return monacoThemeOf(useThemeStore((s) => s.resolved));
}
