import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { vi } from "vitest";
import { NarrowDrawer } from "./NarrowDrawer";

describe("NarrowDrawer Escape 层级", () => {
  it("多个抽屉同时挂载时，Escape 只关闭最后打开的抽屉", async () => {
    const user = userEvent.setup();
    const onCloseBase = vi.fn();
    const onCloseTop = vi.fn();
    render(
      <>
        <NarrowDrawer side="left" label="底层需求" onClose={onCloseBase}>
          <button type="button">底层操作</button>
        </NarrowDrawer>
        <NarrowDrawer side="right" label="顶层属性" onClose={onCloseTop}>
          <button type="button">顶层操作</button>
        </NarrowDrawer>
      </>,
    );

    await user.keyboard("{Escape}");

    expect(onCloseTop).toHaveBeenCalledTimes(1);
    expect(onCloseBase).not.toHaveBeenCalled();
  });

  it("最上层卸载后，Escape 能交给仍挂载的底层抽屉", async () => {
    const user = userEvent.setup();
    const onCloseBase = vi.fn();
    const onCloseTop = vi.fn();

    function Harness() {
      const [showTop, setShowTop] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShowTop(false)}>
            卸载顶层
          </button>
          <NarrowDrawer side="left" label="底层需求" onClose={onCloseBase}>
            <button type="button">底层操作</button>
          </NarrowDrawer>
          {showTop && (
            <NarrowDrawer side="right" label="顶层属性" onClose={onCloseTop}>
              <button type="button">顶层操作</button>
            </NarrowDrawer>
          )}
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "卸载顶层" }));
    await user.keyboard("{Escape}");

    expect(onCloseBase).toHaveBeenCalledTimes(1);
    expect(onCloseTop).not.toHaveBeenCalled();
  });

  it("多个抽屉同时挂载时，Tab 与 Shift+Tab 只有栈顶实例处理", () => {
    render(
      <>
        <NarrowDrawer side="left" label="底层需求" onClose={vi.fn()}>
          <button type="button">底层操作</button>
        </NarrowDrawer>
        <NarrowDrawer side="right" label="顶层属性" onClose={vi.fn()}>
          <button type="button">顶层操作</button>
        </NarrowDrawer>
      </>,
    );

    const topClose = screen.getByRole("button", { name: "关闭顶层属性" });
    const topAction = screen.getByRole("button", { name: "顶层操作" });
    topAction.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    const preventTab = vi.spyOn(tab, "preventDefault");
    window.dispatchEvent(tab);
    expect(preventTab).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(topClose);

    topClose.focus();
    const shiftTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
    const preventShiftTab = vi.spyOn(shiftTab, "preventDefault");
    window.dispatchEvent(shiftTab);
    expect(preventShiftTab).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(topAction);
  });

  it("Tab 跳过 hidden、display:none 和 type=hidden 控件", async () => {
    const user = userEvent.setup();
    render(
      <NarrowDrawer side="left" label="需求" onClose={vi.fn()}>
        <input type="hidden" aria-label="隐藏输入" />
        <button type="button" hidden>
          hidden 按钮
        </button>
        <button type="button" style={{ display: "none" }}>
          display none 按钮
        </button>
        <button type="button">最后一个操作</button>
      </NarrowDrawer>,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭需求" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "最后一个操作" }));
  });

  it("Escape 关闭前同步 blur 抽屉内当前输入框", () => {
    const events: string[] = [];
    render(
      <NarrowDrawer
        side="left"
        label="需求"
        onClose={() => events.push("close")}
      >
        <input aria-label="抽屉输入" onBlur={() => events.push("blur")} />
      </NarrowDrawer>,
    );
    const input = screen.getByRole("textbox", { name: "抽屉输入" });
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(events).toEqual(["blur", "close"]);
  });

  it("抽屉直接卸载时同步 blur 当前输入框", () => {
    const events: string[] = [];
    const nativeBlurEvents: string[] = [];
    const { rerender } = render(
      <NarrowDrawer side="left" label="需求" onClose={() => {}}>
        <input aria-label="抽屉输入" onBlur={() => events.push("blur")} />
      </NarrowDrawer>,
    );
    const input = screen.getByRole("textbox", { name: "抽屉输入" });
    input.addEventListener("blur", () => nativeBlurEvents.push("blur"));
    input.focus();
    expect(document.activeElement).toBe(input);

    rerender(<div />);

    expect(events).toEqual([]);
    expect(nativeBlurEvents).toEqual(["blur"]);
  });

  it("窄屏触发器与抽屉一起卸载时，把焦点交给新桌面侧栏的首个控件", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [narrow, setNarrow] = useState(true);
      const [open, setOpen] = useState(false);
      return (
        <>
          <div data-testid="switch-breakpoint" onClick={() => setNarrow(false)}>
            切到桌面
          </div>
          {narrow ? (
            <>
              <button type="button" onClick={() => setOpen(true)}>
                打开需求
              </button>
              {open && (
                <NarrowDrawer
                  side="left"
                  label="需求"
                  onClose={() => setOpen(false)}
                  focusFallback={() =>
                    document.querySelector<HTMLElement>("[data-desktop-sidebar] button")
                  }
                >
                  <input aria-label="抽屉输入" />
                </NarrowDrawer>
              )}
            </>
          ) : (
            <aside data-desktop-sidebar aria-label="桌面需求栏">
              <button type="button">桌面首个控件</button>
            </aside>
          )}
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "打开需求" }));
    const input = screen.getByRole("textbox", { name: "抽屉输入" });
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByTestId("switch-breakpoint"));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "桌面首个控件" }));
    });
  });

  it("新桌面侧栏在抽屉卸载后才挂载时，仍把焦点交给 fallback", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [narrow, setNarrow] = useState(true);
      const [open, setOpen] = useState(false);
      const [desktopReady, setDesktopReady] = useState(false);
      return (
        <>
          <div data-testid="delayed-switch-breakpoint" onClick={() => setNarrow(false)}>
            切到桌面
          </div>
          {narrow ? (
            <>
              <button type="button" onClick={() => setOpen(true)}>
                打开需求
              </button>
              {open && (
                <NarrowDrawer
                  side="left"
                  label="需求"
                  onClose={() => setOpen(false)}
                  focusFallback={() =>
                    document.querySelector<HTMLElement>("[data-delayed-desktop-sidebar] button")
                  }
                >
                  <input aria-label="抽屉输入" />
                </NarrowDrawer>
              )}
            </>
          ) : (
            <>
              {desktopReady && (
                <aside data-delayed-desktop-sidebar aria-label="桌面需求栏">
                  <button type="button">桌面首个控件</button>
                </aside>
              )}
              {!desktopReady && <DelayedDesktopMount onReady={() => setDesktopReady(true)} />}
            </>
          )}
        </>
      );
    }

    function DelayedDesktopMount({ onReady }: { onReady: () => void }) {
      useEffect(() => {
        const timer = window.setTimeout(onReady, 100);
        return () => window.clearTimeout(timer);
      }, [onReady]);
      return null;
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "打开需求" }));
    screen.getByRole("textbox", { name: "抽屉输入" }).focus();
    fireEvent.click(screen.getByTestId("delayed-switch-breakpoint"));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "桌面首个控件" }));
    }, { timeout: 500 });
  });

  it("关闭按钮在浏览器将焦点落到 body 后，下一微任务恢复触发按钮焦点", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开需求
          </button>
          {open && (
            <NarrowDrawer
              side="left"
              label="需求"
              onClose={() => {
                document.body.tabIndex = -1;
                document.body.focus();
                setOpen(false);
              }}
            >
              <button type="button">抽屉操作</button>
            </NarrowDrawer>
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开需求" });
    const previousBodyTabIndex = document.body.getAttribute("tabindex");
    try {
      await user.click(trigger);
      await user.click(screen.getByRole("button", { name: "关闭需求" }));

      await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      if (previousBodyTabIndex === null) document.body.removeAttribute("tabindex");
      else document.body.setAttribute("tabindex", previousBodyTabIndex);
    }
  });

  it("关闭回调同步把焦点移到其它触发器时，不抢回旧触发器焦点", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      const nextTriggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开需求
          </button>
          <button ref={nextTriggerRef} type="button">
            打开属性
          </button>
          {open && (
            <NarrowDrawer
              side="left"
              label="需求"
              onClose={() => {
                nextTriggerRef.current?.focus();
                setOpen(false);
              }}
            >
              <button type="button">抽屉操作</button>
            </NarrowDrawer>
          )}
        </>
      );
    }

    render(<Harness />);
    const oldTrigger = screen.getByRole("button", { name: "打开需求" });
    const nextTrigger = screen.getByRole("button", { name: "打开属性" });
    await user.click(oldTrigger);
    await user.click(screen.getByRole("button", { name: "关闭需求" }));

    await waitFor(() => expect(document.activeElement).toBe(nextTrigger));
    expect(document.activeElement).not.toBe(oldTrigger);
  });

  it("click 默认动作在 microtask 后把焦点落到 body 时，仍在下一帧恢复触发按钮", async () => {
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
              <button type="button">抽屉操作</button>
            </NarrowDrawer>
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开需求" });
    const previousBodyTabIndex = document.body.getAttribute("tabindex");
    try {
      await user.click(trigger);
      await user.click(screen.getByRole("button", { name: "关闭需求" }));
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      document.body.tabIndex = -1;
      document.body.focus();
      expect(document.activeElement).toBe(document.body);
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      if (previousBodyTabIndex === null) document.body.removeAttribute("tabindex");
      else document.body.setAttribute("tabindex", previousBodyTabIndex);
    }
  });
});
