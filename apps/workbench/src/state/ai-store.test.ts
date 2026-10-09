import {
  defaultPage,
  defaultStudioDocument,
  validateDocument,
  type Page,
  type StudioDocument,
} from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat, type ChatEvent, type StreamChatBody } from "../api/client";
import { db } from "../db/db";
import { useEditorStore } from "./editorStore";
import { useAiStore } from "./aiStore";
import type { ToolkitCommand } from "../features/ai/types";
import * as versionStore from "./versionStore";
import { emptyStack } from "./undoStack";
/** T19: store/document APIs consume the WHOLE doc; tests pass a page fixture. */
function docAsWhole(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}



// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    streamChat: vi.fn(),
    cancelChat: vi.fn(),
  };
});

const mockedStream = vi.mocked(streamChat);

const PID = "00000000-0000-4000-8000-000000000000";

/** Dashboard doc matching the mock provider's generate output shape. */
const GEN_DOC: StudioDocument = validateDocument({
  documentVersion: 1,


  name: "运营工作台",
  tokens: {
    color: {
      brand: "#0F766E", surface: "#FFFFFF", text: "#172033", muted: "#64748B",
      border: "#E2E8F0", accent: "#0EA5E9", success: "#16A34A", warning: "#D97706", danger: "#DC2626",
    },
    radius: { card: 6, control: 4 },
    spacing: { unit: 4 },
    font: { sans: "Inter, system-ui, sans-serif" },
  },
  rootId: "m_root",
  nodes: [
    { id: "m_root", type: "AppShell", props: { title: "运营工作台", sidebar: true }, children: ["m_header"] },
    { id: "m_header", type: "Header", props: { title: "运营工作台", subtitle: "" }, children: [] },
  ],
});

const GEN_TEXT = JSON.stringify({ plan: "规划：AppShell 根 + Header。", document: GEN_DOC });

function freshDoc(): Page {
  return { ...defaultPage("草稿"), rootId: "root",
    nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
  };
}

/** Non-blank doc (has one content node) for mode decisions that need patchability. */
function freshDocWithNode(): Page {
  return {
    ...freshDoc(),
    nodes: [
      { id: "root", type: "Container", props: {}, children: ["n1"] },
      { id: "n1", type: "Text", props: { content: "正文", muted: false }, children: [] },
    ],
  };
}

/** Replay a scripted event list through the mocked streamChat. */
function mockStreamOnce(events: (string | ChatEvent)[]): void {
  mockedStream.mockImplementationOnce(async (_body, handlers) => {
    for (const ev of events) {
      if (typeof ev === "string") handlers.onDelta(ev);
      else handlers.onEvent(ev);
    }
  });
}

beforeEach(async () => {
  await db.versions.clear();
  vi.clearAllMocks();
  useEditorStore.setState({
    projectId: PID,
    meta: null,
    document: docAsWhole(freshDoc()),
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
});

describe("aiStore send — 流式与终态", () => {
  it("流式 delta 累积渲染到 assistant 占位消息；plan 模式 done 不产生确认卡", async () => {
    mockStreamOnce(['{"plan"', ': "文本规划"}', { done: true, text: '{"plan": "文本规划"}' }]);
    await useAiStore.getState().send({ projectId: PID, text: "生成工作台", mode: "plan" });

    const msgs = useAiStore.getState().messages;
    expect(msgs).toHaveLength(3); // user + assistant 气泡 + 归档时间线卡片
    expect(msgs[0]).toMatchObject({ role: "user", text: "生成工作台", streaming: false });
    // done 后聊天气泡显示可读 plan 文本，而非原始 JSON
    expect(msgs[1]).toMatchObject({ role: "assistant", text: "文本规划", streaming: false });
    expect(msgs[2]?.kind).toBe("activity");
    expect(useAiStore.getState().phase).toBe("idle");
    expect(useAiStore.getState().pendingPlan).toBeNull();
  });

  it("generate done+validated → awaiting-confirm，pendingPlan.document 就绪", async () => {
    mockStreamOnce([
      "段1",
      { done: true, text: GEN_TEXT, validated: "document", document: GEN_DOC },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成运营工作台", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("awaiting-confirm");
    expect(s.pendingPlan?.document).toEqual(GEN_DOC);
    expect(s.pendingPlan?.plan).toContain("AppShell");
  });

  it("patch done → {plan, ops} 经 patchOpSchema 校验入 pendingPlan", async () => {
    const patchText = JSON.stringify({
      plan: "规划：仅更新所选节点。",
      ops: [{ op: "node.update", id: "root", props: {} }],
    });
    mockStreamOnce([{ done: true, text: patchText }]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 target:root", mode: "patch" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("awaiting-confirm");
    expect(s.pendingPlan?.ops).toEqual([{ op: "node.update", id: "root", props: {} }]);
    expect(s.pendingPlan?.plan).toContain("所选节点");
  });

  it("patch 结构不合法（patchOpSchema 拒绝）→ phase=error 保留 raw", async () => {
    const patchText = JSON.stringify({ plan: "p", ops: [{ op: "node.nuke", id: "x" }] });
    mockStreamOnce([{ done: true, text: patchText }]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 target:root", mode: "patch" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("AI 返回的操作集不合法");
    expect(s.error).toContain(patchText); // raw 保留在 error 文本中
    expect(s.pendingPlan).toBeNull();
  });

  it("badjson（error invalid_json）→ phase=error 且 raw 保留", async () => {
    const raw = "抱歉，这次不是 JSON。";
    mockStreamOnce([
      "抱歉",
      { error: "invalid_json", raw },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 badjson", mode: "patch" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("invalid_json");
    expect(s.error).toContain(raw);
  });

  it("violation 事件 → violations 展示且流继续（server 自动重试后 done）", async () => {
    const patchText = JSON.stringify({ plan: "p", ops: [{ op: "node.update", id: "root", props: {} }] });
    mockStreamOnce([
      { violation: ["节点 root 超出修改范围"], retry: true },
      "重试",
      { done: true, text: patchText },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 违规 target:root", mode: "patch" });

    const s = useAiStore.getState();
    expect(s.violations).toEqual(["节点 root 超出修改范围"]); // 展示保留
    expect(s.phase).toBe("awaiting-confirm"); // 且流程继续走完
  });

  it("canceled → phase=idle，streaming 消息收尾", async () => {
    mockStreamOnce(["部分", { canceled: true }]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.messages[1]?.streaming).toBe(false);
    expect(s.messages[1]?.text).toBe("部分");
    // 取消同样归档时间线（status canceled），live activity 清空
    expect(s.messages.at(-1)?.activity?.status).toBe("canceled");
    expect(s.activity).toBeNull();
  });

  it("请求体带 requestId/messages/mode/scope；网络层异常 → error", async () => {
    mockedStream.mockImplementationOnce(async () => {
      throw new Error("无法连接本地服务");
    });
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });
    expect(useAiStore.getState().phase).toBe("error");
    expect(useAiStore.getState().error).toContain("无法连接本地服务");

    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.requestId).toBeTruthy();
    expect(body.mode).toBe("generate");
    expect(body.messages.at(-1)).toMatchObject({ role: "user", content: "生成" });
  });
});

describe("aiStore confirm/cancel/clear", () => {
  it("confirm 应用 document：editorStore dirty=true，回退点存为 AI 回退点版本", async () => {
    const spy = vi.spyOn(versionStore, "saveVersion").mockResolvedValue({
      versionId: "v-ai", projectId: PID, name: "AI 回退点", createdAt: "t",
      document: null,
    });
    const before = useEditorStore.getState().document!;
    mockStreamOnce([{ done: true, text: GEN_TEXT, validated: "document", document: GEN_DOC }]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    await useAiStore.getState().confirm(PID);
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.pendingPlan).toBeNull();
    expect(s.rollbackDoc).toEqual(before); // 回退点留存
    expect(useEditorStore.getState().document).toEqual(GEN_DOC);
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(spy).toHaveBeenCalledWith(PID, "AI 回退点", before);
    spy.mockRestore();
  });

  it("confirm 应用 ops：editorStore 文档更新 + saveVersion 以回退点被调", async () => {
    const spy = vi.spyOn(versionStore, "saveVersion").mockResolvedValue({
      versionId: "v-ai2", projectId: PID, name: "AI 回退点", createdAt: "t",
      document: null,
    });
    const patchText = JSON.stringify({
      plan: "规划：更新根容器。",
      ops: [{ op: "tokens.set", path: ["color", "brand"], value: "#123456" }],
    });
    mockStreamOnce([{ done: true, text: patchText }]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 target:root", mode: "patch" });

    const before = useEditorStore.getState().document!;
    await useAiStore.getState().confirm(PID);
    expect((useEditorStore.getState().document as StudioDocument | null)?.tokens.color.brand).toBe("#123456");
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useAiStore.getState().rollbackDoc).toEqual(before);
    expect(spy).toHaveBeenCalledWith(PID, "AI 回退点", before);
    spy.mockRestore();
  });

  it("ops 引用不存在节点（updateProps 抛 OpError）→ 不切换文档、error 展示", async () => {
    const spy = vi.spyOn(versionStore, "saveVersion");
    const patchText = JSON.stringify({
      plan: "p",
      ops: [{ op: "node.update", id: "ghost", props: {} }],
    });
    mockStreamOnce([{ done: true, text: patchText }]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 target:ghost", mode: "patch" });

    const before = useEditorStore.getState().document!;
    await useAiStore.getState().confirm(PID);
    // applyPatch 全或无：文档不变（applyOp 捕获 OpError）
    expect(useEditorStore.getState().document).toEqual(before);
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useAiStore.getState().phase).toBe("error");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("cancel：cancelChat(requestId) + phase=idle + streaming 收尾", async () => {
    // mock 一次可暂停的流：send 发出后挂起，cancel 先行，再放行收尾
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onDelta("段落");
      await gate; // 保持 streaming 状态直到测试放行
    });
    const sending = useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });
    await vi.waitFor(() => {
      expect(useAiStore.getState().requestId).toBeTruthy();
    });
    const rid = useAiStore.getState().requestId!;
    expect(useAiStore.getState().phase).toBe("streaming");

    await useAiStore.getState().cancel();
    expect(useAiStore.getState().phase).toBe("idle");
    expect(useAiStore.getState().messages[1]?.streaming).toBe(false);
    const { cancelChat } = await import("../api/client");
    expect(vi.mocked(cancelChat)).toHaveBeenCalledWith(rid);

    release();
    await sending;
  });

  it("clear 重置全部状态", async () => {
    mockStreamOnce([{ done: true, text: GEN_TEXT, validated: "document", document: GEN_DOC }]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });
    expect(useAiStore.getState().phase).toBe("awaiting-confirm");

    useAiStore.getState().clear();
    const s = useAiStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.phase).toBe("idle");
    expect(s.pendingPlan).toBeNull();
    expect(s.violations).toBeNull();
    expect(s.requestId).toBeNull();
    expect(s.rollbackDoc).toBeNull();
  });
});

describe("aiStore helpers", () => {
  it("modeFor：选中 → patch 且消息文本拼 target:<id>；未选中 → generate 原文", () => {
    expect(useAiStore.getState().modeFor("n_stat_1", "改成警告色")).toEqual({
      mode: "patch",
      text: "改成警告色 target:n_stat_1",
    });
    expect(useAiStore.getState().modeFor(null, "改成警告色")).toEqual({
      mode: "generate",
      text: "改成警告色",
    });
  });

  it("buildScope：选中 → nodeIds 限定且 allowAllTokens=false；未选中 → undefined", () => {
    expect(useAiStore.getState().buildScope(docAsWhole(freshDoc()), "n_x")).toEqual({ nodeIds: ["n_x"], allowAllTokens: false });
    expect(useAiStore.getState().buildScope(docAsWhole(freshDoc()), null)).toBeUndefined();
  });

  it("modeFor/buildScope 多选：数组逐个拼 target 标记，scope 取并集", () => {
    expect(useAiStore.getState().modeFor(["n_a", "n_b"], "统一换成强调色")).toEqual({
      mode: "patch",
      text: "统一换成强调色 target:n_a target:n_b",
    });
    expect(useAiStore.getState().buildScope(docAsWhole(freshDoc()), ["n_a", "n_b"])).toEqual({
      nodeIds: ["n_a", "n_b"],
      allowAllTokens: false,
    });
    // 单选数组与字符串等价（画布多选退化为单选时仍走同一通路）
    expect(useAiStore.getState().modeFor(["n_a"], "改成警告色")).toEqual(
      useAiStore.getState().modeFor("n_a", "改成警告色"),
    );
  });

  it("buildScope：选中容器时展开整棵子树（容器内部元素在范围内）", () => {
    const doc: Page = {
      ...freshDoc(),
      nodes: [
        { id: "root", type: "Container", props: {}, children: ["card", "other"] },
        { id: "card", type: "Container", props: {}, children: ["title", "button"] },
        { id: "title", type: "Heading", props: { text: "t" }, children: [] },
        { id: "button", type: "Button", props: { label: "b" }, children: [] },
        { id: "other", type: "Text", props: { text: "o" }, children: [] },
      ],
    };
    const scope = useAiStore.getState().buildScope(docAsWhole(doc), "card");
    expect(scope?.nodeIds.sort()).toEqual(["button", "card", "title"]);
    expect(scope?.nodeIds).not.toContain("other");
  });

  it("send 局部修改：mode=patch 时请求带 scope（nodeIds=选中）", async () => {
    const patchText = JSON.stringify({ plan: "p", ops: [{ op: "node.update", id: "root", props: {} }] });
    mockStreamOnce([{ done: true, text: patchText }]);
    const decision = useAiStore.getState().modeFor("root", "修改颜色");
    await useAiStore.getState().send({
      projectId: PID,
      text: decision.text,
      mode: decision.mode,
      scope: useAiStore.getState().buildScope(docAsWhole(freshDoc()), "root"),
    });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.mode).toBe("patch");
    expect(body.scope).toEqual({ nodeIds: ["root"], allowAllTokens: false });
    expect(body.messages.at(-1)?.content).toContain("target:root");
  });
});

describe("aiStore send — 活动时间线（activity timeline）", () => {
  /** Latest archived timeline card from the message list. */
  const archivedActivity = () => {
    const cards = useAiStore.getState().messages.filter((m) => m.kind === "activity");
    return cards[cards.length - 1]?.activity;
  };

  it("tool-call/tool-result 逐步累积为时间线步骤：中文动作名、结果摘要、done 后归档", async () => {
    mockStreamOnce([
      { type: "tool-call", name: "insert_node", args: {} },
      { type: "tool-result", name: "insert_node", ok: true, message: "已插入指标卡" },
      { type: "tool-call", name: "set_frame", args: {} },
      { type: "tool-result", name: "set_frame", ok: true, message: "已调整位置" },
      { done: true, text: GEN_TEXT, validated: "document", document: GEN_DOC },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.activity).toBeNull(); // 终态后 live activity 已清空
    const card = archivedActivity();
    expect(card?.status).toBe("done");
    const tools = card?.steps.filter((step) => step.kind === "tool");
    expect(tools).toHaveLength(2);
    expect(tools?.[0]).toMatchObject({
      name: "insert_node",
      label: "插入节点",
      status: "done",
      detail: "已插入指标卡",
    });
    expect(tools?.[1]).toMatchObject({ name: "set_frame", label: "调整位置与尺寸", status: "done" });
    // 归档头部：generate → "文档已生成 · 耗时 Ns"；patch 计划走"变更计划已生成"
    expect(card?.resultTitle).toMatch(/^文档已生成 · 耗时 \d+s$/);
  });

  it("tool-result 失败：对应步骤标 failed 且携带原因；toolTrace 同步累积", async () => {
    mockStreamOnce([
      { type: "tool-call", name: "insert_node", args: {} },
      { type: "tool-result", name: "insert_node", ok: true, message: "已插入指标卡" },
      { type: "tool-result", name: "update_props", ok: false, message: "越权拒绝：节点超出范围" },
      { done: true, text: GEN_TEXT, validated: "document", document: GEN_DOC },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const tools = archivedActivity()?.steps.filter((step) => step.kind === "tool");
    expect(tools?.[0]?.status).toBe("done");
    // update_props 没有对应 tool-call（服务端异常序列），无 running 可关，不产生步骤——
    // 但 toolTrace 仍逐帧累积给确认卡摘要。
    expect(useAiStore.getState().pendingPlan?.toolTrace).toEqual([
      { name: "insert_node", ok: true, message: "已插入指标卡" },
      { name: "update_props", ok: false, message: "越权拒绝：节点超出范围" },
    ]);
  });

  it("done：运行中 toolTrace 移入 pendingPlan.toolTrace，运行态清空", async () => {
    mockStreamOnce([
      { type: "tool-result", name: "insert_node", ok: true, message: "已插入指标卡" },
      { type: "tool-result", name: "update_props", ok: false, message: "参数错误" },
      { done: true, text: GEN_TEXT, validated: "document", document: GEN_DOC },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.toolTrace).toEqual([]); // 运行态已复位
    expect(s.pendingPlan?.toolTrace).toEqual([
      { name: "insert_node", ok: true, message: "已插入指标卡" },
      { name: "update_props", ok: false, message: "参数错误" },
    ]);
  });

  it("patch done：toolTrace 同样进入 pendingPlan（plan/ops 契约不破坏）", async () => {
    const patchText = JSON.stringify({
      plan: "规划：仅更新所选节点。",
      ops: [{ op: "node.update", id: "root", props: {} }],
    });
    mockStreamOnce([
      { type: "tool-result", name: "update_props", ok: true, message: "已更新属性" },
      { done: true, text: patchText },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 target:root", mode: "patch" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("awaiting-confirm");
    expect(s.pendingPlan?.ops).toEqual([{ op: "node.update", id: "root", props: {} }]);
    expect(s.pendingPlan?.toolTrace).toEqual([{ name: "update_props", ok: true, message: "已更新属性" }]);
  });

  it("error 帧：时间线归档为 error，进行中的工具步骤标 failed", async () => {
    mockStreamOnce([
      { type: "tool-call", name: "insert_node", args: {} },
      { error: "invalid_json", raw: "不是 JSON" },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.activity).toBeNull();
    const card = archivedActivity();
    expect(card?.status).toBe("error");
    expect(card?.errorMessage).toContain("invalid_json");
    const pendingTool = card?.steps.find((step) => step.kind === "tool");
    expect(pendingTool).toMatchObject({ name: "insert_node", status: "failed" });
    expect(s.toolTrace).toEqual([]);
  });

  it("canceled 帧：时间线归档为 canceled，步骤不标红", async () => {
    mockStreamOnce([
      { type: "tool-call", name: "insert_node", args: {} },
      { canceled: true },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    const card = archivedActivity();
    expect(card?.status).toBe("canceled");
    expect(card?.steps.some((step) => step.status === "failed")).toBe(false);
  });

  it("clear 后新一轮 send 从空时间线与空 toolTrace 起步", async () => {
    mockStreamOnce([
      { type: "tool-result", name: "insert_node", ok: true, message: "已插入指标卡" },
      { done: true, text: GEN_TEXT, validated: "document", document: GEN_DOC },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });
    await useAiStore.getState().clear();

    mockStreamOnce([{ done: true, text: '{"plan":"p"}' }]);
    await useAiStore.getState().send({ projectId: PID, text: "再生成", mode: "plan" });
    const s = useAiStore.getState();
    expect(s.toolTrace).toEqual([]);
    expect(s.pendingPlan).toBeNull();
    // user + assistant 气泡 + 本轮归档时间线卡片（即使没有任何步骤帧也归档）
    expect(s.messages).toHaveLength(3);
    expect(s.messages.at(-1)?.kind).toBe("activity");
    expect(s.activity).toBeNull();
  });
});

describe("aiStore send — 多模态 images", () => {
  it("images 挂在本轮最后一条 user 消息上，且不写入聊天记录", async () => {
    const patchText = JSON.stringify({ plan: "p", ops: [{ op: "node.update", id: "root", props: {} }] });
    mockStreamOnce([{ done: true, text: patchText }]);
    const images = ["data:image/png;base64,AAA", "data:image/png;base64,BBB"];
    await useAiStore.getState().send({
      projectId: PID,
      text: "修复截图问题",
      mode: "patch",
      scope: { nodeIds: ["root"], allowAllTokens: false },
      images,
    });

    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.messages.at(-1)).toMatchObject({ role: "user", content: "修复截图问题", images });
    // 聊天记录只留文本，不缓存 base64
    expect(useAiStore.getState().messages[0]).not.toHaveProperty("images");
  });

  it("不传 images：消息体不带 images 键（纯文本请求形状不变）", async () => {
    mockStreamOnce([{ done: true, text: '{"plan":"p"}' }]);
    await useAiStore.getState().send({ projectId: PID, text: "只发文字", mode: "plan" });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "只发文字" });
  });

  it("images 为空数组：同样不附加 images", async () => {
    mockStreamOnce([{ done: true, text: '{"plan":"p"}' }]);
    await useAiStore.getState().send({ projectId: PID, text: "空图", mode: "plan", images: [] });
    const body = mockedStream.mock.calls[0]?.[0] as StreamChatBody;
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "空图" });
  });
});

describe("aiStore send — P7 流式可见性（stage/progress/heartbeat/verify-round）", () => {
  it("stage/progress 帧更新运行态；done 后 stage/progress 清空", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onEvent({ type: "stage", id: "reading", label: "正在理解需求" });
      handlers.onEvent({ type: "progress", step: 2, total: 5, label: "生成中" });
      await gate;
      handlers.onEvent({ done: true, text: '{"plan":"p"}' }); // 终态：阶段行必须清空
    });
    const sending = useAiStore.getState().send({ projectId: PID, text: "生成", mode: "plan" });
    await vi.waitFor(() => {
      expect(useAiStore.getState().stage).toEqual({ id: "reading", label: "正在理解需求" });
    });
    expect(useAiStore.getState().progress).toEqual({ step: 2, total: 5 });
    release();
    await sending;

    const s = useAiStore.getState();
    expect(s.stage).toBeNull();
    expect(s.progress).toBeNull();
  });

  it("verify-round → stage 人话化（含轮次）", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onEvent({ type: "verify-round", round: 2, issues: ["缺 header"] });
      await gate;
    });
    const sending = useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });
    await vi.waitFor(() => {
      expect(useAiStore.getState().stage).toEqual({
        id: "verify",
        label: "文档校验未通过，自动修复中（第 2 轮）",
        round: 2,
      });
    });
    release();
    await sending;
  });

  it("heartbeat 更新 lastFrameAt（停滞时钟），不写 stage/progress", async () => {
    const sentAt = Date.now();
    let atHeartbeat = 0;
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      const atSend = useAiStore.getState().lastFrameAt!;
      expect(atSend).toBeGreaterThanOrEqual(sentAt); // send 起点已置时钟
      handlers.onEvent({ type: "heartbeat", at: Date.now() });
      atHeartbeat = useAiStore.getState().lastFrameAt!;
      expect(atHeartbeat).toBeGreaterThanOrEqual(atSend); // 心跳推进停滞时钟
      expect(useAiStore.getState().stage).toBeNull(); // 心跳不产生阶段
      expect(useAiStore.getState().progress).toBeNull();
      handlers.onEvent({ done: true, text: '{"plan":"p"}' });
    });
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "plan" });

    const s = useAiStore.getState();
    expect(s.lastFrameAt).toBeGreaterThanOrEqual(atHeartbeat); // 终态帧再刷新
    expect(s.stage).toBeNull();
    expect(s.progress).toBeNull();
  });

  it("error 终态：stage/progress 清空且不残留阶段行数据", async () => {
    mockStreamOnce([
      { type: "stage", id: "model", label: "正在生成界面" },
      { type: "progress", step: 1, total: 3, label: "生成" },
      { error: "invalid_json", raw: "不是 JSON" },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.stage).toBeNull();
    expect(s.progress).toBeNull();
  });

  it("canceled 终态：stage/progress 清空", async () => {
    mockStreamOnce([
      { type: "stage", id: "writing", label: "正在写入文档" },
      { canceled: true },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "generate" });

    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.stage).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.lastFrameAt).not.toBeNull(); // 终态帧本身刷新时钟
  });

  it("send 起点置 lastFrameAt，stage/progress 从空起步", async () => {
    mockStreamOnce([{ done: true, text: '{"plan":"p"}' }]);
    await useAiStore.getState().send({ projectId: PID, text: "生成", mode: "plan" });
    const s = useAiStore.getState();
    expect(s.stage).toBeNull();
    expect(s.progress).toBeNull();
  });

  it("notice 终态（空 ops + 有语义说明）：原样展示模型原因", async () => {
    const explanation = "当前选中节点已是最终态，无需调整。";
    mockStreamOnce([
      { type: "stage", id: "model", label: "正在思考" },
      { done: true, text: JSON.stringify({ plan: explanation, ops: [] }) },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 target:root", mode: "patch" });
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.notice).toBe(explanation);
    expect(s.stage).toBeNull();
    expect(s.progress).toBeNull();
  });

  it("notice 终态（空 ops + 空白 plan）：保持通用提示", async () => {
    mockStreamOnce([
      { type: "stage", id: "model", label: "正在思考" },
      { done: true, text: '{"plan":"   ","ops":[]}' },
    ]);
    await useAiStore.getState().send({ projectId: PID, text: "修改 target:root", mode: "patch" });
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.notice).toContain("无需修改");
    expect(s.stage).toBeNull();
    expect(s.progress).toBeNull();
  });
});

describe("P7 修复回归：token 意图与可读气泡", () => {
  it.each([
    "生成一个品牌色主题的运营工作台",
    "创建一个颜色鲜明的运营页面",
    "新建一个暖色仪表盘",
  ])("无选择时，明确的整页生成意图优先于 token 关键词：%s", (text) => {
    expect(useAiStore.getState().modeFor(null, text)).toEqual({ mode: "generate", text });
  });

  it("换色/主题类请求 → scope.allowAllTokens=true（否则模型交空 ops）", () => {
    expect(useAiStore.getState().modeFor("n1", "整体换成暖色品牌色")).toMatchObject({ mode: "patch", allowAllTokens: true });
    // 非空文档 + 无选区：token 措辞仍是 patch（空文档走 generate，见 intent-regression.test.tsx）
    expect(useAiStore.getState().modeFor(null, "把主题换成暖色", docAsWhole(freshDocWithNode()))).toMatchObject({
      mode: "patch",
      allowAllTokens: true,
    });
    expect(useAiStore.getState().modeFor("n1", "把标题加粗")).toEqual({ mode: "patch", text: "把标题加粗 target:n1" });
    // 颜色意图 + 选中：nodeIds 与 allowAllTokens 并存
    const scope = useAiStore.getState().buildScope(docAsWhole(freshDoc()), "n1", undefined, true);
    expect(scope).toEqual({ nodeIds: ["n1"], allowAllTokens: true });
    // C1: English token intent also unlocks tokens
    expect(useAiStore.getState().modeFor("n1", "switch to warm brand colors")).toMatchObject({
      mode: "patch",
      allowAllTokens: true,
    });
    expect(useAiStore.getState().modeFor(null, "apply dark theme palette", docAsWhole(freshDocWithNode()))).toMatchObject({
      mode: "patch",
      allowAllTokens: true,
    });
  });
});

describe("outboundChatMessages（API 400 空 content 修复）", () => {
  it("剔除活动时间线卡片与空 assistant 占位，只保留非空对话", async () => {
    const { outboundChatMessages } = await import("./aiStore");
    const out = outboundChatMessages([
      { id: "1", role: "user", text: "改一下", streaming: false },
      {
        id: "2",
        role: "assistant",
        text: "",
        streaming: false,
        kind: "activity",
        activity: { id: "a", startedAt: 0, status: "done", steps: [] },
      },
      { id: "3", role: "assistant", text: "", streaming: false },
      { id: "4", role: "assistant", text: "  ", streaming: false },
      { id: "5", role: "assistant", text: "已完成", streaming: false },
    ]);
    expect(out).toEqual([
      { role: "user", content: "改一下" },
      { role: "assistant", content: "已完成" },
    ]);
  });
});

describe("aiStore toolkit 命令计划（P7.3）", () => {
  /** P7.3 done frame carrying toolkit commands (client.ts ChatEvent lags the union). */
  interface ToolkitDoneEvent {
    done: true;
    text: string;
    commands: unknown;
  }

  const cmd = (invocationId: string, riskLevel: "low" | "medium" | "high" = "low"): ToolkitCommand => ({
    invocationId,
    commandId: `cmd.${invocationId}`,
    title: `命令 ${invocationId}`,
    riskLevel,
    args: { id: invocationId },
    summary: `摘要 ${invocationId}`,
  });

  /** Drive one toolkit patch turn whose done frame carries the given commands. */
  async function sendToolkitTurn(commands: unknown): Promise<void> {
    const done: ToolkitDoneEvent = {
      done: true,
      text: JSON.stringify({ plan: "规划：调整演示稿。", commands }),
      commands,
    };
    mockStreamOnce([done as unknown as ChatEvent]);
    await useAiStore.getState().send({
      projectId: PID,
      text: "调整演示稿",
      mode: "patch",
      scope: { kind: "selection", targetIds: ["obj-1"] },
    });
  }

  beforeEach(() => {
    useAiStore.getState().setCommandApplier(null);
  });

  it("patch done 带 commands → pendingPlan.commands 就绪且 scope 记录请求范围", async () => {
    const commands = [cmd("inv-1"), cmd("inv-2", "medium")];
    await sendToolkitTurn(commands);

    const s = useAiStore.getState();
    expect(s.phase).toBe("awaiting-confirm");
    expect(s.pendingPlan?.commands).toEqual(commands);
    expect(s.pendingPlan?.scope).toEqual({ kind: "selection", targetIds: ["obj-1"] });
    expect(s.pendingPlan?.plan).toContain("调整演示稿");
  });

  it("patch done commands 为空数组 → 中性 notice（非 error）", async () => {
    await sendToolkitTurn([]);
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.notice).toContain("未产生变更命令");
  });

  it("confirm 走 commandApplier 整批重放并 settle；不写 UI 回退点版本", async () => {
    const spy = vi.spyOn(versionStore, "saveVersion");
    const applier = vi.fn().mockResolvedValue(true);
    useAiStore.getState().setCommandApplier(applier);
    const commands = [cmd("inv-1"), cmd("inv-2")];
    await sendToolkitTurn(commands);

    await useAiStore.getState().confirm(PID);
    expect(applier).toHaveBeenCalledTimes(1);
    expect(applier).toHaveBeenCalledWith(commands);
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.pendingPlan).toBeNull();
    expect(s.rollbackDoc).toBeNull(); // 工具包路径不写 UI 回退点
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("applier 失败 → phase=error 人话文案且 pendingPlan 保留（可重试/跳过）", async () => {
    useAiStore.getState().setCommandApplier(vi.fn().mockResolvedValue(false));
    await sendToolkitTurn([cmd("inv-1")]);

    await useAiStore.getState().confirm(PID);
    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("应用变更失败");
    expect(s.pendingPlan?.commands).toHaveLength(1);
  });

  it("applier 未注册 → phase=error（编辑器尚未就绪）", async () => {
    await sendToolkitTurn([cmd("inv-1")]);

    await useAiStore.getState().confirm(PID);
    expect(useAiStore.getState().phase).toBe("error");
    expect(useAiStore.getState().error).toContain("编辑器尚未就绪");
  });

  it("acceptCommand：单条应用并从清单移除，最后一条处理后自动 settle", async () => {
    const applier = vi.fn().mockResolvedValue(true);
    useAiStore.getState().setCommandApplier(applier);
    const commands = [cmd("inv-1"), cmd("inv-2"), cmd("inv-3")];
    await sendToolkitTurn(commands);

    await useAiStore.getState().acceptCommand(PID, commands[0]!);
    expect(applier).toHaveBeenLastCalledWith([commands[0]]);
    expect(useAiStore.getState().pendingPlan?.commands?.map((c) => c.invocationId)).toEqual([
      "inv-2",
      "inv-3",
    ]);
    expect(useAiStore.getState().phase).toBe("awaiting-confirm");

    await useAiStore.getState().acceptCommand(PID, commands[1]!);
    expect(useAiStore.getState().pendingPlan?.commands).toHaveLength(1);

    await useAiStore.getState().acceptCommand(PID, commands[2]!);
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.pendingPlan).toBeNull();
  });

  it("acceptCommand 失败：error 文案含命令标题且该条保留在清单", async () => {
    useAiStore.getState().setCommandApplier(vi.fn().mockResolvedValue(false));
    const commands = [cmd("inv-1"), cmd("inv-2")];
    await sendToolkitTurn(commands);

    await useAiStore.getState().acceptCommand(PID, commands[0]!);
    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("命令 inv-1");
    expect(s.pendingPlan?.commands?.map((c) => c.invocationId)).toEqual(["inv-1", "inv-2"]);
  });

  it("skipCommand：直接移除该条；全部处理完后 phase=idle", async () => {
    useAiStore.getState().setCommandApplier(vi.fn());
    const commands = [cmd("inv-1"), cmd("inv-2")];
    await sendToolkitTurn(commands);

    await useAiStore.getState().skipCommand(commands[0]!);
    expect(useAiStore.getState().pendingPlan?.commands?.map((c) => c.invocationId)).toEqual(["inv-2"]);
    expect(useAiStore.getState().phase).toBe("awaiting-confirm");

    await useAiStore.getState().skipCommand(commands[1]!);
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.pendingPlan).toBeNull();
  });

  it("skip/accept 未知的 invocationId → no-op（不误删、不重复执行）", async () => {
    useAiStore.getState().setCommandApplier(vi.fn().mockResolvedValue(true));
    const commands = [cmd("inv-1")];
    await sendToolkitTurn(commands);

    await useAiStore.getState().skipCommand(cmd("ghost"));
    expect(useAiStore.getState().pendingPlan?.commands).toHaveLength(1);
  });

  it("partial 批次用请求 scope 调 applier（pendingPlan 尚未生成）", async () => {
    const applier = vi.fn().mockResolvedValue(true);
    useAiStore.getState().setCommandApplier(applier);
    const commands = [cmd("inv-1")];
    mockStreamOnce([
      { done: true, text: "已完成一批（1 条命令）", commands, partial: true } as unknown as ChatEvent,
      { done: true, text: "收尾", commands: [] } as unknown as ChatEvent,
    ]);
    const scope = { kind: "container" as const, targetIds: ["slide-1"] };
    await useAiStore.getState().send({
      projectId: PID,
      text: "改第一页",
      mode: "patch",
      scope,
    });
    expect(applier).toHaveBeenCalledTimes(1);
    expect(applier).toHaveBeenCalledWith(commands, scope);
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle"); // 流收尾后 idle，且不报“分批应用失败”
    expect(s.error).toBeNull();
  });

  it("partial 帧携带服务端自愈后的 scope 时，重放优先用帧 scope（删除选中对象后放宽到所属页）", async () => {
    const applier = vi.fn().mockResolvedValue(true);
    useAiStore.getState().setCommandApplier(applier);
    const commands = [cmd("inv-healed")];
    const healed = { kind: "container" as const, targetIds: ["slide-1"] };
    mockStreamOnce([
      // Request started as selection on an object the run deleted; the server
      // widened to the owning slide and announces it ON THE FRAME.
      { done: true, text: "已完成一批", commands, partial: true, scope: healed } as unknown as ChatEvent,
      { done: true, text: "收尾", commands: [], scope: healed } as unknown as ChatEvent,
    ]);
    await useAiStore.getState().send({
      projectId: PID,
      text: "替换占位符",
      mode: "patch",
      scope: { kind: "selection", targetIds: ["cover-bg"] },
    });
    expect(applier).toHaveBeenCalledWith(commands, healed);
  });

  it("分批自动应用的工具包命令在终帧后自动保存（无 pendingPlan/确认可走）", async () => {
    const saveSpy = vi.spyOn(useEditorStore.getState(), "save").mockResolvedValue(undefined);
    useEditorStore.setState({ dirty: true });
    useAiStore.getState().setCommandApplier(vi.fn().mockResolvedValue(true));
    const commands = [cmd("inv-auto-1")];
    mockStreamOnce([
      { done: true, text: "已完成一批（1 条命令）", commands, partial: true } as unknown as ChatEvent,
      // Final frame re-sends the same invocation; dedupe empties the plan.
      { done: true, text: "收尾", commands } as unknown as ChatEvent,
    ]);
    await useAiStore.getState().send({
      projectId: PID,
      text: "新增一页封面",
      mode: "patch",
      scope: { kind: "file", targetIds: [] },
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    saveSpy.mockRestore();
  });

  it("分批应用失败时不触发自动保存", async () => {
    const saveSpy = vi.spyOn(useEditorStore.getState(), "save").mockResolvedValue(undefined);
    useAiStore.getState().setCommandApplier(vi.fn().mockResolvedValue(false));
    mockStreamOnce([
      { done: true, text: "已完成一批（1 条命令）", commands: [cmd("inv-bad")], partial: true } as unknown as ChatEvent,
      { done: true, text: "收尾", commands: [] } as unknown as ChatEvent,
    ]);
    await useAiStore.getState().send({
      projectId: PID,
      text: "新增一页",
      mode: "patch",
      scope: { kind: "file", targetIds: [] },
    });
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it("partial 应用全部命令后 final 帧去重为空 → 完成态而非“无需修改”", async () => {
    const applier = vi.fn().mockResolvedValue(true);
    useAiStore.getState().setCommandApplier(applier);
    const commands = [cmd("inv-1"), cmd("inv-2")];
    mockStreamOnce([
      { done: true, text: "已完成一批（2 条命令）", commands, partial: true } as unknown as ChatEvent,
      { done: true, text: JSON.stringify({ plan: "规划：调整演示稿。", commands }), commands } as unknown as ChatEvent,
    ]);
    await useAiStore.getState().send({
      projectId: PID,
      text: "调整演示稿",
      mode: "patch",
      scope: { kind: "selection", targetIds: ["obj-1"] },
    });
    const s = useAiStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.notice).toContain("已全部应用");
    expect(s.pendingPlan).toBeNull(); // 不弹空确认卡
    expect(applier).toHaveBeenCalledTimes(1); // final 帧不重放
  });

  it("partial 无 applier 时不误报“已全部应用”，并保留可靠错误态", async () => {
    const commands = [cmd("inv-missing-applier")];
    mockStreamOnce([
      { done: true, text: "已完成一批", commands, partial: true } as unknown as ChatEvent,
      { done: true, text: JSON.stringify({ plan: "规划", commands }), commands } as unknown as ChatEvent,
    ]);

    await useAiStore.getState().send({
      projectId: PID,
      text: "分批应用",
      mode: "patch",
      scope: { kind: "selection", targetIds: ["obj-1"] },
    });

    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("编辑器尚未就绪");
    expect(s.notice).toBeNull();
  });

  it("partial applier 失败：快速失败并中止本轮，后续批次全部忽略（不再错误态改文档）", async () => {
    const applier = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    useAiStore.getState().setCommandApplier(applier);
    const commands = [cmd("inv-abort")];
    mockStreamOnce([
      { done: true, text: "第一批", commands, partial: true } as unknown as ChatEvent,
      { done: true, text: "后续批", commands, partial: true } as unknown as ChatEvent,
      { done: true, text: JSON.stringify({ plan: "规划", commands }), commands } as unknown as ChatEvent,
    ]);

    await useAiStore.getState().send({
      projectId: PID,
      text: "分批应用失败",
      mode: "patch",
      scope: { kind: "selection", targetIds: ["obj-1"] },
    });

    // Only the failing first batch ran; later partial batches and the final
    // frame are ignored so the document stops mutating behind the error card.
    expect(applier).toHaveBeenCalledTimes(1);
    expect(useAiStore.getState().phase).toBe("error");
    expect(useAiStore.getState().error).toContain("命令与当前文档冲突");
    expect(useAiStore.getState().notice).toBeNull();
  });

  it("partial applier 抛异常时转为可见 error，final 帧不能覆盖错误", async () => {
    const applier = vi.fn().mockRejectedValue(new Error("当前文档已变化"));
    useAiStore.getState().setCommandApplier(applier);
    const commands = [cmd("inv-throw")];
    mockStreamOnce([
      { done: true, text: "第一批", commands, partial: true } as unknown as ChatEvent,
      { done: true, text: JSON.stringify({ plan: "规划", commands }), commands } as unknown as ChatEvent,
    ]);

    await useAiStore.getState().send({
      projectId: PID,
      text: "异常分批应用",
      mode: "patch",
      scope: { kind: "selection", targetIds: ["obj-1"] },
    });

    const s = useAiStore.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("当前文档已变化");
    expect(s.notice).toBeNull();
  });

  it("clear()（离开/切换项目）后旧流的后续分批帧全部丢弃，不再调用 applier", async () => {
    const applier = vi.fn().mockResolvedValue(true);
    useAiStore.getState().setCommandApplier(applier);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    mockedStream.mockImplementationOnce(async (_body, handlers) => {
      handlers.onEvent({ done: true, text: "第一批", commands: [cmd("inv-a")], partial: true } as unknown as ChatEvent);
      await gate;
      // clear() already ran: this batch must never reach the new project's doc.
      handlers.onEvent({ done: true, text: "旧项目第二批", commands: [cmd("inv-b")], partial: true } as unknown as ChatEvent);
      handlers.onEvent({ done: true, text: "旧项目终帧", commands: [cmd("inv-c")] } as unknown as ChatEvent);
    });

    const sending = useAiStore.getState().send({
      projectId: PID,
      text: "长任务",
      mode: "patch",
      scope: { kind: "selection", targetIds: ["obj-1"] },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(applier).toHaveBeenCalledTimes(1); // first batch applied

    useAiStore.getState().clear(); // user backs out / opens another project
    releaseGate();
    await sending;

    expect(applier).toHaveBeenCalledTimes(1); // stale batches ignored
    expect(useAiStore.getState().messages).toEqual([]);
    expect(useAiStore.getState().phase).toBe("idle");
  });
});
