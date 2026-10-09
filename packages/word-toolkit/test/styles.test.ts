import { describe, expect, it } from "vitest";
import { baseDocument } from "./fixtures.js";
import { deriveResolvedBlockStyle, deriveResolvedRunStyle, defaultStyleSet } from "../src/index.js";

const doc = baseDocument();

describe("word style inheritance", () => {
  it("falls back to normal for a plain paragraph", () => {
    const block = doc.blocks[1]!;
    const resolved = deriveResolvedBlockStyle(doc.styles, block);
    expect(resolved.size).toBe(doc.styles.normal.size);
    expect(resolved.spaceAfter).toBe(doc.styles.normal.spaceAfter);
  });

  it("resolves heading levels to their own styles", () => {
    const heading1 = doc.blocks[0]!;
    const resolved = deriveResolvedBlockStyle(doc.styles, heading1);
    expect(resolved.size).toBe(doc.styles.heading1!.size);
    expect(resolved.bold).toBe(true);
    expect(resolved.keepWithNext).toBe(true);
  });

  it("gives declared styleId priority over the implicit normal", () => {
    const quote = { type: "paragraph" as const, id: "p-quote", runs: [{ text: "引用一句" }], styleId: "quote" };
    const resolved = deriveResolvedBlockStyle(doc.styles, quote);
    expect(resolved.italic).toBe(doc.styles.quote!.italic);
    expect(resolved.indent).toBe(doc.styles.quote!.indent);
  });

  it("lets run direct formatting win over paragraph and run styles", () => {
    const block = {
      type: "paragraph" as const,
      id: "p-run",
      runs: [{ text: "直接", bold: true, styleId: "caption" }],
      styleId: "heading2",
    };
    const run = deriveResolvedRunStyle(doc.styles, block, block.runs[0]!);
    // bold: run direct > caption (unspecified -> undefined) > heading2 (true)
    expect(run.bold).toBe(true);
    // size: caption run style > heading2 block style > normal
    expect(run.size).toBe(doc.styles.caption!.size);
  });

  it("resolves unstyled runs through the block style", () => {
    const block = doc.blocks[2]!;
    if (block.type !== "paragraph") throw new Error("fixture mismatch");
    const resolved = deriveResolvedRunStyle(doc.styles, block, block.runs[1]!);
    expect(resolved.bold).toBe(true);
  });

  it("treats unknown styleIds as normal instead of throwing", () => {
    const block = { type: "paragraph" as const, id: "p-x", runs: [{ text: "旧文档", styleId: "legacy-style" }] };
    const resolved = deriveResolvedRunStyle(doc.styles, block, block.runs[0]!);
    expect(resolved.size).toBe(doc.styles.normal.size);
  });

  it("keeps normal as the only required style entry", () => {
    const minimal = defaultStyleSet();
    delete minimal.heading3;
    const block = { type: "heading" as const, id: "h-x", level: 3 as const, runs: [{ text: "三级" }] };
    const resolved = deriveResolvedBlockStyle(minimal, block);
    expect(resolved.size).toBe(minimal.normal.size);
    expect(resolved.bold).toBe(false);
  });
});
