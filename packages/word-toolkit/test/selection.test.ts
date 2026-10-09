import { describe, expect, it } from "vitest";
import { baseDocument } from "./fixtures.js";
import {
  assertTextRange,
  resolveWordSelection,
  validateSelection,
  validateTextRange,
  WordSelectionError,
} from "../src/index.js";

const doc = baseDocument();

describe("word selection", () => {
  it("resolves a file scope to all sections", () => {
    const resolved = resolveWordSelection(doc, { kind: "file", targetIds: [] });
    expect(resolved.kind).toBe("file");
    expect(resolved.sectionIds).toEqual(["section-1", "section-2"]);
  });

  it("resolves a container scope to section ids", () => {
    const resolved = resolveWordSelection(doc, { kind: "container", targetIds: ["section-1"] });
    expect(resolved.sectionIds).toEqual(["section-1"]);
  });

  it("resolves a selection scope to block ids and rejects missing blocks", () => {
    const resolved = resolveWordSelection(doc, { kind: "selection", targetIds: ["para-1"] });
    expect(resolved.blockIds).toEqual(["para-1"]);
    expect(() =>
      resolveWordSelection(doc, { kind: "selection", targetIds: ["ghost"] }),
    ).toThrow(WordSelectionError);
  });

  it("resolves a range scope to its block", () => {
    const resolved = resolveWordSelection(doc, {
      kind: "range",
      targetIds: ["para-2"],
      range: { containerId: "para-2", start: 0, end: 2 },
    });
    expect(resolved.range).toEqual({ containerId: "para-2", start: 0, end: 2 });
  });

  it("accepts an in-bounds, ordered text range", () => {
    const issues = validateTextRange(doc, { containerId: "para-2", start: 0, end: 2 });
    expect(issues).toEqual([]);
    expect(() => assertTextRange(doc, { containerId: "para-2", start: 0, end: 2 })).not.toThrow();
  });

  it("rejects a reversed range", () => {
    const issues = validateTextRange(doc, { containerId: "para-2", start: 2, end: 1 });
    expect(issues.length).toBeGreaterThan(0);
    expect(() => assertTextRange(doc, { containerId: "para-2", start: 2, end: 1 })).toThrow(/文本范围无效/);
  });

  it("rejects an out-of-bounds end index", () => {
    const issues = validateTextRange(doc, { containerId: "para-2", start: 0, end: 99 });
    expect(issues.some((line) => line.includes("越界"))).toBe(true);
    expect(() => assertTextRange(doc, { containerId: "para-2", start: 0, end: 99 })).toThrow(/越界/);
  });

  it("rejects a range over a block without runs", () => {
    const issues = validateTextRange(doc, { containerId: "table-1", start: 0, end: 1 });
    expect(issues.some((line) => line.includes("不包含可编辑文本"))).toBe(true);
  });

  it("reports locked blocks in validateSelection", () => {
    const locked = baseDocument();
    (locked.blocks[1] as { locked?: boolean }).locked = true;
    const issues = validateSelection(locked, { kind: "selection", targetIds: ["para-1"] });
    expect(issues.some((line) => line.includes("已锁定"))).toBe(true);
    const clean = validateSelection(locked, { kind: "selection", targetIds: ["para-2"] });
    expect(clean).toEqual([]);
  });

  it("flags a locked block inside a container-scope selection", () => {
    const locked = baseDocument();
    (locked.blocks[1] as { locked?: boolean }).locked = true;
    const issues = validateSelection(locked, { kind: "container", targetIds: ["section-1"] });
    expect(issues.some((line) => line.includes('章节 "section-1"') && line.includes("para-1"))).toBe(true);
  });
});
