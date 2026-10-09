import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, type StudioDocument, type Page, defaultTokens } from "@studio/schema-core";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  codegenApi,
  exportProject,
  exportUiPng,
  exportUiPdf,
  runChecks,
  startPreview,
  stopPreview,
} from "../../api/client";
import { useEditorStore } from "../../state/editorStore";
import { useLogStore } from "../../state/logStore";
import { emptyStack } from "../../state/undoStack";
import { useCodegenStore } from "../../state/codegenStore";
import { CodePanel } from "./CodePanel";
import { DocDiff } from "./DocDiff";
import { ProjectPreview } from "../../preview/ProjectPreview";
/** T19: store/document APIs consume the WHOLE doc; tests pass a page fixture. */
function docAsWhole(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}



// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

const diffLifecycleEvents = vi.hoisted(() => [] as string[]);

// Monaco cannot mount under jsdom (needs real DOM layout); render a stub div and
// surface the text props so tests can assert what the editors would display.
vi.mock("@monaco-editor/react", () => ({
  // CodePanel imports the default export (Editor); DocDiff imports DiffEditor.
  default: ({ value, language }: { value?: string; language?: string }) => (
    <div data-testid="monaco-editor" data-language={language ?? ""}>
      {value ?? ""}
    </div>
  ),


  DiffEditor: (props: {
    original?: string;
    modified?: string;
    keepCurrentOriginalModel?: boolean;
    keepCurrentModifiedModel?: boolean;
    onMount?: (editor: { getModel: () => { original: { dispose: () => void }; modified: { dispose: () => void } } }, monaco: unknown) => void;
  }) => {
    const model = {
      original: { dispose: () => diffLifecycleEvents.push("original-model-dispose") },
      modified: { dispose: () => diffLifecycleEvents.push("modified-model-dispose") },
    };
    const editor = {
      getModel: () => model,
      dispose: () => diffLifecycleEvents.push("diff-editor-dispose"),
    };
    useEffect(() => {
      props.onMount?.(editor, {});
      return () => {
        diffLifecycleEvents.push("library-cleanup");
        editor.dispose();
      };
    }, [props.onMount]);
    return (
      <div
        data-testid="monaco-diff"
        data-original={props.original ?? ""}
        data-modified={props.modified ?? ""}
        data-keep-original={String(Boolean(props.keepCurrentOriginalModel))}
        data-keep-modified={String(Boolean(props.keepCurrentModifiedModel))}
      />
    );
  },
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../api/client")
  >();
  return {
    ...actual,
    codegenApi: {
      generateProject: vi.fn(),
      listProjectFiles: vi.fn(),
      getProjectFile: vi.fn(),
    },
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
    runChecks: vi.fn(),
    exportProject: vi.fn(),
    exportUiPng: vi.fn(),
    exportUiPdf: vi.fn(),
  };
});

const mockedGenerate = vi.mocked(codegenApi.generateProject);
const mockedGetFile = vi.mocked(codegenApi.getProjectFile);
const mockedStart = vi.mocked(startPreview);
const mockedStop = vi.mocked(stopPreview);
const mockedChecks = vi.mocked(runChecks);
const mockedExport = vi.mocked(exportProject);
const mockedExportPng = vi.mocked(exportUiPng);
const mockedExportPdf = vi.mocked(exportUiPdf);

const PID = "00000000-0000-4000-8000-000000000000";
const DOC: Page = { ...defaultPage("草稿"), rootId: "root",
  nodes: [
    { id: "root", type: "AppShell", props: { title: "运营台", sidebar: false }, children: ["stat"] },
    { id: "stat", type: "StatCard", props: { label: "今日活跃", value: "1", delta: "", tone: "brand" }, children: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  diffLifecycleEvents.length = 0;
  // Default happy-path generate: ProjectPreview auto-generates before start.
  mockedGenerate.mockResolvedValue({ files: [] });
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
  useCodegenStore.getState().clear();
  // jsdom lacks createObjectURL/revokeObjectURL; tests assert the download flow.
  URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
  URL.revokeObjectURL = vi.fn();
});

describe("codegenStore.generate", () => {
  it("生成成功：files 入 store、lastGeneratedDocJson 记录生成时的文档", async () => {
    mockedGenerate.mockResolvedValue({ files: ["src/main.tsx", "index.html"] });
    const docJson = JSON.stringify(useEditorStore.getState().document);
    await useCodegenStore.getState().generate(PID, docJson);

    // P5-5：未保存的画布编辑必须随请求发给 server（否则生成旧磁盘文档）
    expect(mockedGenerate).toHaveBeenCalledWith(PID, docAsWhole(DOC));
    const s = useCodegenStore.getState();
    expect(s.generateState).toBe("done");
    expect(s.generatedFiles).toEqual(["src/main.tsx", "index.html"]);
    // lastGeneratedDocJson 是 generate 当时文档的 JSON 快照（Diff 面板 old 侧）
    expect(JSON.parse(s.lastGeneratedDocJson!)).toEqual(docAsWhole(DOC));
  });

  it("生成失败：state=error 且 error 可见", async () => {
    mockedGenerate.mockRejectedValue(new Error("服务未启动"));
    await useCodegenStore.getState().generate(PID);
    const s = useCodegenStore.getState();
    expect(s.generateState).toBe("error");
    expect(s.error).toContain("服务未启动");
    expect(s.generatedFiles).toEqual([]);
  });

  it("generate 调用形状：与 editorStore 文档联动（传 projectId）", async () => {
    mockedGenerate.mockResolvedValue({ files: [] });
    await useCodegenStore.getState().generate(PID, JSON.stringify(docAsWhole(DOC)));
    const [urlId] = mockedGenerate.mock.calls[0]!;
    expect(urlId).toBe(PID);
  });
});

describe("CodePanel", () => {
  it("U3：挂载不预取导出检查——runChecks 零调用（checks 仅在点「导出 zip」时由 runExport 触发）", async () => {
    // Regression lock: a mount-time GET /codegen/check reflected the LAST SAVED
    // document and could show a stale 「导出前检查未通过」banner before any export
    // action. Checks now run only inside runExport (design §3.3 / Q4 verified).
    mockedChecks.mockResolvedValue({ checks: { ok: true, errors: [] } });
    render(<CodePanel projectId={PID} />);

    // Let all mount effects flush, including child panes.
    await waitFor(() => expect(screen.getByRole("button", { name: "导出 zip" })).toBeEnabled());
    expect(mockedChecks).not.toHaveBeenCalled();
    expect(screen.queryByText(/导出前检查未通过/)).toBeNull();
    // Sanity: the same spy DOES fire once the export action is taken.
    const user = userEvent.setup();
    mockedExport.mockResolvedValue(new Blob(["PK"], { type: "application/zip" }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "导出 zip" }));
    await waitFor(() => expect(mockedChecks).toHaveBeenCalledTimes(1));
  });

  it("生成成功后文件列表渲染，点击文件显示内容（getProjectFile）", async () => {
    mockedGenerate.mockResolvedValue({ files: ["src/main.tsx"] });
    mockedGetFile.mockResolvedValue({ path: "src/main.tsx", content: "export {}" });
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "生成代码" }));
    expect(await screen.findByRole("listitem", { name: /src\/main\.tsx/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "src/main.tsx" }));
    expect(mockedGetFile).toHaveBeenCalledWith(PID, "src/main.tsx");
    expect(await screen.findByTestId("monaco-editor")).toHaveTextContent("export {}");
  });

  it("生成报错：role=alert 显示错误", async () => {
    mockedGenerate.mockRejectedValue(new Error("409 冲突"));
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "生成代码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("409 冲突");
  });

  it("导出流程：checks ok → 直接下载（createObjectURL + anchor click）", async () => {
    mockedGenerate.mockResolvedValue({ files: ["src/main.tsx"] });
    mockedChecks.mockResolvedValue({ checks: { ok: true, errors: [] } });
    mockedExport.mockResolvedValue(new Blob(["PK"], { type: "application/zip" }));
    const clickSpy = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "导出 zip" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(mockedChecks).toHaveBeenCalledWith(PID);
    expect(mockedExport).toHaveBeenCalledWith(PID);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "仍然导出" })).toBeNull();
  });

  it("导出流程：checks 失败 → 错误清单 + [仍然导出] 确认后才下载", async () => {
    mockedChecks.mockResolvedValue({
      checks: { ok: false, errors: ["TS2304: 找不到名称", "vite build 失败"] },
    });
    mockedExport.mockResolvedValue(new Blob(["PK"], { type: "application/zip" }));
    const clickSpy = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "导出 zip" }));
    expect(await screen.findByText(/TS2304/)).toBeInTheDocument();
    expect(screen.getByText(/vite build 失败/)).toBeInTheDocument();
    expect(clickSpy).not.toHaveBeenCalled(); // 未确认前不下载

    await user.click(screen.getByRole("button", { name: "仍然导出" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(mockedExport).toHaveBeenCalledWith(PID);
  });

  it("导出 PNG（三视口）：exportUiPng 成功 → 触发下载，无错误提示", async () => {
    mockedExportPng.mockResolvedValue(new Blob(["PK"], { type: "application/zip" }));
    const clickSpy = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "导出 PNG（三视口）" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(mockedExportPng).toHaveBeenCalledWith(PID);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    // 按钮回到可点击态（导出中状态已退出）
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出 PNG（三视口）" })).toBeEnabled(),
    );
  });

  it("导出 PNG（三视口）失败：服务端中文 message 以 alert 展示", async () => {
    mockedExportPng.mockRejectedValue(new Error("Playwright 截图失败：Executable doesn't exist"));
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "导出 PNG（三视口）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Playwright 截图失败");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("导出 PDF：exportUiPdf 成功 → 触发下载并记成功日志", async () => {
    mockedExportPdf.mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    const clickSpy = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
    useLogStore.setState({ entries: [] });
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "导出 PDF" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(mockedExportPdf).toHaveBeenCalledWith(PID);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      useLogStore.getState().entries.some((e) => e.level === "success" && e.source === "export"),
    ).toBe(true);
    // 按钮回到可点击态（导出中状态已退出）
    await waitFor(() => expect(screen.getByRole("button", { name: "导出 PDF" })).toBeEnabled());
  });

  it("导出 PDF 失败：服务端中文 message 以 alert 展示并记 error 日志", async () => {
    mockedExportPdf.mockRejectedValue(new Error("PDF 渲染失败：Playwright 不可用"));
    const user = userEvent.setup();
    render(<CodePanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "导出 PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF 渲染失败");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(
      useLogStore.getState().entries.some((e) => e.level === "error" && e.source === "export"),
    ).toBe(true);
  });
});

describe("DocDiff", () => {
  it("无 lastGeneratedDocJson：提示文案", () => {
    render(<DocDiff />);
    expect(screen.getByText(/生成代码后可查看文档 diff/)).toBeInTheDocument();
  });

  it("有快照：DiffEditor 收到 original=快照 modified=当前文档 JSON", async () => {
    useCodegenStore.setState({ lastGeneratedDocJson: JSON.stringify(docAsWhole(DOC)) });
    // 生成后用户改了标题 → 当前文档与快照不同
    const edited = docAsWhole({
      ...DOC,
      nodes: [
        { id: "root", type: "AppShell", props: { title: "新标题", sidebar: false }, children: ["stat"] },
        ...DOC.nodes.slice(1),
      ],
    });
    useEditorStore.setState({ document: edited });

    render(<DocDiff />);
    const diff = screen.getByTestId("monaco-diff");
    expect(diff).toHaveAttribute("data-original", JSON.stringify(docAsWhole(DOC)));
    expect(diff).toHaveAttribute("data-modified", JSON.stringify(edited));
  });

  it("DiffEditor 卸载时先释放编辑器再释放两侧模型", async () => {
    useCodegenStore.setState({ lastGeneratedDocJson: JSON.stringify(docAsWhole(DOC)) });
    const view = render(<DocDiff />);

    expect(screen.getByTestId("monaco-diff")).toHaveAttribute("data-keep-original", "true");
    expect(screen.getByTestId("monaco-diff")).toHaveAttribute("data-keep-modified", "true");
    view.unmount();
    await act(async () => {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    });
    expect(diffLifecycleEvents).toEqual([
      "library-cleanup",
      "diff-editor-dispose",
      "original-model-dispose",
      "modified-model-dispose",
    ]);
  });
});

describe("ProjectPreview", () => {
  it("未启动：显示启动按钮，无 iframe", () => {
    render(<ProjectPreview projectId={PID} />);
    expect(screen.getByRole("button", { name: "启动预览" })).toBeEnabled();
    expect(screen.queryByTitle("项目预览")).toBeNull();
  });  it("启动成功：iframe 出现且 src 指向返回端口", async () => {
    mockedStart.mockResolvedValue({ port: 5180 });
    const user = userEvent.setup();
    render(<ProjectPreview projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "启动预览" }));

    const frame = await screen.findByTitle("项目预览");
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:5180");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  });

  it("启动失败：错误文案可见", async () => {
    mockedStart.mockRejectedValue(new Error("409 请先生成代码"));
    const user = userEvent.setup();
    render(<ProjectPreview projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "启动预览" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("409");
  });

  it("运行中显示停止按钮；stop 后回到启动态", async () => {
    mockedStart.mockResolvedValue({ port: 5181 });
    mockedStop.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ProjectPreview projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "启动预览" }));
    await screen.findByTitle("项目预览");

    await user.click(screen.getByRole("button", { name: "停止预览" }));
    await waitFor(() => {
      expect(mockedStop).toHaveBeenCalledWith(PID);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "启动预览" })).toBeEnabled();
    });
    expect(screen.queryByTitle("项目预览")).toBeNull();
  });
});

describe("ProjectPreview 启动前同步（当前文档 → generate → startPreview）", () => {
  it("点击启动预览：先用当前 editor 文档 generate，成功后才 startPreview", async () => {
    mockedGenerate.mockResolvedValue({ files: ["src/main.tsx"] });
    mockedStart.mockResolvedValue({ port: 5182 });
    const user = userEvent.setup();
    render(<ProjectPreview projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "启动预览" }));

    // 同步的是 editorStore 当前文档（未保存的编辑也要生效）
    expect(mockedGenerate).toHaveBeenCalledWith(PID, docAsWhole(DOC));
    expect(mockedGenerate.mock.invocationCallOrder[0]!).toBeLessThan(
      mockedStart.mock.invocationCallOrder[0]!,
    );
    expect(mockedStart).toHaveBeenCalledWith(PID);
    await screen.findByTitle("项目预览");
  });

  it("已有生成产物的项目：改文档后再启动，仍按当前文档重新 generate", async () => {
    // 模拟旧的生成残留：store 里已有一次成功 generate（旧文档快照）
    useCodegenStore.setState({
      generateState: "done",
      generatedFiles: ["package.json", "src/main.tsx"],
      lastGeneratedDocJson: JSON.stringify({ name: "旧文档" }),
    });
    const edited = docAsWhole({
      ...DOC,
      nodes: [
        { id: "root", type: "AppShell", props: { title: "改后标题", sidebar: false }, children: ["stat"] },
        DOC.nodes[1]!,
      ],
    });
    useEditorStore.setState({ document: edited });
    mockedGenerate.mockResolvedValue({ files: ["src/main.tsx"] });
    mockedStart.mockResolvedValue({ port: 5183 });
    const user = userEvent.setup();
    render(<ProjectPreview projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "启动预览" }));

    // 关键断言：重 generate 的是改后的文档，而不是旧产物
    expect(mockedGenerate).toHaveBeenCalledWith(PID, edited);
    expect(mockedStart).toHaveBeenCalledWith(PID);
    await screen.findByTitle("项目预览");
  });

  it("generate 失败：不调用 startPreview，错误以 alert 展示", async () => {
    mockedGenerate.mockRejectedValue(new Error("生成失败：document_invalid"));
    const user = userEvent.setup();
    render(<ProjectPreview projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "启动预览" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("document_invalid");
    expect(mockedStart).not.toHaveBeenCalled();
    expect(screen.queryByTitle("项目预览")).toBeNull();
  });
});

describe("codegenStore.generateAndStartPreview", () => {
  it("成功路径：先 generate 后 startPreview，最终 previewState=running", async () => {
    mockedGenerate.mockResolvedValue({ files: ["src/main.tsx"] });
    mockedStart.mockResolvedValue({ port: 5184 });
    await useCodegenStore.getState().generateAndStartPreview(PID, JSON.stringify(docAsWhole(DOC)));
    expect(mockedGenerate.mock.invocationCallOrder[0]!).toBeLessThan(
      mockedStart.mock.invocationCallOrder[0]!,
    );
    expect(useCodegenStore.getState().previewState).toBe("running");
    expect(useCodegenStore.getState().previewPort).toBe(5184);
  });

  it("失败路径：generate 抛错时短路，previewState 保持 idle", async () => {
    mockedGenerate.mockRejectedValue(new Error("422"));
    await useCodegenStore.getState().generateAndStartPreview(PID, JSON.stringify(docAsWhole(DOC)));
    expect(mockedStart).not.toHaveBeenCalled();
    const s = useCodegenStore.getState();
    expect(s.previewState).toBe("idle");
    expect(s.generateState).toBe("error");
  });
});

describe("PreviewSurface 模式切换（P3-4）", () => {
  it("工具条两个切换按钮 aria-pressed；切到项目预览渲染 ProjectPreview", async () => {
    const user = userEvent.setup();
    const { PreviewSurface } = await import("../../preview/PreviewSurface");
    const onModeChange = vi.fn();
    render(
      <PreviewSurface tokens={defaultTokens()}
        doc={DOC}
        projectId={PID}
        selectedId={null}
        onSelect={() => {}}
        viewport="desktop"
        onViewportChange={() => {}}
        mode="schema"
        onModeChange={onModeChange}
      />,
    );

    const schemaBtn = screen.getByRole("button", { name: "Schema 预览" });
    const projectBtn = screen.getByRole("button", { name: "项目预览" });
    expect(schemaBtn).toHaveAttribute("aria-pressed", "true");
    expect(projectBtn).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();

    await user.click(projectBtn);
    expect(onModeChange).toHaveBeenCalledWith("project");

    cleanup();
    render(
      <PreviewSurface tokens={defaultTokens()}
        doc={DOC}
        projectId={PID}
        selectedId={null}
        onSelect={() => {}}
        viewport="desktop"
        onViewportChange={() => {}}
        mode="project"
        onModeChange={onModeChange}
      />,
    );
    expect(screen.getByRole("button", { name: "项目预览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("preview-frame")).toBeNull();
    expect(screen.getByRole("button", { name: "启动预览" })).toBeInTheDocument();
  });
});
