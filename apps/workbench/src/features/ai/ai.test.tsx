import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, planScope, type StudioDocument, type Page } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChatBody } from "../../api/client";
import { streamChat } from "../../api/client";
import { useEditorStore } from "../../state/editorStore";
import { useAiStore } from "../../state/aiStore";
import { usePptEditorStore } from "../../toolkits/ppt/state";
import { useWordEditorStore } from "../../toolkits/word/state";
import { emptyStack } from "../../state/undoStack";
import { AiChatPanel } from "./AiChatPanel";
import { ChangePlanCard } from "./ChangePlanCard";
import { SettingsDialog } from "./SettingsDialog";
/** T19: store/document APIs consume the WHOLE doc; tests pass a page fixture. */
function docAsWhole(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}



// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

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
const DOC: Page = { ...defaultPage("草稿"), rootId: "root",
  nodes: [
    { id: "root", type: "Container", props: {}, children: ["stat"] },
    { id: "stat", type: "StatCard", props: { label: "今日活跃", value: "1", delta: "", tone: "brand" }, children: [] },
  ],
};

/** Replay a scripted event list through the mocked streamChat. */
function mockStreamOnce(events: (string | object)[]): void {
  mockedStream.mockImplementationOnce(async (_body, handlers) => {
    for (const ev of events) {
      if (typeof ev === "string") handlers.onDelta(ev);
      else handlers.onEvent(ev as Parameters<typeof handlers.onEvent>[0]);
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    projectId: PID,
    meta: null,
    document: docAsWhole(DOC),
    dirty: false,
    saving: false,
    error: null,
    selectedId: null,
    viewport: "desktop",
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
  useAiStore.getState().clear();
  // P7.3: toolkit 编辑器选择态一并复位（AiChatPanel toolkit 分派用例之间隔离）。
  // deck/doc carry the ids the scope staleness guard validates against.
  usePptEditorStore.setState({
    deck: TOOLKIT_PPT_DECK,
    envelopeDeck: TOOLKIT_PPT_DECK,
    selectedSlideId: null,
    selectedObjectIds: [],
  });
  useWordEditorStore.setState({
    doc: TOOLKIT_WORD_DOC,
    envelopeDoc: TOOLKIT_WORD_DOC,
    selection: { sectionId: null, blockId: null, blockIds: [] },
  });
});

/** Minimal live deck for scope resolution (ids must exist to survive staleness filter). */
const TOOLKIT_PPT_DECK = {
  documentVersion: 1,
  name: "toolkit-deck",
  presentation: { title: null, author: null, subject: null },
  slideSize: { w: 1280, h: 720 },
  theme: { primary: "#000000", secondary: "#000000", accent: "#000000", background: "#FFFFFF", fontTitle: "x", fontBody: "y" },
  masters: [],
  layouts: [],
  slides: [
    {
      id: "slide-1",
      title: "第一页",
      notes: "",
      objects: [
        { id: "o1", kind: "shape", shape: "rect", rect: { x: 0, y: 0, w: 10, h: 10 } },
        { id: "o2", kind: "shape", shape: "rect", rect: { x: 0, y: 0, w: 10, h: 10 } },
      ],
    },
  ],
} as unknown as ReturnType<typeof usePptEditorStore.getState>["deck"];

const TOOLKIT_WORD_DOC = {
  documentVersion: 1,
  name: "toolkit-doc",
  sections: [
    { id: "sec-1", title: "第一章", blockIds: ["block-1"] },
  ],
  blocks: [{ id: "block-1", type: "paragraph", runs: [{ text: "原文" }] }],
} as unknown as ReturnType<typeof useWordEditorStore.getState>["doc"];

describe("AiChatPanel", () => {
  it("发送消息：user 消息出现，streamChat 以 generate 模式调用（未选中）", async () => {
    mockStreamOnce(["planning", { done: true, text: "规划文本" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);

    await user.type(screen.getByLabelText("AI 指令"), "生成一个运营工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.mode).toBe("generate");
    expect(body.scope).toBeUndefined();
    expect(body.messages.at(-1)?.content).toBe("生成一个运营工作台");
    expect(screen.getByText("生成一个运营工作台")).toBeInTheDocument(); // user 消息入列
  });

  it("选中节点发送：mode=patch + scope 限定 + target 拼接", async () => {
    mockStreamOnce([
      JSON.stringify({ plan: "p", ops: [{ op: "node.update", id: "stat", props: { tone: "warning" } }] }),
      {
        done: true,
        text: JSON.stringify({ plan: "规划：改 tone。", ops: [{ op: "node.update", id: "stat", props: { tone: "warning" } }] }),
      },
    ]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="stat" />);

    await user.type(screen.getByLabelText("AI 指令"), "改成警告色");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.mode).toBe("patch");
    expect(body.scope).toEqual({ nodeIds: ["stat"], allowAllTokens: false });
    expect(body.messages.at(-1)?.content).toBe("【选中：指标卡「今日活跃」】改成警告色 target:stat");
  });

  it("流式中发送禁用且取消按钮出现；streaming 消息带光标", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onDelta("生成中");
      await gate;
    });
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);

    await user.type(screen.getByLabelText("AI 指令"), "生成");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await vi.waitFor(() => {
      expect(useAiStore.getState().phase).toBe("streaming");
    });

    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
    expect(screen.getByText(/生成中/)).toBeInTheDocument();
    release();
  });

  it("violations 非空时以 role=alert 展示违规清单", async () => {
    mockStreamOnce([
      { violation: ["节点 stat 超出修改范围"], retry: true },
      { error: "scope_violation", violations: ["节点 stat 超出修改范围"] },
    ]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="stat" />);
    await user.type(screen.getByLabelText("AI 指令"), "修改 违规 target:stat");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const alerts = await screen.findAllByRole("alert");
    const texts = alerts.map((a) => a.textContent).join("\n");
    expect(texts).toContain("节点 stat 超出修改范围"); // 违规清单展示
    expect(texts).toContain("scope_violation"); // 终态错误也可见
  });

  it("error 终态以 role=alert 展示错误文本（含 raw）", async () => {
    mockStreamOnce([{ error: "invalid_json", raw: "抱歉不是 JSON" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="stat" />);
    await user.type(screen.getByLabelText("AI 指令"), "修改 badjson target:stat");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("invalid_json");
    expect(alert).toHaveTextContent("抱歉不是 JSON");
  });

  it("tool-call/tool-result 帧：归档时间线展开后逐步显示中文动作名与结果摘要", async () => {
    // 色彩措辞 → patch 模式（无需选中节点）；空 ops 走中性 notice 终态。
    mockStreamOnce([
      { type: "tool-call", name: "insert_node", args: {} },
      { type: "tool-result", name: "insert_node", ok: true, message: "已插入指标卡" },
      { type: "tool-call", name: "set_frame", args: {} },
      { type: "tool-result", name: "set_frame", ok: true, message: "已调整位置" },
      { done: true, text: JSON.stringify({ plan: "无需改色", ops: [] }) },
    ]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);
    await user.type(screen.getByLabelText("AI 指令"), "整体换成暖色");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await vi.waitFor(() => {
      expect(useAiStore.getState().phase).not.toBe("streaming");
    });
    // 终态后卡片折叠为头部一行；展开看完整步骤历史。
    const card = await screen.findByRole("group", { name: "AI 执行过程" });
    expect(card).toHaveTextContent(/无需改色|已完成/);
    await user.click(screen.getByRole("button", { name: /展开/ }));
    expect(card).toHaveTextContent("插入节点");
    expect(card).toHaveTextContent("已插入指标卡");
    expect(card).toHaveTextContent("调整位置与尺寸");
  });

  it("进行中时间线卡片：stage/progress 帧实时渲染阶段与步数，终态后转为归档卡", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onEvent({ type: "stage", id: "model", label: "正在生成界面" });
      handlers.onEvent({ type: "progress", step: 3, total: 8, label: "组件生成" });
      await gate;
      handlers.onEvent({ canceled: true }); // 终态帧：live 卡片必须消失
    });
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);
    await user.type(screen.getByLabelText("AI 指令"), "生成工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const liveCard = await screen.findByRole("group", { name: "AI 执行过程（进行中）" });
    expect(liveCard).toHaveTextContent("正在生成界面");
    expect(liveCard).toHaveTextContent("3/8 步");
    release();
    await vi.waitFor(() => {
      expect(useAiStore.getState().phase).not.toBe("streaming");
    });
    expect(screen.queryByRole("group", { name: "AI 执行过程（进行中）" })).toBeNull();
    expect(screen.getByRole("group", { name: "AI 执行过程" })).toBeInTheDocument();
  });

  it("进行中时间线卡片：无 progress 时只显示阶段文案，不显示步数", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onEvent({ type: "stage", id: "reading", label: "正在理解需求" });
      await gate;
    });
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);
    await user.type(screen.getByLabelText("AI 指令"), "生成工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const liveCard = await screen.findByRole("group", { name: "AI 执行过程（进行中）" });
    expect(liveCard).toHaveTextContent("正在理解需求");
    expect(liveCard).not.toHaveTextContent("步");
    release();
  });

  it("verify-round：进行中卡片显示人话化校验修复文案（含轮次）", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onEvent({ type: "verify-round", round: 3, issues: ["缺 header"] });
      await gate;
    });
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);
    await user.type(screen.getByLabelText("AI 指令"), "生成工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const liveCard = await screen.findByRole("group", { name: "AI 执行过程（进行中）" });
    expect(liveCard).toHaveTextContent("文档校验未通过，自动修复中（第 3 轮）");
    release();
  });

  it("P7 停滞警示：streaming 且 15 秒无帧时出现警示行；终态不出现", async () => {
    // 直接驱动 store 状态（时序行为由 stallWatch.test.tsx 的 fake-timers
    // 用例覆盖；此处只验证 AiChatPanel 对 stalled 状态的渲染接线）。
    useAiStore.setState({
      phase: "streaming",
      messages: [
        { id: "m1", role: "user", text: "生成工作台", streaming: false },
        { id: "m2", role: "assistant", text: "", streaming: true },
      ],
      lastFrameAt: Date.now() - 16_000,
    });
    render(<AiChatPanel projectId={PID} selectedId={null} />);

    const warn = await screen.findByText(/秒没有新数据/);
    expect(warn).toHaveTextContent("已 16 秒没有新数据——模型可能卡住或网络中断，可点取消后重试");

    // 终态（非 streaming）恒不显示：phase 切回 idle 后警示行消失
    useAiStore.setState({ phase: "idle" });
    await waitFor(() => {
      expect(screen.queryByText(/秒没有新数据/)).toBeNull();
    });
  });
});

describe("ChangePlanCard 三要素门槛", () => {
  const OPS = [{ op: "node.update" as const, id: "stat", props: { tone: "warning" as const } }];

  it("三要素齐备（plan/范围/摘要）→ 应用/取消按钮可用并展示三要素", () => {
    render(
      <ChangePlanCard
        pendingPlan={{ plan: "规划：把指标卡改成警告色。", ops: OPS }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/把指标卡改成警告色/)).toBeInTheDocument(); // ① 目的
    const scope = planScope(OPS);
    expect(screen.getByText(/stat/)).toBeInTheDocument(); // ② 涉及节点
    expect(screen.getByText(/1/)).toBeInTheDocument(); // ③ 影响摘要（ops 条数）
    expect(screen.getByRole("button", { name: "应用变更" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
  });

  it("plan 为空 → 应用按钮禁用（门槛不齐不可确认）", () => {
    render(
      <ChangePlanCard
        pendingPlan={{ plan: "", ops: OPS }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "应用变更" })).toBeDisabled();
  });

  it("document 模式（整页生成）：摘要为整页生成、范围为文档名", () => {
    render(
      <ChangePlanCard
        pendingPlan={{ plan: "规划：AppShell 结构。", document: docAsWhole(DOC) }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/整页生成/)).toBeInTheDocument();
    expect(screen.getByText(/草稿/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用变更" })).toBeEnabled();
  });

  it("确认触发 onConfirm；取消触发 onDismiss", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ChangePlanCard pendingPlan={{ plan: "p", ops: OPS }} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "应用变更" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("pendingPlan 为 null → 不渲染", () => {
    const { container } = render(
      <ChangePlanCard pendingPlan={null} onConfirm={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ChangePlanCard 工具轨迹摘要（P6-4）", () => {
  const TRACE = [
    { name: "insert_node", ok: true, message: "已插入指标卡" },
    { name: "set_token", ok: true, message: "已更新颜色" },
    { name: "insert_node", ok: true, message: "已插入按钮" },
    { name: "update_props", ok: false, message: "越权拒绝" },
  ];

  it("有失败：摘要为「经 4 步：成功 3 · 失败 1 · 失败项已回传模型」", () => {
    render(
      <ChangePlanCard
        pendingPlan={{ plan: "规划：多步生成。", ops: [{ op: "node.update", id: "stat", props: {} }], toolTrace: TRACE }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const summary = screen.getByLabelText("工具轨迹摘要");
    expect(summary).toHaveTextContent("经 4 步：成功 3 · 失败 1 · 失败项已回传模型");
  });

  it("全成功：摘要不含失败提示", () => {
    render(
      <ChangePlanCard
        pendingPlan={{ plan: "规划：多步生成。", ops: [{ op: "node.update", id: "stat", props: {} }], toolTrace: TRACE.slice(0, 2) }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("工具轨迹摘要")).toHaveTextContent("经 2 步：成功 2 · 失败 0");
    expect(screen.getByLabelText("工具轨迹摘要")).not.toHaveTextContent("失败项已回传模型");
  });

  it("无 toolTrace → 不渲染摘要行", () => {
    const { container } = render(
      <ChangePlanCard
        pendingPlan={{ plan: "规划：无工具轨迹。", ops: [{ op: "node.update", id: "stat", props: {} }] }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("工具轨迹摘要")).toBeNull();
    expect(container.textContent).not.toContain("经 0 步");
  });
});

describe("ChangePlanCard 空间指令人话 diff（P5-4）", () => {
  const frameOp = (frame: { x: number; y: number; w: number; h: number; rotation: number }) =>
    ({ op: "setFrame" as const, nodeId: "stat", frame });

  /** beforeEach 的 DOC 中 stat 无 frame；带 frame 的场景用本函数落 editorStore。 */
  const setDocWithFrame = (frame: { x: number; y: number; w: number; h: number; rotation: number }): void => {
    const root = DOC.nodes[0]!;
    const stat = DOC.nodes[1]!;
    useEditorStore.setState({
      document: docAsWhole({ ...DOC, nodes: [{ ...root }, { ...stat, frame }] }),
    });
  };

  it("无既有 frame：渲染纯 位置/尺寸 行（rotation 0 不显示）", () => {
    render(
      <ChangePlanCard
        pendingPlan={{ plan: "规划：移动指标卡。", ops: [frameOp({ x: 320, y: 80, w: 240, h: 120, rotation: 0 })] }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("位置 (320, 80) · 尺寸 240×120")).toBeInTheDocument();
    expect(screen.queryByText(/旋转/)).toBeNull(); // rotation 0 不显示
  });

  it("有既有 frame：箭头形式展示 位置 → 与 尺寸 →", () => {
    setDocWithFrame({ x: 120, y: 40, w: 200, h: 100, rotation: 0 });
    render(
      <ChangePlanCard
        pendingPlan={{ plan: "规划：移动指标卡。", ops: [frameOp({ x: 320, y: 80, w: 240, h: 120, rotation: 0 })] }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByText("位置 (120, 40) → (320, 80) · 尺寸 200×100 → 240×120"),
    ).toBeInTheDocument();
  });

  it("rotation 变化显示旋转 → 箭头；坐标未变不出现位置行", () => {
    setDocWithFrame({ x: 120, y: 40, w: 200, h: 100, rotation: 45 });
    const { container } = render(
      <ChangePlanCard
        pendingPlan={{
          plan: "规划：旋转指标卡。",
          ops: [frameOp({ x: 120, y: 40, w: 200, h: 100, rotation: 90 })],
        }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("旋转 45° → 90°");
    expect(container.textContent).not.toContain("位置 ("); // 坐标未变不出现位置行
  });

  it("无既有 frame + rotation 90 → 单行含「旋转 90°」", () => {
    const { container } = render(
      <ChangePlanCard
        pendingPlan={{
          plan: "规划：旋转指标卡。",
          ops: [frameOp({ x: 0, y: 0, w: 240, h: 120, rotation: 90 })],
        }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("旋转 90°");
  });

  it("setFrame op 不渲染裸 JSON（diff 列表内无 setFrame 字面量）", () => {
    setDocWithFrame({ x: 120, y: 40, w: 200, h: 100, rotation: 0 });
    const { container } = render(
      <ChangePlanCard
        pendingPlan={{
          plan: "规划：移动指标卡。",
          ops: [frameOp({ x: 320, y: 80, w: 240, h: 120, rotation: 0 })],
        }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("位置 (120, 40) → (320, 80) · 尺寸 200×100 → 240×120")).toBeInTheDocument();
    // 「位置与尺寸」dd 内不出现 op 名/nodeId/JSON 字面量（plan 文案不含 setFrame，故全文断言安全）
    const spatialList = screen.getByText(/位置 \(/).closest("dd")!;
    expect(spatialList.textContent).not.toContain("setFrame");
    expect(spatialList.textContent).not.toContain('"op"');
    expect(spatialList.textContent).not.toContain("nodeId");
  });
});

describe("SettingsDialog", () => {
  const maskedSettings = {
    provider: "mock" as const,
    openai: { baseUrl: "https://api.openai.com/v1", apiKey: "" as const, model: "gpt-4o" },
    ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
    temperature: 0.2,
    hasKey: true,
    keyHint: "abcd",
  };

  it("打开即拉取掩码 settings；已配置 key 显示末 4 位提示且输入框留空", async () => {
    const { getSettings } = await import("../../api/client");
    vi.mocked(getSettings).mockResolvedValue(maskedSettings);
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    const keyInput = await screen.findByLabelText("API Key");
    expect(keyInput).toHaveValue("");
    expect(screen.getByText(/\*\*\*\*abcd/)).toBeInTheDocument();
  });

  it("切换 provider 到 openai-compat 时展示数据范围清单 role=note", async () => {
    const { getSettings } = await import("../../api/client");
    vi.mocked(getSettings).mockResolvedValue(maskedSettings);
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    await screen.findByLabelText("API Key");
    // mock provider 下无清单
    expect(screen.queryByRole("note")).toBeNull();
    await user.click(screen.getByLabelText("openai-compat"));
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/提示词/);
    expect(note).toHaveTextContent(/Schema JSON/);
    expect(note).toHaveTextContent(/图片/);
  });

  it("保存 → PUT 形状（apiKey 留空原样发送，语义由 server 解释为保留）", async () => {
    const { getSettings, putSettings } = await import("../../api/client");
    vi.mocked(getSettings).mockResolvedValue(maskedSettings);
    vi.mocked(putSettings).mockResolvedValue(maskedSettings);
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    await screen.findByLabelText("API Key");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(putSettings).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "mock", temperature: 0.2 }),
      );
    });
  });

  it("测试连接 → POST /api/model/test 结果展示", async () => {
    const { getSettings, testModel } = await import("../../api/client");
    vi.mocked(getSettings).mockResolvedValue(maskedSettings);
    vi.mocked(testModel).mockResolvedValue({ ok: true, sample: "pong" });
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    await screen.findByLabelText("API Key");
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/连接成功/)).toBeInTheDocument();
    expect(testModel).toHaveBeenCalledTimes(1);
  });

  it("open=false 时不渲染", () => {
    const { container } = render(<SettingsDialog open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("P7 修复回归：可读气泡", () => {
  it("流式 done 后聊天气泡显示可读 plan 文本，而非原始 JSON", async () => {
    mockStreamOnce([
      '{"plan": "把品牌色换成暖色", "ops": []}',
      { done: true, text: '{"plan": "把品牌色换成暖色", "ops": []}' },
    ]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId="p-1" selectedId={null} />);
    await user.type(screen.getByLabelText("AI 指令"), "整体换成暖色品牌色");
    await user.click(screen.getByRole("button", { name: "发送" }));
    // 中性 notice 横幅（同文案也进入归档时间线卡片标题，故按 role 定位）。
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/把品牌色换成暖色/);
    // 气泡仍显示可读的 plan 文本，而非原始 JSON
    expect(screen.getByText(/把品牌色换成暖色（0 个变更操作）/)).toBeInTheDocument();
    expect(screen.queryByText(/{\"plan\"/)).not.toBeInTheDocument();
  });
});

describe("ChangePlanCard 命令清单（P7.3）", () => {
  const COMMANDS = [
    {
      invocationId: "inv-1",
      commandId: "slide.rename",
      title: "重命名幻灯片",
      riskLevel: "low" as const,
      args: {},
      summary: "改为「Q3 复盘」",
    },
    { invocationId: "inv-2", commandId: "slide.insert", title: "插入小结页", riskLevel: "high" as const, args: {} },
  ];
  const PLAN = {
    plan: "规划：两步调整。",
    commands: COMMANDS,
    scope: { kind: "container" as const, targetIds: ["slide-1"] },
  };

  it("渲染命令清单：默认折叠为摘要，展开后标题/摘要/风险徽章/范围行 + 全部应用（含条数）", async () => {
    const user = userEvent.setup();
    render(<ChangePlanCard pendingPlan={PLAN} onConfirm={vi.fn()} onDismiss={vi.fn()} />);
    // 默认不铺逐条按钮——只给摘要与主操作
    expect(screen.queryByRole("button", { name: /接受此条/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /展开 2 条命令明细/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /全部应用（2）/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "全部拒绝" })).toBeEnabled();
    // 展开明细后可见逐条
    await user.click(screen.getByRole("button", { name: /展开 2 条命令明细/ }));
    expect(screen.getByText("重命名幻灯片")).toBeInTheDocument();
    expect(screen.getByText("改为「Q3 复盘」")).toBeInTheDocument();
    expect(screen.getByText("低风险")).toBeInTheDocument();
    expect(screen.getByText("高风险")).toBeInTheDocument();
    expect(screen.getByText(/2 条命令/)).toBeInTheDocument();
    expect(screen.getByText(/选中容器/)).toBeInTheDocument();
  });

  it("逐条接受：调 onAcceptCommand(该条)；进行中其余按钮禁用（防双击重复重放）", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const onAccept = vi.fn().mockReturnValue(gate);
    render(
      <ChangePlanCard
        pendingPlan={PLAN}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
        onAcceptCommand={onAccept}
        onSkipCommand={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /展开 2 条命令明细/ }));
    await user.click(screen.getByRole("button", { name: "接受此条：重命名幻灯片" }));
    expect(onAccept).toHaveBeenCalledWith(COMMANDS[0]);
    expect(screen.getByRole("button", { name: "接受此条：插入小结页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "跳过：插入小结页" })).toBeDisabled();

    release();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "接受此条：插入小结页" })).toBeEnabled();
    });
  });

  it("跳过：直接调 onSkipCommand(该条)，不触发接受", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onSkip = vi.fn();
    render(
      <ChangePlanCard
        pendingPlan={PLAN}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
        onAcceptCommand={onAccept}
        onSkipCommand={onSkip}
      />,
    );
    await user.click(screen.getByRole("button", { name: /展开 2 条命令明细/ }));
    await user.click(screen.getByRole("button", { name: "跳过：插入小结页" }));
    expect(onSkip).toHaveBeenCalledWith(COMMANDS[1]);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("全部应用 → onConfirm；全部拒绝 → onDismiss", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ChangePlanCard
        pendingPlan={PLAN}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        onAcceptCommand={vi.fn()}
        onSkipCommand={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /全部应用（2）/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "全部拒绝" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("AiChatPanel 选中快捷 chips（W1-A）", () => {
  it("有选中：渲染该类型的快捷动作 chips，点击填入输入框", async () => {
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="stat" />);

    expect(screen.getByLabelText("选中快捷操作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加阴影" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "加阴影" }));
    expect(screen.getByLabelText("AI 指令")).toHaveValue("给这个卡片加一层柔和阴影效果");
  });

  it("无选中：不渲染 chips 行", () => {
    render(<AiChatPanel projectId={PID} selectedId={null} />);
    expect(screen.queryByLabelText("选中快捷操作")).toBeNull();
  });

  it("选中发送：出站文本带选中摘要前缀", async () => {
    mockStreamOnce([{ done: true, text: JSON.stringify({ plan: "p", ops: [] }) }]);
    const user = userEvent.setup();
    // Chip clicks in sibling tests persist a draft under the same project id.
    useAiStore.setState({ composerDrafts: {} });
    render(<AiChatPanel projectId={PID} selectedId="stat" />);

    await user.type(screen.getByLabelText("AI 指令"), "改成警告色");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.messages.at(-1)?.content).toBe("【选中：指标卡「今日活跃」】改成警告色 target:stat");
  });
});

describe("AiChatPanel toolkit 项目发送（P7.3）", () => {
  it("ppt 项目：mode=patch，scope 取工具包选择（kind/targetIds），文本不拼 target 标记", async () => {
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: [] });
    mockStreamOnce([{ done: true, text: "done" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} projectType="ppt" selectedId={null} />);

    await user.type(screen.getByLabelText("AI 指令"), "把这一页标题改大");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.mode).toBe("patch");
    expect(body.scope).toEqual({ kind: "container", targetIds: ["slide-1"] });
    expect(body.messages.at(-1)?.content).toBe("把这一页标题改大"); // 无 target: 拼接
  });

  it("ppt 项目多选对象：scope 为 selection + 全部目标，chip 显示局部数量", async () => {
    usePptEditorStore.setState({ selectedSlideId: "slide-1", selectedObjectIds: ["o1", "o2"] });
    mockStreamOnce([{ done: true, text: "done" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} projectType="ppt" selectedId={null} />);

    expect(screen.getByText(/局部 · 2 个对象/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("AI 指令"), "统一左对齐");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.scope).toEqual({ kind: "selection", targetIds: ["o1", "o2"] });
  });

  it("word 项目块选中：scope 为 selection；无选中 → file 空 targetIds", async () => {
    mockStreamOnce([{ done: true, text: "done" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} projectType="word" selectedId={null} />);

    await user.type(screen.getByLabelText("AI 指令"), "润色一下");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.scope).toEqual({ kind: "file", targetIds: [] });

    // 块选中后重新发送：scope 收窄为 selection
    useWordEditorStore.setState({ selection: { sectionId: "sec-1", blockId: "block-1", blockIds: ["block-1"] } });
    await user.type(screen.getByLabelText("AI 指令"), "再加粗这段");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect((mockedStream.mock.calls[1]?.[0] as StreamChatBody).scope).toEqual({
        kind: "selection",
        targetIds: ["block-1"],
      });
    });
  });
});

describe("ChangePlanCard 多方案候选 tab（T61 W3-B）", () => {
  const altDoc = (name: string): StudioDocument => defaultStudioDocument(name);

  /** Renders the card against the live aiStore so tab clicks re-render it. */
  function CardHarness({ onConfirm }: { onConfirm: () => void }) {
    const plan = useAiStore((s) => s.pendingPlan);
    return <ChangePlanCard pendingPlan={plan} onConfirm={onConfirm} onDismiss={vi.fn()} />;
  }

  it("done 带 alternatives：卡片出 3 tab；多方案 toggle 随请求上行；点方案 2 确认应用 alternatives[0]", async () => {
    mockStreamOnce([
      {
        done: true,
        validated: "document",
        text: JSON.stringify({ plan: "生成运营工作台" }),
        document: docAsWhole(DOC),
        alternatives: [altDoc("备选A"), altDoc("备选B")],
      },
    ]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);

    // OP-3 toggle: 多方案 ×2 rides on the outbound generate request body.
    await user.selectOptions(screen.getByLabelText("方案数量"), "2");
    await user.type(screen.getByLabelText("AI 指令"), "生成一个运营工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await vi.waitFor(() => {
      expect(useAiStore.getState().phase).toBe("awaiting-confirm");
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody & { variants?: number };
    expect(body.variants).toBe(2);

    const applied: StudioDocument[] = [];
    useEditorStore.setState({
      applyOp: (fn) => {
        applied.push(fn(useEditorStore.getState().document as StudioDocument));
        return true;
      },
    });
    render(<CardHarness onConfirm={() => void useAiStore.getState().confirm(PID)} />);
    expect(screen.getByTestId("variant-tab-0")).toHaveTextContent("方案 1");
    expect(screen.getByTestId("variant-tab-1")).toHaveTextContent("方案 2");
    expect(screen.getByTestId("variant-tab-2")).toHaveTextContent("方案 3");

    await user.click(screen.getByTestId("variant-tab-1"));
    expect(screen.getByTestId("variant-tab-1")).toHaveAttribute("aria-selected", "true");
    // Per-tab preview: 范围 line follows the active candidate document.
    expect(screen.getByText(/备选A/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "应用变更" }));
    await vi.waitFor(() => {
      expect(useAiStore.getState().phase).toBe("idle");
    });
    expect(applied[0]?.name).toBe("备选A"); // tab 1 = alternatives[0]
  });

  it("坏 alternative 丢弃：只剩有效候选 tab", async () => {
    mockStreamOnce([
      {
        done: true,
        validated: "document",
        text: JSON.stringify({ plan: "生成运营工作台" }),
        document: docAsWhole(DOC),
        alternatives: [altDoc("备选A"), { broken: true }, altDoc("备选B")],
      },
    ]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);
    await user.type(screen.getByLabelText("AI 指令"), "生成一个运营工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await vi.waitFor(() => {
      expect(useAiStore.getState().phase).toBe("awaiting-confirm");
    });
    expect(useAiStore.getState().pendingPlan?.alternatives?.length).toBe(2);

    render(<CardHarness onConfirm={vi.fn()} />);
    // 2 valid candidates remain -> 3 tabs (方案 1/2/3); without the drop there would be 4.
    expect(screen.getByTestId("variant-tab-2")).toBeInTheDocument();
    expect(screen.queryByTestId("variant-tab-3")).toBeNull();
  });
});

/** T14 G2/G3: chip 清除与 per-turn scope trace（display-only，不进出站文本）。 */
describe("AiChatPanel scope chip 清除与 trace（T14）", () => {
  it("E1 点击清除按钮 → editorStore 选中清空，chip 回整页生成", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AiChatPanel projectId={PID} selectedId="stat" />);
    expect(screen.getByText("局部 · StatCard stat")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清除选中范围" }));
    expect(useEditorStore.getState().selectedId).toBeNull();
    expect(useEditorStore.getState().selectedIds).toEqual([]);

    // 面板选中 props 由宿主下发（App 同款）：选中清空后 chip 回退整页。
    rerender(<AiChatPanel projectId={PID} selectedId={null} />);
    expect(screen.getByText("整页生成（未选中节点）")).toBeInTheDocument();
  });

  it("E2 patch 发送：用户气泡带 scope trace 行，出站文本不含 trace", async () => {
    mockStreamOnce([{ done: true, text: JSON.stringify({ plan: "p", ops: [] }) }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="stat" />);

    await user.type(screen.getByLabelText("AI 指令"), "改成警告色");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });

    // G3 主方案：气泡内渲染 trace 行（CustomEvent 旁路，display-only）。
    expect(screen.getByText("（本次对话针对选中的这个元素）")).toBeInTheDocument();
    // Q6 红线：trace 不进 ChatLogMessage.text → 不进下轮出站上下文。
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.messages.at(-1)?.content).toBe("【选中：指标卡「今日活跃」】改成警告色 target:stat");
    expect(body.messages.at(-1)?.content).not.toContain("本次对话针对");
  });

  it("E3 generate 发送：不产生 trace 行", async () => {
    mockStreamOnce(["planning", { done: true, text: "规划文本" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);

    await user.type(screen.getByLabelText("AI 指令"), "生成一个运营工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });

    expect(screen.getByText("生成一个运营工作台")).toBeInTheDocument();
    expect(screen.queryByText(/本次对话针对/)).toBeNull();
  });
});
