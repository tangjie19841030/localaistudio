import type { Block, WordDocument } from "@studio/word-toolkit";
import { defaultStyleSet, emptyWordDocument } from "@studio/word-toolkit";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { BlockView } from "./BlockRenderer";
import { PrintPreview } from "./PrintPreview";
import { useWordEditorStore } from "./state";

const LONG_URL = "https://example.com/very/long/path?query=abcdefghijklmnopqrstuvwxyz0123456789&more=tail";

/** Doc with every body-text shape: newline paragraph, list, table, TOC, image. */
function renderDoc(): WordDocument {
  const base = emptyWordDocument("渲染测试");
  const blocks: Block[] = [
    { id: "p1", type: "paragraph", runs: [{ text: `第一行\n第二行 ${LONG_URL} 结束` }] },
    { id: "l1", type: "list", ordered: false, items: [{ runs: [{ text: LONG_URL }] }] },
    {
      id: "t1",
      type: "table",
      headerRowCount: 1,
      rows: [
        { cells: [{ runs: [{ text: "列头" }] }, { runs: [{ text: "链接" }] }] },
        { cells: [{ runs: [{ text: "甲" }] }, { runs: [{ text: LONG_URL }] }] },
      ],
    },
    {
      id: "toc-1",
      type: "tocPlaceholder",
      entries: [{ headingBlockId: "h-x", level: 1, text: `目录项 ${LONG_URL}` }],
    },
    { id: "img-1", type: "image", src: LONG_URL, width: 200 },
  ];
  return { ...base, blocks, sections: [{ id: "section-1", blockIds: blocks.map((block) => block.id) }] };
}

beforeEach(() => {
  useWordEditorStore.getState().syncDocument(renderDoc());
});

describe("BlockRenderer 换行与长 URL 安全渲染", () => {
  it("段落容器使用 pre-wrap/overflow-wrap，不出现 nowrap/截断样式", () => {
    const { container } = render(<BlockView block={useWordEditorStore.getState().doc!.blocks[0]!} styles={defaultStyleSet()} />);
    const paragraph = container.querySelector("p")!;
    expect(paragraph.getAttribute("style")).toContain("white-space: pre-wrap");
    expect(paragraph.getAttribute("style")).toContain("overflow-wrap");
    expect(paragraph.getAttribute("style")).not.toContain("nowrap");
    expect(paragraph.getAttribute("style")).not.toContain("text-overflow");
  });

  it("正文中的显式换行与长 URL 全文保留，不被省略", () => {
    const { container } = render(<BlockView block={useWordEditorStore.getState().doc!.blocks[0]!} styles={defaultStyleSet()} />);
    expect(container.textContent).toContain("第一行\n第二行");
    expect(container.textContent).toContain(LONG_URL);
    expect(container.textContent?.endsWith("结束")).toBe(true);
  });
});

describe("PrintPreview 正文不截断", () => {
  it("预览内不使用 truncate，正文元素带 whitespace-pre-wrap break-words", () => {
    render(<PrintPreview />);
    const preview = screen.getByTestId("print-preview-pages");
    expect(preview.querySelectorAll(".truncate")).toHaveLength(0);
    const wrapped = preview.querySelectorAll(".whitespace-pre-wrap.break-words");
    // paragraph + list item + 2 table cells (header+body) + toc entry + image caption line
    expect(wrapped.length).toBeGreaterThanOrEqual(6);
  });

  it("长 URL 与换行在预览中全文渲染", () => {
    render(<PrintPreview />);
    const preview = screen.getByTestId("print-preview-pages");
    expect(preview.textContent).toContain(LONG_URL);
    expect(preview.textContent).toContain("第一行\n第二行");
  });
});
