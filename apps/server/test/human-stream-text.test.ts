import { describe, expect, it } from "vitest";
import { humanStreamText } from "../src/ai/loopPipeline.js";

describe("humanStreamText", () => {
  it("从 {plan, document} 抽出 plan，绝不吐出 document", () => {
    const doc = { documentVersion: 1, name: "x", tokens: { color: { brand: "#FFFFFF" } } };
    const full = JSON.stringify({
      plan: "规划：插入了指标卡。",
      document: doc,
    });
    const out = humanStreamText(full);
    expect(out).toBe("规划：插入了指标卡。");
    expect(out).not.toContain("documentVersion");
  });

  it("超长非 JSON → 截断提示", () => {
    expect(humanStreamText("{".repeat(500))).toBe("正在整理变更摘要…");
  });

  it("普通短文本原样透传", () => {
    expect(humanStreamText("你好")).toBe("你好");
  });
});
