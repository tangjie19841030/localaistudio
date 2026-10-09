import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newProjectMeta, type ProjectBundle } from "@studio/schema-core";
import { createEmptyDeck, type PptDocument } from "@studio/ppt-toolkit";
import { emptyWordDocument, type WordDocument } from "@studio/word-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api/client";
import { useEditorStore } from "./state/editorStore";
import { usePptEditorStore } from "./toolkits/ppt/state";
import { useWordEditorStore } from "./toolkits/word/state";

/**
 * P7.3：ppt/word 项目打开后的工作台壳行为——
 * 编辑面板渲染、UI 预览/右栏不出现、TopBar 改名可保存（document 原样回传）、
 * AI 对话对 ppt/word 项目同样挂载（P7.3 拆 gate，scope 走工具包选择）。
 */

vi.mock("./api/client", () => ({
  api: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    createVersion: vi.fn(),
    listVersions: vi.fn(),
    deleteVersion: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const pptDocument: PptDocument = createEmptyDeck("季度汇报");
const wordDocument: WordDocument = emptyWordDocument("季度报告");

const pptBundle = (): ProjectBundle => ({
  meta: { ...newProjectMeta({ name: "季度汇报", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }), projectType: "ppt" },
  document: pptDocument,
}) as unknown as ProjectBundle; // schema-core 的 ProjectBundle 是 UI 形状；ppt 文档经联合断言进入

const wordBundle = (): ProjectBundle => ({
  meta: { ...newProjectMeta({ name: "季度报告", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }), projectType: "word" },
  document: wordDocument,
}) as unknown as ProjectBundle;

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.listVersions.mockResolvedValue([]);
  // Each case mounts a fresh App, so mirror the real "back to project list"
  // cleanup instead of letting the previous case's async openProject state
  // satisfy the next case's readiness assertions.
  useEditorStore.getState().reset();
  usePptEditorStore.setState({
    deck: null,
    envelopeDeck: null,
    selectedSlideId: null,
    selectedObjectIds: [],
    error: null,
    past: [],
    future: [],
    onDocumentChange: null,
  });
  useWordEditorStore.setState({
    doc: null,
    envelopeDoc: null,
    selection: { sectionId: null, blockId: null, blockIds: [] },
    error: null,
    past: [],
    future: [],
    onDocumentChange: null,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ppt 项目的工作台壳（P7.3）", () => {
  it("打开后渲染编辑面板，不渲染 UI 预览空态，AI 对话对 ppt 项目挂载", async () => {
    const user = userEvent.setup();
    const b = pptBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度汇报" }));
    // P9.1 起占位编辑器已替换为 PptEditorPanel（占位文案不再渲染）
    expect(await screen.findByLabelText("PPT 编辑器")).toBeInTheDocument();
    expect(screen.queryByText("PPT 演示编辑器开发中")).not.toBeInTheDocument();
    // UI 预览面板不出现（CenterPanel 空态文案不得渲染）
    expect(screen.queryByText("尚未打开项目")).not.toBeInTheDocument();
    // P7.3 拆 gate：ppt 项目同样挂载 AiChatPanel，"仅 UI 项目支持"提示已删除
    expect(screen.getAllByLabelText("AI 对话").length).toBeGreaterThan(0);
    expect(screen.queryByText("仅 UI 项目支持 AI 对话。")).not.toBeInTheDocument();
  });

  it("TopBar 改名置 dirty，保存把 PPT 文档原样回传（document 联合按类型发回）", async () => {
    const user = userEvent.setup();
    const b = pptBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    const bumped = {
      ...b,
      document: { ...pptDocument, name: "新文档名" },
      meta: { ...b.meta, updatedAt: new Date(Date.parse(b.meta.updatedAt) + 1).toISOString() },
    };
    mockedApi.saveProject.mockResolvedValue(bumped as never);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度汇报" }));
    await waitFor(() => expect(screen.getByLabelText("文档名称")).toHaveValue("季度汇报"));

    const nameInput = screen.getByLabelText("文档名称");
    // One-shot change instead of clear+type: deterministic under load (the
    // per-key setDocumentName round-trip raced the save click in CI runs).
    await user.clear(nameInput);
    fireEvent.change(nameInput, { target: { value: "新文档名" } });
    expect(screen.getByRole("status")).toHaveTextContent("未保存更改");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(mockedApi.saveProject).toHaveBeenCalledWith(b.meta.id, {
        meta: b.meta,
        document: expect.objectContaining({ name: "新文档名" }),
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已保存");
    });
  });

  it("版本面板对 ppt 项目禁用「存为版本」（仅 UI 项目支持）", async () => {
    const user = userEvent.setup();
    const b = pptBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度汇报" }));
    await user.click(await screen.findByRole("tab", { name: "版本历史" }));
    expect(screen.getByRole("button", { name: "存为版本" })).toBeDisabled();
  });

  it("公共撤销/重做与 PPT 编辑历史接线，快捷键也操作当前 deck", async () => {
    const user = userEvent.setup();
    const b = pptBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度汇报" }));
    await user.click(await screen.findByRole("button", { name: "新增幻灯片" }));
    await waitFor(() => expect(usePptEditorStore.getState().past).toHaveLength(1));

    const topBar = screen.getAllByRole("banner")[0]!;
    const undo = within(topBar).getByRole("button", { name: "撤销" });
    const redo = within(topBar).getByRole("button", { name: "重做" });
    expect(undo).toBeEnabled();

    await user.click(undo);
    await waitFor(() => expect(usePptEditorStore.getState().deck!.slides).toHaveLength(1));
    expect(redo).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(usePptEditorStore.getState().deck!.slides).toHaveLength(2));
    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => expect(usePptEditorStore.getState().deck!.slides).toHaveLength(1));
  });

  it("顶栏改名同步 PPT 面板并进入工具包历史，保存后仍可撤销", async () => {
    const user = userEvent.setup();
    const b = pptBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.saveProject.mockImplementation(async (_id, payload) => payload as never);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度汇报" }));
    await waitFor(() => expect(screen.getByLabelText("文档名称")).toHaveValue("季度汇报"));
    const nameInput = screen.getByLabelText("文档名称");
    fireEvent.change(nameInput, { target: { value: "新的 PPT 标题" } });

    await waitFor(() => expect(usePptEditorStore.getState().deck!.name).toBe("新的 PPT 标题"));
    await waitFor(() => expect(useEditorStore.getState().document).toEqual(expect.objectContaining({ name: "新的 PPT 标题" })));
    expect(nameInput).toHaveValue("新的 PPT 标题");
    expect(screen.getAllByRole("banner")[0]).toContainElement(nameInput);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    expect(usePptEditorStore.getState().past).toHaveLength(1);

    await user.click(screen.getAllByRole("banner")[0]!.querySelector('button[aria-label="撤销"]')!);
    await waitFor(() => expect(usePptEditorStore.getState().deck!.name).toBe("季度汇报"));
    expect(nameInput).toHaveValue("季度汇报");
  });

  it("导出 PPTX 前先保存当前 deck，保存失败则阻止导出", async () => {
    const user = userEvent.setup();
    const b = pptBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.saveProject.mockRejectedValue(new Error("PPT 保存失败"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["pptx"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度汇报" }));
    await user.click(await screen.findByRole("button", { name: "新增幻灯片" }));
    const exportPanel = screen.getByLabelText("导出面板");
    await user.click(within(exportPanel).getByRole("button", { name: "导出 PPTX" }));

    await waitFor(() => expect(mockedApi.saveProject).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert", { name: "导出提示" })).toHaveTextContent("PPT 保存失败");
  });

  it("导出 PPTX 使用保存后的最新 deck，并保留撤销历史", async () => {
    const user = userEvent.setup();
    const b = pptBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.saveProject.mockImplementation(async (_id, payload) => payload as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["pptx"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度汇报" }));
    await user.click(await screen.findByRole("button", { name: "新增幻灯片" }));
    await user.click(within(screen.getByLabelText("导出面板")).getByRole("button", { name: "导出 PPTX" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${b.meta.id}/export/pptx`, { method: "POST" }));
    const savedPayload = mockedApi.saveProject.mock.calls[0]?.[1] as unknown as { document: PptDocument };
    expect(savedPayload.document.slides).toHaveLength(2);
    expect(mockedApi.saveProject.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    expect(usePptEditorStore.getState().past).toHaveLength(1);
  });
});

describe("word 项目的公共历史接线", () => {
  it("公共撤销/重做与 Word 编辑历史接线，文本输入中的 Ctrl+Z 保留原生行为", async () => {
    const user = userEvent.setup();
    const b = wordBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度报告" }));
    await user.click(await screen.findByRole("button", { name: "插入标题" }));
    await waitFor(() => expect(useWordEditorStore.getState().past).toHaveLength(1));

    const topBar = screen.getAllByRole("banner")[0]!;
    const undo = within(topBar).getByRole("button", { name: "撤销" });
    const redo = within(topBar).getByRole("button", { name: "重做" });
    expect(undo).toBeEnabled();

    const nameInput = screen.getByLabelText("文档名称");
    const nativeUndo = new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true });
    nameInput.dispatchEvent(nativeUndo);
    expect(nativeUndo.defaultPrevented).toBe(false);
    expect(useWordEditorStore.getState().past).toHaveLength(1);

    await user.click(undo);
    await waitFor(() => expect(useWordEditorStore.getState().doc!.blocks).toHaveLength(wordDocument.blocks.length));
    expect(redo).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(useWordEditorStore.getState().doc!.blocks).toHaveLength(wordDocument.blocks.length + 1));
    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => expect(useWordEditorStore.getState().doc!.blocks).toHaveLength(wordDocument.blocks.length));
  });

  it("顶栏改名同步 Word 面板并进入工具包历史，保存后仍可撤销", async () => {
    const user = userEvent.setup();
    const b = wordBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.saveProject.mockImplementation(async (_id, payload) => payload as never);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度报告" }));
    await waitFor(() => expect(screen.getByLabelText("文档名称")).toHaveValue("季度报告"));
    const nameInput = screen.getByLabelText("文档名称");
    fireEvent.change(nameInput, { target: { value: "新的 Word 标题" } });

    await waitFor(() => expect(useWordEditorStore.getState().doc!.name).toBe("新的 Word 标题"));
    await waitFor(() => expect(useEditorStore.getState().document).toEqual(expect.objectContaining({ name: "新的 Word 标题" })));
    expect(nameInput).toHaveValue("新的 Word 标题");
    expect(screen.getAllByRole("banner")[0]).toContainElement(nameInput);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    expect(useWordEditorStore.getState().past).toHaveLength(1);

    await user.click(screen.getAllByRole("banner")[0]!.querySelector('button[aria-label="撤销"]')!);
    await waitFor(() => expect(useWordEditorStore.getState().doc!.name).toBe("季度报告"));
    expect(nameInput).toHaveValue("季度报告");
  });

  it("导出 DOCX 前先保存当前文档，导出请求使用最新内容且保留编辑历史", async () => {
    const user = userEvent.setup();
    const b = wordBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.saveProject.mockImplementation(async (_id, payload) => payload as never);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["docx"]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="word.docx"' },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度报告" }));
    await user.click(await screen.findByRole("button", { name: "插入标题" }));
    await waitFor(() => expect(useWordEditorStore.getState().past).toHaveLength(1));

    const exportPanel = screen.getByLabelText("导出面板");
    await user.click(within(exportPanel).getByRole("button", { name: "导出 DOCX" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${b.meta.id}/export/docx`, { method: "POST" }));

    const savedPayload = mockedApi.saveProject.mock.calls[0]?.[1] as unknown as { document: WordDocument };
    expect(savedPayload.document.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "heading", runs: [{ text: "新标题" }] }),
    ]));
    expect(mockedApi.saveProject.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    expect(useWordEditorStore.getState().past).toHaveLength(1);
  });

  it("Word 保存失败时显示错误且不发起 DOCX 导出", async () => {
    const user = userEvent.setup();
    const b = wordBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.saveProject.mockRejectedValue(new Error("Word 保存失败"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度报告" }));
    await user.click(await screen.findByRole("button", { name: "插入标题" }));
    await user.click(within(screen.getByLabelText("导出面板")).getByRole("button", { name: "导出 DOCX" }));

    await waitFor(() => expect(mockedApi.saveProject).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert", { name: "导出提示" })).toHaveTextContent("Word 保存失败");
  });

  it("服务端返回规范化文档时，保存采纳回包内容", async () => {
    const user = userEvent.setup();
    const b = wordBundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.saveProject.mockImplementation(async (_id, payload) => ({
      ...payload,
      document: { ...(payload.document as unknown as WordDocument), name: "服务端规范化" },
    }) as never);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 季度报告" }));
    await user.click(await screen.findByRole("button", { name: "插入标题" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(useEditorStore.getState().document).toEqual(expect.objectContaining({ name: "服务端规范化" })));
    await waitFor(() => expect(useWordEditorStore.getState().doc).toEqual(expect.objectContaining({ name: "服务端规范化" })));
  });
});
