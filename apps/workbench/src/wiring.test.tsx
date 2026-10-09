import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultStudioDocument, moveNode, newProjectMeta, type StudioDocument, type ProjectBundle, replacePage } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api/client";
import { db } from "./db/db";
import { useAiStore } from "./state/aiStore";
import { useEditorStore } from "./state/editorStore";
import { emptyStack } from "./state/undoStack";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

// 版本历史页签内的 VersionDiff 用 Monaco，jsdom 挂不起来。
vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco-editor">{value ?? ""}</div>,
  DiffEditor: ({ original, modified }: { original?: string; modified?: string }) => (
    <div data-testid="monaco-diff" data-original={original ?? ""} data-modified={modified ?? ""} />
  ),
}));

vi.mock("./api/client", () => ({
  api: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    createVersion: vi.fn(),
    listVersions: vi.fn(),
    // VersionDiff 拉取无 Dexie 镜像的版本文档（P4-5）
    getVersion: vi.fn(),
    deleteVersion: vi.fn(),


  },
}));

const mockedApi = vi.mocked(api);

const bundle = (): ProjectBundle => ({
  meta: newProjectMeta({ name: "运营工作台", productType: "后台", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
  document: {
    ...defaultDoc("运营工作台"),
    pages: [{
      id: "page-1",
      name: "运营工作台",
      rootId: "shell",
    nodes: [
      { id: "shell", type: "AppShell", props: { title: "运营台", sidebar: false }, children: ["sec"] },
      { id: "sec", type: "Section", props: { title: "区块", description: "" }, children: [] },
    ],
    }],
  },
});

/** P7.3: editorStore.document is the per-toolkit union; UI tests read it narrowed. */
function uiDoc(): StudioDocument {
  const doc = useEditorStore.getState().document;
  if (!doc) throw new Error("UI 文档未加载");
  return doc as StudioDocument;
}

beforeEach(async () => {
  cleanup();
  await db.projects.clear();
  await db.documents.clear();
  await db.versions.clear();
  vi.clearAllMocks();
  useEditorStore.setState({
    projectId: null,
    meta: null,
    document: null,
    dirty: false,
    saving: false,
    error: null,
    selectedId: null,
    viewport: "desktop",
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
  mockedApi.listVersions.mockResolvedValue([]);
});

async function openApp(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const b = bundle();
  mockedApi.listProjects.mockResolvedValue([b.meta]);
  mockedApi.getProject.mockResolvedValue(b);
  mockedApi.saveProject.mockResolvedValue(b);
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "打开 运营工作台" }));
  // 中栏预览出现根节点文本即视为打开完成
  await screen.findByText("运营台");
}

describe("P1-8 接线：快捷键/TopBar/插入", () => {
  it("Ctrl+Z 触发 undo，document 回退", async () => {
    const user = userEvent.setup();
    await openApp(user);

    // 修改 token（走 applyOp）制造可撤销变更：右栏 Token 页改品牌色
    await user.click(screen.getByRole("tab", { name: "Token" }));
    fireEvent.change(screen.getByLabelText("品牌色"), { target: { value: "#abcdef" } });
    expect(useEditorStore.getState().canUndo).toBe(true);

    fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true });
    await waitFor(() => {
      expect((useEditorStore.getState().document as StudioDocument | null)?.tokens.color.brand).toBe("#0F766E");
    });
  });

  it("品牌色控件获得焦点时 Ctrl+Z 仍撤销 token 历史", async () => {
    const user = userEvent.setup();
    await openApp(user);

    await user.click(screen.getByRole("tab", { name: "Token" }));
    const brandInput = screen.getByLabelText("品牌色");
    fireEvent.change(brandInput, { target: { value: "#abcdef" } });
    brandInput.focus();
    fireEvent.keyDown(brandInput, { key: "z", code: "KeyZ", ctrlKey: true });

    await waitFor(() => {
      expect((useEditorStore.getState().document as StudioDocument | null)?.tokens.color.brand).toBe("#0F766E");
    });
  });

  it("Ctrl+Shift+Z 触发 redo", async () => {
    const user = userEvent.setup();
    await openApp(user);
    await user.click(screen.getByRole("tab", { name: "Token" }));
    fireEvent.change(screen.getByLabelText("品牌色"), { target: { value: "#abcdef" } });
    fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true });
    await waitFor(() => {
      expect(useEditorStore.getState().canRedo).toBe(true);
    });

    fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect((useEditorStore.getState().document as StudioDocument | null)?.tokens.color.brand).toBe("#abcdef");
    });
  });

  it("TopBar 撤销/重做按钮 disabled 随 canUndo/canRedo", async () => {
    const user = userEvent.setup();
    await openApp(user);

    const undoBtn = screen.getByRole("button", { name: "撤销" });
    const redoBtn = screen.getByRole("button", { name: "重做" });
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    await user.click(screen.getByRole("tab", { name: "Token" }));
    fireEvent.change(screen.getByLabelText("品牌色"), { target: { value: "#abcdef" } });
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "重做" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => {
      expect((useEditorStore.getState().document as StudioDocument | null)?.tokens.color.brand).toBe("#0F766E");
    });
    expect(screen.getByRole("button", { name: "重做" })).toBeEnabled();
  });

  it("插入流程：点插入按钮后预览出现新组件（插入到选中容器/根）", async () => {
    const user = userEvent.setup();
    await openApp(user);

    // 未选中 → 插入根（AppShell 是容器）
    await user.click(screen.getByRole("button", { name: "插入 指标卡" }));
    await waitFor(() => {
      expect(uiDoc().pages[0]!.nodes).toHaveLength(3);
    });
    // 新 StatCard 用默认 props：label=指标 value=0
    expect(screen.getByText("指标")).toBeInTheDocument();
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("点选预览节点选中：点击 StatCard 文本后右栏属性页显示其 props", async () => {
    const user = userEvent.setup();
    await openApp(user);
    await user.click(screen.getByRole("button", { name: "插入 指标卡" }));
    await screen.findByText("指标");

    await user.click(screen.getByText("指标"));
    await waitFor(() => {
      expect(useEditorStore.getState().selectedId).not.toBeNull();
    });
    // 属性页（默认页签）出现选中节点的 label 字段输入框
    const labelInput = within(screen.getByRole("complementary", { name: "属性" })).getByLabelText("label");
    expect(labelInput).toHaveValue("指标");
  });

  it("视口切换按钮驱动 PreviewSurface 宽度", async () => {
    const user = userEvent.setup();
    await openApp(user);
    expect(screen.getByTestId("preview-frame")).toHaveStyle({ width: "1440px" });
    await user.click(screen.getByRole("button", { name: "平板" }));
    expect(useEditorStore.getState().viewport).toBe("tablet");
    expect(screen.getByTestId("preview-frame")).toHaveStyle({ width: "1024px" });
  });
});

describe("P1-10 接线：版本历史 + JSON 导入导出", () => {
  it("存为版本：POST 后刷新列表并渲染", async () => {
    const user = userEvent.setup();
    const b = bundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.listVersions.mockResolvedValue([]);
    const created = { versionId: "v-1", projectId: b.meta.id, name: "上线前", createdAt: "2026-09-09T00:00:00.000Z" };
    mockedApi.createVersion.mockResolvedValue(created);
    // reload 后 server 返回新列表
    mockedApi.listVersions.mockResolvedValue([created]);
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "打开 运营工作台" }));
    await screen.findByText("运营台");

    await user.click(screen.getByRole("tab", { name: "版本历史" }));
    await user.type(screen.getByLabelText("版本名称"), "上线前");
    await user.click(screen.getByRole("button", { name: "存为版本" }));

    expect(mockedApi.createVersion).toHaveBeenCalledWith(
      b.meta.id,
      expect.objectContaining({ name: "上线前" }),
    );
    // 名称也出现在「版本对比」下拉的 option 里，断言收敛到版本列表区域
    const list = within(await screen.findByRole("region", { name: "版本列表" }));
    expect(await list.findByText("上线前")).toBeInTheDocument();
    // Dexie 镜像已写入（双写）
    expect(await db.versions.get("v-1")).toBeTruthy();
  });

  it("恢复版本：applyOp 生效（文档切换 + undo 可回退 + dirty）", async () => {
    const user = userEvent.setup();
    const b = bundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    const snapshot: StudioDocument = {
      ...b.document,
      pages: [
        { ...b.document.pages[0]!, nodes: [{ id: "shell", type: "AppShell", props: { title: "旧版标题", sidebar: false }, children: [] }] },
      ],
    };
    await db.versions.put({
      versionId: "v-1",
      projectId: b.meta.id,
      name: "旧版",
      document: snapshot,
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    mockedApi.listVersions.mockResolvedValue([
      { versionId: "v-1", projectId: b.meta.id, name: "旧版", createdAt: "2026-09-09T00:00:00.000Z" },
    ]);
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "打开 运营工作台" }));
    await screen.findByText("运营台");

    await user.click(screen.getByRole("tab", { name: "版本历史" }));
    await user.click(screen.getByRole("button", { name: "恢复 旧版" }));
    await waitFor(() => {
      expect(uiDoc().pages[0]!.nodes[0]?.props.title).toBe("旧版标题");
    });
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useEditorStore.getState().canUndo).toBe(true);

    // undo 回退到恢复前
    useEditorStore.getState().undo();
    await waitFor(() => {
      expect(uiDoc().pages[0]!.nodes[0]?.props.title).toBe("运营台");
    });
  });

  it("导入合法 JSON：文档替换且可撤销", async () => {
    const user = userEvent.setup();
    const b = bundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    mockedApi.listVersions.mockResolvedValue([]);
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "打开 运营工作台" }));
    await screen.findByText("运营台");

    await user.click(screen.getByRole("tab", { name: "版本历史" }));
    const imported: StudioDocument = {
      ...b.document,
      pages: [
        { ...b.document.pages[0]!, nodes: [{ id: "shell", type: "AppShell", props: { title: "导入的页", sidebar: false }, children: [] }] },
      ],
    };
    const file = new File([JSON.stringify(imported)], "doc.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("导入 JSON"), file);
    await waitFor(() => {
      expect(uiDoc().pages[0]!.nodes[0]?.props.title).toBe("导入的页");
    });
    expect(useEditorStore.getState().dirty).toBe(true);
    useEditorStore.getState().undo();
    await waitFor(() => {
      expect(uiDoc().pages[0]!.nodes[0]?.props.title).toBe("运营台");
    });
  });

  it("删除版本：DELETE 后列表刷新", async () => {
    const user = userEvent.setup();
    const b = bundle();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    const summary = { versionId: "v-1", projectId: b.meta.id, name: "待删版", createdAt: "2026-09-09T00:00:00.000Z" };
    mockedApi.listVersions.mockResolvedValue([summary]);
    mockedApi.deleteVersion.mockResolvedValue({ ok: true });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "打开 运营工作台" }));
    await screen.findByText("运营台");

    await user.click(screen.getByRole("tab", { name: "版本历史" }));
    const delList = within(await screen.findByRole("region", { name: "版本列表" }));
    expect(await delList.findByText("待删版")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除 待删版" }));
    await waitFor(() => {
      expect(mockedApi.deleteVersion).toHaveBeenCalledWith(b.meta.id, "v-1");
    });
  });
});

describe("P1-9 接线：图层拖拽 onMove → applyOp(moveNode)", () => {
  it("LayerTree onMove 经 App 走 moveNode（直接调用 handleMove 路径）", async () => {
    const user = userEvent.setup();
    await openApp(user);

    // 图层页签选中 Section 节点后插入一个 Card（作为移动目标），验证 move 全链路。
    // 属性优先设计：选中节点后插入目录默认折叠，先展开再点插入。
    await user.click(screen.getByRole("tab", { name: "图层" }));
    await user.click(screen.getByRole("treeitem", { name: /区块/ }));
    await user.click(screen.getByRole("tab", { name: "属性" }));
    await user.click(screen.getByRole("button", { name: "插入组件" }));
    await user.click(screen.getByRole("button", { name: "插入 卡片" }));
    await waitFor(() => {
      expect(uiDoc().pages[0]!.nodes.some((n) => n.type === "Card")).toBe(true);
    });

    // 直接驱动 store 级 move（E2E 覆盖真实拖拽）：把 Card 移回根下
    const doc = uiDoc();
    const card = doc.pages[0]!.nodes.find((n) => n.type === "Card")!;
    const ok = useEditorStore.getState().applyOp((d) => replacePage(d, d.pages[0]!.id, moveNode(d.pages[0]!, card.id, d.pages[0]!.rootId, 0)));
    expect(ok).toBe(true);
    const moved = uiDoc();
    expect(moved.pages[0]!.nodes.find((n) => n.id === moved.pages[0]!.rootId)!.children).toContain(card.id);
    expect(useEditorStore.getState().canUndo).toBe(true);
  });
});

describe("P4 接线：AI 确认后刷新版本列表", () => {
  it("confirm 写入「AI 回退点」后，版本列表与对比下拉立刻可见（不需手动刷新）", async () => {
    const user = userEvent.setup();
    await openApp(user);
    const pid = useEditorStore.getState().projectId!;
    const rollback = { versionId: "v-ai", projectId: pid, name: "AI 回退点", createdAt: "2026-09-09T00:00:00.000Z" };
    mockedApi.createVersion.mockResolvedValue(rollback);
    mockedApi.listVersions.mockResolvedValue([rollback]);

    // 直接驱动 aiStore 的确认路径：pendingPlan 为完整文档
    const nextDoc: StudioDocument = {
      ...uiDoc(),
      pages: [
        { ...uiDoc().pages[0]!, nodes: [{ id: "shell", type: "AppShell", props: { title: "AI 改后", sidebar: false }, children: [] }] },
      ],
    };
    useAiStore.setState({ phase: "awaiting-confirm", pendingPlan: { plan: "规划：改标题。", document: nextDoc } });
    await user.click(screen.getByRole("tab", { name: "版本历史" }));
    await user.click(screen.getByRole("button", { name: "应用变更" }));

    expect(mockedApi.createVersion).toHaveBeenCalledWith(pid, expect.objectContaining({ name: "AI 回退点" }));
    const list = within(await screen.findByRole("region", { name: "版本列表" }));
    expect(await list.findByText("AI 回退点")).toBeInTheDocument();
    // 版本对比下拉也拿到了该版本（跨会话对比的入口）
    const compare = within(screen.getByRole("region", { name: "版本对比" }));
    expect(compare.getByLabelText("对比基准版本")).toHaveValue("v-ai");
  });
});
