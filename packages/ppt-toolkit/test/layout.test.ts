import { describe, expect, it } from "vitest";
import { SLIDE_HEIGHT, SLIDE_WIDTH, applyLayoutTemplate, createSlide, createSlideFromLayout } from "../src/index.js";
import { isPlaceholder } from "./fixtures.js";

describe("ppt layout templates", () => {
  it("title layout stamps title and subtitle placeholders inside the canvas", () => {
    const slide = applyLayoutTemplate(createSlide("slide-1", "标题页"), "title");
    expect(slide.layoutId).toBe("title");
    expect(slide.objects).toHaveLength(2);
    for (const object of slide.objects) {
      expect(object.kind).toBe("placeholder");
      expect(object.rect.x).toBeGreaterThanOrEqual(0);
      expect(object.rect.y).toBeGreaterThanOrEqual(0);
      expect(object.rect.x + object.rect.w).toBeLessThanOrEqual(SLIDE_WIDTH);
      expect(object.rect.y + object.rect.h).toBeLessThanOrEqual(SLIDE_HEIGHT);
    }
    expect(slide.objects.map((object) => object.id)).toEqual(
      expect.arrayContaining(["slide-1-title-1", "slide-1-subtitle-1"]),
    );
  });

  it("titleContent layout stamps title and content placeholders", () => {
    const slide = createSlideFromLayout("titleContent", new Set());
    expect(slide.objects.filter(isPlaceholder).map((object) => object.subtype)).toEqual(["title", "content"]);
    expect(slide.objects.every((object) => object.rect.y + object.rect.h <= SLIDE_HEIGHT)).toBe(true);
  });

  it("blank layout adds no placeholders and creates unique slide ids", () => {
    const first = createSlideFromLayout("blank", new Set(["slide-1"]));
    expect(first.id).toBe("slide-2");
    expect(first.objects).toHaveLength(0);
  });

  it("applyLayoutTemplate replaces placeholders, keeps user objects, carries text", () => {
    const base = createSlideFromLayout("title", new Set());
    base.objects = base.objects.map((o) =>
      o.kind === "placeholder" && o.subtype === "title" ? { ...o, text: "我的标题" } : o,
    );
    const withContent = applyLayoutTemplate(base, "titleContent");
    // Placeholders replaced (2, not stacked to 4); subtypes title+content; the
    // typed title text migrated onto the new title placeholder.
    expect(withContent.objects).toHaveLength(2);
    const placeholders = withContent.objects.filter(
      (o): o is Extract<typeof o, { kind: "placeholder" }> => o.kind === "placeholder",
    );
    expect(placeholders.map((o) => o.subtype)).toEqual(["title", "content"]);
    const title = placeholders.find((o) => o.subtype === "title");
    expect(title?.text).toBe("我的标题");
    const ids = withContent.objects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
