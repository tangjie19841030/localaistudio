import type { Block, WordDocument } from "@studio/word-toolkit";
import { emptyWordDocument, paginate } from "@studio/word-toolkit";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { flushSync } from "react-dom";
import { newProjectMeta, type ProjectMeta } from "@studio/schema-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentCanvas } from "./DocumentCanvas";
import { OutlinePanel } from "./OutlinePanel";
import { ReviewPanel } from "./ReviewPanel";
import { manualInvocation, useWordEditorStore } from "./state";
import { StylePanel } from "./StylePanel";
import { WordEditorPanel } from "./WordEditorPanel";

/** Build a small legal document: heading + paragraph + table in one section. */
function sampleDoc(): WordDocument {
  const base = emptyWordDocument("测试文档");
  const blocks: Block[] = [
    { id: "h1", type: "heading", level: 1, runs: [{ text: "章节标题" }] },
    { id: "p1", type: "paragraph", runs: [{ text: "正文段落。" }] },
    {
      id: "t1",
      type: "table",
      headerRowCount: 1,
      rows: [
        { cells: [{ runs: [{ text: "列一" }] }, { runs: [{ text: "列二" }] }] },
        { cells: [{ runs: [{ text: "甲" }] }, { runs: [{ text: "乙" }] }] },
      ],
    },
  ];
  return { ...base, blocks, sections: [{ id: "section-1", blockIds: ["h1", "p1", "t1"] }] };
}

const meta: ProjectMeta = newProjectMeta({ name: "测试文档", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" });

let onChange: ReturnType<typeof vi.fn>;

function freshDoc(): WordDocument {
  const doc = sampleDoc();
  useWordEditorStore.getState().syncDocument(doc);
  useWordEditorStore.getState().setOnChange(onChange);
  return doc;
}

beforeEach(() => {
  onChange = vi.fn();
});

function stubNarrowViewport(width = 360): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  vi.stubGlobal(
    "matchMedia",
    ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia,
  );
}

function stubResponsiveViewport(initial: "narrow" | "wide" = "narrow") {
  const state = { wide: initial === "wide", medium: initial === "wide" };
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    ((query: string) => ({
      matches: query === "(min-width: 1440px)" ? state.wide : state.medium,
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })) as unknown as typeof window.matchMedia,
  );
  return {
    setWide: async () => {
      state.wide = true;
      state.medium = true;
      await act(() => {
        flushSync(() => listeners.forEach((listener) => listener()));
      });
    },
    setNarrow: async () => {
      state.wide = false;
      state.medium = false;
      await act(() => {
        flushSync(() => listeners.forEach((listener) => listener()));
      });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OutlinePanel（P10.1）", () => {
  it("按 heading 层级缩进展示 sections 与 blocks；点击块选中", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<OutlinePanel doc={doc} onSelectBlock={(id) => useWordEditorStore.getState().selectBlock(id)} />);

    expect(screen.getByLabelText("文档大纲")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "大纲块 章节标题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "大纲块 正文段落。" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "大纲块 正文段落。" }));
    expect(useWordEditorStore.getState().selection.blockId).toBe("p1");
  });

  it("新增章节按钮走 word.section.insert 事务", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<OutlinePanel doc={doc} onSelectBlock={() => {}} />);
    await user.click(screen.getByRole("button", { name: "新增章节" }));
    expect(useWordEditorStore.getState().doc!.sections.length).toBe(2);
    expect(useWordEditorStore.getState().doc!.sections[1]?.heading).toBe("新章节");
    expect(onChange).toHaveBeenCalled();
  });

  it("章节标题双击改名走 word.section.rename 事务", async () => {
    const user = userEvent.setup();
    const doc = { ...freshDoc(), sections: [{ id: "section-1", heading: "旧标题", blockIds: ["h1", "p1", "t1"] }] };
    useWordEditorStore.getState().syncDocument(doc);
    render(<OutlinePanel doc={doc} onSelectBlock={() => {}} />);

    await user.dblClick(screen.getByRole("button", { name: "旧标题" }));
    const input = screen.getByLabelText("章节标题输入");
    await user.clear(input);
    await user.type(input, "新标题");
    await user.type(input, "{Enter}");
    expect(useWordEditorStore.getState().doc!.sections[0]?.heading).toBe("新标题");
  });

  it("章节重命名改回原标题后清理草稿，后续外部改名能同步", async () => {
    const user = userEvent.setup();
    const base = freshDoc();
    const doc = { ...base, sections: [{ id: "section-1", heading: "旧标题", blockIds: ["h1", "p1", "t1"] }] };
    useWordEditorStore.getState().syncDocument(doc);

    function ControlledOutline() {
      const currentDoc = useWordEditorStore((state) => state.doc) ?? doc;
      const [drafts, setDrafts] = useState<Record<string, string>>({});
      return (
        <OutlinePanel
          doc={currentDoc}
          onSelectBlock={() => {}}
          sectionNameDrafts={drafts}
          onSectionNameDraftChange={(sectionId, draft) => {
            setDrafts((current) => {
              if (draft === undefined) {
                const next = { ...current };
                delete next[sectionId];
                return next;
              }
              return { ...current, [sectionId]: draft };
            });
          }}
        />
      );
    }

    render(<ControlledOutline />);
    await user.dblClick(screen.getByRole("button", { name: "旧标题" }));
    const input = screen.getByLabelText("章节标题输入");
    await user.clear(input);
    await user.type(input, "暂存标题");
    await user.clear(input);
    await user.type(input, "旧标题");
    const historyBeforeNoop = useWordEditorStore.getState().past.length;
    await user.type(input, "{Enter}");
    expect(useWordEditorStore.getState().doc!.sections[0]?.heading).toBe("旧标题");
    expect(useWordEditorStore.getState().past.length).toBe(historyBeforeNoop);

    act(() => {
      useWordEditorStore.getState().runCommands([
        manualInvocation("word.section.rename", { sectionId: "section-1", heading: "AI 更新标题" }),
      ]);
    });
    await user.dblClick(screen.getByRole("button", { name: "AI 更新标题" }));
    expect(screen.getByLabelText("章节标题输入")).toHaveValue("AI 更新标题");
  });
});

describe("DocumentCanvas（P10.1）", () => {
  it("渲染 heading/paragraph/table 块与 A4 分页卡片", () => {
    const doc = freshDoc();
    render(<DocumentCanvas doc={doc} />);
    expect(screen.getByLabelText("文档画布")).toBeInTheDocument();
    expect(screen.getByText("章节标题")).toBeInTheDocument();
    expect(screen.getByText("正文段落。")).toBeInTheDocument();
    expect(screen.getByText("列一")).toBeInTheDocument();
    const pages = paginate(doc).pages;
    for (const page of pages) {
      expect(screen.getByLabelText(`第 ${page.index + 1} 页`)).toBeInTheDocument();
    }
  });

  it("移动端按真实 A4 宽度保留画布专属横向滚动范围", () => {
    stubNarrowViewport(320);
    const doc = freshDoc();
    render(<DocumentCanvas doc={doc} />);

    const canvas = screen.getByLabelText("文档画布");
    const content = canvas.firstElementChild as HTMLElement;
    const page = screen.getByLabelText("第 1 页");

    expect(canvas).toHaveClass("overflow-auto");
    expect(content).toHaveStyle({ minWidth: "595.3px" });
    expect(page).toHaveStyle({ width: "595.3px", minHeight: "841.9px" });

    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 272 });
    Object.defineProperty(canvas, "scrollWidth", { configurable: true, value: 643 });
    canvas.scrollLeft = canvas.scrollWidth - canvas.clientWidth;
    fireEvent.scroll(canvas);
    expect(canvas.scrollLeft).toBe(371);
  });

  it("双击段落进入编辑，失焦提交 block.update-text 事务（runs 归一化）", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<DocumentCanvas doc={doc} />);

    await user.click(screen.getByLabelText("文档块 p1")); // select
    await user.dblClick(screen.getByLabelText("文档块 p1")); // start editing
    const editor = screen.getByLabelText("编辑块文本 p1");
    await user.clear(editor);
    await user.type(editor, "改后的段落");
    await user.tab(); // blur → commit
    expect(onChange).toHaveBeenCalled();
    const para = useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "p1");
    expect(para).toMatchObject({ type: "paragraph", runs: [{ text: "改后的段落" }] });
  });

  it("双击列表进入编辑（每行一项，word.list.update）；双击表格进入编辑（Tab 分列）", async () => {
    const user = userEvent.setup();
    const base = sampleDoc();
    const list: Block = { id: "l1", type: "list", ordered: false, items: [{ runs: [{ text: "甲" }] }, { runs: [{ text: "乙" }] }] };
    base.blocks.push(list);
    base.sections[0]!.blockIds.push("l1");
    freshDoc();
    useWordEditorStore.getState().syncDocument(base);
    render(<DocumentCanvas doc={base} />);

    await user.dblClick(screen.getByLabelText("文档块 l1"));
    const listEditor = screen.getByLabelText("编辑列表 l1");
    await user.clear(listEditor);
    await user.type(listEditor, "新甲{enter}新乙{enter}新丙");
    await user.tab();
    const updatedList = useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "l1");
    expect(updatedList?.type === "list" && updatedList.items).toHaveLength(3);
    expect(updatedList?.type === "list" && updatedList.items[2]!.runs[0]!.text).toBe("新丙");

    await user.dblClick(screen.getByLabelText("文档块 t1"));
    const tableEditor = screen.getByLabelText("编辑表格 t1");
    fireEvent.change(tableEditor, { target: { value: "列一\t列二\n甲\t改乙" } });
    await user.tab();
    const table = useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "t1");
    expect(table?.type === "table" && table.rows[1]!.cells[1]!.runs[0]!.text).toBe("改乙");
  });

  it("悬浮工具条「复制块」与 Ctrl/⌘+D 走 word.block.duplicate", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<DocumentCanvas doc={doc} />);
    await user.click(screen.getByLabelText("文档块 p1"));
    await user.click(screen.getByRole("button", { name: "复制块" }));
    expect(useWordEditorStore.getState().doc!.blocks.filter((b) => b.type === "paragraph")).toHaveLength(2);

    useWordEditorStore.getState().selectBlock("h1");
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(useWordEditorStore.getState().doc!.blocks.filter((b) => b.type === "heading")).toHaveLength(2);
  });

  it("多选时样式面板显示批量操作；单选显示字符格式工具条（加粗/字色/字号）", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    useWordEditorStore.getState().selectBlock("p1");
    render(<StylePanel doc={doc} />);
    await user.click(screen.getByRole("button", { name: "加粗" }));
    const para = useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "p1");
    expect(para?.type === "paragraph" && para.runs[0]!.bold).toBe(true);

    act(() => useWordEditorStore.getState().toggleBlock("h1"));
    expect(screen.getByText(/已选 2 个块/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全部删除" }));
    expect(useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "p1")).toBeUndefined();
    expect(useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "h1")).toBeUndefined();
  });

  it("外部 block.update-text 后同步正在编辑的文本框", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    const { rerender } = render(<DocumentCanvas doc={doc} />);

    await user.dblClick(screen.getByLabelText("文档块 p1"));
    const updatedDoc: WordDocument = {
      ...doc,
      blocks: doc.blocks.map((block) => block.id === "p1" ? { ...block, runs: [{ text: "AI 更新后的段落" }] } : block),
    };
    rerender(<DocumentCanvas doc={updatedDoc} />);

    expect(screen.getByLabelText("编辑块文本 p1")).toHaveValue("AI 更新后的段落");
  });

  it("选中块显示浮动工具条，上移/下移走 block.move，删除走 block.remove", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<DocumentCanvas doc={doc} />);

    await user.click(screen.getByLabelText("文档块 p1"));
    const toolbar = screen.getByRole("toolbar", { name: "块工具条 p1" });
    expect(toolbar).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下移块" }));
    expect(useWordEditorStore.getState().doc!.sections[0]?.blockIds).toEqual(["h1", "t1", "p1"]);

    await user.click(screen.getByRole("button", { name: "上移块" }));
    expect(useWordEditorStore.getState().doc!.sections[0]?.blockIds).toEqual(["h1", "p1", "t1"]);

    await user.click(screen.getByRole("button", { name: "删除块" }));
    expect(useWordEditorStore.getState().doc!.blocks.some((b) => b.id === "p1")).toBe(false);
  });

  it("锁定块双击不进编辑、工具条显示已锁定", async () => {
    const user = userEvent.setup();
    const base = freshDoc();
    const locked: WordDocument = {
      ...base,
      blocks: base.blocks.map((b) => (b.id === "p1" ? { ...b, locked: true } : b)),
    };
    useWordEditorStore.getState().syncDocument(locked);
    render(<DocumentCanvas doc={locked} />);

    await user.click(screen.getByLabelText("文档块 p1"));
    expect(screen.getByText("已锁定")).toBeInTheDocument();
    await user.dblClick(screen.getByLabelText("文档块 p1"));
    expect(screen.queryByLabelText("编辑块文本 p1")).not.toBeInTheDocument();
  });
});

describe("StylePanel（P10.1）", () => {
  it("选中段落后切换 styleId 生效（block.set-style）", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    useWordEditorStore.getState().selectBlock("p1");
    render(<StylePanel doc={doc} />);

    await user.selectOptions(screen.getByLabelText("块样式选择"), "quote");
    const para = useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "p1");
    expect(para).toMatchObject({ type: "paragraph", styleId: "quote" });
    expect(screen.getByText("11pt")).toBeInTheDocument(); // resolved size summary
  });
});

describe("ReviewPanel（P10.1）", () => {
  it("对选中块添加批注并删除（word.comment.add / remove）", async () => {
    const user = userEvent.setup();
    freshDoc();
    useWordEditorStore.getState().selectBlock("p1");
    render(<ReviewPanel onLocateBlock={() => {}} />);

    await user.type(screen.getByLabelText("新批注内容"), "这里要改");
    await user.click(screen.getByRole("button", { name: "添加批注" }));
    const added = useWordEditorStore.getState().doc!.comments;
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ author: "我", text: "这里要改", targetBlockId: "p1" });
    expect(screen.getByLabelText("批注 这里要改")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `删除批注 ${added[0]!.id}` }));
    expect(useWordEditorStore.getState().doc!.comments).toHaveLength(0);
  });

  it("点击批注定位目标块（选中该块）", async () => {
    const user = userEvent.setup();
    freshDoc();
    useWordEditorStore.getState().selectBlock("p1");
    render(
      <ReviewPanel
        onLocateBlock={(id) => useWordEditorStore.getState().selectBlock(id)}
      />,
    );
    await user.type(screen.getByLabelText("新批注内容"), "定位我");
    await user.click(screen.getByRole("button", { name: "添加批注" }));

    act(() => {
      useWordEditorStore.getState().selectBlock("h1");
    });
    await user.click(screen.getByText("我 · 第 2 块"));
    expect(useWordEditorStore.getState().selection.blockId).toBe("p1");
  });
});

describe("WordEditorPanel（编排）", () => {
  it("窄屏章节重命名草稿在关闭与断点切宽后保留，显式提交仍走事务", async () => {
    const media = stubResponsiveViewport("narrow");
    const user = userEvent.setup();
    const base = freshDoc();
    const doc = {
      ...base,
      sections: base.sections.map((section) => ({ ...section, heading: "旧章节" })),
    };
    useWordEditorStore.getState().syncDocument(doc);
    render(<WordEditorPanel document={doc} meta={meta} onDocumentChange={onChange} />);

    const outlineToggle = screen.getByRole("button", { name: "切换文档大纲" });
    await user.click(outlineToggle);
    await user.dblClick(screen.getByRole("button", { name: "旧章节" }));
    const input = screen.getByLabelText("章节标题输入");
    await user.clear(input);
    await user.type(input, "Escape 后保留章节");
    await user.click(screen.getByRole("button", { name: "关闭文档大纲" }));

    expect(screen.queryByRole("dialog", { name: "文档大纲" })).toBeNull();

    await user.click(outlineToggle);
    await user.dblClick(screen.getByTitle("单击选中整个章节（AI 只改本章），双击重命名"));
    expect(screen.getByLabelText("章节标题输入")).toHaveValue("Escape 后保留章节");

    const reopenedInput = screen.getByLabelText("章节标题输入");
    await user.clear(reopenedInput);
    await user.type(reopenedInput, "切宽后保留章节");
    const historyBeforeBreakpoint = useWordEditorStore.getState().past.length;
    await media.setWide();

    await user.dblClick(screen.getByTitle("单击选中整个章节（AI 只改本章），双击重命名"));
    expect(screen.getByLabelText("章节标题输入")).toHaveValue("切宽后保留章节");
    expect(useWordEditorStore.getState().past.length).toBe(historyBeforeBreakpoint);
    await user.type(screen.getByLabelText("章节标题输入"), "{Enter}");
    await waitFor(() => expect(useWordEditorStore.getState().doc!.sections[0]!.heading).toBe("切宽后保留章节"));
    expect(screen.getByRole("complementary", { name: "文档大纲" })).toBeInTheDocument();
  });

  it("批注草稿在辅助栏关闭重开与窄宽往返后保留，提交清空且按项目隔离", async () => {
    const media = stubResponsiveViewport("narrow");
    const user = userEvent.setup();
    const docA = freshDoc();
    const metaA = { ...meta, id: "word-project-a" };
    const metaB = { ...meta, id: "word-project-b" };
    const { rerender } = render(<WordEditorPanel document={docA} meta={metaA} onDocumentChange={onChange} />);
    act(() => useWordEditorStore.getState().selectBlock("p1"));

    await user.click(screen.getByRole("button", { name: "切换辅助栏" }));
    await user.click(screen.getByRole("tab", { name: "批注" }));
    const draft = screen.getByLabelText("新批注内容");
    await user.type(draft, "项目 A 未提交批注");

    await user.click(screen.getByRole("button", { name: "切换辅助栏" }));
    await user.click(screen.getByRole("button", { name: "切换辅助栏" }));
    await user.click(screen.getByRole("tab", { name: "批注" }));
    expect(screen.getByLabelText("新批注内容")).toHaveValue("项目 A 未提交批注");

    await media.setWide();
    await waitFor(() => expect(screen.getByRole("complementary", { name: "辅助栏" })).toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "批注" }));
    await media.setNarrow();
    const auxToggleAfterNarrow = screen.getByRole("button", { name: "切换辅助栏" });
    expect(auxToggleAfterNarrow).toHaveAttribute("aria-expanded", "false");
    await user.click(auxToggleAfterNarrow);
    expect(auxToggleAfterNarrow).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "辅助栏" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "批注" }));
    expect(screen.getByLabelText("新批注内容")).toHaveValue("项目 A 未提交批注");

    rerender(<WordEditorPanel document={{ ...docA, name: "项目 B 文档" }} meta={metaB} onDocumentChange={onChange} />);
    await waitFor(() => expect(screen.getByLabelText("新批注内容")).toHaveValue(""));
    rerender(<WordEditorPanel document={docA} meta={metaA} onDocumentChange={onChange} />);
    act(() => useWordEditorStore.getState().selectBlock("p1"));
    await waitFor(() => expect(screen.getByLabelText("新批注内容")).toHaveValue("项目 A 未提交批注"));

    await user.click(screen.getByRole("button", { name: "添加批注" }));
    await waitFor(() => expect(screen.getByLabelText("新批注内容")).toHaveValue(""));
  });

  it("同一项目切换批注目标块时隔离草稿，提交只作用当前块", async () => {
    stubResponsiveViewport("narrow");
    const user = userEvent.setup();
    const doc = freshDoc();
    const metaA = { ...meta, id: "word-project-a" };
    render(<WordEditorPanel document={doc} meta={metaA} onDocumentChange={onChange} />);

    act(() => useWordEditorStore.getState().selectBlock("p1"));
    await user.click(screen.getByRole("button", { name: "切换辅助栏" }));
    await user.click(screen.getByRole("tab", { name: "批注" }));
    await user.type(screen.getByLabelText("新批注内容"), "A 块草稿");

    act(() => useWordEditorStore.getState().selectBlock("h1"));
    expect(screen.getByLabelText("新批注内容")).toHaveValue("");
    await user.type(screen.getByLabelText("新批注内容"), "B 块批注");
    await user.click(screen.getByRole("button", { name: "添加批注" }));

    expect(useWordEditorStore.getState().doc!.comments).toHaveLength(1);
    expect(useWordEditorStore.getState().doc!.comments[0]).toMatchObject({
      targetBlockId: "h1",
      text: "B 块批注",
    });

    act(() => useWordEditorStore.getState().selectBlock("p1"));
    expect(screen.getByLabelText("新批注内容")).toHaveValue("A 块草稿");
  });

  it.each([320, 360])("窄屏 %ipx 优先保留文档画布，大纲与辅助栏通过可关闭抽屉访问", async (width) => {
    stubNarrowViewport(width);
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<WordEditorPanel document={doc} meta={meta} onDocumentChange={onChange} />);

    expect(screen.getByLabelText("文档画布")).toBeInTheDocument();
    expect(screen.getByLabelText("文档画布")).toHaveClass("min-w-0");
    const delivery = screen.getByRole("contentinfo", { name: "交付操作" });
    expect(delivery).toHaveClass("min-w-0", "h-14", "max-w-full", "overflow-x-auto", "overflow-y-hidden");
    expect(delivery.firstElementChild).toHaveClass("h-full", "min-w-max", "flex-nowrap");
    expect(within(delivery).queryByRole("region", { name: "打印预览" })).toBeNull();
    expect(within(delivery).getByRole("button", { name: "打开打印预览" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "文档大纲" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "辅助栏" })).toBeNull();

    const outlineToggle = screen.getByRole("button", { name: "切换文档大纲" });
    const auxToggle = screen.getByRole("button", { name: "切换辅助栏" });
    expect(outlineToggle).toHaveAttribute("aria-expanded", "false");
    expect(auxToggle).toHaveAttribute("aria-expanded", "false");

    await user.click(outlineToggle);
    const outlineDrawer = screen.getByRole("dialog", { name: "文档大纲" });
    expect(outlineDrawer).toBeInTheDocument();
    const outlineContent = outlineDrawer.querySelector("[data-word-narrow-drawer-content]");
    expect(outlineContent).toHaveClass("min-h-0", "flex-1", "w-full", "overflow-y-auto");
    const embeddedOutline = within(outlineDrawer).getByRole("complementary", { name: "文档大纲" });
    expect(embeddedOutline).toHaveClass("min-h-0", "min-w-0", "flex-1", "w-full");
    expect(embeddedOutline).not.toHaveClass("h-full", "shrink-0", "w-56");
    expect(outlineToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(outlineToggle);
    expect(screen.queryByRole("dialog", { name: "文档大纲" })).toBeNull();

    await user.click(auxToggle);
    const auxDrawer = screen.getByRole("dialog", { name: "辅助栏" });
    expect(auxDrawer).toBeInTheDocument();
    const auxContent = auxDrawer.querySelector("[data-word-narrow-drawer-content]");
    expect(auxContent).toHaveClass("min-h-0", "flex-1", "w-full", "overflow-y-auto");
    const embeddedAux = within(auxDrawer).getByRole("complementary", { name: "辅助栏" });
    expect(embeddedAux).toHaveClass("min-h-0", "min-w-0", "flex-1", "w-full");
    expect(embeddedAux).not.toHaveClass("h-full", "shrink-0", "w-60");
    await user.click(auxToggle);
    expect(screen.queryByRole("dialog", { name: "辅助栏" })).toBeNull();

    const printPreviewTrigger = screen.getByRole("button", { name: "打开打印预览" });
    expect(within(delivery).queryByRole("region", { name: "打印预览" })).toBeNull();
    await user.click(printPreviewTrigger);
    const printPreviewDrawer = screen.getByRole("dialog", { name: "打印预览" });
    expect(within(printPreviewDrawer).getByRole("region", { name: "打印预览" })).toBeInTheDocument();
    expect(within(printPreviewDrawer).getByTestId("print-preview-pages")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭打印预览" }));
    expect(screen.queryByRole("dialog", { name: "打印预览" })).toBeNull();
  });

  it("桌面模式保留大纲与辅助栏的固定效率宽度", () => {
    const doc = freshDoc();
    render(<WordEditorPanel document={doc} meta={meta} onDocumentChange={onChange} />);

    expect(screen.getByRole("complementary", { name: "文档大纲" })).toHaveClass("h-full", "w-56", "shrink-0");
    expect(screen.getByRole("complementary", { name: "辅助栏" })).toHaveClass("h-full", "w-60", "shrink-0");
  });

  it("三区组合渲染 + 工具条生成目录（无占位块时插入并生成）", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<WordEditorPanel document={doc} meta={meta} onDocumentChange={onChange} />);

    expect(screen.getByLabelText("Word 编辑器")).toBeInTheDocument();
    expect(screen.getByLabelText("文档大纲")).toBeInTheDocument();
    expect(screen.getByLabelText("文档画布")).toBeInTheDocument();
    // 辅助栏默认样式页签：只渲染样式面板，批注面板需切页签
    expect(screen.getByLabelText("样式面板")).toBeInTheDocument();
    expect(screen.queryByLabelText("批注面板")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "批注" }));
    expect(screen.getByLabelText("批注面板")).toBeInTheDocument();
    expect(screen.queryByLabelText("样式面板")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "生成目录" }));
    const toc = useWordEditorStore.getState().doc!.blocks.find((b) => b.type === "tocPlaceholder");
    expect(toc).toMatchObject({ type: "tocPlaceholder", entries: [{ headingBlockId: "h1", level: 1, text: "章节标题" }] });
    expect(onChange).toHaveBeenCalled();
  });

  it("插入段落按钮走 block.insert 事务并出现在大纲", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<WordEditorPanel document={doc} meta={meta} onDocumentChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "插入段落" }));
    const next = useWordEditorStore.getState().doc!;
    const inserted = next.blocks.find((b) => b.type === "paragraph" && b.runs[0]?.text === "新段落");
    expect(inserted).toBeTruthy();
    expect(next.sections[0]?.blockIds).toContain(inserted!.id);
  });

  it("工具条撤销恢复上一版文档", async () => {
    const user = userEvent.setup();
    const doc = freshDoc();
    render(<WordEditorPanel document={doc} meta={meta} onDocumentChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "插入段落" }));
    expect(useWordEditorStore.getState().doc!.blocks.length).toBe(4);
    act(() => {
      useWordEditorStore.getState().undo();
    });
    expect(useWordEditorStore.getState().doc!.blocks.length).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
