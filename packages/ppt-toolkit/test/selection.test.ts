import { describe, expect, it } from "vitest";
import { resolvePptSelection, validateSelection } from "../src/index.js";
import { sampleDocument } from "./fixtures.js";

describe("ppt selection", () => {
  it("resolves slide-level targets", () => {
    const resolved = resolvePptSelection(sampleDocument(), ["slide-1"]);
    expect(resolved.selection.level).toBe("slide");
    expect(resolved.selection.objectIds).toEqual([]);
    expect(resolved.slideIds).toEqual(["slide-1"]);
  });

  it("resolves object-level targets within one slide", () => {
    const resolved = resolvePptSelection(sampleDocument(), ["text-1", "shape-1"]);
    expect(resolved.selection.level).toBe("object");
    expect(resolved.selection.slideId).toBe("slide-1");
    expect(resolved.selection.objectIds).toEqual(["text-1", "shape-1"]);
  });

  it("reports unknown target ids as violations", () => {
    const issues = validateSelection(sampleDocument(), ["nope-1"]);
    expect(issues).toEqual(["选择目标不存在: nope-1"]);
  });

  it("reports mixed slide/object targets as violations", () => {
    const issues = validateSelection(sampleDocument(), ["slide-1", "text-1"]);
    expect(issues).toEqual(["选择目标混用了幻灯片与对象"]);
  });

  it("reports object selection spanning multiple slides", () => {
    const doc = sampleDocument();
    const second = { ...doc.slides[0]!, id: "slide-2", title: "第二页", objects: [{ ...(doc.slides[0]!.objects[0]!), id: "text-2" }] };
    const multi = { ...doc, slides: [...doc.slides, second] };
    const issues = validateSelection(multi, ["text-1", "text-2"]);
    expect(issues.length).toBeGreaterThan(0);
  });
});
