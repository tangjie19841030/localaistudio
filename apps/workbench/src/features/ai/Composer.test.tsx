import userEvent from "@testing-library/user-event";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { Composer } from "./Composer";
import { useAiStore } from "../../state/aiStore";

beforeEach(() => {
  useAiStore.setState({ composerDrafts: {} });
});

describe("Composer 草稿", () => {
  it("卸载并重新挂载时保留未发送文字", async () => {
    const user = userEvent.setup();
    const first = render(
      <Composer projectId="project-a" disabled={false} streaming={false} onSend={() => {}} onCancel={() => {}} />,
    );
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "保留这段草稿");
    const file = new File(["image"], "参考图.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("添加参考图"), file);
    expect(screen.getByAltText("参考图 1")).toBeInTheDocument();

    first.unmount();
    render(
      <Composer projectId="project-a" disabled={false} streaming={false} onSend={() => {}} onCancel={() => {}} />,
    );

    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("保留这段草稿");
    expect(screen.getByAltText("参考图 1")).toBeInTheDocument();
  });

  it("按项目隔离草稿，切换项目不会串内容", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Composer projectId="project-a" disabled={false} streaming={false} onSend={() => {}} onCancel={() => {}} />,
    );
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "项目 A 草稿");
    rerender(
      <Composer projectId="project-b" disabled={false} streaming={false} onSend={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("");
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "项目 B 草稿");
    rerender(
      <Composer projectId="project-a" disabled={false} streaming={false} onSend={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("项目 A 草稿");
  });

  it("组件复用到新项目后，建议词只写入当前项目", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Composer projectId="project-a" disabled={false} streaming={false} onSend={() => {}} onCancel={() => {}} />,
    );
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "A 的原草稿");
    rerender(
      <Composer projectId="project-b" disabled={false} streaming={false} onSend={() => {}} onCancel={() => {}} />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent("studio-ai-prefill", { detail: "B 的建议词" }));
    });

    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("B 的建议词");
    expect(useAiStore.getState().composerDrafts["project-a"]?.text).toBe("A 的原草稿");
    expect(useAiStore.getState().composerDrafts["project-b"]?.text).toBe("B 的建议词");
  });

  it("发送后只清空当前项目草稿，其他项目草稿保留", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    useAiStore.getState().setComposerDraft("project-b", { text: "B 的草稿", images: ["data:image/png;base64,b"] });
    render(
      <Composer projectId="project-a" disabled={false} streaming={false} onSend={onSend} onCancel={() => {}} />,
    );
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "A 要发送");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).toHaveBeenCalledWith("A 要发送", []);
    expect(useAiStore.getState().composerDrafts["project-a"]).toBeUndefined();
    expect(useAiStore.getState().composerDrafts["project-b"]).toEqual({
      text: "B 的草稿",
      images: ["data:image/png;base64,b"],
    });
  });
});

describe("Composer 选中摘要前缀（W1-A）", () => {
  it("有 selectedNodes：发送文本自动带【选中：…】前缀", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const selectedNodes = [
      { id: "b1", type: "Button", props: { label: "提交" }, children: [] },
    ];
    render(
      <Composer
        projectId="project-a"
        disabled={false}
        streaming={false}
        onSend={onSend}
        onCancel={() => {}}
        selectedNodes={selectedNodes}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "改大一点");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalledWith("【选中：按钮「提交」】改大一点", []);
  });

  it("输入框内容不含前缀，前缀只在出站时拼接", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <Composer
        projectId="project-a"
        disabled={false}
        streaming={false}
        onSend={onSend}
        onCancel={() => {}}
        selectedNodes={[{ id: "c1", type: "Card", props: { title: "卡片" }, children: [] }]}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "更紧凑");
    expect(screen.getByRole("textbox", { name: "AI 指令" })).toHaveValue("更紧凑");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalledWith("【选中：卡片「卡片」】更紧凑", []);
  });

  it("selectedNodes 为空：出站文本原样", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <Composer projectId="project-a" disabled={false} streaming={false} onSend={onSend} onCancel={() => {}} />,
    );
    await user.type(screen.getByRole("textbox", { name: "AI 指令" }), "生成一个运营工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalledWith("生成一个运营工作台", []);
  });
});
