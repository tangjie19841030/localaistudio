import { describe, expect, it } from "vitest";
import type { Block, WordDocument } from "../src/index.js";
import { WORD_INSPECTORS, runWordInspectors } from "../src/index.js";
import { baseDocument } from "./fixtures.js";

/**
 * P10.2 quality inspectors: heading level jumps, >3 consecutive empty
 * paragraphs, widow/orphan pagination hints (paginate model), and comment
 * refs to missing blocks. Issues must carry block/comment ids.
 */

function docWith(blocks: Block[], comments: WordDocument["comments"] = []): WordDocument {
  const base = baseDocument();
  return {
    ...base,
    sections: [{ id: "section-1", blockIds: blocks.map((block) => block.id) }],
    blocks,
    comments,
  };
}

function issueFor(inspectorId: string, doc: WordDocument) {
  return runWordInspectors(doc).filter((issue) => issue.inspectorId === inspectorId);
}

describe("word.qc.heading-jump 标题层级跳跃", () => {
  it("相邻标题跨级（1 -> 3）报告并定位后一个标题块", () => {
    const doc = docWith([
      { id: "h1", type: "heading", level: 1, runs: [{ text: "一级" }] },
      { id: "h3", type: "heading", level: 3, runs: [{ text: "三级" }] },
    ]);
    const issues = issueFor("word.qc.heading-jump", doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ inspectorId: "word.qc.heading-jump", blockId: "h3" });
  });

  it("逐级（1 -> 2 -> 3）与重新从 1 开始都不报告", () => {
    const doc = docWith([
      { id: "h1", type: "heading", level: 1, runs: [{ text: "一级" }] },
      { id: "h2", type: "heading", level: 2, runs: [{ text: "二级" }] },
      { id: "h1b", type: "heading", level: 1, runs: [{ text: "另一章" }] },
    ]);
    expect(issueFor("word.qc.heading-jump", doc)).toHaveLength(0);
  });

  it("正文段落夹在标题之间仍按标题顺序比较", () => {
    const doc = docWith([
      { id: "h1", type: "heading", level: 1, runs: [{ text: "一级" }] },
      { id: "p", type: "paragraph", runs: [{ text: "正文" }] },
      { id: "h2", type: "heading", level: 2, runs: [{ text: "二级" }] },
    ]);
    expect(issueFor("word.qc.heading-jump", doc)).toHaveLength(0);
  });
});

describe("word.qc.empty-paragraphs 连续空段落", () => {
  const blank = (id: string): Block => ({ id, type: "paragraph", runs: [{ text: "  " }] });

  it("连续 4 个空段落时在第 4 个上报告；3 个不报告", () => {
    const four = docWith([{ id: "e1", type: "paragraph", runs: [{ text: "x" }] }, blank("e2"), blank("e3"), blank("e4"), blank("e5")]);
    expect(issueFor("word.qc.empty-paragraphs", four).map((issue) => issue.blockId)).toEqual(["e5"]);
    const three = docWith([blank("a"), blank("b"), blank("c")]);
    expect(issueFor("word.qc.empty-paragraphs", three)).toHaveLength(0);
  });

  it("被非空段落打断后重新计数", () => {
    const doc = docWith([
      blank("a"),
      blank("b"),
      blank("c"),
      { id: "real", type: "paragraph", runs: [{ text: "正文" }] },
      blank("d"),
    ]);
    expect(issueFor("word.qc.empty-paragraphs", doc)).toHaveLength(0);
  });
});

describe("word.qc.widow-orphan 孤行检查", () => {
  it("复用 paginate：页末 keepWithNext 标题产生孤行问题并带块 id", () => {
    const base = baseDocument();
    // Tiny content height (240pt) + a 14-line paragraph (~200pt) force the
    // keepWithNext heading onto the estimated page bottom -> orphan. With the
    // per-character-class width estimate (CJK = full advance) 120 chars make
    // 14 lines; the paragraph must stay within one page so only the orphan
    // issue (no page-overflow issue) is reported.
    const longText = "很长的正文。".repeat(120);
    const doc: WordDocument = {
      ...base,
      sections: [{ id: "section-1", blockIds: ["heading-1", "para-1"] }],
      blocks: [
        { id: "heading-1", type: "heading", level: 1, runs: [{ text: "章标题" }] },
        { id: "para-1", type: "paragraph", runs: [{ text: longText }] },
      ],
      pageSettings: { width: 595.3, height: 260, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    };
    const issues = issueFor("word.qc.widow-orphan", doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.blockId === "heading-1")).toBe(true);
  });
});

describe("word.qc.comment-ref 批注引用检查", () => {
  it("指向不存在块的批注报告，定位 targetBlockId 与 commentId", () => {
    const doc = docWith([{ id: "p", type: "paragraph", runs: [{ text: "正文" }] }], [
      { id: "c1", author: "张三", text: "这里要改", targetBlockId: "ghost-block" },
      { id: "c2", author: "李四", text: "没问题", targetBlockId: "p" },
    ]);
    const issues = issueFor("word.qc.comment-ref", doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ blockId: "ghost-block", commentId: "c1" });
  });
});

describe("runWordInspectors 汇总", () => {
  it("干净基线文档零问题；WORD_INSPECTORS 覆盖 4 条规则", () => {
    expect(runWordInspectors(baseDocument())).toHaveLength(0);
    expect(WORD_INSPECTORS.map((inspector) => inspector.id)).toEqual([
      "word.qc.heading-jump",
      "word.qc.empty-paragraphs",
      "word.qc.widow-orphan",
      "word.qc.comment-ref",
    ]);
    expect(WORD_INSPECTORS.every((inspector) => inspector.title.length > 0)).toBe(true);
  });
});
