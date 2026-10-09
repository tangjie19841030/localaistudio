import { describe, expect, it } from "vitest";
import { checkPptDocument, validatePptDocument } from "../src/index.js";
import { sampleDocument } from "./fixtures.js";

describe("ppt document", () => {
  it("accepts a valid deck", () => {
    const parsed = validatePptDocument(sampleDocument());
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.slides[0]!.objects).toHaveLength(2);
    expect(checkPptDocument(parsed)).toEqual([]);
  });

  it("rejects duplicate slide IDs", () => {
    const doc = sampleDocument();
    const broken = validatePptDocument({ ...doc, slides: [...doc.slides, { ...doc.slides[0]! }] });
    expect(checkPptDocument(broken)).toContain("存在重复的幻灯片 ID: slide-1");
  });

  it("rejects duplicate object IDs within a slide", () => {
    const doc = sampleDocument();
    const slide = doc.slides[0]!;
    const broken = validatePptDocument({
      ...doc,
      slides: [{ ...slide, objects: [...slide.objects, { ...slide.objects[0]!, rect: { x: 0, y: 0, w: 10, h: 10 } }] }],
    });
    expect(checkPptDocument(broken)).toContain('幻灯片 "slide-1" 存在重复的对象 ID: text-1');
  });

  it("rejects group children that do not exist in the same slide", () => {
    const doc = sampleDocument();
    const slide = doc.slides[0]!;
    const group = { kind: "group" as const, id: "group-1", rect: { x: 0, y: 0, w: 300, h: 300 }, children: ["missing-obj"] };
    const broken = validatePptDocument({ ...doc, slides: [{ ...slide, objects: [...slide.objects, group] }] });
    expect(checkPptDocument(broken)).toContain('分组 "group-1" 引用了不存在的对象 "missing-obj"');
  });

  it("rejects negative rect coordinates via zod", () => {
    const doc = sampleDocument();
    const slide = doc.slides[0]!;
    const bad = {
      ...doc,
      slides: [{ ...slide, objects: [...slide.objects, { kind: "shape", id: "bad-1", rect: { x: -10, y: 0, w: 100, h: 100 }, shape: "rect" }] }],
    };
    expect(() => validatePptDocument(bad)).toThrow(/固定画布不允许负坐标/);
  });

  it("rejects geometry extending beyond the fixed canvas", () => {
    const doc = sampleDocument();
    const slide = doc.slides[0]!;
    expect(() =>
      validatePptDocument({
        ...doc,
        slides: [{ ...slide, objects: [{ kind: "shape", id: "big-1", rect: { x: 1000, y: 0, w: 500, h: 100 }, shape: "rect" }] }],
      }),
    ).toThrow(/超出幻灯片边界/);
  });

  it("rejects non-positive width/height", () => {
    const doc = sampleDocument();
    const slide = doc.slides[0]!;
    expect(() =>
      validatePptDocument({
        ...doc,
        slides: [{ ...slide, objects: [{ kind: "shape", id: "flat-1", rect: { x: 10, y: 10, w: 0, h: 100 }, shape: "rect" }] }],
      }),
    ).toThrow(/宽高必须为正数/);
  });

  it("rejects unknown object kind and bad theme colors at parse level", () => {
    const doc = sampleDocument();
    expect(() => validatePptDocument({ ...doc, theme: { ...doc.theme, primary: "teal" } })).toThrow();
    const slide = doc.slides[0]!;
    expect(() =>
      validatePptDocument({
        ...doc,
        slides: [{ ...slide, objects: [{ kind: "sticker", id: "s-1", rect: { x: 0, y: 0, w: 10, h: 10 } }] }],
      }),
    ).toThrow();
  });

  it("accepts a valid video object (poster optional) and passes referential checks", () => {
    const doc = sampleDocument();
    const video = {
      kind: "video" as const,
      id: "video-1",
      rect: { x: 100, y: 100, w: 640, h: 360 },
      src: "/api/projects/p/assets/abc123.mp4",
    };
    const parsed = validatePptDocument({ ...doc, slides: [{ ...doc.slides[0]!, objects: [...doc.slides[0]!.objects, video] }] });
    expect(checkPptDocument(parsed)).toEqual([]);
    const stored = parsed.slides[0]!.objects.find((object) => object.id === "video-1")!;
    expect(stored.kind).toBe("video");
    expect(stored.kind === "video" && stored.poster).toBeUndefined();
  });

  it("rejects video objects with empty/oversized src or invalid poster", () => {
    const doc = sampleDocument();
    const slide = doc.slides[0]!;
    const withVideo = (video: Record<string, unknown>) =>
      validatePptDocument({ ...doc, slides: [{ ...slide, objects: [...slide.objects, video] }] });
    // src missing / empty -> required + min(1) rejects.
    expect(() => withVideo({ kind: "video", id: "v-1", rect: { x: 0, y: 0, w: 10, h: 10 } })).toThrow();
    expect(() => withVideo({ kind: "video", id: "v-2", rect: { x: 0, y: 0, w: 10, h: 10 }, src: "" })).toThrow();
    // src beyond max(2000).
    expect(() =>
      withVideo({ kind: "video", id: "v-3", rect: { x: 0, y: 0, w: 10, h: 10 }, src: "a".repeat(2001) }),
    ).toThrow();
    // poster present but empty string violates min(1).
    expect(() =>
      withVideo({
        kind: "video",
        id: "v-4",
        rect: { x: 0, y: 0, w: 10, h: 10 },
        src: "/api/projects/p/assets/a.mp4",
        poster: "",
      }),
    ).toThrow();
    // poster null is not allowed at schema level (absent vs null).
    expect(() =>
      withVideo({
        kind: "video",
        id: "v-5",
        rect: { x: 0, y: 0, w: 10, h: 10 },
        src: "/api/projects/p/assets/a.mp4",
        poster: null,
      }),
    ).toThrow();
  });
});
