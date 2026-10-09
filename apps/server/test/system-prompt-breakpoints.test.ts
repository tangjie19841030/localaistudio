import { describe, expect, it } from "vitest";
import { defaultStudioDocument } from "@studio/schema-core";
import { buildSystemPrompt } from "../src/ai/systemPrompt.js";

const CONTEXT = {
  productType: "后台",
  targetUsers: "运营",
  goal: "看数据",
  brandRules: "无",
};

/** Minimal bundle + default single-page doc; scope left undefined so the
 *  prompt does not depend on node selection in these assertions. */
function promptFor(mode: "plan" | "generate" | "patch"): string {
  return buildSystemPrompt(
    { meta: CONTEXT, document: defaultStudioDocument("T68 断点契约") },
    mode,
    undefined,
  );
}

describe("buildSystemPrompt 响应式断点契约（W4-A）", () => {
  it("patch/generate 模式输出断点契约与白名单描述（verbatim 文案）", () => {
    const patch = promptFor("patch");
    expect(patch).toContain("响应式断点契约：需要逐节点响应式的布局");
    expect(patch).toContain('"breakpoints":{"tablet":{"columns":2},"mobile":{"columns":1}}');
    expect(patch).toContain("仅白名单属性可覆盖：Grid.columns/Grid.gap、MetricGrid.columns、Stack.gap");
    expect(patch).toContain("desktop 不允许覆盖（基础值写在 props 里）");
    expect(patch).toContain("不要为用户未提及响应式的节点凭空添加 breakpoints");
    const generate = promptFor("generate");
    expect(generate).toContain("响应式断点契约");
    expect(generate).toContain("Stack.gap；tablet/mobile 二选一或都有");
  });

  it("plan 模式不含断点契约行", () => {
    const plan = promptFor("plan");
    expect(plan).not.toContain("响应式断点契约");
    expect(plan).not.toContain("breakpoints");
  });

  it("断点契约插入不影响其余段落拼接", () => {
    const patch = promptFor("patch");
    expect(patch).toContain("可用组件目录：");
    expect(patch).toContain("页面跳转契约");
    expect(patch).toContain("画布空间契约");
    expect(patch).toContain("视觉质量规范（每次产出都必须满足，不是可选项）");
    expect(patch).toContain("文档共 1 页");
    expect(patch).toContain("只输出 JSON，不要 markdown 代码围栏");
  });
});