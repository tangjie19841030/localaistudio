import { describe, expect, it } from "vitest";
import type { CommandInvocation, DocumentEnvelope, SelectionScope } from "@studio/studio-core";
import { CommandExecutionError, executeCommand, executeTransaction, ToolKitRegistry } from "@studio/studio-core";
import { PPT_TOOLKIT, createPptDocumentEnvelope } from "../src/index.js";
import type { PptDocument, PptSlideObject } from "../src/index.js";
import { envelope, fileScope, invocation, isPlaceholder, objectScope, slideScope } from "./fixtures.js";

type Base = DocumentEnvelope<PptDocument>;

function run(args: { id: string; args: unknown; scope?: SelectionScope }, base: Base = envelope()) {
  const scope = args.scope ?? fileScope;
  return executeCommand(PPT_TOOLKIT, base, invocation(args.id, args.args, scope, `inv-${args.id}`));
}

function failureMessage(args: { id: string; args: unknown; scope?: SelectionScope }, base: Base = envelope()): string {
  try {
    run(args, base);
    throw new Error("expected command to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CommandExecutionError);
    return (error as CommandExecutionError).message;
  }
}

function slideTitles(doc: PptDocument): string[] {
  return doc.slides.map((slide) => slide.title);
}

describe("slide commands", () => {
  it("slide.add appends a slide with layout and notes", () => {
    const executed = run({ id: "slide.add", args: { layout: "titleContent", title: "新增页", notes: "讲这页" } });
    const doc = executed.result.nextEnvelope.document;
    expect(doc.slides).toHaveLength(2);
    const added = doc.slides[1]!;
    expect(added.title).toBe("新增页");
    expect(added.layoutId).toBe("titleContent");
    expect(added.notes).toBe("讲这页");
    expect(added.objects.filter(isPlaceholder).map((object) => object.subtype)).toEqual(["title", "content"]);
    expect(executed.result.createdIds).toHaveLength(1);
  });

  it("slide.add rejects duplicate slide ids and empty titles", () => {
    expect(failureMessage({ id: "slide.add", args: { slideId: "slide-1", title: "重复" } })).toMatch(/ID 已存在/);
    expect(failureMessage({ id: "slide.add", args: { title: "" } })).toMatch(/命令参数无效/);
  });

  it("slide.duplicate clones a slide with fresh object ids", () => {
    const executed = run({ id: "slide.duplicate", args: { slideId: "slide-1" } });
    const doc = executed.result.nextEnvelope.document;
    expect(doc.slides).toHaveLength(2);
    const copy = doc.slides[1]!;
    expect(copy.id).not.toBe("slide-1");
    expect(copy.objects).toHaveLength(2);
    expect(copy.objects.map((object) => object.id)).not.toContain("text-1");
  });

  it("slide.remove deletes a slide but keeps at least one", () => {
    const two = run({ id: "slide.add", args: { title: "第二页" } }).result.nextEnvelope;
    const removed = run({ id: "slide.remove", args: { slideId: "slide-1" } }, two);
    expect(slideTitles(removed.result.nextEnvelope.document)).toEqual(["第二页"]);
    expect(failureMessage({ id: "slide.remove", args: { slideId: "slide-2" } }, removed.result.nextEnvelope)).toMatch(/至少保留一张/);
  });

  it("slide.remove rejects a locked slide", () => {
    const locked = run({ id: "slide.lock", args: { slideId: "slide-1", locked: true } }).result.nextEnvelope;
    expect(failureMessage({ id: "slide.remove", args: { slideId: "slide-1" } }, locked)).toMatch(/已锁定/);
  });

  it("slide.reorder moves a slide to a target index", () => {
    const base = envelope();
    const extra = run({ id: "slide.add", args: { title: "第二页" } }, base).result.nextEnvelope;
    const final = run({ id: "slide.add", args: { title: "第三页" } }, extra).result.nextEnvelope;
    const moved = run({ id: "slide.reorder", args: { slideId: "slide-2", index: 0 } }, final);
    expect(slideTitles(moved.result.nextEnvelope.document)).toEqual(["第二页", "第一页", "第三页"]);
    expect(failureMessage({ id: "slide.reorder", args: { slideId: "slide-1", index: 99 } })).toMatch(/超出范围/);
    expect(failureMessage({ id: "slide.reorder", args: { slideId: "nope", index: 0 } })).toMatch(/幻灯片不存在/);
  });

  it("slide.rename updates the title", () => {
    const executed = run({ id: "slide.rename", args: { slideId: "slide-1", title: "新的标题" } });
    expect(executed.result.nextEnvelope.document.slides[0]!.title).toBe("新的标题");
  });

  it("slide.lock toggles and manual unlock overrides the lock; AI cannot override", () => {
    const locked = run({ id: "slide.lock", args: { slideId: "slide-1", locked: true } });
    expect(locked.result.nextEnvelope.document.slides[0]!.locked).toBe(true);
    const unlocked = run({ id: "slide.lock", args: { slideId: "slide-1", locked: false } }, locked.result.nextEnvelope);
    expect(unlocked.result.nextEnvelope.document.slides[0]!.locked).toBe(false);
    // AI source cannot request lock overrides.
    expect(() =>
      executeCommand(PPT_TOOLKIT, locked.result.nextEnvelope, {
        invocationId: "ai-unlock",
        id: "slide.lock",
        args: { slideId: "slide-1", locked: false },
        source: "ai",
        scope: fileScope,
      }),
    ).toThrow(/锁定豁免/);
  });

  it("slide.setNotes writes speaker notes and rejects locked slides", () => {
    const executed = run({ id: "slide.setNotes", args: { slideId: "slide-1", notes: "演讲要点" } });
    expect(executed.result.nextEnvelope.document.slides[0]!.notes).toBe("演讲要点");
    const locked = run({ id: "slide.lock", args: { slideId: "slide-1", locked: true } }).result.nextEnvelope;
    expect(failureMessage({ id: "slide.setNotes", args: { slideId: "slide-1", notes: "x" } }, locked)).toMatch(/已锁定/);
  });

  it("slide.applyLayout stamps placeholders onto an existing slide", () => {
    const executed = run({ id: "slide.applyLayout", args: { slideId: "slide-1", layout: "title" } });
    const slide = executed.result.nextEnvelope.document.slides[0]!;
    expect(slide.objects).toHaveLength(4);
    expect(slide.layoutId).toBe("title");
  });

  it("slide.applyLayout rejects locked slides and unknown layouts", () => {
    const locked = run({ id: "slide.lock", args: { slideId: "slide-1", locked: true } }).result.nextEnvelope;
    expect(failureMessage({ id: "slide.applyLayout", args: { slideId: "slide-1", layout: "title" } }, locked)).toMatch(/已锁定/);
    expect(failureMessage({ id: "slide.applyLayout", args: { slideId: "slide-1", layout: "nope" } })).toMatch(/命令参数无效/);
  });

  it("theme.apply switches the deck theme without touching object colors", () => {
    const executed = run({ id: "theme.apply", args: { themeId: "minimal" } });
    const doc = executed.result.nextEnvelope.document;
    expect(doc.theme.primary).toBe("#171717");
    const shape = doc.slides[0]!.objects.find((object) => object.id === "shape-1")!;
    expect(shape.kind === "shape" && shape.fill).toBe("#0F766E");
    expect(failureMessage({ id: "theme.apply", args: { themeId: "nope" } })).toMatch(/未知主题/);
  });

  it("file-only commands reject container/selection scopes", () => {
    expect(failureMessage({ id: "slide.add", args: { title: "x" }, scope: slideScope })).toMatch(/不支持 container 范围/);
    expect(failureMessage({ id: "slide.add", args: { title: "x" }, scope: objectScope })).toMatch(/不支持 selection 范围/);
    expect(failureMessage({ id: "theme.apply", args: { themeId: "minimal" }, scope: objectScope })).toMatch(/不支持 selection 范围/);
  });
});

describe("object commands", () => {
  it("object.add inserts a text object with defaults and rejects bad geometry", () => {
    const executed = run({
      id: "object.add",
      args: {
        slideId: "slide-1",
        object: { kind: "text", rect: { x: 10, y: 10, w: 200, h: 60 }, data: { paragraphs: [{ runs: [{ text: "hi" }] }] } },
      },
    });
    const objects = executed.result.nextEnvelope.document.slides[0]!.objects;
    expect(objects).toHaveLength(3);
    expect(objects[2]!.id).toMatch(/^slide-1-text-/);
    expect(failureMessage({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", rect: { x: -5, y: 0, w: 10, h: 10 } } },
    })).toMatch(/固定画布/);
  });

  it("object.add fails on a locked slide and rejects duplicate ids", () => {
    const locked = run({ id: "slide.lock", args: { slideId: "slide-1", locked: true } }).result.nextEnvelope;
    expect(failureMessage({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", rect: { x: 0, y: 0, w: 10, h: 10 } } },
    }, locked)).toMatch(/已锁定/);
    expect(failureMessage({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", id: "text-1", rect: { x: 0, y: 0, w: 10, h: 10 } } },
    })).toMatch(/ID 已存在/);
  });

  it("object.move and object.resize update geometry with canvas bounds", () => {
    const moved = run({ id: "object.move", args: { objectId: "text-1", x: 600, y: 400 } });
    expect(moved.result.nextEnvelope.document.slides[0]!.objects[0]!.rect).toEqual({ x: 600, y: 400, w: 600, h: 80 });
    expect(failureMessage({ id: "object.move", args: { objectId: "text-1", x: 700, y: 0 } })).toMatch(/固定画布/);
    const resized = run({ id: "object.resize", args: { objectId: "text-1", rect: { x: 100, y: 80, w: 1000, h: 100 } } });
    expect(resized.result.nextEnvelope.document.slides[0]!.objects[0]!.rect).toEqual({ x: 100, y: 80, w: 1000, h: 100 });
    expect(failureMessage({ id: "object.move", args: { objectId: "nope", x: 0, y: 0 } })).toMatch(/对象不存在/);
  });

  it("object.align aligns one object to slide edges and center", () => {
    const right = run({ id: "object.align", args: { objectId: "shape-1", edge: "right" } });
    expect(right.result.nextEnvelope.document.slides[0]!.objects[1]!.rect.x).toBe(1080);
    const hcenter = run({ id: "object.align", args: { objectId: "shape-1", edge: "hcenter" } });
    expect(hcenter.result.nextEnvelope.document.slides[0]!.objects[1]!.rect.x).toBe(540);
  });

  it("object.distribute spaces three objects evenly", () => {
    const a = run({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", id: "d-1", rect: { x: 0, y: 600, w: 50, h: 50 } } },
    }).result.nextEnvelope;
    const b = run({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", id: "d-2", rect: { x: 1200, y: 600, w: 80, h: 50 } } },
    }, a).result.nextEnvelope;
    const c = run({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", id: "d-3", rect: { x: 500, y: 600, w: 100, h: 50 } } },
    }, b).result.nextEnvelope;
    const result = run({ id: "object.distribute", args: { slideId: "slide-1", objectIds: ["d-1", "d-2", "d-3"], axis: "horizontal" } }, c);
    const objects = result.result.nextEnvelope.document.slides[0]!.objects;
    const xs = ["d-1", "d-2", "d-3"]
      .map((id) => objects.find((object) => object.id === id)!.rect)
      .sort((p, q) => p.x - q.x);
    const gaps = [xs[1]!.x - (xs[0]!.x + xs[0]!.w), xs[2]!.x - (xs[1]!.x + xs[1]!.w)];
    expect(gaps[0]).toBeCloseTo(gaps[1]!, 6);
  });

  it("object.distribute rejects overlapping objects and missing ids", () => {
    const a = run({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", id: "d-1", rect: { x: 0, y: 600, w: 500, h: 50 } } },
    }).result.nextEnvelope;
    const b = run({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", id: "d-2", rect: { x: 100, y: 600, w: 500, h: 50 } } },
    }, a).result.nextEnvelope;
    const c = run({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "shape", id: "d-3", rect: { x: 200, y: 600, w: 500, h: 50 } } },
    }, b).result.nextEnvelope;
    expect(failureMessage({
      id: "object.distribute",
      args: { slideId: "slide-1", objectIds: ["d-1", "d-2", "d-3"], axis: "horizontal" },
    }, c)).toMatch(/空间不足/);
    expect(failureMessage({
      id: "object.distribute",
      args: { slideId: "slide-1", objectIds: ["nope", "d-1", "d-2"], axis: "horizontal" },
    })).toMatch(/不存在对象/);
  });

  it("object.editText replaces paragraphs and rejects non-text objects", () => {
    const executed = run({ id: "object.editText", args: { objectId: "text-1", paragraphs: [{ runs: [{ text: "新内容", bold: true }] }] } });
    const text = executed.result.nextEnvelope.document.slides[0]!.objects[0]!;
    expect(text.kind === "text" && text.paragraphs[0]!.runs[0]!.text).toBe("新内容");
    expect(failureMessage({ id: "object.editText", args: { objectId: "shape-1", paragraphs: [] } })).toMatch(/不是文本对象/);
  });

  it("object.editImage swaps src/fit/title and rejects non-image objects", () => {
    const added = run({
      id: "object.add",
      args: {
        slideId: "slide-1",
        object: { kind: "image", id: "img-1", rect: { x: 0, y: 0, w: 200, h: 100 }, data: { src: "/api/projects/p/assets/a.png" } },
      },
    }).result.nextEnvelope;
    const swapped = run(
      { id: "object.editImage", args: { objectId: "img-1", src: "/api/projects/p/assets/b.png", fit: "cover", title: "新背景" } },
      added,
    );
    const image = swapped.result.nextEnvelope.document.slides[0]!.objects.find((object) => object.id === "img-1")!;
    expect(image.kind === "image" && { src: image.src, fit: image.fit, title: image.title }).toEqual({
      src: "/api/projects/p/assets/b.png",
      fit: "cover",
      title: "新背景",
    });
    // Omitting fit/title preserves the previous values.
    const srcOnly = run({ id: "object.editImage", args: { objectId: "img-1", src: "data:image/png;base64,AAAA" } }, swapped.result.nextEnvelope);
    const again = srcOnly.result.nextEnvelope.document.slides[0]!.objects.find((object) => object.id === "img-1")!;
    expect(again.kind === "image" && again.fit).toBe("cover");
    expect(failureMessage({ id: "object.editImage", args: { objectId: "shape-1", src: "/x.png" } })).toMatch(/不是图片对象/);
    expect(failureMessage({ id: "object.editImage", args: { objectId: "ghost", src: "/x.png" } })).toMatch(/对象不存在/);
    expect(failureMessage({ id: "object.editImage", args: { objectId: "img-1", src: "" } }, added)).toMatch(/命令参数无效/);
  });

  it("object.editVideo swaps src/title, clears poster via null, rejects non-video", () => {
    // object.add kind=video: materializes through the domain schema (src required).
    const added = run({
      id: "object.add",
      args: {
        slideId: "slide-1",
        object: { kind: "video", id: "vid-1", rect: { x: 100, y: 100, w: 640, h: 360 }, data: { src: "/api/projects/p/assets/v.mp4" } },
      },
    }).result.nextEnvelope;
    let stored = added.document.slides[0]!.objects.find((object) => object.id === "vid-1")!;
    expect(stored.kind).toBe("video");
    expect(stored.kind === "video" && stored.src).toBe("/api/projects/p/assets/v.mp4");

    // Empty src at add time is rejected by the domain schema chain.
    expect(failureMessage({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "video", rect: { x: 0, y: 0, w: 10, h: 10 }, data: { src: "" } } },
    })).toMatch(/对象数据无效/);

    // Swap src + set poster + title in one edit.
    const edited = run(
      {
        id: "object.editVideo",
        args: { objectId: "vid-1", src: "/api/projects/p/assets/w.mp4", poster: "/api/projects/p/assets/c.png", title: "产品演示" },
      },
      added,
    );
    stored = edited.result.nextEnvelope.document.slides[0]!.objects.find((object) => object.id === "vid-1")!;
    expect(stored.kind === "video" && stored.src).toBe("/api/projects/p/assets/w.mp4");
    expect(stored.kind === "video" && stored.poster).toBe("/api/projects/p/assets/c.png");
    expect(stored.kind === "video" && stored.title).toBe("产品演示");

    // poster: null clears the poster key entirely.
    const cleared = run({ id: "object.editVideo", args: { objectId: "vid-1", poster: null } }, edited.result.nextEnvelope);
    stored = cleared.result.nextEnvelope.document.slides[0]!.objects.find((object) => object.id === "vid-1")!;
    expect(stored.kind === "video" && "poster" in stored).toBe(false);

    // Omitted fields preserve previous values.
    const srcOnly = run({ id: "object.editVideo", args: { objectId: "vid-1", src: "data:video/mp4;base64,AAAA" } }, cleared.result.nextEnvelope);
    stored = srcOnly.result.nextEnvelope.document.slides[0]!.objects.find((object) => object.id === "vid-1")!;
    expect(stored.kind === "video" && stored.title).toBe("产品演示");

    // Non-video object and missing object are rejected; args require at least one field.
    expect(failureMessage({ id: "object.editVideo", args: { objectId: "text-1", src: "/x.mp4" } })).toMatch(/不是视频对象/);
    expect(failureMessage({ id: "object.editVideo", args: { objectId: "ghost", src: "/x.mp4" } })).toMatch(/对象不存在/);
    expect(failureMessage({ id: "object.editVideo", args: { objectId: "vid-1" } }, added)).toMatch(/命令参数无效/);
  });

  it("object.remove deletes an object and cleans dangling group refs", () => {
    const withGroup = run({
      id: "object.add",
      args: { slideId: "slide-1", object: { kind: "group", id: "grp-1", rect: { x: 0, y: 0, w: 700, h: 300 }, data: { children: ["text-1"] } } },
    }).result.nextEnvelope;
    const removed = run({ id: "object.remove", args: { objectId: "text-1" } }, withGroup);
    const slide = removed.result.nextEnvelope.document.slides[0]!;
    expect(slide.objects.some((object) => object.id === "text-1")).toBe(false);
    const group = slide.objects.find((object) => object.id === "grp-1")!;
    expect(group.kind === "group" && group.children).toEqual([]);
  });

  it("object.lock blocks mutation and manual unlock can override", () => {
    const locked = run({ id: "object.lock", args: { objectId: "shape-1", locked: true } }).result.nextEnvelope;
    expect(failureMessage({ id: "object.move", args: { objectId: "shape-1", x: 10, y: 10 } }, locked)).toMatch(/对象已锁定/);
    expect(failureMessage({ id: "object.remove", args: { objectId: "shape-1" } }, locked)).toMatch(/已锁定/);
    const unlocked = run({ id: "object.lock", args: { objectId: "shape-1", locked: false } }, locked);
    expect(unlocked.result.nextEnvelope.document.slides[0]!.objects[1]!.locked).toBe(false);
  });

  it("slide lock inherits to objects: mutation blocked even when object itself unlocked", () => {
    const locked = run({ id: "slide.lock", args: { slideId: "slide-1", locked: true } }).result.nextEnvelope;
    expect(failureMessage({ id: "object.move", args: { objectId: "text-1", x: 0, y: 0 } }, locked)).toMatch(/幻灯片已锁定|目标已锁定/);
  });

  it("selection scope restricts object commands to the selected objects only", () => {
    const otherScope: SelectionScope = { kind: "selection", targetIds: ["shape-1"] };
    expect(failureMessage({ id: "object.move", args: { objectId: "text-1", x: 0, y: 0 }, scope: otherScope })).toMatch(/超出当前范围/);
    const inScope = run({ id: "object.move", args: { objectId: "shape-1", x: 300, y: 300 }, scope: otherScope });
    expect(inScope.result.nextEnvelope.document.slides[0]!.objects[1]!.rect).toEqual({ x: 300, y: 300, w: 200, h: 120 });
  });

  it("object commands work within a container (slide) scope", () => {
    const executed = run({ id: "object.move", args: { objectId: "text-1", x: 0, y: 0 }, scope: slideScope });
    expect(executed.result.nextEnvelope.document.slides[0]!.objects[0]!.rect).toEqual({ x: 0, y: 0, w: 600, h: 80 });
  });

  it("container scope rejects object ids and selection scope rejects slide ids", () => {
    // Commands that allow selection scope (object.move) reject a slide id as a selection target.
    expect(failureMessage({ id: "object.move", args: { objectId: "text-1", x: 0, y: 0 }, scope: { kind: "selection", targetIds: ["slide-1"] } })).toMatch(
      /不是对象/,
    );
    // A container-scope command (slide.rename) accepts slides but a container target must be a slide.
    expect(failureMessage({ id: "slide.rename", args: { slideId: "slide-1", title: "x" }, scope: { kind: "container", targetIds: ["text-1"] } })).toMatch(
      /不是幻灯片/,
    );
  });
});

describe("对象细节编辑能力（选中 → AI 修细节）", () => {
  // A deck carrying every editable object kind on one slide.
  function richBase(): Base {
    const objects: PptSlideObject[] = [
      { kind: "text", id: "text-1", rect: { x: 100, y: 80, w: 600, h: 80 }, paragraphs: [{ runs: [{ text: "标题文本" }] }], fontSize: 32 },
      { kind: "shape", id: "shape-1", rect: { x: 300, y: 200, w: 200, h: 120 }, shape: "round", fill: "#0F766E" },
      {
        kind: "table", id: "table-1", rect: { x: 80, y: 380, w: 500, h: 160 }, rows: 1, cols: 1,
        cells: [[{ text: "旧" }]],
      },
      {
        kind: "chart", id: "chart-1", rect: { x: 700, y: 380, w: 400, h: 240 }, chartType: "bar",
        series: [{ name: "销量", points: [{ label: "Q1", value: 1 }] }],
      },
      {
        kind: "placeholder", id: "title-ph", rect: { x: 140, y: 60, w: 1000, h: 120 }, subtype: "title" as const,
        text: "旧标题",
      },
    ];
    const source = envelope().document;
    const doc: PptDocument = {
      ...source,
      slides: [{ ...source.slides[0]!, objects }],
    };
    return createPptDocumentEnvelope(doc);
  }

  let base: Base;
  const exec = (id: string, args: unknown) => {
    const result = run({ id, args }, base);
    if (result.result.nextEnvelope) base = result.result.nextEnvelope;
    return result;
  };
  const findObject = (id: string): PptSlideObject => {
    const obj = base.document.slides[0]!.objects.find((candidate) => candidate.id === id);
    if (!obj) throw new Error(`missing ${id}`);
    return obj;
  };

  it("object.editShape 改填充/描边/形状类型；null 清除颜色；非形状拒绝", () => {
    base = richBase();
    exec("object.editShape", { objectId: "shape-1", shape: "ellipse", fill: "#FF0000", stroke: "#000000" });
    let shape = findObject("shape-1") as Extract<PptSlideObject, { kind: "shape" }>;
    expect(shape.shape).toBe("ellipse");
    expect(shape.fill).toBe("#FF0000");
    expect(shape.stroke).toBe("#000000");
    exec("object.editShape", { objectId: "shape-1", fill: null });
    shape = findObject("shape-1") as Extract<PptSlideObject, { kind: "shape" }>;
    expect("fill" in shape).toBe(false);
    expect(failureMessage({ id: "object.editShape", args: { objectId: "text-1", fill: "#000000" } }, base)).toMatch(/不是形状/);
  });

  it("object.editText 只改 fontSize/align 无需重发全文；placeholder 原地转 text（同 id/rect）", () => {
    base = richBase();
    exec("object.editText", { objectId: "text-1", fontSize: 44, align: "center" });
    const text = findObject("text-1") as Extract<PptSlideObject, { kind: "text" }>;
    expect(text.fontSize).toBe(44);
    expect(text.align).toBe("center");
    expect(text.paragraphs[0]!.runs[0]!.text).toBe("标题文本");

    const before = findObject("title-ph");
    exec("object.editText", { objectId: "title-ph", paragraphs: [{ runs: [{ text: "年度总结" }] }] });
    const after = findObject("title-ph");
    expect(after.kind).toBe("text");
    expect(after.id).toBe("title-ph");
    expect(after.rect).toEqual(before.rect);
  });

  it("object.editTable 整矩阵替换并重算 rows/cols；object.editChart 改类型", () => {
    base = richBase();
    exec("object.editTable", {
      objectId: "table-1",
      cells: [
        [{ text: "A" }, { text: "B" }],
        [{ text: "1" }, { text: "2" }],
      ],
    });
    const table = findObject("table-1") as Extract<PptSlideObject, { kind: "table" }>;
    expect(table.rows).toBe(2);
    expect(table.cols).toBe(2);
    expect(table.cells[1]![1]!.text).toBe("2");
    exec("object.editChart", { objectId: "chart-1", chartType: "line" });
    expect((findObject("chart-1") as Extract<PptSlideObject, { kind: "chart" }>).chartType).toBe("line");
  });

  it("slide.setBackground 设置与清除背景色", () => {
    base = richBase();
    exec("slide.setBackground", { slideId: "slide-1", color: "#0F172A" });
    expect(base.document.slides[0]!.background).toBe("#0F172A");
    exec("slide.setBackground", { slideId: "slide-1", color: null });
    expect("background" in base.document.slides[0]!).toBe(false);
  });

  it("object.alignMany 让多个对象互相左对齐（不是吸到画布左边）", () => {
    base = richBase();
    exec("object.alignMany", { slideId: "slide-1", objectIds: ["text-1", "shape-1"], edge: "left" });
    const xs = base.document.slides[0]!.objects.filter((o) => ["text-1", "shape-1"].includes(o.id)).map((o) => o.rect.x);
    expect(new Set(xs).size).toBe(1);
    expect(xs[0]).toBe(100);
  });

  it("object.group/ungroup：成组后移动外壳，成员一起移动；分组不可缩放", () => {
    base = richBase();
    exec("object.group", { slideId: "slide-1", objectIds: ["text-1", "shape-1"], id: "grp-1" });
    const group = findObject("grp-1") as Extract<PptSlideObject, { kind: "group" }>;
    expect(group.children).toEqual(["text-1", "shape-1"]);
    exec("object.move", { objectId: "grp-1", x: 200, y: 200 });
    expect(findObject("text-1").rect.x).toBe(200);
    expect(findObject("shape-1").rect.x).toBe(400); // 300 + 100 dx
    expect(failureMessage({ id: "object.resize", args: { objectId: "grp-1", rect: group.rect } }, base)).toMatch(/分组/);
    exec("object.ungroup", { objectId: "grp-1" });
    expect(base.document.slides[0]!.objects.find((o) => o.id === "grp-1")).toBeUndefined();
    expect(findObject("text-1")).toBeDefined();
  });

  it("形状透明度与文本字体字段（截图复现：遮罩透明化/楷体）", () => {
    base = richBase();
    exec("object.editShape", { objectId: "shape-1", opacity: 0.3 });
    const shape = findObject("shape-1") as Extract<PptSlideObject, { kind: "shape" }>;
    expect(shape.opacity).toBeCloseTo(0.3);
    exec("object.editText", { objectId: "text-1", fontFamily: "楷体" });
    const text = findObject("text-1") as Extract<PptSlideObject, { kind: "text" }>;
    expect(text.fontFamily).toBe("楷体");
  });

  it("object.duplicate 复制对象（偏移 24px、新 id、锁定不继承）", () => {
    base = richBase();
    const before = findObject("shape-1");
    exec("object.duplicate", { objectId: "shape-1" });
    const slide = base.document.slides[0]!;
    expect(slide.objects).toHaveLength(richBase().document.slides[0]!.objects.length + 1);
    const clone = slide.objects.find((o) => o.id !== "shape-1" && o.kind === "shape")!;
    expect(clone.rect.x).toBe(before.rect.x + 24);
    expect("locked" in clone).toBe(false);
  });

  it("object.duplicate 深拷贝分组（成员也复制，不共享 children）", () => {
    base = richBase();
    exec("object.group", { slideId: "slide-1", objectIds: ["text-1", "shape-1"], id: "grp-x" });
    exec("object.duplicate", { objectId: "grp-x" });
    const groups = base.document.slides[0]!.objects.filter((o) => o.kind === "group");
    expect(groups).toHaveLength(2);
    const memberSets = groups.map((g) => (g as Extract<PptSlideObject, { kind: "group" }>).children);
    expect(memberSets[0]).not.toEqual(memberSets[1]);
    const intersection = memberSets[0]!.filter((id) => memberSets[1]!.includes(id));
    expect(intersection).toHaveLength(0);
  });

  it("object.reorder 调整数组顺序：置顶/置底/上下移", () => {
    base = richBase();
    exec("object.reorder", { objectId: "text-1", position: "front" });
    const slide = () => base.document.slides[0]!;
    expect(slide().objects.at(-1)!.id).toBe("text-1");
    exec("object.reorder", { objectId: "text-1", position: "back" });
    expect(slide().objects[0]!.id).toBe("text-1");
    exec("object.reorder", { objectId: "text-1", position: "forward" });
    expect(slide().objects[1]!.id).toBe("text-1");
  });

  it("新细节命令均在 AI 工具组内", () => {
    const ids = PPT_TOOLKIT.aiTools.flatMap((t) => t.commandIds);
    for (const id of ["theme.apply", "object.editShape", "object.editTable", "object.editChart", "object.editVideo", "object.alignMany", "object.group", "object.ungroup", "slide.setBackground"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("transactions", () => {
  it("rolls back the whole transaction when a later command fails", () => {
    const invocations: CommandInvocation[] = [
      invocation("slide.add", { title: "第二页" }, fileScope, "t1"),
      invocation("slide.remove", { slideId: "missing-slide" }, fileScope, "t2"),
    ];
    const result = executeTransaction(PPT_TOOLKIT, envelope(), invocations);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.envelope.document.slides).toHaveLength(1);
      expect(result.error.invocationId).toBe("t2");
    }
  });

  it("commits all commands when everything succeeds", () => {
    const invocations: CommandInvocation[] = [
      invocation("slide.add", { title: "第二页" }, fileScope, "t1"),
      invocation("slide.rename", { slideId: "slide-1", title: "改名" }, fileScope, "t2"),
    ];
    const result = executeTransaction(PPT_TOOLKIT, envelope(), invocations);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.document.slides).toHaveLength(2);
      expect(result.commands).toHaveLength(2);
    }
  });

  it("rejects duplicate invocation ids inside one transaction", () => {
    const invocations: CommandInvocation[] = [
      invocation("slide.rename", { slideId: "slide-1", title: "A" }, fileScope, "dup"),
      invocation("slide.rename", { slideId: "slide-1", title: "B" }, fileScope, "dup"),
    ];
    const result = executeTransaction(PPT_TOOLKIT, envelope(), invocations);
    expect(result.ok).toBe(false);
  });
});

describe("toolkit registration", () => {
  it("registers through ToolKitRegistry and serves ppt projects", () => {
    const registry = new ToolKitRegistry([PPT_TOOLKIT]);
    const resolved = registry.get("ppt", "builtin.ppt");
    expect(resolved).toBe(PPT_TOOLKIT as never);
    expect(registry.getForProjectType("ppt").id).toBe("builtin.ppt");
  });

  it("every aiTool commandId points at a registered command", () => {
    const commandIds = new Set(PPT_TOOLKIT.commands.map((command) => command.id));
    for (const tool of PPT_TOOLKIT.aiTools) {
      for (const commandId of tool.commandIds) {
        expect(commandIds.has(commandId)).toBe(true);
      }
    }
  });

  it("createEmpty builds a parseable envelope with one title slide", () => {
    const created = PPT_TOOLKIT.document.createEmpty("我的演示");
    const parsed = PPT_TOOLKIT.document.parse(structuredClone(created));
    expect(parsed.document.slides).toHaveLength(1);
    expect(parsed.document.slides[0]!.objects.filter(isPlaceholder).map((object) => object.subtype)).toEqual(["title", "subtitle"]);
  });

  it("parse rejects envelopes from other toolkits and unknown themes stay untouched", () => {
    const created = PPT_TOOLKIT.document.createEmpty("我的演示");
    const tampered = { ...created, document: { ...created.document, name: "" } };
    expect(() => PPT_TOOLKIT.document.parse(tampered)).toThrow();
    const wrongToolkit = { ...created, toolkitId: "builtin.other" };
    expect(() => PPT_TOOLKIT.document.parse(wrongToolkit)).toThrow(/信封不匹配/);
  });
});
