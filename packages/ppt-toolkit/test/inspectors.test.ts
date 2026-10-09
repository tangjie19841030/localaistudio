import { describe, expect, it } from "vitest";
import type { PptDocument, PptSlide } from "../src/index.js";
import { PPT_INSPECTORS, runPptInspectors } from "../src/index.js";
import { emptyDeck } from "./fixtures.js";

/**
 * P9.2 quality inspectors: pure-function coverage for out-of-canvas objects,
 * >30% overlap, empty placeholders, and object-less slides. Issues must carry
 * slide/object ids. T78: overlap reports text pairs only — textless pairs are
 * never reported.
 */

function slideWith(id: string, objects: PptSlide["objects"]): PptSlide {
  return { id, title: `页 ${id}`, notes: "", objects };
}

function deckWith(...slides: PptSlide[]): PptDocument {
  return { ...emptyDeck("质检示例"), slides };
}

function issueFor(inspectorId: string, doc: PptDocument) {
  return runPptInspectors(doc).filter((issue) => issue.inspectorId === inspectorId);
}

describe("ppt.qc.bounds 对象越界", () => {
  it("超出右边界/下边界的对象被定位到 slide+object", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "o-out", kind: "shape", rect: { x: 1200, y: 100, w: 200, h: 100 }, shape: "rect" },
      ]),
      slideWith("s2", [
        { id: "o-ok", kind: "shape", rect: { x: 0, y: 0, w: 100, h: 100 }, shape: "rect" },
      ]),
    );
    const issues = issueFor("ppt.qc.bounds", doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ slideId: "s1", objectId: "o-out" });
    expect(issues[0]!.message).toContain("超出画布");
  });

  it("负坐标越界也会报告；组对象（无实际几何）跳过", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "g", kind: "group", rect: { x: -50, y: -50, w: 2000, h: 900 }, children: [] },
      ]),
    );
    expect(issueFor("ppt.qc.bounds", doc)).toHaveLength(0);
  });
});

describe("ppt.qc.overlap 对象重叠", () => {
  it("文字无关叠放（shape-shape 56%）不再报告（T78：重叠检查只保护文字）", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "big", kind: "shape", rect: { x: 0, y: 0, w: 400, h: 400 }, shape: "rect" },
        { id: "small", kind: "shape", rect: { x: 250, y: 250, w: 200, h: 200 }, shape: "rect" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("轻微重叠（<=30%）不报告", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "a", kind: "shape", rect: { x: 0, y: 0, w: 100, h: 100 }, shape: "rect" },
        { id: "b", kind: "shape", rect: { x: 90, y: 0, w: 100, h: 100 }, shape: "rect" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });
});

describe("ppt.qc.overlap 收紧：插画/同组豁免与文字遮挡判定（W2 T53）", () => {
  it("插画在下、文字浮于其上（>30% 重叠）豁免不报", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "img", kind: "image", rect: { x: 0, y: 0, w: 800, h: 600 }, src: "data:image/png;base64,AAA", fit: "fill" },
        { id: "cap", kind: "text", rect: { x: 100, y: 100, w: 400, h: 80 }, paragraphs: [{ runs: [{ text: "标题" }] }] },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("图表在下、占位符在上同样豁免", () => {
    const doc = deckWith(
      slideWith("s1", [
        {
          id: "chart",
          kind: "chart",
          rect: { x: 0, y: 0, w: 600, h: 400 },
          chartType: "bar",
          series: [{ name: "s", points: [{ label: "a", value: 1 }] }],
        },
        { id: "p", kind: "placeholder", rect: { x: 100, y: 100, w: 400, h: 100 }, subtype: "title", text: "季度" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("同组对象设计性叠放豁免（不透明 shape >30% 互相压盖也不报）", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "g", kind: "group", rect: { x: 0, y: 0, w: 450, h: 450 }, children: ["ga", "gb"] },
        { id: "ga", kind: "shape", rect: { x: 0, y: 0, w: 400, h: 400 }, shape: "rect" },
        { id: "gb", kind: "shape", rect: { x: 250, y: 250, w: 200, h: 200 }, shape: "rect" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("半透明 shape（opacity 0.4）压文字不报", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "t", kind: "text", rect: { x: 0, y: 0, w: 400, h: 200 }, paragraphs: [{ runs: [{ text: "正文" }] }] },
        { id: "shade", kind: "shape", rect: { x: 0, y: 0, w: 400, h: 200 }, shape: "rect", opacity: 0.4 },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("不透明 shape 盖死文字（>=60%）报告，消息带遮挡语义", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "t", kind: "text", rect: { x: 0, y: 0, w: 200, h: 100 }, paragraphs: [{ runs: [{ text: "被盖" }] }] },
        { id: "block", kind: "shape", rect: { x: 0, y: 0, w: 200, h: 100 }, shape: "rect" },
      ]),
    );
    const issues = issueFor("ppt.qc.overlap", doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ slideId: "s1", objectId: "t", inspectorId: "ppt.qc.overlap" });
    expect(issues[0]!.message).toContain("文字被不透明图形遮挡 100%");
  });

  it("占位符被不透明图形盖死同样报告", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "p", kind: "placeholder", rect: { x: 0, y: 0, w: 200, h: 100 }, subtype: "content", text: "内容" },
        { id: "block", kind: "shape", rect: { x: 0, y: 0, w: 200, h: 100 }, shape: "rect" },
      ]),
    );
    const issues = issueFor("ppt.qc.overlap", doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ objectId: "p" });
    expect(issues[0]!.message).toContain("文字被不透明图形遮挡");
  });

  it("不透明 shape 压文字 30%-60% 之间不报（阈值收紧到 60%）", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "t", kind: "text", rect: { x: 0, y: 0, w: 200, h: 100 }, paragraphs: [{ runs: [{ text: "半盖" }] }] },
        { id: "block", kind: "shape", rect: { x: 120, y: 0, w: 200, h: 100 }, shape: "rect" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("shape-shape 旧措辞不再触发（T78：文字无关叠层整体不报）", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "sa", kind: "shape", rect: { x: 0, y: 0, w: 200, h: 200 }, shape: "rect" },
        { id: "sb", kind: "shape", rect: { x: 100, y: 0, w: 200, h: 200 }, shape: "rect" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });
});

describe("ppt.qc.overlap 文字无关叠层（T78：textless 对一律不报）", () => {
  it("细长装饰条横穿照片：textless 对不报", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "photo", kind: "image", rect: { x: 0, y: 0, w: 800, h: 600 }, src: "data:image/png;base64,AAA", fit: "fill" },
        { id: "hairline", kind: "shape", rect: { x: 450, y: 0, w: 14, h: 697 }, shape: "rect" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("两张大照片 45% 互叠：textless 对不报", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "photo-a", kind: "image", rect: { x: 0, y: 0, w: 600, h: 450 }, src: "data:image/png;base64,AAA", fit: "fill" },
        { id: "photo-b", kind: "image", rect: { x: 330, y: 0, w: 600, h: 450 }, src: "data:image/png;base64,BBB", fit: "fill" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("小贴纸照片 86% 压大照片：textless 对不报", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "big-photo", kind: "image", rect: { x: 0, y: 0, w: 700, h: 500 }, src: "data:image/png;base64,AAA", fit: "fill" },
        { id: "inset", kind: "image", rect: { x: 528, y: 60, w: 200, h: 150 }, src: "data:image/png;base64,BBB", fit: "fill" },
      ]),
    );
    expect(issueFor("ppt.qc.overlap", doc)).toHaveLength(0);
  });

  it("mini 稿子回归：全幅色带 + 条纹纸屑 + 半幅蒙层 + 垫底卡 + 标题文本 → overlap 报 0 条", () => {
    const objects: PptSlide["objects"] = [
      { id: "band", kind: "shape", rect: { x: 0, y: 421.68, w: 1280, h: 298.32 }, shape: "rect" },
    ];
    for (let i = 0; i < 5; i += 1) {
      objects.push({
        id: `stripe-${i}`,
        kind: "shape",
        rect: { x: 80 + i * 240, y: 0, w: 14.33, h: 720 },
        shape: "rect",
      });
    }
    objects.push(
      { id: "veil", kind: "shape", rect: { x: 552, y: 0, w: 728, h: 652 }, shape: "rect", opacity: 0.9 },
      { id: "base-card", kind: "shape", rect: { x: 600, y: 100, w: 600, h: 400 }, shape: "rect" },
      { id: "title", kind: "text", rect: { x: 640, y: 480, w: 400, h: 80 }, paragraphs: [{ runs: [{ text: "标题" }] }] },
      { id: "subtitle", kind: "text", rect: { x: 640, y: 580, w: 300, h: 60 }, paragraphs: [{ runs: [{ text: "副标题" }] }] },
    );
    expect(issueFor("ppt.qc.overlap", deckWith(slideWith("imp-s1", objects)))).toHaveLength(0);
  });
});

describe("ppt.qc.empty-placeholder 空占位符", () => {
  it("缺 text 与纯空白 text 的占位符都报告", () => {
    const doc = deckWith(
      slideWith("s1", [
        { id: "p-missing", kind: "placeholder", rect: { x: 0, y: 0, w: 100, h: 40 }, subtype: "title" },
        { id: "p-blank", kind: "placeholder", rect: { x: 0, y: 60, w: 100, h: 40 }, subtype: "content", text: "   " },
        { id: "p-ok", kind: "placeholder", rect: { x: 0, y: 120, w: 100, h: 40 }, subtype: "content", text: "有内容" },
      ]),
    );
    const issues = issueFor("ppt.qc.empty-placeholder", doc);
    expect(issues.map((issue) => issue.objectId)).toEqual(["p-missing", "p-blank"]);
  });
});

describe("ppt.qc.empty-slide 空幻灯片", () => {
  it("无对象 slide 报告且定位 slide id", () => {
    const doc = deckWith(slideWith("s-empty", []), slideWith("s-full", [
      { id: "o", kind: "shape", rect: { x: 0, y: 0, w: 10, h: 10 }, shape: "rect" },
    ]));
    const issues = issueFor("ppt.qc.empty-slide", doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ slideId: "s-empty" });
  });
});

describe("runPptInspectors 汇总", () => {
  it("干净文档零问题；PPT_INSPECTORS 覆盖 4 条规则", () => {
    const clean = deckWith(
      slideWith("s1", [
        { id: "t", kind: "text", rect: { x: 10, y: 10, w: 200, h: 40 }, paragraphs: [{ runs: [{ text: "正文" }] }] },
      ]),
    );
    expect(runPptInspectors(clean)).toHaveLength(0);
    expect(PPT_INSPECTORS.map((inspector) => inspector.id)).toEqual([
      "ppt.qc.bounds",
      "ppt.qc.overlap",
      "ppt.qc.empty-placeholder",
      "ppt.qc.empty-slide",
    ]);
    expect(PPT_INSPECTORS.every((inspector) => inspector.title.length > 0)).toBe(true);
  });

  it("可传入子集只跑部分规则", () => {
    const doc = deckWith(slideWith("s1", []));
    const onlyEmptySlide = runPptInspectors(doc, PPT_INSPECTORS.slice(3));
    expect(onlyEmptySlide.map((issue) => issue.inspectorId)).toEqual(["ppt.qc.empty-slide"]);
  });
});
