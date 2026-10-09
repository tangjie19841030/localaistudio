import type { CommandInvocation, DocumentEnvelope, SelectionScope } from "@studio/studio-core";
import type { Block, WordDocument } from "../src/index.js";
import { defaultStyleSet, defaultPageSettings, WORD_TOOLKIT, createWordDocumentEnvelope } from "../src/index.js";

/** Valid base document: title + one paragraph in section-1, empty section-2. */
export function baseDocument(): WordDocument {
  const blocks: Block[] = [
    { id: "heading-1", type: "heading", level: 1, runs: [{ text: "项目概述" }] },
    { id: "para-1", type: "paragraph", runs: [{ text: "这是第一段正文，用来验证命令与分页。" }], styleId: "normal" },
    { id: "para-2", type: "paragraph", runs: [{ text: "第二段正文。" }, { text: "带粗体", bold: true }] },
    {
      id: "table-1",
      type: "table",
      headerRowCount: 1,
      rows: [
        { cells: [{ runs: [{ text: "名称" }] }, { runs: [{ text: "数值" }] }] },
        { cells: [{ runs: [{ text: "条目一" }] }, { runs: [{ text: "10" }] }] },
      ],
    },
    { id: "toc-1", type: "tocPlaceholder" },
  ];
  return {
    documentVersion: 1,
    name: "测试文档",
    sections: [
      { id: "section-1", blockIds: ["heading-1", "para-1", "para-2", "table-1", "toc-1"] },
      { id: "section-2", blockIds: [] },
    ],
    blocks,
    styles: defaultStyleSet(),
    pageSettings: defaultPageSettings(),
    footnotes: [],
    comments: [],
  };
}

export function wordEnvelope(document: WordDocument = baseDocument()): DocumentEnvelope<WordDocument> {
  return createWordDocumentEnvelope(document);
}

export const fileScope: SelectionScope = { kind: "file", targetIds: [] };
export const sectionScope: SelectionScope = { kind: "container", targetIds: ["section-1"] };
export const blockScope = (blockId: string): SelectionScope => ({ kind: "selection", targetIds: [blockId] });
export const rangeScope = (blockId: string, start: number, end: number): SelectionScope => ({
  kind: "range",
  targetIds: [blockId],
  range: { containerId: blockId, start, end },
});

let counter = 0;
export function invocation(overrides: Partial<CommandInvocation> = {}): CommandInvocation {
  counter += 1;
  return {
    invocationId: `inv-${counter}`,
    id: "word.doc.rename",
    args: { name: "改名后" },
    source: "manual",
    scope: fileScope,
    ...overrides,
  };
}

export { WORD_TOOLKIT };
