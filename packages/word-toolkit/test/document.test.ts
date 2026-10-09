import { describe, expect, it } from "vitest";
import { baseDocument } from "./fixtures.js";
import {
  checkWordDocument,
  defaultPageSettings,
  defaultStyleSet,
  emptyWordDocument,
  validateWordDocument,
  WORD_DOCUMENT_VERSION,
} from "../src/index.js";

describe("word document schema", () => {
  it("accepts a valid document", () => {
    const doc = validateWordDocument(baseDocument());
    expect(checkWordDocument(doc)).toEqual([]);
  });

  it("accepts the empty document factory output", () => {
    const doc = validateWordDocument(emptyWordDocument("新文档"));
    expect(doc.name).toBe("新文档");
    expect(checkWordDocument(doc)).toEqual([]);
  });

  it("rejects duplicate block ids", () => {
    const doc = baseDocument();
    doc.blocks = [...doc.blocks, { ...doc.blocks[0]!, locked: undefined }];
    const parsed = validateWordDocument(doc);
    const issues = checkWordDocument(parsed);
    expect(issues.some((line) => line.includes("重复的块 ID"))).toBe(true);
  });

  it("rejects a section referencing a missing block", () => {
    const doc = baseDocument();
    doc.sections[0]!.blockIds = [...doc.sections[0]!.blockIds, "ghost-block"];
    const parsed = validateWordDocument(doc);
    const issues = checkWordDocument(parsed);
    expect(issues.some((line) => line.includes("引用了不存在的块") && line.includes("ghost-block"))).toBe(true);
  });

  it("rejects a block owned by no section", () => {
    const doc = baseDocument();
    doc.blocks.push({ id: "orphan-block", type: "paragraph", runs: [{ text: "孤儿" }] });
    const parsed = validateWordDocument(doc);
    expect(checkWordDocument(parsed).some((line) => line.includes("未被任何章节引用"))).toBe(true);
  });

  it("rejects ragged table rows at schema level", () => {
    const doc = baseDocument();
    const ragged = baseDocument();
    (ragged.blocks[3] as { rows: unknown[] }).rows = [
      { cells: [{ runs: [{ text: "A" }] }] },
      { cells: [{ runs: [{ text: "B" }] }, { runs: [{ text: "C" }] }] },
    ];
    expect(() => validateWordDocument(ragged)).toThrow(/单元格数量必须一致/);
    void doc;
  });

  it("rejects footnote refs pointing at missing footnotes", () => {
    const doc = baseDocument();
    (doc.blocks[1] as { runs: { text: string; footnoteRef?: string }[] }).runs = [
      { text: "带脚注", footnoteRef: "fn-missing" },
    ];
    const parsed = validateWordDocument(doc);
    expect(checkWordDocument(parsed).some((line) => line.includes("脚注") && line.includes("fn-missing"))).toBe(true);
  });

  it("defaults page settings to A4 portrait", () => {
    const settings = defaultPageSettings();
    expect(settings.width).toBeCloseTo(595.3, 1);
    expect(settings.height).toBeCloseTo(841.9, 1);
  });

  it("keeps style defaults aligned with the A4/pt unit choice", () => {
    const styles = defaultStyleSet();
    expect(styles.normal.size).toBeDefined();
    expect(styles.heading1?.size!).toBeGreaterThan(styles.normal.size!);
  });

  it("pins the document version literal", () => {
    expect(WORD_DOCUMENT_VERSION).toBe(1);
  });
});
