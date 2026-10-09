import { create } from "zustand";

/**
 * 主题状态（docs/dark-ui-design-system.md 第 6 节）。
 *
 * 设计要点：
 * - 三个偏好：light / dark / system（默认跟随系统）。
 * - data-theme 写在 <html> 上，index.css 的 [data-theme="dark"]
 *   令牌层据此翻转全部语义色 — 组件零改动。
 * - localStorage 持久化；system 模式监听 prefers-color-scheme 变化。
 * - matchMedia / localStorage 均有防御性兜底（jsdom、隐私模式）。
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "studio-theme";

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

let removeSystemListener: (() => void) | null = null;

/** 在应用挂载前调用一次：恢复偏好并接管 <html data-theme>。 */
export function initTheme(): void {
  const preference = readStoredPreference();
  const resolved = resolveTheme(preference);
  useThemeStore.setState({ preference, resolved });
  applyTheme(resolved);

  removeSystemListener?.();
  removeSystemListener = null;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (useThemeStore.getState().preference !== "system") return;
      const next = resolveTheme("system");
      useThemeStore.setState({ resolved: next });
      applyTheme(next);
    };
    mq.addEventListener("change", onChange);
    removeSystemListener = () => mq.removeEventListener("change", onChange);
  }
}

export const useThemeStore = create<ThemeState>()((set) => ({
  preference: "system",
  resolved: "light",
  setPreference(preference) {
    const resolved = resolveTheme(preference);
    set({ preference, resolved });
    applyTheme(resolved);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* 持久化失败不影响本次会话 */
    }
  },
}));
