import type { Block, WordDocument } from "@studio/word-toolkit";
import { emptyWordDocument } from "@studio/word-toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyWordAiCommands, manualInvocation, useWordEditorStore } from "./state";
import { useAiStore } from "../../state/aiStore";

/** Build a small legal document: one section with heading + paragraph + table. */
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

let onChangeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onChangeSpy = vi.fn();
  useWordEditorStore.getState().syncDocument(sampleDoc());
  useWordEditorStore.getState().setOnChange(onChangeSpy);
  useWordEditorStore.getState().selectBlock("p1");
});

describe("多块选择（多选）", () => {
  it("selectBlock 单选；toggleBlock 增删；selectSection 切到章节（container）", () => {
    const store = useWordEditorStore.getState();
    store.selectBlock("p1");
    expect(useWordEditorStore.getState().selection.blockIds).toEqual(["p1"]);
    useWordEditorStore.getState().toggleBlock("h1");
    expect(useWordEditorStore.getState().selection.blockIds).toEqual(["p1", "h1"]);
    expect(useWordEditorStore.getState().selection.blockId).toBe("p1");
    useWordEditorStore.getState().toggleBlock("p1");
    expect(useWordEditorStore.getState().selection.blockIds).toEqual(["h1"]);
    useWordEditorStore.getState().selectSection("section-1");
    expect(useWordEditorStore.getState().selection).toMatchObject({ sectionId: "section-1", blockId: null });
    expect(useWordEditorStore.getState().selection.blockIds).toEqual([]);
  });

  it("删除块后 keepSelection 过滤掉已删 id（多选不残留死 id）", () => {
    useWordEditorStore.getState().selectBlock("p1");
    useWordEditorStore.getState().toggleBlock("h1");
    useWordEditorStore.getState().runCommands([manualInvocation("word.block.remove", { blockId: "h1" })]);
    expect(useWordEditorStore.getState().selection.blockIds).toEqual(["p1"]);
  });
});

describe("WordEditorState store (P10.1)", () => {
  it("双击编辑提交事务：update-text 归一化为单 run 并回调 onDocumentChange", () => {
    const ok = useWordEditorStore.getState().runCommands([
      manualInvocation("word.block.update-text", { blockId: "p1", runs: [{ text: "改后的文本" }] }),
    ]);
    expect(ok).toBe(true);
    const doc = useWordEditorStore.getState().doc!;
    const para = doc.blocks.find((b) => b.id === "p1");
    expect(para).toMatchObject({ type: "paragraph", runs: [{ text: "改后的文本" }] });
    expect(onChangeSpy).toHaveBeenCalledWith(doc);
    expect(useWordEditorStore.getState().error).toBeNull();
  });

  it("锁定块的文本更新被拒：中文 error、文档不变、无回调", () => {
    useWordEditorStore.getState().runCommands([
      manualInvocation("word.block.update-text", { blockId: "p1", runs: [{ text: "先改一次以入历史" }] }),
    ]);
    const before = useWordEditorStore.getState().doc!;
    const lockedDoc: WordDocument = {
      ...before,
      blocks: before.blocks.map((b) => (b.id === "p1" ? { ...b, locked: true } : b)),
    };
    useWordEditorStore.getState().syncDocument(lockedDoc);

    const ok = useWordEditorStore.getState().runCommands([
      manualInvocation("word.block.update-text", { blockId: "p1", runs: [{ text: "不该生效" }] }),
    ]);
    expect(ok).toBe(false);
    expect(useWordEditorStore.getState().error).toMatch(/锁定/);
    expect(useWordEditorStore.getState().doc).toBe(lockedDoc);
  });

  it("undo 恢复上一版文档，redo 重做；历史深度有界", () => {
    const s = useWordEditorStore.getState();
    s.runCommands([manualInvocation("word.block.update-text", { blockId: "p1", runs: [{ text: "第一次" }] })]);
    const afterFirst = useWordEditorStore.getState().doc!;
    s.runCommands([manualInvocation("word.block.update-text", { blockId: "p1", runs: [{ text: "第二次" }] })]);
    const afterSecond = useWordEditorStore.getState().doc!;

    useWordEditorStore.getState().undo();
    expect(useWordEditorStore.getState().doc).toBe(afterFirst);
    useWordEditorStore.getState().redo();
    expect(useWordEditorStore.getState().doc).toBe(afterSecond);
    useWordEditorStore.getState().undo();
    expect(useWordEditorStore.getState().doc).toBe(afterFirst);
  });

  it("失败命令不进历史（undo 不会回到失败前的新状态）", () => {
    useWordEditorStore.getState().runCommands([
      manualInvocation("word.block.remove", { blockId: "不存在的块" }),
    ]);
    expect(useWordEditorStore.getState().error).toBeTruthy();
    expect(useWordEditorStore.getState().past.length).toBe(0);
  });

  it("选区在命令后指向仍存在的块；删除选中块后清空选区", () => {
    expect(useWordEditorStore.getState().selection.blockId).toBe("p1");
    useWordEditorStore.getState().runCommands([
      manualInvocation("word.block.remove", { blockId: "p1" }),
    ]);
    expect(useWordEditorStore.getState().selection.blockId).toBeNull();
  });
});
describe("P7.3 applyWordAiCommands（AI 命令本地重放）", () => {
  it("按 pendingPlan.scope 构造 ai-source invocation 并原子重放", async () => {
    useAiStore.setState({
      pendingPlan: {
        plan: "规划：改写正文。",
        commands: [],
        scope: { kind: "selection", targetIds: ["p1"] },
      },
    });
    const ok = await applyWordAiCommands([
      {
        invocationId: "inv-1",
        commandId: "word.block.update-text",
        title: "改写段落",
        riskLevel: "low",
        args: { blockId: "p1", runs: [{ text: "AI 改写后的正文" }] },
      },
    ]);
    expect(ok).toBe(true);
    const block = useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "p1");
    expect(block && "runs" in block ? block.runs[0]!.text : "").toBe("AI 改写后的正文");
    expect(onChangeSpy).toHaveBeenCalled();
  });

  it("pendingPlan 无 scope（计划已消费/未就绪）→ 拒绝重放", async () => {
    useAiStore.setState({ pendingPlan: null });
    const ok = await applyWordAiCommands([
      {
        invocationId: "inv-2",
        commandId: "word.block.update-text",
        title: "改写段落",
        riskLevel: "low",
        args: { blockId: "p1", runs: [{ text: "不应生效" }] },
      },
    ]);
    expect(ok).toBe(false);
    const block = useWordEditorStore.getState().doc!.blocks.find((b) => b.id === "p1");
    expect(block && "runs" in block ? block.runs[0]!.text : "").toBe("正文段落。");
  });
});
