import { defaultTokens } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import { tokensToCssVars, toneBgClass, toneTextClass } from "../src/tokens";

describe("tokensToCssVars", () => {
  it("defaultTokens 产出全部 18 个 CSS 变量（含 soft 色调）", () => {
    const vars = tokensToCssVars(defaultTokens());
    const entries = Object.entries(vars);
    expect(entries).toHaveLength(18);

    const keys = Object.keys(vars);
    for (const k of [
      "--studio-color-brand",
      "--studio-color-surface",
      "--studio-color-text",
      "--studio-color-muted",
      "--studio-color-border",
      "--studio-color-accent",
      "--studio-color-success",
      "--studio-color-warning",
      "--studio-color-danger",
      "--studio-color-brand-soft",
      "--studio-color-success-soft",
      "--studio-color-warning-soft",
      "--studio-color-danger-soft",
      "--studio-color-muted-soft",
      "--studio-radius-card",
      "--studio-radius-control",
      "--studio-spacing-unit",
      "--studio-font-sans",
    ]) {
      expect(keys).toContain(k);
    }
    expect(vars["--studio-color-brand"]).toBe("#0F766E");
    expect(vars["--studio-color-danger"]).toBe("#DC2626");
    expect(vars["--studio-color-brand-soft"]).toContain("color-mix");
    expect(vars["--studio-radius-card"]).toBe("8px");
    expect(vars["--studio-radius-control"]).toBe("6px");
    expect(vars["--studio-spacing-unit"]).toBe("4px");
    expect(vars["--studio-font-sans"]).toContain("Inter");
  });

  it("自定义 tokens 透传值", () => {
    const t = defaultTokens();
    t.color.brand = "#123456";
    t.radius.card = 12;
    t.spacing.unit = 8;
    const vars = tokensToCssVars(t);
    expect(vars["--studio-color-brand"]).toBe("#123456");
    expect(vars["--studio-radius-card"]).toBe("12px");
    expect(vars["--studio-spacing-unit"]).toBe("8px");
  });
});

describe("tone 辅助类", () => {
  it("toneTextClass/toneBgClass 产出 STATIC 字面量类（Tailwind 可扫描）", () => {
    expect(toneTextClass("brand")).toBe("text-[var(--studio-color-brand)]");
    expect(toneBgClass("success")).toBe("bg-[var(--studio-color-success-soft)]");
    expect(toneTextClass("danger")).toBe("text-[var(--studio-color-danger)]");
    expect(toneTextClass("warning")).toBe("text-[var(--studio-color-warning)]");
    expect(toneTextClass("neutral")).toBe("text-[var(--studio-color-text)]");
  });
});
