import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  defaultStudioDocument,
  defaultTokens,
  newProjectMeta,
  type StudioDocument,
} from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenImportButton } from "../../components/editor/TokenImportButton";
import { TokenEditor } from "../../components/editor/TokenEditor";
import { useEditorStore } from "../../state/editorStore";
import { emptyStack } from "../../state/undoStack";
import { importTokens } from "./importTokens";

vi.mock("../../api/client", () => ({
  api: { getProject: vi.fn(), saveProject: vi.fn() },
}));

const DOC: StudioDocument = defaultStudioDocument("测试页");

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

describe("importTokens 映射（A1 三种形状）", () => {
  it("A1 扁平/嵌套/点路径同输入同输出", () => {
    const flat = importTokens(JSON.stringify({ brand: "#0D9488", card: 12, unit: 6, sans: "Roboto" }));
    const nested = importTokens(
      JSON.stringify({ color: { brand: "#0D9488" }, radius: { card: 12 }, spacing: { unit: 6 }, font: { sans: "Roboto" } }),
    );
    const dotted = importTokens(
      JSON.stringify({ "color.brand": "#0D9488", "radius.card": 12, "spacing.unit": 6, "font.sans": "Roboto" }),
    );
    expect(flat.ok).toBe(true);
    const base = defaultTokens();
    const expected = {
      ...base,
      color: { ...base.color, brand: "#0D9488" },
      radius: { ...base.radius, card: 12 },
      spacing: { ...base.spacing, unit: 6 },
      font: { ...base.font, sans: "Roboto" },
    };
    expect(flat.tokens).toEqual(expected);
    expect(nested.tokens).toEqual(flat.tokens);
    expect(dotted.tokens).toEqual(flat.tokens);
    expect(nested.mapped).toEqual(flat.mapped);
    expect(dotted.mapped).toEqual(flat.mapped);
  });

  it("A1b 完整 13 键文档形状全部映射且过 tokensSchema", () => {
    const full = {
      color: {
        brand: "#0D9488", surface: "#F8FAFC", text: "#0F172A", muted: "#5B7083", border: "#CBD5E1",
        accent: "#0891B2", success: "#16A34A", warning: "#D97706", danger: "#DC2626",
      },
      radius: { card: 8, control: 6 },
      spacing: { unit: 4 },
      font: { sans: "Inter" },
    };
    const r = importTokens(JSON.stringify(full));
    expect(r.ok).toBe(true);
    expect(r.tokens).toEqual(full);
    expect(r.mapped).toHaveLength(13);
  });
});

describe("importTokens 别名（A2）", () => {
  it("A2 常见别名按固定表命中规范键", () => {
    const r = importTokens(
      JSON.stringify({
        primary: "#111111", background: "#222222", fg: "#333333",
        secondary: "#444444", "border-color": "#555555", destructive: "#666666",
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.mapped).toEqual(["color.brand", "color.surface", "color.text", "color.muted", "color.border", "color.danger"]);
    expect(r.tokens!.color).toMatchObject({
      brand: "#111111", surface: "#222222", text: "#333333", muted: "#444444", border: "#555555", danger: "#666666",
    });
    expect(r.warnings).toEqual([]);
  });

  it("A2b 别名冲突第一个命中，后续源进 warnings", () => {
    const r = importTokens(JSON.stringify({ primary: "#111111", brand: "#222222" }));
    expect(r.ok).toBe(true);
    expect(r.tokens!.color.brand).toBe("#111111");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("primary");
    expect(r.warnings[0]).toContain("color.brand");
  });

  it("A2c 标量 radius 别名同时落 control 与 card", () => {
    const r = importTokens(JSON.stringify({ radius: 10 }));
    expect(r.ok).toBe(true);
    expect(r.tokens!.radius).toEqual({ card: 10, control: 10 });
    expect(r.mapped).toEqual(["radius.control", "radius.card"]);
  });
});

describe("importTokens 失败路径（A3）", () => {
  it("A3 非法 JSON 返回行级错误且不抛", () => {
    const r = importTokens("{brand: 不是json");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("不是合法 JSON");
    expect(r.tokens).toBeUndefined();
  });

  it("A3b 非法色值/越界数值逐行报错", () => {
    const r = importTokens(JSON.stringify({ brand: "teal", "radius.card": 99 }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("color.brand: ");
    expect(r.errors[0]).toContain("十六进制");
    expect(r.errors.some((e) => e.startsWith("radius.card: "))).toBe(true);
    expect(r.tokens).toBeUndefined();
  });

  it("A3c 顶层非对象（数组/标量/null）报错不抛", () => {
    for (const raw of ["[]", "42", "null", '"hi"']) {
      const r = importTokens(raw);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain("JSON 对象");
    }
  });
});

describe("importTokens 降级与忽略（A4/A5）", () => {
  it("A4 缺键用 defaultTokens 补全", () => {
    const r = importTokens(JSON.stringify({ color: { brand: "#0D9488" } }));
    expect(r.ok).toBe(true);
    const base = defaultTokens();
    expect(r.tokens).toEqual({ ...base, color: { ...base.color, brand: "#0D9488" } });
    expect(r.mapped).toEqual(["color.brand"]);
  });

  it("A5 未知键进 warnings（含 .fig 预留文案）且不阻塞导入", () => {
    const r = importTokens(JSON.stringify({ fontFamily: "Inter", foo: 1, color: { weird: "#123456" } }));
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(3);
    for (const w of r.warnings) expect(w).toContain(".fig");
    expect(r.tokens).toEqual(defaultTokens());
    expect(r.mapped).toEqual([]);
  });

  it("永不抛出：任意输入都返回结果对象", () => {
    expect(() => importTokens("")).not.toThrow();
    expect(importTokens("").ok).toBe(false);
    expect(() => importTokens(null as unknown as string)).not.toThrow();
    expect(importTokens(null as unknown as string).ok).toBe(false);
  });
});

describe("TokenImportButton 组件级", () => {
  it("粘贴合法 JSON → onApply 收到 parse 后 Tokens，成功后清空输入", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(createElement(TokenImportButton, { onApply }));
    fireEvent.click(screen.getByText("导入 Token JSON"));
    fireEvent.change(screen.getByLabelText("Token JSON"), {
      target: { value: JSON.stringify({ primary: "#0D9488" }) },
    });
    await user.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].color.brand).toBe("#0D9488");
    expect(screen.getByText("已导入 1 项")).toBeInTheDocument();
    expect((screen.getByLabelText("Token JSON") as HTMLTextAreaElement).value).toBe("");
  });

  it("非法 JSON 显示行级错误且不触发 onApply", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onError = vi.fn();
    render(createElement(TokenImportButton, { onApply, onError }));
    fireEvent.click(screen.getByText("导入 Token JSON"));
    fireEvent.change(screen.getByLabelText("Token JSON"), { target: { value: "not json" } });
    await user.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("不是合法 JSON");
  });
});

describe("TokenEditor 导入接线", () => {
  it("粘贴 JSON 经 applyPreset 落地全部值，undoStack 恰 +1", async () => {
    seedStore();
    const user = userEvent.setup();
    render(createElement(TokenEditor, { doc: DOC, onSetToken: vi.fn() }));
    fireEvent.click(screen.getByText("导入 Token JSON"));
    fireEvent.change(screen.getByLabelText("Token JSON"), {
      target: { value: JSON.stringify({ primary: "#0D9488", card: 12 }) },
    });
    await user.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => {
      expect((useEditorStore.getState().document as StudioDocument).tokens.color.brand).toBe("#0D9488");
    });
    const s = useEditorStore.getState();
    expect((s.document as StudioDocument).tokens.radius.card).toBe(12);
    expect(s.dirty).toBe(true);
    expect(s.undoStack.past).toHaveLength(1); // 一次撤销即整体回退
    expect(s.canUndo).toBe(true);
    s.undo();
    expect((useEditorStore.getState().document as StudioDocument).tokens.color.brand).toBe(DOC.tokens.color.brand);
  });
});
