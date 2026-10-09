import { beforeEach, describe, expect, it } from "vitest";
import type { PptDocument } from "@studio/ppt-toolkit";
import type { WordDocument } from "@studio/word-toolkit";
import { getToolkitSelection, resolveToolkitRequestScope } from "./registry";
import { usePptEditorStore } from "./ppt/state";
import { useWordEditorStore } from "./word/state";

/**
 * P7.3 toolkit 选择契约：ppt 对象选择 > 幻灯片选择 > 整个文件；
 * word 块选择 > （防御性）章节选择 > 整个文件。范围直接从两个
 * 编辑器 store 的 getState 读取。
 */

/** Minimal deck carrying the ids the staleness guard checks against. */
function deckWith(slides: { id: string; objects?: string[] }[]): PptDocument {
  return {
    documentVersion: 1,
    name: "测试",
    presentation: { title: null, author: null, subject: null },
    slideSize: { w: 1280, h: 720 },
    theme: { primary: "#000000", secondary: "#000000", accent: "#000000", background: "#FFFFFF", fontTitle: "x", fontBody: "y" },
    masters: [],
    layouts: [],
    slides: slides.map((s) => ({
      id: s.id,
      title: s.id,
      notes: "",
      objects: (s.objects ?? []).map((id) => ({
        id,
        kind: "shape" as const,
        shape: "rect" as const,
        rect: { x: 0, y: 0, w: 10, h: 10 },
      })),
    })),
  };
}

function wordDocWith(opts: { sections?: string[]; blocks?: string[] }): WordDocument {
  const blocks = opts.blocks ?? [];
  return {
    documentVersion: 1,
    name: "测试",
    sections: (opts.sections ?? []).map((id) => ({ id, title: id, blockIds: blocks })),
    blocks: blocks.map((id) => ({ id, type: "paragraph", runs: [] })),
  } as unknown as WordDocument;
}

beforeEach(() => {
  usePptEditorStore.setState({
    deck: deckWith([{ id: "slide-1", objects: ["o1", "o2", "obj-1"] }]),
    selectedSlideId: null,
    selectedObjectIds: [],
  });
  useWordEditorStore.setState({
    doc: wordDocWith({ sections: ["sec-1"], blocks: ["b1", "b2"] }),
    selection: { sectionId: null, blockId: null, blockIds: [] },
  });
});

describe("getToolkitSelection（P7.3 选择契约）", () => {
  it("ppt：多对象选中 → selection + 全部目标", () => {
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: ["o1", "o2"] });
    expect(getToolkitSelection("ppt")).toEqual({ kind: "selection", targetIds: ["o1", "o2"] });
  });

  it("ppt：仅幻灯片选中 → container；全无 → file", () => {
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: [] });
    expect(getToolkitSelection("ppt")).toEqual({ kind: "container", targetIds: ["slide-1"] });
    usePptEditorStore.setState({ selectedSlideId: null, selectedObjectIds: [] });
    expect(getToolkitSelection("ppt")).toEqual({ kind: "file", targetIds: [] });
  });

  it("ppt：选择指向已删除对象/页时回落，不把失效 id 发给服务端（live repro: cover-bg）", () => {
    // Object id no longer exists on the current slide → fall back to container.
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: ["cover-bg"] });
    expect(getToolkitSelection("ppt")).toEqual({ kind: "container", targetIds: ["slide-1"] });
    // Stale objects are dropped but alive ones stay.
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: ["o1", "ghost"] });
    expect(getToolkitSelection("ppt")).toEqual({ kind: "selection", targetIds: ["o1"] });
    // Selected slide itself is gone → first available slide.
    usePptEditorStore.setState({ deck: deckWith([{ id: "slide-9" }]), selectedSlideId: "slide-1", selectedObjectIds: ["o1"] });
    expect(getToolkitSelection("ppt")).toEqual({ kind: "container", targetIds: ["slide-9"] });
    // Explicit no-selection still means whole-file (not narrowed to slide 1).
    usePptEditorStore.setState({ selectedSlideId: null, selectedObjectIds: [] });
    expect(getToolkitSelection("ppt")).toEqual({ kind: "file", targetIds: [] });
  });

  it("word：块选中 → selection；章节态 → container；全无 → file；多块 → 多 target", () => {
    useWordEditorStore.setState({ selection: { sectionId: "sec-1", blockId: "b1", blockIds: ["b1"] } });
    expect(getToolkitSelection("word")).toEqual({ kind: "selection", targetIds: ["b1"] });
    useWordEditorStore.setState({ selection: { sectionId: "sec-1", blockId: "b1", blockIds: ["b1", "b2"] } });
    expect(getToolkitSelection("word")).toEqual({ kind: "selection", targetIds: ["b1", "b2"] });
    useWordEditorStore.setState({ selection: { sectionId: "sec-1", blockId: null, blockIds: [] } });
    expect(getToolkitSelection("word")).toEqual({ kind: "container", targetIds: ["sec-1"] });
    useWordEditorStore.setState({ selection: { sectionId: null, blockId: null, blockIds: [] } });
    expect(getToolkitSelection("word")).toEqual({ kind: "file", targetIds: [] });
  });

  it("word：块/章节已被删除时回落到 file", () => {
    useWordEditorStore.setState({ selection: { sectionId: "sec-1", blockId: "ghost-block", blockIds: ["ghost-block"] } });
    expect(getToolkitSelection("word")).toEqual({ kind: "container", targetIds: ["sec-1"] });
    useWordEditorStore.setState({ selection: { sectionId: "ghost-sec", blockId: null, blockIds: [] } });
    expect(getToolkitSelection("word")).toEqual({ kind: "file", targetIds: [] });
  });
});

/**
 * 真实模型复现（glm-5.3-flash）：PPT 始终默认选中一张幻灯片 → container 范围，
 * 整页生成请求里的 slide.add/新 id 在 scope 闸门整批回滚，最终"有输出无产物"。
 */
describe("resolveToolkitRequestScope（意图提升）", () => {
  const file = { kind: "file" as const, targetIds: [] };

  it("ppt 选中幻灯片 + 整页/新增页指令 → 提升为 file", () => {
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: [] });
    const deckPrompts = [
      "做一页关于季度营收的汇报封面，标题用「2026 Q3 营收汇报」",
      "做一个关于Q3营收复盘的PPT，大概5页",
      "新增一页团队介绍",
      "给PPT加一页目录",
      "生成5页产品介绍",
      "帮我写五页幻灯片介绍公司业务",
      "整套PPT换成深蓝色商务风，重新组织大纲",
    ];
    for (const text of deckPrompts) {
      expect(resolveToolkitRequestScope("ppt", text), text).toEqual(file);
    }
  });

  it("ppt 选中幻灯片 + 本页局部指令 → 保持 container", () => {
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: [] });
    const localPrompts = [
      "把这页标题改成 Q3 营收复盘",
      "压缩这一页，突出关键数字",
      "备注写：封面页，开场用",
      "删掉这页",
      "给这页换标题+内容版式",
    ];
    for (const text of localPrompts) {
      expect(resolveToolkitRequestScope("ppt", text), text).toEqual({
        kind: "container",
        targetIds: ["slide-1"],
      });
    }
  });

  it("ppt 显式选中对象 → 任何文案都保持 selection（显式局部手势优先）", () => {
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: ["obj-1"] });
    expect(resolveToolkitRequestScope("ppt", "重新生成整个PPT，做10页")).toEqual({
      kind: "selection",
      targetIds: ["obj-1"],
    });
  });

  it("ppt 无选中 → 始终 file", () => {
    usePptEditorStore.setState({ selectedSlideId: null, selectedObjectIds: [] });
    expect(resolveToolkitRequestScope("ppt", "把标题改短一点")).toEqual(file);
  });

  it("word：章节选中 + 结构级指令提升 file；局部指令保持 container", () => {
    useWordEditorStore.setState({ selection: { sectionId: "sec-1", blockId: null, blockIds: [] } });
    expect(resolveToolkitRequestScope("word", "在后面新增一个章节讲风险与对策")).toEqual(file);
    expect(resolveToolkitRequestScope("word", "写一份季度工作总结，分三个部分")).toEqual(file);
    expect(resolveToolkitRequestScope("word", "把本节标题改短一点")).toEqual({
      kind: "container",
      targetIds: ["sec-1"],
    });
  });

  it("word：块选中不提升；无选中始终 file", () => {
    useWordEditorStore.setState({ selection: { sectionId: "sec-1", blockId: "b1", blockIds: ["b1"] } });
    expect(resolveToolkitRequestScope("word", "新增章节：风险")).toEqual({
      kind: "selection",
      targetIds: ["b1"],
    });
    useWordEditorStore.setState({ selection: { sectionId: null, blockId: null, blockIds: [] } });
    expect(resolveToolkitRequestScope("word", "随便写点什么")).toEqual(file);
  });
});
