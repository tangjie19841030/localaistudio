import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TOKEN_PRESETS, defaultStudioDocument, newProjectMeta, presetById, type StudioDocument } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenEditor } from "./TokenEditor";
import { TokenPresetPicker, applyPresetTokens, tokenPathEntries } from "./TokenPresetPicker";
import { useEditorStore } from "../../state/editorStore";
import { emptyStack } from "../../state/undoStack";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

vi.mock("../../api/client", () => ({
  api: { getProject: vi.fn(), saveProject: vi.fn() },
}));

const DOC: StudioDocument = defaultDoc("测试页");
const TEAL = presetById("teal")!;

function seedStore(doc: StudioDocument = DOC): void {
  useEditorStore.setState({
    projectId: "p1",
    meta: newProjectMeta({ name: "p", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
    document: doc,
    dirty: false,
    saving: false,
    error: null,
    selectedId: null,
    viewport: "desktop",
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,


  });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TokenPresetPicker", () => {
  it("列出全部预设名并带占位项（挂载时不应用任何预设）", () => {
    const onApply = vi.fn();
    render(<TokenPresetPicker onApply={onApply} />);
    const select = screen.getByLabelText("Token 预设") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "选择预设…" })).toBeInTheDocument();
    for (const p of TOKEN_PRESETS) {
      expect(screen.getByRole("option", { name: p.name })).toBeInTheDocument();
    }
    expect(onApply).not.toHaveBeenCalled();
  });

  it("选中预设回调其完整 tokens，且下拉回到占位项", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<TokenPresetPicker onApply={onApply} />);
    const select = screen.getByLabelText("Token 预设") as HTMLSelectElement;
    await user.selectOptions(select, "teal");
    expect(onApply).toHaveBeenCalledWith(TEAL.tokens);
    expect(select.value).toBe(""); // 动作而非持久状态
  });
});

describe("applyPresetTokens / tokenPathEntries（纯函数）", () => {
  it("覆盖全部 token 路径（9 色 + 2 圆角 + 间距 + 字体）", () => {
    const entries = tokenPathEntries(TEAL.tokens);
    expect(entries).toHaveLength(13);
    expect(entries.map(([p]) => p.join("."))).toContain("color.brand");
    expect(entries.map(([p]) => p.join("."))).toContain("font.sans");
  });

  it("折叠 setToken 后文档 tokens 与预设逐字段相等", () => {
    const next = applyPresetTokens(DOC, TEAL.tokens);
    expect(next.tokens).toEqual(TEAL.tokens);
    expect(next.pages[0]!.nodes).toEqual(DOC.pages[0]!.nodes); // 只改 tokens
  });
});

describe("TokenEditor 预设接线", () => {
  it("选中预设经 applyOp 落地全部 token 值，且只产生一条撤销记录", async () => {
    const user = userEvent.setup();
    seedStore();
    render(<TokenEditor doc={DOC} onSetToken={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Token 预设"), "teal");

    await waitFor(() => {
      expect((useEditorStore.getState().document as StudioDocument | null)?.tokens).toEqual(TEAL.tokens);
    });
    const s = useEditorStore.getState();
    expect(s.dirty).toBe(true);
    expect(s.undoStack.past).toHaveLength(1); // 一次撤销即整体回退
    expect(s.canUndo).toBe(true);

    s.undo();
    expect((useEditorStore.getState().document as StudioDocument | null)?.tokens).toEqual(DOC.tokens);
  });

  it("应用预设后颜色输入框读到新值，下拉回到占位项", async () => {
    const user = userEvent.setup();
    seedStore();
    const { rerender } = render(<TokenEditor doc={DOC} onSetToken={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Token 预设"), "teal");
    await waitFor(() => expect(useEditorStore.getState().document).toBeTruthy());
    rerender(
      <TokenEditor
        doc={useEditorStore.getState().document as StudioDocument}
        onSetToken={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("品牌色") as HTMLInputElement).value).toBe(
      TEAL.tokens.color.brand.toLowerCase(),
    );
    expect((screen.getByLabelText("Token 预设") as HTMLSelectElement).value).toBe("");
  });

  it("注入 onApplyTokens 时走注入路径，不动 store", async () => {
    const user = userEvent.setup();
    seedStore();
    const onApplyTokens = vi.fn();
    render(<TokenEditor doc={DOC} onSetToken={vi.fn()} onApplyTokens={onApplyTokens} />);
    await user.selectOptions(screen.getByLabelText("Token 预设"), "warm");
    expect(onApplyTokens).toHaveBeenCalledWith(presetById("warm")!.tokens);
    expect(useEditorStore.getState().undoStack.past).toHaveLength(0);
  });
});
