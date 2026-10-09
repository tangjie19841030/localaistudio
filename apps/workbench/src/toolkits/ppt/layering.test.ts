import { describe, expect, it } from "vitest";
import type { PptSlideObject } from "@studio/ppt-toolkit";
import { repairDeckWashLayering, repairSlideWashLayering } from "./layering";

const shape = (id: string, rect: PptSlideObject["rect"], fill: string): PptSlideObject => ({
  id,
  kind: "shape",
  rect,
  shape: "rect",
  fill,
});

const text = (id: string, rect: PptSlideObject["rect"]): PptSlideObject => ({
  id,
  kind: "text",
  rect,
  paragraphs: [{ runs: [{ text: id }] }],
  fontSize: 24,
});

const image = (id: string, rect: PptSlideObject["rect"]): PptSlideObject => ({
  id,
  kind: "image",
  rect,
  src: `/api/projects/p/assets/${id}.png`,
  fit: "contain",
});

const FULL: PptSlideObject["rect"] = { x: 0, y: 0, w: 1280, h: 652 };
const HALF: PptSlideObject["rect"] = { x: 551, y: 0, w: 728, h: 652 };
const SMALL: PptSlideObject["rect"] = { x: 100, y: 100, w: 200, h: 100 };
const TEXT_RECT: PptSlideObject["rect"] = { x: 400, y: 500, w: 400, h: 100 };
const IMG_RECT: PptSlideObject["rect"] = { x: 995, y: 100, w: 225, h: 200 };

describe("repairSlideWashLayering（导入蒙层沉底自愈）", () => {
  it("全幅浅色矩形压在文本/图片之上时，移到第一个被覆盖内容之前", () => {
    // Reproduces the 卡通PPT slide 1 order: small bars, images, text,
    // then the full-bleed + half-bleed pink washes at the very top.
    const objects = [
      image("img-left", { x: 230, y: 123, w: 198, h: 267 }),
      image("img-right", IMG_RECT),
      text("title", TEXT_RECT),
      shape("bar1", { x: 0, y: 421, w: 1280, h: 298 }, "#DEFCFF"),
      shape("wash-half", HALF, "#FFEAE7"),
      shape("wash-full", FULL, "#FFEAE7"),
      shape("white-card", { x: 177, y: 487, w: 963, h: 232 }, "#FFFFFF"),
    ];
    const result = repairSlideWashLayering(objects);
    expect(result.moved).toBe(3);
    const ids = result.objects.map((o) => o.id);
    // Full-width bottom bar and washes now sit before the content they cover.
    expect(result.movedIds).toEqual(["bar1", "wash-half", "wash-full"]);
    expect(ids.indexOf("bar1")).toBeLessThan(ids.indexOf("img-left"));
    expect(ids.indexOf("wash-full")).toBeLessThan(ids.indexOf("title"));
    expect(ids.indexOf("wash-full")).toBeLessThan(ids.indexOf("img-left"));
    expect(ids.indexOf("wash-half")).toBeLessThan(ids.indexOf("img-right"));
    // The white content card stays above the washes.
    expect(ids.indexOf("white-card")).toBeGreaterThan(ids.indexOf("wash-full"));
    expect(result.movedIds).not.toContain("white-card");
  });

  it("963px 白色内容卡片不移动；1280px 全宽底部背景仍移动", () => {
    const shape72 = shape("shape72", { x: 176.95, y: 487.66, w: 963.69, h: 232.34 }, "#FFFFFF");
    const shape73 = shape("shape73", { x: 0, y: 501.22, w: 1280, h: 218.78 }, "#FFFFFF");
    const objects = [image("content", { x: 220, y: 520, w: 300, h: 100 }), shape72, shape73];
    const result = repairSlideWashLayering(objects);

    expect(result.moved).toBe(1);
    expect(result.movedIds).toEqual(["shape73"]);
    expect(result.objects.map((o) => o.id)).toEqual(["shape73", "content", "shape72"]);
  });

  it("正常文档不改动（幂等：修复后再跑 moved=0）", () => {
    const objects = [
      shape("wash-full", FULL, "#FFEAE7"),
      image("img", SMALL),
      text("title", TEXT_RECT),
    ];
    const first = repairSlideWashLayering(objects);
    expect(first.moved).toBe(0);
    const again = repairSlideWashLayering(first.objects);
    expect(again.moved).toBe(0);
    expect(again.objects.map((o) => o.id)).toEqual(first.objects.map((o) => o.id));
  });

  it("模板的浅黄装饰竖条（贴边、通高、压住图片）也要沉到内容下方", () => {
    // Reproduces the 卡通PPT yellow bars: 14x720 pale stripes at the edges.
    const stripe = (id: string, x: number): PptSlideObject =>
      shape(id, { x, y: 0, w: 14.33, h: 720 }, "#FFFCCD");
    const objects = [
      image("img-left", { x: 0, y: 123, w: 198, h: 267 }),
      image("img-right", { x: 1260, y: 100, w: 20, h: 200 }),
      text("title", TEXT_RECT),
      stripe("bar1", 0),
      stripe("bar2", 1265.67),
      shape("wash-full", FULL, "#FFEAE7"),
    ];
    const result = repairSlideWashLayering(objects);
    // Both stripes + the full wash move; images/text stay above them.
    expect(result.moved).toBe(3);
    const ids = result.objects.map((o) => o.id);
    for (const id of ["bar1", "bar2", "wash-full"]) {
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf("img-left"));
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf("title"));
    }
    // Relative order among the moved backgrounds is preserved (bar1 before bar2 before wash).
    expect(ids.indexOf("bar1")).toBeLessThan(ids.indexOf("bar2"));
    expect(ids.indexOf("bar2")).toBeLessThan(ids.indexOf("wash-full"));
  });

  it("贴边规则严格限制竖条；非贴边竖条不移动", () => {
    const objects = [
      image("img", { x: 0, y: 100, w: 5, h: 400 }),
      shape("near-edge", { x: 9, y: 20, w: 14, h: 680 }, "#FFFCCD"),
      shape("edge", { x: 0, y: 0, w: 14, h: 720 }, "#FFFCCD"),
    ];
    const result = repairSlideWashLayering(objects);

    expect(result.moved).toBe(1);
    expect(result.movedIds).toEqual(["edge"]);
    expect(result.objects.map((o) => o.id)).toEqual(["edge", "img", "near-edge"]);
  });
  it("深色形状不动；居中卡片不动；不覆盖内容的形状不动", () => {
    const objects = [
      image("img", SMALL),
      shape("dark-overlay", FULL, "#1F2937"),
      shape("centered", { x: 100, y: 100, w: 1000, h: 600 }, "#FFFFFF"),
    ];
    const result = repairSlideWashLayering(objects);
    expect(result.moved).toBe(0);
    expect(result.objects.map((o) => o.id)).toEqual(["img", "dark-overlay", "centered"]);
  });
});

describe("repairDeckWashLayering", () => {
  it("逐页修复并给出中文报告；无问题页不出现在报告", () => {
    const deck = {
      documentVersion: 1,
      name: "t",
      presentation: { title: null, author: null, subject: null },
      theme: {
        primary: "#0F766E",
        secondary: "#134E4A",
        accent: "#F59E0B",
        background: "#F8FAFC",
        fontTitle: "x",
        fontBody: "y",
      },
      slideSize: { w: 1280, h: 720 },
      masters: [],
      layouts: [],
      slides: [
        {
          id: "s1",
          title: "坏页",
          notes: "",
          objects: [image("i1", SMALL), shape("w", FULL, "#FFEAE7")],
        },
        {
          id: "s2",
          title: "好页",
          notes: "",
          objects: [shape("bg", FULL, "#FFEAE7"), text("t", TEXT_RECT)],
        },
      ],
    } as never as Parameters<typeof repairDeckWashLayering>[0];
    const result = repairDeckWashLayering(deck);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toContain("坏页");
    const ids = result.deck.slides[0]!.objects.map((o) => o.id);
    expect(ids.indexOf("w")).toBeLessThan(ids.indexOf("i1"));
  });
});
