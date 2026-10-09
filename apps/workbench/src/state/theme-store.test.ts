import { beforeEach, describe, expect, it } from "vitest";
import { initTheme, useThemeStore } from "./themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.removeItem("studio-theme");
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ preference: "system", resolved: "light" });
  });

  it("默认跟随系统，jsdom 无 matchMedia 时解析为浅色", () => {
    initTheme();
    expect(useThemeStore.getState().preference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("切换深色：写入 data-theme 并持久化", () => {
    useThemeStore.getState().setPreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
    expect(localStorage.getItem("studio-theme")).toBe("dark");
  });

  it("initTheme 恢复已保存的深色偏好", () => {
    localStorage.setItem("studio-theme", "dark");
    initTheme();
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("非法持久化值回退为 system", () => {
    localStorage.setItem("studio-theme", "neon-pink");
    initTheme();
    expect(useThemeStore.getState().preference).toBe("system");
  });
});
