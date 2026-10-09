import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../state/themeStore";
import { monacoThemeOf, useMonacoTheme } from "./monacoTheme";

/**
 * 单一来源测试：所有 Monaco 挂载点（CodePanel / DocDiff / VersionDiff）共用
 * monacoThemeOf / useMonacoTheme，跟随 themeStore.resolved（ThemeToggle 写入的
 * localStorage key 为 "studio-theme"，store 内部自洽，见 theme-store.test.ts）。
 */

describe("monacoTheme", () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: "system", resolved: "light" });
  });

  it("浅色 → vs；深色 → vs-dark", () => {
    expect(monacoThemeOf("light")).toBe("vs");
    expect(monacoThemeOf("dark")).toBe("vs-dark");
  });

  it("useMonacoTheme 跟随 themeStore.resolved 切换", () => {
    const { result } = renderHook(() => useMonacoTheme());
    expect(result.current).toBe("vs");
    act(() => useThemeStore.setState({ preference: "dark", resolved: "dark" }));
    expect(result.current).toBe("vs-dark");
    act(() => useThemeStore.setState({ preference: "light", resolved: "light" }));
    expect(result.current).toBe("vs");
  });
});
