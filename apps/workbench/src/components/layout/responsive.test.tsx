import userEvent from "@testing-library/user-event";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { defaultStudioDocument } from "@studio/schema-core";
import { afterEach, beforeEach, vi } from "vitest";
import { useState } from "react";
import { WorkbenchLayout } from "./WorkbenchLayout";
import { NarrowDrawer } from "./NarrowDrawer";
import { useAiStore } from "../../state/aiStore";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

const noop = () => {};

/** Editor wiring defaults, mirroring layout.test.tsx (narrow/medium behavior focus). */
const EDITOR_PROPS = {
  document: defaultDoc("d"),
  selectedId: null as string | null,
  viewport: "desktop" as const,
  onSelect: noop,
  onSetViewport: noop,
  onSetToken: noop,
  onPropsChange: noop,
  onInsert: noop,
  onRemove: noop,
  onMove: noop,
  canUndo: false,
  canRedo: false,
  onUndo: noop,
  onRedo: noop,
  onOpenSettings: noop,
  projectId: "00000000-0000-4000-8000-000000000000",
  onConfirmPlan: noop,


  previewMode: "schema" as const,
  onSetPreviewMode: noop,
};

type MatchMap = Record<string, boolean>;

/**
 * Stub window.matchMedia. jsdom lacks matchMedia entirely; the hook needs
 * addEventListener("change") (or legacy addListener) to observe transitions.
 * Captured listeners are exposed so tests can simulate breakpoint changes.
 */
function stubMatchMedia(matches: MatchMap) {
  const changeListeners: Array<() => void> = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: (_type: string, listener: () => void) => {
      changeListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      const i = changeListeners.indexOf(listener);
      if (i >= 0) changeListeners.splice(i, 1);
    },
  }));
  return {
    /** Simulate a media change: the hook recomputes and resets rail state. */
    fireChange: () =>
      act(async () => {
        for (const listener of [...changeListeners]) listener();
      }),
  };
}

function renderLayout(props: Partial<typeof EDITOR_PROPS> = {}) {
  return render(
    <WorkbenchLayout
      projectName="响应式工作台"
      documentName="d"
      dirty={false}
      saving={false}
      error={null}
      meta={null}
      onDocumentNameChange={noop}
      onSave={noop}
      onBack={noop}
      {...EDITOR_PROPS}
      {...props}
    />,
  );
}

beforeEach(() => {
  useAiStore.setState({ composerDrafts: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkbenchLayout 响应式（批次 E）", () => {
  it("narrow：双栏不内联，常驻开关存在，抽屉单开互斥，backdrop/Esc 可关闭", async () => {
    stubMatchMedia({ "(min-width: 1024px)": false, "(min-width: 1440px)": false });
    const user = userEvent.setup();
    renderLayout();

    // 双栏均不内联渲染，中央预览保持
    expect(screen.queryByRole("complementary", { name: "需求" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "属性" })).toBeNull();
    expect(screen.getByRole("main", { name: "预览" })).toBeInTheDocument();
    // 不渲染 PanelResizer
    expect(screen.queryByRole("separator", { name: "调整需求栏宽度" })).toBeNull();

    // 两个常驻切换入口
    const leftToggle = screen.getByRole("button", { name: "切换需求栏" });
    const rightToggle = screen.getByRole("button", { name: "切换属性栏" });
    expect(leftToggle).toHaveAttribute("aria-expanded", "false");
    expect(rightToggle).toHaveAttribute("aria-expanded", "false");

    // 打开左抽屉
    await user.click(leftToggle);
    const drawer = screen.getByRole("dialog", { name: "需求" });
    expect(drawer).toBeInTheDocument();
    expect(leftToggle).toHaveAttribute("aria-expanded", "true");

    // 打开右抽屉会先关掉左抽屉（一次只开一个）
    await user.click(rightToggle);
    expect(screen.queryByRole("dialog", { name: "需求" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "属性" })).toBeInTheDocument();
    expect(rightToggle).toHaveAttribute("aria-expanded", "true");

    // Esc 关闭
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "属性" })).toBeNull();

    // backdrop 点击关闭
    await user.click(screen.getByRole("button", { name: "切换需求栏" }));
    expect(screen.getByRole("dialog", { name: "需求" })).toBeInTheDocument();
    await user.click(screen.getByTestId("narrow-backdrop"));
    expect(screen.queryByRole("dialog", { name: "需求" })).toBeNull();
    expect(screen.queryByTestId("narrow-backdrop")).toBeNull();
  });

  it("窄屏从左抽屉切到右抽屉后，关闭右抽屉恢复右侧入口焦点", async () => {
    stubMatchMedia({ "(min-width: 1024px)": false, "(min-width: 1440px)": false });
    const user = userEvent.setup();
    renderLayout();

    const leftToggle = screen.getByRole("button", { name: "切换需求栏" });
    const rightToggle = screen.getByRole("button", { name: "切换属性栏" });
    await user.click(leftToggle);
    await user.click(rightToggle);
    expect(screen.getByRole("dialog", { name: "属性" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭属性" }));
    expect(document.activeElement).toBe(rightToggle);
  });

  it("medium：左栏内联展开，右栏默认折叠，开关可展开属性栏", async () => {
    stubMatchMedia({ "(min-width: 1024px)": true, "(min-width: 1440px)": false });
    const user = userEvent.setup();
    renderLayout();

    expect(screen.getByRole("complementary", { name: "需求" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "属性" })).toBeNull();

    const toggle = screen.getByRole("button", { name: "切换属性栏" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByRole("complementary", { name: "属性" })).toBeInTheDocument();

    // Open rails expose a discoverable close action, and closing keeps the
    // original edge toggle available for keyboard users.
    await user.click(screen.getByRole("button", { name: "关闭属性栏" }));
    expect(screen.queryByRole("complementary", { name: "属性" })).toBeNull();
    expect(screen.getByRole("button", { name: "切换属性栏" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "关闭需求栏" }));
    expect(screen.queryByRole("complementary", { name: "需求" })).toBeNull();
    expect(screen.getByRole("button", { name: "切换需求栏" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "切换需求栏" }));
    expect(screen.getByRole("complementary", { name: "需求" })).toBeInTheDocument();
  });

  it("wide：双栏内联且无开关按钮（stub matchMedia 路径）", () => {
    stubMatchMedia({ "(min-width: 1024px)": true, "(min-width: 1440px)": true });
    renderLayout();

    expect(screen.getByRole("complementary", { name: "需求" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "属性" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换需求栏" })).toBeNull();
    expect(screen.queryByRole("button", { name: "切换属性栏" })).toBeNull();
  });

  it("断点变化时重置为该断点默认值（medium -> wide 右栏自动展开）", async () => {
    const media = stubMatchMedia({ "(min-width: 1024px)": true, "(min-width: 1440px)": false });
    renderLayout();
    expect(screen.queryByRole("complementary", { name: "属性" })).toBeNull();

    // 模拟窗口变宽：hook 经 change 监听重算并把右栏重置为 wide 默认展开
    vi.stubGlobal(
      "matchMedia",
      ((query: string) => ({
        matches: query === "(min-width: 1024px)" || query === "(min-width: 1440px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia,
    );
    await media.fireChange();

    expect(screen.getByRole("complementary", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "需求" })).toBeInTheDocument();
  });

  it("断点变化不覆盖用户手动关闭的侧栏", async () => {
    const media = stubMatchMedia({ "(min-width: 1024px)": true, "(min-width: 1440px)": false });
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("button", { name: "切换属性栏" }));
    await user.click(screen.getByRole("button", { name: "关闭属性栏" }));

    vi.stubGlobal(
      "matchMedia",
      ((query: string) => ({
        matches: query === "(min-width: 1024px)" || query === "(min-width: 1440px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia,
    );
    await media.fireChange();

    expect(screen.queryByRole("complementary", { name: "属性" })).toBeNull();
    expect(screen.getByRole("button", { name: "切换属性栏" })).toHaveAttribute("aria-expanded", "false");
  });

  it("narrow 需求抽屉关闭/重开及窄宽断点往返都保留 Composer 草稿", async () => {
    useAiStore.setState({ composerDrafts: {} });
    const media = stubMatchMedia({ "(min-width: 1024px)": false, "(min-width: 1440px)": false });
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "切换需求栏" }));
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "跨断点也要保留");
    const file = new File(["image"], "参考图.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("添加参考图"), file);
    await waitFor(() => expect(screen.getByAltText("参考图 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "关闭需求" }));
    await user.click(screen.getByRole("button", { name: "切换需求栏" }));
    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("跨断点也要保留");
    expect(screen.getByAltText("参考图 1")).toBeInTheDocument();

    vi.stubGlobal(
      "matchMedia",
      ((query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia,
    );
    await media.fireChange();
    expect(screen.getByRole("complementary", { name: "需求" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("跨断点也要保留");
    expect(screen.getByAltText("参考图 1")).toBeInTheDocument();

    vi.stubGlobal(
      "matchMedia",
      (() => ({
        matches: false,
        media: "",
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia,
    );
    await media.fireChange();
    await user.click(screen.getByRole("button", { name: "切换需求栏" }));
    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("跨断点也要保留");
    expect(screen.getByAltText("参考图 1")).toBeInTheDocument();
  });
});

describe("NarrowDrawer 键盘与焦点行为", () => {
  it("打开后把焦点送入抽屉，Tab 循环，关闭后还给触发按钮", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开需求
          </button>
          {open && (
            <NarrowDrawer side="left" label="需求" onClose={() => setOpen(false)}>
              <button type="button">第一个操作</button>
              <button type="button">最后一个操作</button>
            </NarrowDrawer>
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开需求" });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: "关闭需求" });
    expect(document.activeElement).toBe(close);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "第一个操作" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "最后一个操作" }));
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "最后一个操作" }));

    await user.click(close);
    expect(document.activeElement).toBe(trigger);
  });
});
