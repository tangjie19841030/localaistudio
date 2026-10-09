import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { defaultStudioDocument, newProjectMeta } from "@studio/schema-core";
import { useState } from "react";
import { CenterPanel } from "./CenterPanel";
import { WorkbenchLayout } from "./WorkbenchLayout";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

const noop = () => {};

/** Editor wiring defaults for layout-level tests (they assert TopBar/left panel only). */
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

describe("WorkbenchLayout", () => {
  it("渲染顶栏、三栏与底部坞", () => {
    render(
      <WorkbenchLayout
        projectName="运营工作台"
        documentName="运营工作台"
        dirty={false}
        saving={false}
        error={null}
        meta={null}
        onDocumentNameChange={noop}
        onSave={noop}
        onBack={noop}
        {...EDITOR_PROPS}
      />,
    );
    expect(screen.getByRole("button", { name: "返回项目列表" })).toBeInTheDocument();
    expect(screen.getByLabelText("文档名称")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
    expect(screen.getByRole("complementary", { name: "需求" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "预览" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "底部坞" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Diff", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "运行日志" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "本地质检" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "版本历史" })).toBeInTheDocument();
  });

  it("底部坞页签切换：版本历史渲染传入的面板内容", async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchLayout
        projectName="运营工作台"
        documentName="运营工作台"
        dirty={false}
        saving={false}
        error={null}
        meta={null}
        onDocumentNameChange={noop}
        onSave={noop}
        onBack={noop}
        versionPanel={<div data-testid="injected-version-panel">版本面板内容</div>}
        {...EDITOR_PROPS}
      />,
    );
    // 默认 Diff 页：未注入 codePanel 时显示生成占位，版本面板未渲染
    expect(screen.getByText(/生成代码后此处展示文件与文档 diff/)).toBeInTheDocument();
    expect(screen.queryByTestId("injected-version-panel")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "版本历史" }));
    expect(screen.getByTestId("injected-version-panel")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "版本历史", selected: true })).toBeInTheDocument();
  });

  it("底部坞页签切换：本地质检渲染传入的 visualPanel", async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchLayout
        projectName="运营工作台"
        documentName="运营工作台"
        dirty={false}
        saving={false}
        error={null}
        meta={null}
        onDocumentNameChange={noop}
        onSave={noop}
        onBack={noop}
        visualPanel={<div data-testid="injected-visual-panel">本地质检面板内容</div>}
        {...EDITOR_PROPS}
      />,
    );
    expect(screen.queryByTestId("injected-visual-panel")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "本地质检" }));
    expect(screen.getByTestId("injected-visual-panel")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "本地质检", selected: true })).toBeInTheDocument();
  });

  it("dirty 时保存可用且状态为未保存更改；error 显示 alert", () => {
    render(
      <WorkbenchLayout
        projectName="x"
        documentName="x"
        dirty
        saving={false}
        error="boom"
        meta={null}
        onDocumentNameChange={noop}
        onSave={noop}
        onBack={noop}
        {...EDITOR_PROPS}
      />,
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("未保存更改");
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("回调接线：改名/保存/返回都会触发回调", async () => {
    const onDocumentNameChange = vi.fn();
    const onSave = vi.fn();
    const onBack = vi.fn();
    // 受控输入：回调值必须回填给 documentName，否则 React 在事件后会恢复旧值 "d"，
    // 打字会变成 "d新"/"d名" 而非 "新"/"新名"（详见 Task 10 报告）。
    function Harness() {
      const [name, setName] = useState("d");
      return (
        <WorkbenchLayout
          projectName="p"
          documentName={name}
          dirty
          saving={false}
          error={null}
          meta={null}
          onDocumentNameChange={(n) => {
            onDocumentNameChange(n);
            setName(n);
          }}
          onSave={onSave}
          onBack={onBack}
          {...EDITOR_PROPS}
        />
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("文档名称"));
    await user.type(screen.getByLabelText("文档名称"), "新名");
    expect(onDocumentNameChange).toHaveBeenCalledWith("新名");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "返回项目列表" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("saving 时按钮禁用并显示保存中", () => {
    render(
      <WorkbenchLayout
        projectName="x"
        documentName="x"
        dirty
        saving
        error={null}
        meta={null}
        onDocumentNameChange={() => {}}
        onSave={() => {}}
        onBack={() => {}}
        {...EDITOR_PROPS}
      />,
    );
    const btn = screen.getByRole("button", { name: "保存中…" });
    expect(btn).toBeDisabled();
  });

  it("LeftPanel 渲染项目元数据（含参考链接列表）", async () => {
    const meta = newProjectMeta({
      name: "运营工作台",
      productType: "后台",
      targetUsers: "运营",
      goal: "看数据",
      referenceLinks: ["https://a.com", "https://b.com"],
      brandRules: "不要渐变",
    });
    render(
      <WorkbenchLayout
        projectName={meta.name}
        documentName="d"
        dirty={false}
        saving={false}
        error={null}
        meta={meta}
        onDocumentNameChange={() => {}}
        onSave={() => {}}
        onBack={() => {}}
        {...EDITOR_PROPS}
      />,
    );
    // P6 后元数据默认折叠成手风琴（AI 对话是左栏主体）——先展开再断言
    await userEvent.setup().click(screen.getByRole("button", { name: "需求" }));
    expect(screen.getByText("后台")).toBeInTheDocument();
    expect(screen.getByText("运营")).toBeInTheDocument();
    expect(screen.getByText("看数据")).toBeInTheDocument();
    expect(screen.getByText("不要渐变")).toBeInTheDocument();
    // 参考链接逐条展示为可点击链接（去掉协议前缀）
    expect(screen.getByText("a.com")).toBeInTheDocument();
    expect(screen.getByText("b.com")).toBeInTheDocument();
  });
});

describe("CenterPanel 非 ui 项目空态", () => {
  const noop = () => {};
  const base = {
    document: null,
    projectId: "p1",
    selectedId: null as string | null,
    viewport: "desktop" as const,
    onSelect: noop,
    onSetViewport: noop,
    previewMode: "schema" as const,
    onSetPreviewMode: noop,
  };

  it("默认 ui：document=null 保留「尚未打开项目」空态", () => {
    render(<CenterPanel {...base} />);
    expect(screen.getByText("尚未打开项目")).toBeInTheDocument();
  });

  it("ppt：document=null 显示编辑器使用中说明", () => {
    render(<CenterPanel {...base} projectType="ppt" />);
    expect(screen.getByText("正在使用 PPT 演示编辑器")).toBeInTheDocument();
    expect(screen.queryByText("尚未打开项目")).not.toBeInTheDocument();
  });

  it("word：document=null 显示编辑器使用中说明", () => {
    render(<CenterPanel {...base} projectType="word" />);
    expect(screen.getByText("正在使用 Word 文档编辑器")).toBeInTheDocument();
  });
});
