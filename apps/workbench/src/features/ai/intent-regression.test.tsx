import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, type StudioDocument, type Page } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChatBody } from "../../api/client";
import { streamChat } from "../../api/client";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore } from "../../state/editorStore";
import { emptyStack } from "../../state/undoStack";
import { AiChatPanel } from "./AiChatPanel";
import { buildScope as intentBuildScope, modeFor as intentModeFor } from "./intent";
import { selectedNodes } from "./selectionChips";
/** T19: store/document APIs consume the WHOLE doc; tests pass a page fixture. */
function docAsWhole(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}



// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

/**
 * Regression: whole-page generate must never ride a selection scope.
 * A leftover canvas selection (aiStore keeps it after sending) turned
 * "生成一个运营工作台" into a scoped patch, so the server rejected every write
 * with 节点 <id> 超出修改范围 and the canvas ended up empty.
 */

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

/** Non-blank doc: root + one card + one text leaf. */
const DOC: Page = { ...defaultPage("草稿"), rootId: "root",
  nodes: [
    { id: "root", type: "Container", props: {}, children: ["stat", "body"] },
    { id: "stat", type: "StatCard", props: { label: "指标", value: "1", delta: "", tone: "brand" }, children: [] },
    { id: "body", type: "Text", props: { content: "原文", muted: false }, children: [] },
  ],
};

/** Fresh project: the root node is the only node (nothing patchable). */
const BLANK: Page = { ...defaultPage("新项目"), rootId: "root",
  nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
};

function mockStreamOnce(events: (string | object)[]): void {
  mockedStream.mockImplementationOnce(async (_body, handlers) => {
    for (const ev of events) {
      if (typeof ev === "string") handlers.onDelta(ev);
      else handlers.onEvent(ev as Parameters<typeof handlers.onEvent>[0]);
    }
  });
}

function seedEditor(page: Page): void {
  const document = docAsWhole(page);
  useEditorStore.setState({
    projectId: PID,
    meta: null,
    document,
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
}

beforeEach(() => {
  vi.clearAllMocks();
  seedEditor(DOC);
});

const lastBody = (): StreamChatBody => mockedStream.mock.calls[0]?.[0] as StreamChatBody;

describe("modeFor 整页生成意图（选区/空文档回归）", () => {
  const modeFor = (selection: string | string[] | null, text: string, doc?: Page | null) =>
    useAiStore.getState().modeFor(selection, text, doc == null ? doc : docAsWhole(doc));

  it("有选区 + 整页生成文案 → generate（不拼 target 标记）", () => {
    const text = "生成一个运营工作台";
    expect(modeFor("stat", text, DOC)).toEqual({ mode: "generate", text });
    expect(modeFor(["stat", "body"], text, DOC)).toEqual({ mode: "generate", text });
    // 无选区时语义不变
    expect(modeFor(null, text, DOC)).toEqual({ mode: "generate", text });
  });

  it("空文档 + 换色/主题文案 → generate（无可改节点，不得判 patch）", () => {
    const text = "做一个暖色的运营看板";
    expect(modeFor(null, text, BLANK)).toEqual({ mode: "generate", text });
    expect(modeFor("root", text, BLANK)).toEqual({ mode: "generate", text });
    // 同一文案在非空文档 + 无选区时仍是原来的 token patch 行为
    expect(modeFor(null, text, DOC)).toMatchObject({ mode: "patch", allowAllTokens: true });
  });

  it("选中 + 修改类文案 → patch 不变（含 target 拼接）", () => {
    expect(modeFor("stat", "改成警告色", DOC)).toEqual({ mode: "patch", text: "改成警告色 target:stat" });
    expect(modeFor(["stat", "body"], "统一换成强调色", DOC)).toEqual({
      mode: "patch",
      text: "统一换成强调色 target:stat target:body",
    });
    // 空文档上的选中修改（如刚插入的节点）也不被空文档判定覆盖
    expect(modeFor("stat", "把标题加粗", DOC)).toEqual({ mode: "patch", text: "把标题加粗 target:stat" });
  });

  it("空间标记仍优先于整页生成判定（P5 契约不变）", () => {
    expect(modeFor("stat", "move:body:320,80 生成一个页面", DOC)).toEqual({
      mode: "patch",
      text: "move:body:320,80 生成一个页面",
      markerNodeIds: ["body"],
    });
  });
});

describe("modeFor 页面跳转措辞（W3-A action navigate）", () => {
  const modeFor = (selection: string | string[] | null, text: string, doc?: Page | null) =>
    useAiStore.getState().modeFor(selection, text, doc == null ? doc : docAsWhole(doc));

  it("跳转措辞 + 非空文档 → patch，且追加 action navigate 指导语", () => {
    const text = "点击按钮跳转到设置页";
    expect(modeFor(null, text, DOC)).toEqual({ mode: "patch", text: `${text} （用 action navigate 实现）` });
    expect(modeFor("stat", text, DOC)).toEqual({
      mode: "patch",
      text: `${text} （用 action navigate 实现） target:stat`,
    });
  });

  it("空文档 + 跳转措辞 → generate（无可挂 action 的节点）", () => {
    const text = "点击按钮跳转到设置页";
    expect(modeFor(null, text, BLANK)).toEqual({ mode: "generate", text });
    expect(modeFor("root", text, BLANK)).toEqual({ mode: "generate", text });
  });

  it("换色 + 跳转措辞仍保留 allowAllTokens（token 权限不被跳转分支吞掉）", () => {
    expect(modeFor(null, "整体换成暖色并跳转到设置页", DOC)).toMatchObject({
      mode: "patch",
      allowAllTokens: true,
    });
  });
});

/** T27: short fuzzy intents ("中文"/"英文") expand to explicit interface-copy
 * instructions before modeFor's normal branches run. */
describe("modeFor 极短模糊指令归一（T27）", () => {
  const modeFor = (selection: string | string[] | null, text: string, doc?: Page | null) =>
    useAiStore.getState().modeFor(selection, text, doc == null ? doc : docAsWhole(doc));

  it("短词别名精确扩展为明确指令（非空文档、无选区 → patch、scope undefined）", () => {
    for (const alias of ["中文", "中文化", "改中文"]) {
      expect(modeFor(null, alias, DOC)).toEqual({ mode: "patch", text: "把界面文案改成中文" });
    }
    for (const alias of ["英文", "英文化", "改英文"]) {
      expect(modeFor(null, alias, DOC)).toEqual({ mode: "patch", text: "把界面文案改成英文" });
    }
    // patch + 无选区 → 整文档可改；scope undefined 由服务端解释为整文档范围
    expect(intentBuildScope(docAsWhole(DOC), null)).toBeUndefined();
  });

  it("选中摘要前缀保留，正文仍被扩展（摘要含 】 也能正确切分）", () => {
    expect(modeFor("stat", "【选中：指标卡「指标」】中文", DOC)).toEqual({
      mode: "patch",
      text: "【选中：指标卡「指标」】把界面文案改成中文 target:stat",
    });
    expect(modeFor("stat", "【选中：指标卡】A】中文", DOC)).toEqual({
      mode: "patch",
      text: "【选中：指标卡】A】把界面文案改成中文 target:stat",
    });
  });

  it("空文档 + 短词 → 仍 generate，输出扩展后指令且不拼 target", () => {
    expect(modeFor(null, "中文", BLANK)).toEqual({ mode: "generate", text: "把界面文案改成中文" });
    expect(modeFor(null, "英文", BLANK)).toEqual({ mode: "generate", text: "把界面文案改成英文" });
    expect(modeFor("root", "中文", BLANK)).toEqual({ mode: "generate", text: "把界面文案改成中文" });
  });

  it("长句不做别名替换（无选区 generate，有选区按原规则拼 target）", () => {
    const text = "把界面文案改成中文，并保持布局不变";
    expect(modeFor(null, text, DOC)).toEqual({ mode: "generate", text });
    expect(modeFor("stat", text, DOC)).toEqual({ mode: "patch", text: `${text} target:stat` });
  });

  it("直接发送明确指令 → patch（扩展后的文本语义稳定）", () => {
    expect(modeFor(null, "把界面文案改成中文", DOC)).toEqual({ mode: "patch", text: "把界面文案改成中文" });
    expect(modeFor("stat", "把界面文案改成中文", DOC)).toEqual({
      mode: "patch",
      text: "把界面文案改成中文 target:stat",
    });
  });
});

describe("AiChatPanel 发送范围（generate 不带 scope 回归）", () => {
  it("有选区 + 整页生成文案 → mode=generate 且 scope undefined", async () => {
    mockStreamOnce(["plan", { done: true, text: "规划文本" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="stat" />);

    await user.type(screen.getByLabelText("AI 指令"), "生成一个运营工作台");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = lastBody();
    expect(body.mode).toBe("generate");
    expect(body.scope).toBeUndefined();
    // W1-A: composer prefixes the selection summary even in generate mode.
    expect(body.messages.at(-1)?.content).toBe("【选中：指标卡「指标」】生成一个运营工作台"); // 无 target 标记
  });

  it("空文档 + 换色文案 → mode=generate 且 scope undefined（原为 patch 空范围）", async () => {
    seedEditor(BLANK);
    mockStreamOnce(["plan", { done: true, text: "规划文本" }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId={null} />);

    await user.type(screen.getByLabelText("AI 指令"), "做一个暖色的运营看板");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = lastBody();
    expect(body.mode).toBe("generate");
    expect(body.scope).toBeUndefined();
  });

  it("选中 + 修改类文案 → patch 仍携带选区 scope（严格性不放宽）", async () => {
    mockStreamOnce([{ done: true, text: JSON.stringify({ plan: "p", ops: [] }) }]);
    const user = userEvent.setup();
    render(<AiChatPanel projectId={PID} selectedId="stat" />);

    await user.type(screen.getByLabelText("AI 指令"), "改成警告色");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockedStream).toHaveBeenCalled();
    });
    const body = lastBody();
    expect(body.mode).toBe("patch");
    expect(body.scope).toEqual({ nodeIds: ["stat"], allowAllTokens: false });
    expect(body.messages.at(-1)?.content).toBe("【选中：指标卡「指标」】改成警告色 target:stat");
  });
});

/** T14 G1: two-page doc — page 1 holds a card, page 2 a container subtree. */
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

describe("T14 G1: modeFor/buildScope/selectedNodes 跨页解析", () => {
  const doc = twoPageDoc();

  it("A1 活动页=页2：选中页2节点 → patch + scope 取页2子树", () => {
    const decision = intentModeFor("p2card", "改一下这个卡片", doc, "page-2");
    expect(decision.mode).toBe("patch");
    expect(decision.text).toBe("改一下这个卡片 target:p2card");
    expect(intentBuildScope(doc, "p2card", undefined, false, "page-2")).toEqual({
      nodeIds: ["p2card", "p2text"],
      allowAllTokens: false,
    });
  });

  it("A2 兼容锁：不传 pageId（旧调用方）→ 节点表=pages[0]", () => {
    expect(intentModeFor("p1card", "改一下这个卡片", doc).text).toBe("改一下这个卡片 target:p1card");
    expect(intentBuildScope(doc, "root1")).toEqual({
      nodeIds: ["root1", "p1card"],
      allowAllTokens: false,
    });
    // pageId=null 也是 G1 感知调用：严格按 pages[0] 解析，绝不跨页捞页2 id
    expect(intentBuildScope(doc, "p2card", undefined, false, null)).toBeUndefined();
  });

  it("A3 stale id：选中不在活动页 → selectedNodes 空、modeFor 走全文档路径", () => {
    expect(selectedNodes(doc, ["p1card"], "page-2")).toEqual([]);
    const decision = intentModeFor(["p1card"], "改一下这个卡片", doc, "page-2");
    expect(decision.mode).toBe("generate"); // 降级为无选中行为
    expect(decision.text).not.toMatch(/target:/);
    // token 措辞仍 patch，但不拼 stale 的 target 标记
    const token = intentModeFor(["p1card"], "整体换成暖色品牌色", doc, "page-2");
    expect(token).toMatchObject({ mode: "patch", allowAllTokens: true });
    expect(token.text).not.toMatch(/target:/);
  });

  it("A4 空白判定按活动页：页1空、页2有内容 + pageId=页2 → patch 可用", () => {
    const halfBlank = defaultStudioDocument("半空");
    halfBlank.pages[0] = defaultPage("空页", "page-1"); // root-only page
    halfBlank.pages.push({
      ...defaultPage("内容页", "page-2"),
      rootId: "root2",
      nodes: [
        { id: "root2", type: "Container", props: {}, children: ["n2"] },
        { id: "n2", type: "Text", props: { content: "正文", muted: false }, children: [] },
      ],
    });
    expect(intentModeFor(null, "做一个暖色的运营看板", halfBlank, "page-1")).toEqual({
      mode: "generate",
      text: "做一个暖色的运营看板",
    });
    expect(intentModeFor(null, "做一个暖色的运营看板", halfBlank, "page-2")).toMatchObject({
      mode: "patch",
      allowAllTokens: true,
    });
  });

  it("B1 活动页 container 子树并集只含页2节点", () => {
    expect(intentBuildScope(doc, ["root2"], undefined, false, "page-2")).toEqual({
      nodeIds: ["root2", "p2card", "p2text"],
      allowAllTokens: false,
    });
    expect(intentBuildScope(doc, ["p2card", "p2text"], undefined, false, "page-2")).toEqual({
      nodeIds: ["p2card", "p2text"],
      allowAllTokens: false,
    });
  });

  it("B2 stale id 在两页均不存在 → scope undefined（全文档回退）", () => {
    expect(intentBuildScope(doc, ["ghost"], undefined, false, "page-2")).toBeUndefined();
    expect(intentBuildScope(doc, ["ghost"], undefined, false, null)).toBeUndefined();
    expect(intentModeFor(["ghost"], "改一下这个卡片", doc, "page-2").mode).toBe("generate");
  });
});
