import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { defaultStudioDocument, serializeSvgElement, setSvgParser, svgSourceIssues } from "@studio/schema-core";
import { buildSystemPrompt } from "../src/ai/systemPrompt.js";

/**
 * W5 T74: the system prompt must mirror the svgSubset.ts whitelist so a model
 * that follows the contract passes the subset check on the first proposal.
 * Text is asserted verbatim (same style as system-prompt-breakpoints.test.ts).
 */
const CONTEXT = {
  productType: "后台",
  targetUsers: "运营",
  goal: "看数据",
  brandRules: "无",
};

/** Minimal bundle + default single-page doc; scope undefined so the prompt does
 *  not depend on node selection in these assertions. */
function promptFor(mode: "plan" | "generate" | "patch"): string {
  return buildSystemPrompt(
    { meta: CONTEXT, document: defaultStudioDocument("T74 矢量契约") },
    mode,
    undefined,
  );
}

/** The shortest positive example embedded in the contract (verbatim). */
const EXAMPLE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

interface JsdomCtor {
  new (html?: string): {
    window: { DOMParser: new () => { parseFromString(source: string, type: string): { documentElement: Element | null } } };
  };
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: JsdomCtor };

describe("buildSystemPrompt 矢量图形契约（W5 T74）", () => {
  it("patch/generate 输出契约行、白名单、正例片段（verbatim）", () => {
    for (const mode of ["patch", "generate"] as const) {
      const prompt = promptFor(mode);
      expect(prompt, mode).toContain("矢量图形契约：设计稿可用 SvgBox 组件放置简单图标/插画/Logo");
      expect(prompt, mode).toContain("仅允许这些元素：svg/path/circle/rect/line/polyline/polygon/g/defs");
      expect(prompt, mode).toContain("禁止 script、事件属性（on*）");
      expect(prompt, mode).toContain("style、href/xlink:href、外链引用（url(...)）");
      expect(prompt, mode).toContain("总长不超过 20000 字符");
      expect(prompt, mode).toContain("仅当内容无法用既有组件表达时才使用 SvgBox");
      expect(prompt, mode).toContain("同一图标的重复使用应复用同一 source");
      expect(prompt, mode).toContain(EXAMPLE);
    }
  });

  it("正例本身通过 svgSubset 校验（契约与校验器一致，不改写即合法）", () => {
    const prompt = promptFor("generate");
    expect(prompt).toContain(`最小正例：${EXAMPLE}。`);
    // The example the prompt advertises must actually pass the real validator.
    const dp = new (new JSDOM("").window.DOMParser)();
    setSvgParser((source) => dp.parseFromString(source, "image/svg+xml").documentElement);
    expect(svgSourceIssues(EXAMPLE)).toEqual([]);
    // Serialization is canonical (viewBox first, keys sorted) — not byte-identical
    // to the source, but it must keep the same shape.
    const serialized = serializeSvgElement(EXAMPLE);
    expect(serialized).toContain("<circle");
    expect(serialized.startsWith('<svg viewBox="0 0 24 24"')).toBe(true);
  });

  it("plan 模式不含契约行（组件目录照常列出 SvgBox，契约段落不出现）", () => {
    const plan = promptFor("plan");
    expect(plan).not.toContain("矢量图形契约");
    expect(plan).not.toContain("最小正例");
    // SvgBox itself stays visible in the catalog in every mode (registry-driven).
    expect(plan).toContain("SvgBox");

    const patch = promptFor("patch");
    expect(patch).toContain("可用组件目录：");
    expect(patch).toContain("页面跳转契约");
    expect(patch).toContain("响应式断点契约");
    expect(patch).toContain("画布空间契约");
    expect(patch).toContain("视觉质量规范（每次产出都必须满足，不是可选项）");
    expect(patch).toContain("文档共 1 页");
    expect(patch).toContain("只输出 JSON，不要 markdown 代码围栏");
  });
});
