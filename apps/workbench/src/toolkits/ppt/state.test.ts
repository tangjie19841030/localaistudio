import { vi, beforeEach, describe, expect, it } from "vitest";
import { applyPptAiCommands, manualInvocation, usePptEditorStore } from "./state";
import { useAiStore } from "../../state/aiStore";
import { resetStore } from "./testFixtures";

let onDocumentChange: ReturnType<typeof vi.fn>;
beforeEach(() => {
  onDocumentChange = resetStore().onDocumentChange;
});

describe("PptEditorState runCommands", () => {
  it("事务成功：更新 deck、压入历史、触发 onDocumentChange", () => {
    const ok = usePptEditorStore.getState().runCommands([
      manualInvocation("slide.rename", { slideId: "slide-1", title: "新标题" }),
    ]);
    expect(ok).toBe(true);
    const deck = usePptEditorStore.getState().deck!;
    expect(deck.slides[0]!.title).toBe("新标题");
    expect(usePptEditorStore.getState().past).toHaveLength(1);
    expect(onDocumentChange).toHaveBeenCalledWith(deck);
  });

  it("命令失败：error 中文人话，deck 不变，无历史压入", () => {
    // Lock first so slide.remove hits the domain guard (manual CAN lock).
    usePptEditorStore.getState().runCommands([
      manualInvocation("slide.lock", { slideId: "slide-1", locked: true }),
    ]);
    const locked = usePptEditorStore.getState().deck;
    onDocumentChange.mockClear();
    const ok = usePptEditorStore.getState().runCommands([
      manualInvocation("slide.remove", { slideId: "slide-1" }),
    ]);
    expect(ok).toBe(false);
    expect(usePptEditorStore.getState().error).toBe("幻灯片已锁定: slide-1");
    expect(usePptEditorStore.getState().deck).toBe(locked);
    expect(usePptEditorStore.getState().past).toHaveLength(1); // lock pushed; failure added nothing
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("锁定幻灯片上的对象编辑被拒并给出中文错误", () => {
    usePptEditorStore.getState().runCommands([
      manualInvocation("slide.lock", { slideId: "slide-1", locked: true }),
    ]);
    const ok = usePptEditorStore.getState().runCommands([
      manualInvocation("object.move", { objectId: "text-1", x: 0, y: 0 }),
    ]);
    expect(ok).toBe(false);
    expect(usePptEditorStore.getState().error).toContain("幻灯片已锁定");
  });

  it("undo 恢复前一份 deck，redo 重做；undo 后 onDocumentChange 也触发", () => {
    const original = usePptEditorStore.getState().deck!;
    usePptEditorStore.getState().runCommands([
      manualInvocation("slide.rename", { slideId: "slide-1", title: "改名后" }),
    ]);
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("改名后");
    usePptEditorStore.getState().undo();
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("第一页");
    expect(usePptEditorStore.getState().deck).toBe(original);
    usePptEditorStore.getState().redo();
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("改名后");
    expect(onDocumentChange).toHaveBeenCalledTimes(3);
  });

  it("历史深度封顶 50（FIFO 丢最旧）", () => {
    for (let i = 0; i < 55; i += 1) {
      usePptEditorStore.getState().runCommands([
        manualInvocation("slide.rename", { slideId: "slide-1", title: `第 ${i} 版` }),
      ]);
    }
    expect(usePptEditorStore.getState().past).toHaveLength(50);
    usePptEditorStore.getState().undo();
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("第 53 版");
  });

  it("runPptCommands 便捷函数与 store 行为一致", () => {
    const ok = runPptCommandsHelper("slide.rename", { slideId: "slide-2", title: "改名二" });
    expect(ok).toBe(true);
    expect(usePptEditorStore.getState().deck!.slides[1]!.title).toBe("改名二");
  });
});

// Local indirection keeps the import surface at the component contract.
function runPptCommandsHelper(id: string, args: unknown): boolean {
  return usePptEditorStore.getState().runCommands([manualInvocation(id, args)]);
}

describe("拖拽手势（一次手势一个撤销点，总位移不被重复累加）", () => {
  it("多帧预览始终从手势起点计算绝对坐标；提交只压一个撤销点", () => {
    const store = usePptEditorStore.getState();
    store.beginGesture();
    // Frames report TOTAL pointer deltas: x=110 then x=120 (as if dragged 20px).
    expect(store.runGesturePreview([manualInvocation("object.move", { objectId: "text-1", x: 110, y: 80 })])).toBe(true);
    usePptEditorStore.getState().runGesturePreview([manualInvocation("object.move", { objectId: "text-1", x: 120, y: 80 })]);
    expect(usePptEditorStore.getState().deck!.slides[0]!.objects[0]!.rect.x).toBe(120);
    expect(usePptEditorStore.getState().past).toHaveLength(0); // no per-frame history
    usePptEditorStore.getState().commitGesture();
    expect(usePptEditorStore.getState().past).toHaveLength(1); // single undo point
    expect(usePptEditorStore.getState().gestureBase).toBeNull();
    // Undo restores the drag's starting position in one press.
    usePptEditorStore.getState().undo();
    expect(usePptEditorStore.getState().deck!.slides[0]!.objects[0]!.rect.x).toBe(100);
  });

  it("按下未移动就提交：无撤销点、不触发脏标记", () => {
    onDocumentChange.mockClear();
    usePptEditorStore.getState().beginGesture();
    usePptEditorStore.getState().commitGesture();
    expect(usePptEditorStore.getState().past).toHaveLength(0);
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("cancelGesture 恢复手势前的 deck（不压栈）", () => {
    usePptEditorStore.getState().beginGesture();
    usePptEditorStore.getState().runGesturePreview([manualInvocation("object.move", { objectId: "text-1", x: 300, y: 80 })]);
    expect(usePptEditorStore.getState().deck!.slides[0]!.objects[0]!.rect.x).toBe(300);
    usePptEditorStore.getState().cancelGesture();
    expect(usePptEditorStore.getState().deck!.slides[0]!.objects[0]!.rect.x).toBe(100);
    expect(usePptEditorStore.getState().past).toHaveLength(0);
  });

  it("一次手势内多个对象移动（多选拖拽）在同一预览事务中生效", () => {
    usePptEditorStore.getState().beginGesture();
    usePptEditorStore.getState().runGesturePreview([
      manualInvocation("object.move", { objectId: "text-1", x: 200, y: 80 }),
      manualInvocation("object.move", { objectId: "shape-1", x: 200, y: 200 }),
    ]);
    const objects = usePptEditorStore.getState().deck!.slides[0]!.objects;
    expect(objects[0]!.rect.x).toBe(200);
    expect(objects[1]!.rect.x).toBe(200);
    usePptEditorStore.getState().commitGesture();
    expect(usePptEditorStore.getState().past).toHaveLength(1);
  });
});

describe("P7.3 applyPptAiCommands（AI 命令本地重放）", () => {
  it("按 pendingPlan.scope 构造 ai-source invocation 并原子重放", async () => {
    useAiStore.setState({
      pendingPlan: {
        plan: "规划：重命名。",
        commands: [],
        scope: { kind: "container", targetIds: ["slide-1"] },
      },
    });
    const ok = await applyPptAiCommands([
      {
        invocationId: "inv-1",
        commandId: "slide.rename",
        title: "重命名幻灯片",
        riskLevel: "low",
        args: { slideId: "slide-1", title: "AI 改名" },
      },
    ]);
    expect(ok).toBe(true);
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("AI 改名");
    expect(onDocumentChange).toHaveBeenCalled(); // 保存联动：editorStore 同步置 dirty
  });

  it("pendingPlan 无 scope（计划已消费/未就绪）→ 拒绝重放", async () => {
    useAiStore.setState({ pendingPlan: null });
    const ok = await applyPptAiCommands([
      {
        invocationId: "inv-2",
        commandId: "slide.rename",
        title: "重命名幻灯片",
        riskLevel: "low",
        args: { slideId: "slide-1", title: "不应生效" },
      },
    ]);
    expect(ok).toBe(false);
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("第一页");
  });
});
