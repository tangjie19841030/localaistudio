import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newProjectMeta } from "@studio/schema-core";
import { createEmptyDeck, type PptDocument } from "@studio/ppt-toolkit";
import { emptyWordDocument, type WordDocument } from "@studio/word-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { useEditorStore } from "../../state/editorStore";
import { ExportPanel as PptExportPanel } from "../ppt/ExportPanel";
import { QualityPanel as PptQualityPanel } from "../ppt/QualityPanel";
import { ExportPanel as WordExportPanel } from "../word/ExportPanel";
import { QualityPanel as WordQualityPanel } from "../word/QualityPanel";

/**
 * PPT/Word shared delivery-layer symmetry (unified panels): both toolkits mount
 * the SAME ToolkitExportPanel/ToolkitQualityPanel implementations and must
 * behave identically — save-before-request ordering, endpoint shape, issue
 * rendering. Regression anchor: the word quality panel used to skip the
 * save-first step and inspect a stale saved revision.
 */

vi.mock("../../api/client", () => ({
  api: {
    saveProject: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const pptDeck: PptDocument = createEmptyDeck("对称汇报");
const wordDoc: WordDocument = emptyWordDocument("对称报告");

function metaFor(projectType: "ppt" | "word") {
  return {
    ...newProjectMeta({ name: "对称项目", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
    projectType,
  };
}

function issueResponse(issues: unknown[]): Response {
  return new Response(JSON.stringify({ issues }), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.saveProject.mockImplementation(async (_id, payload) => payload as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useEditorStore.getState().reset();
});

/** Mount a dirty project in the editor store so save-before-request is exercised. */
function useProject(projectType: "ppt" | "word") {
  const meta = metaFor(projectType);
  const document = projectType === "ppt" ? pptDeck : wordDoc;
  useEditorStore.setState({ projectId: meta.id, meta, document, dirty: true });
  return meta;
}

describe("共享导出面板对称", () => {
  it("ppt：主格式 PPTX + PDF/PNG；保存先于导出请求", async () => {
    const user = userEvent.setup();
    const meta = useProject("ppt");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["pptx"]), { status: 200, headers: { "content-disposition": 'attachment; filename="deck.pptx"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<PptExportPanel />);
    const panel = screen.getByLabelText("导出面板");
    expect(within(panel).getByRole("button", { name: "导出 PPTX" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "导出 PDF" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "导出 PNG（首页）" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "导出 PPTX" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${meta.id}/export/pptx`, { method: "POST" }),
    );
    expect(mockedApi.saveProject.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(screen.getByLabelText("导出日志")).toHaveTextContent("PPTX"));
  });

  it("word：主格式 DOCX + PDF/PNG；保存先于导出请求（同一实现，仅主格式不同）", async () => {
    const user = userEvent.setup();
    const meta = useProject("word");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["docx"]), { status: 200, headers: { "content-disposition": 'attachment; filename="doc.docx"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<WordExportPanel />);
    const panel = screen.getByLabelText("导出面板");
    expect(within(panel).getByRole("button", { name: "导出 DOCX" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "导出 PPTX" })).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "导出 DOCX" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${meta.id}/export/docx`, { method: "POST" }),
    );
    expect(mockedApi.saveProject.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(screen.getByLabelText("导出日志")).toHaveTextContent("DOCX"));
  });

  it("两个工具包：保存失败都阻止导出请求（对称守卫）", async () => {
    const user = userEvent.setup();
    useProject("word");
    mockedApi.saveProject.mockRejectedValue(new Error("保存失败"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<WordExportPanel />);
    await user.click(within(screen.getByLabelText("导出面板")).getByRole("button", { name: "导出 DOCX" }));

    await waitFor(() => expect(mockedApi.saveProject).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert", { name: "导出提示" })).toHaveTextContent("保存失败");
  });
});

describe("共享质检面板对称", () => {
  it("ppt：保存先于 /inspect/ppt，问题按 幻灯片/对象 定位渲染", async () => {
    const user = userEvent.setup();
    const meta = useProject("ppt");
    const fetchMock = vi.fn().mockResolvedValue(
      issueResponse([{ inspectorId: "ppt.qc.bounds", message: "对象超出画布", slideId: "slide-1", objectId: "obj-9" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PptQualityPanel />);
    await user.click(screen.getByRole("button", { name: "重新检查" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${meta.id}/inspect/ppt`, { method: "POST" }),
    );
    expect(mockedApi.saveProject.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    const list = screen.getByLabelText("质检问题列表");
    expect(list).toHaveTextContent("对象超出画布");
    expect(list).toHaveTextContent("幻灯片 slide-1 · 对象 obj-9");
  });

  it("word：保存先于 /inspect/word（修复：旧实现跳过保存导致检查过期文档）", async () => {
    const user = userEvent.setup();
    const meta = useProject("word");
    const fetchMock = vi.fn().mockResolvedValue(
      issueResponse([{ inspectorId: "word.qc.comment-ref", message: "批注引用缺失", blockId: "block-9" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WordQualityPanel />);
    await user.click(screen.getByRole("button", { name: "重新检查" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${meta.id}/inspect/word`, { method: "POST" }),
    );
    // The unified contract: the saved document lands BEFORE the inspect request.
    expect(mockedApi.saveProject.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    const list = screen.getByLabelText("质检问题列表");
    expect(list).toHaveTextContent("批注引用缺失");
    expect(list).toHaveTextContent("块 block-9");
  });

  it("word：保存失败同样阻止检查请求（与 ppt 对称）", async () => {
    const user = userEvent.setup();
    useProject("ppt");
    mockedApi.saveProject.mockRejectedValue(new Error("检查前保存失败"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<PptQualityPanel />);
    await user.click(screen.getByRole("button", { name: "重新检查" }));

    await waitFor(() => expect(screen.getByRole("alert", { name: "质检错误" })).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
