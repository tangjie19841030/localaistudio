import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, type StudioDocument } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChatBody } from "../../api/client";
import { streamChat } from "../../api/client";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore } from "../../state/editorStore";
import { usePptEditorStore } from "../../toolkits/ppt/state";
import { emptyStack } from "../../state/undoStack";
import { AiChatPanel } from "./AiChatPanel";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    streamChat: vi.fn(),
    cancelChat: vi.fn(),
    getSettings: vi.fn(),
    putSettings: vi.fn(),
    getModelProviders: vi.fn(),
    testModel: vi.fn(),
  };
});

const mockedStream = vi.mocked(streamChat);
const PID = "00000000-0000-4000-8000-000000000000";

/** Two-page doc: page 1 holds a card, page 2 holds a container subtree. */
function twoPageDoc(): StudioDocument {
  const doc = defaultStudioDocument("多页");
  doc.pages[0] = {
    ...defaultPage("首页", "page-1"),
    rootId: "root1",
    nodes: [
      { id: "root1", type: "Container", props: {}, children: ["p1card"] },
      { id: "p1card", type: "Card", props: { title: "页一卡片" }, children: [] },
    ],
  };
  doc.pages.push({
    ...defaultPage("第二页", "page-2"),
    rootId: "root2",
    nodes: [
      { id: "root2", type: "Container", props: {}, children: ["p2card"] },
      { id: "p2card", type: "Card", props: { title: "页二卡片" }, children: ["p2text"] },
      { id: "p2text", type: "Text", props: { content: "页二文本", muted: false }, children: [] },
    ],
  });
  return doc;
}

function seedActivePage2(selectedId: string | null): void {
  useEditorStore.setState({
    projectId: PID,
    meta: null,
    document: twoPageDoc(),
    dirty: false,
    saving: false,
    error: null,
    selectedId,
    selectedIds: selectedId ? [selectedId] : [],
    activePageId: "page-2",
    viewport: "desktop",
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
  useAiStore.getState().clear();
}

function mockStreamOnce(events: (string | object)[]): void {
  mockedStream.mockImplementationOnce(async (_body, handlers) => {
    for (const ev of events) {
      if (typeof ev === "string") handlers.onDelta(ev);
      else handlers.onEvent(ev as Parameters<typeof handlers.onEvent>[0]);
    }
  });
}

const lastBody = (): StreamChatBody => mockedStream.mock.calls[0]?.[0] as StreamChatBody;

/** Mirrors App.tsx wiring: selection props stream from the editor store. */
function BoundPanel() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  return <AiChatPanel projectId={PID} selectedId={selectedId} selectedIds={selectedIds} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePptEditorStore.setState({ selectedSlideId: null, selectedObjectIds: [] });
});

describe("AiChatPanel 跨页选中（T14 G1/G2）", () => {
  it("D1 活动页=页2 选中页2节点发送 → scope.nodeIds 全来自页2", async () => {
    seedActivePage2("p2card");
    mockStreamOnce([{ done: true, text: JSON.stringify({ plan: "p", ops: [] }) }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="p2card" />);

    await user.type(screen.getByLabelText("AI 指令"), "改一下这个卡片");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });

    const body = lastBody();
    expect(body.mode).toBe("patch");
    expect(body.scope).toEqual({ nodeIds: ["p2card", "p2text"], allowAllTokens: false });
  });

  it("D2 清除按钮 → editorStore 选中清空 + chip 回整页生成", async () => {
    seedActivePage2("p2card");
    const user = userEvent.setup();
    render(<BoundPanel />);
    expect(screen.getByText("局部 · Card p2card")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清除选中范围" }));
    expect(useEditorStore.getState().selectedId).toBeNull();
    expect(useEditorStore.getState().selectedIds).toEqual([]);
    expect(screen.getByText("整页生成（未选中节点）")).toBeInTheDocument();
  });

  it("D3 清除后发送 → mode=generate 且 scope undefined", async () => {
    seedActivePage2("p2card");
    const user = userEvent.setup();
    render(<BoundPanel />);
    await user.click(screen.getByRole("button", { name: "清除选中范围" }));

    mockStreamOnce(["planning", { done: true, text: "规划文本" }]);
    await user.type(screen.getByLabelText("AI 指令"), "再加一个底部栏");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });

    const body = lastBody();
    expect(body.mode).toBe("generate");
    expect(body.scope).toBeUndefined();
  });

  it("D4 toolkit 分支无清除按钮", () => {
    seedActivePage2(null);
    render(<AiChatPanel projectId={PID} projectType="ppt" selectedId={null} />);
    expect(screen.getByText(/整个文件/)).toBeInTheDocument(); // toolkit chip owns the header
    expect(screen.queryByRole("button", { name: "清除选中范围" })).toBeNull();
  });
});
