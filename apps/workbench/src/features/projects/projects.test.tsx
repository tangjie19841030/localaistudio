import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultStudioDocument, newProjectMeta, type ProjectMeta } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type TemplateGalleryItem } from "../../api/client";
import { importImageApi } from "../../api/import-image";
import { ProjectListScreen } from "./ProjectListScreen";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

vi.mock("../../api/client", () => ({
  api: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    // 选了模板时 NewProjectForm 用 saveProject 落地模板文档（P4-5）
    saveProject: vi.fn(),
    // 模板画廊（route A：外部模板）
    listTemplates: vi.fn(),
    importTemplate: vi.fn(),
    // PPT .pptx 模板导入
    importPptx: vi.fn(),
    // 失败流：删除已创建的空白项目
    deleteProject: vi.fn().mockResolvedValue({ ok: true }),
  },


}));

// T49：截图导入走独立 api 模块（不进 client.ts），整模块 mock。
vi.mock("../../api/import-image", () => ({
  importImageApi: { importImage: vi.fn() },
}));

const mockedApi = vi.mocked(api);

/** 默认画廊为空：未显式设置的测试不因模板加载挂起。 */
function mockEmptyGallery() {
  mockedApi.listTemplates.mockResolvedValue({ templates: [] });
}

describe("ProjectListScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmptyGallery();
  });

  it("渲染项目列表与打开按钮", async () => {
    const meta = newProjectMeta({ name: "运营工作台", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" });
    mockedApi.listProjects.mockResolvedValue([meta]);
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    expect(await screen.findByText("运营工作台")).toBeInTheDocument();
    // 整行是一个可点击入口（aria-label 提供可访问名），类型徽标由 projectType 派生
    expect(screen.getByText("UI 页面")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开 运营工作台" }));
    expect(onOpen).toHaveBeenCalledWith(meta.id);
  });

  it("列表行显示 projectType 徽标（ppt→PPT 演示；缺省回退 UI 页面）", async () => {
    const ppt = newProjectMeta({ name: "季度汇报", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", projectType: "ppt" });
    const legacy = newProjectMeta({ name: "旧项目", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }) as ProjectMeta;
    delete (legacy as { projectType?: string }).projectType; // 旧文件可能缺省该字段
    mockedApi.listProjects.mockResolvedValue([ppt, legacy]);
    render(<ProjectListScreen onOpen={vi.fn()} />);
    expect(await screen.findByText("季度汇报")).toBeInTheDocument();
    expect(screen.getByText("PPT 演示")).toBeInTheDocument();
    expect(screen.getByText("UI 页面")).toBeInTheDocument();
  });

  it("空状态只保留一个「新建项目」主按钮", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    render(<ProjectListScreen onOpen={vi.fn()} />);
    await screen.findByText("暂无项目");
    expect(screen.getAllByRole("button", { name: "新建项目" })).toHaveLength(1);
  });

  it("新建项目：提交调用 API 并打开新项目", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    const bundle = {
      meta: newProjectMeta({ name: "新项目", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
      document: defaultDoc("新项目"),
    };
    mockedApi.createProject.mockResolvedValue(bundle);
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);

    // 空列表下头部 CTA 有意隐藏，等空态稳定后从唯一主按钮打开表单
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.type(screen.getByLabelText("项目名称"), "新项目");
    await user.type(screen.getByLabelText("页面目标"), "验收用");
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    expect(mockedApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "新项目", goal: "验收用" }),
    );
    expect(onOpen).toHaveBeenCalledWith(bundle.meta.id);
  });

  it("创建失败：显示错误、按钮可重试", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    mockedApi.createProject.mockRejectedValueOnce(new Error("API 400: {\"error\":\"invalid_body\"}"));
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={vi.fn()} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const submit = screen.getByRole("button", { name: "创建项目" });
    expect(submit).toBeDisabled(); // 未输入名称时禁用
    await user.type(screen.getByLabelText("项目名称"), "会失败的项目");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect((await screen.findByRole("alert")).textContent).toMatch(/^API 400/);
    expect(screen.getByRole("button", { name: "创建项目" })).toBeEnabled(); // 关键：失败后可重试
  });

  it("仅空白字符的项目名时创建按钮禁用", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={vi.fn()} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const input = screen.getByLabelText("项目名称");
    await user.type(input, "   ");
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();
  });

  it("项目类型：三种类型全部可选（P7.3 注册后放行），默认 ui", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={vi.fn()} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const radios = screen.getAllByRole("radio", { name: /UI 网页|PPT 演示|Word 文档/ });
    expect(radios).toHaveLength(3);
    const ui = radios[0] as HTMLInputElement;
    const ppt = radios[1] as HTMLInputElement;
    const word = radios[2] as HTMLInputElement;
    expect(ui.checked).toBe(true);
    expect(ppt.disabled).toBe(false);
    expect(word.disabled).toBe(false);
    expect(screen.queryByText("PPT 演示（即将推出）")).not.toBeInTheDocument();
    expect(screen.queryByText("Word 文档（即将推出）")).not.toBeInTheDocument();
  });

  it("选择 ppt 创建：payload 携带 projectType=ppt", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    mockedApi.createProject.mockResolvedValue({
      meta: newProjectMeta({ name: "幻灯片", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", projectType: "ppt" }),
      document: { documentVersion: 1, name: "幻灯片" } as never,
    });
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.type(screen.getByLabelText("项目名称"), "幻灯片");
    await user.click(screen.getByRole("radio", { name: /PPT 演示/ }));
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(mockedApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "幻灯片", projectType: "ppt" }),
    );
    expect(onOpen).toHaveBeenCalled();
  });

  it("PPT：上传 .pptx 后按 create→import(replace)→save 顺序落地，并预填项目名", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    const pptMeta = newProjectMeta({
      name: "品牌模板", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", projectType: "ppt",
    });
    mockedApi.createProject.mockResolvedValue({ meta: pptMeta, document: { documentVersion: 1, name: "品牌模板" } as never });
    const importedDoc = {
      documentVersion: 1,
      name: "品牌模板",
      slideSize: { w: 1280, h: 720 },
      theme: { primary: "#0F766E", secondary: "#134E4A", accent: "#F59E0B", background: "#F8FAFC", fontTitle: "x", fontBody: "y" },
      slides: [{ id: "imp-s1", title: "封面", notes: "", objects: [] }],
    };
    mockedApi.importPptx.mockResolvedValue({
      document: importedDoc as never,
      warnings: [],
      imported: { slides: 1, assets: 2 },
    });
    mockedApi.saveProject.mockResolvedValue({ meta: pptMeta, document: importedDoc as never });
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.click(screen.getByRole("radio", { name: /PPT 演示/ }));

    // Picker appears; upload a file (input is visually hidden, still upload-able).
    const input = screen.getByLabelText("导入 PPTX 模板文件") as HTMLInputElement;
    const file = new File(["PK"], "品牌模板.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    await user.upload(input, file);
    expect(screen.getByText("品牌模板.pptx")).toBeInTheDocument();
    // Filename pre-fills the project name when left empty.
    expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("品牌模板");

    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(mockedApi.createProject).toHaveBeenCalledWith(expect.objectContaining({ projectType: "ppt" }));
    expect(mockedApi.importPptx).toHaveBeenCalledWith(pptMeta.id, file, "replace");
    expect(mockedApi.saveProject).toHaveBeenCalledWith(
      pptMeta.id,
      expect.objectContaining({ document: expect.objectContaining({ slides: expect.any(Array) }) }),
    );
    expect(onOpen).toHaveBeenCalledWith(pptMeta.id);
  });

  it("PPT：导入失败时项目已建出，提示可在编辑器内重试，不打开项目", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    const pptMeta = newProjectMeta({
      name: "坏模板", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", projectType: "ppt",
    });
    mockedApi.createProject.mockResolvedValue({ meta: pptMeta, document: {} as never });
    mockedApi.importPptx.mockRejectedValue(new Error("API 400: 文件已加密或不是有效的 .pptx"));
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.click(screen.getByRole("radio", { name: /PPT 演示/ }));
    const input = screen.getByLabelText("导入 PPTX 模板文件") as HTMLInputElement;
    await user.upload(input, new File(["PK"], "坏.pptx"));
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("文件已加密");
    // Failure offers explicit next actions instead of a passive hint.
    expect(screen.getByRole("button", { name: "打开空白项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除空白项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试导入/ })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockedApi.saveProject).not.toHaveBeenCalled();
  });

  it("PPT：失败后点「删除空白项目」调用 DELETE 并清掉错误态", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    const pptMeta = newProjectMeta({
      name: "坏模板2", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", projectType: "ppt",
    });
    mockedApi.createProject.mockResolvedValue({ meta: pptMeta, document: {} as never });
    mockedApi.importPptx.mockRejectedValue(new Error("文件已加密或不是有效的 .pptx"));
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.click(screen.getByRole("radio", { name: /PPT 演示/ }));
    await user.upload(screen.getByLabelText("导入 PPTX 模板文件"), new File(["PK"], "坏2.pptx"));
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    await screen.findByRole("button", { name: "删除空白项目" });
    await user.click(screen.getByRole("button", { name: "删除空白项目" }));
    expect(mockedApi.deleteProject).toHaveBeenCalledWith(pptMeta.id);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("列表加载失败显示错误；空列表显示暂无项目", async () => {
    mockedApi.listProjects.mockRejectedValueOnce(new Error("API 0: 无法连接本地服务"));
    render(<ProjectListScreen onOpen={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法连接本地服务");
    expect(screen.queryByText("暂无项目")).not.toBeInTheDocument();
  });

  it("空列表渲染暂无项目空态", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    render(<ProjectListScreen onOpen={vi.fn()} />);
    expect(await screen.findByText("暂无项目")).toBeInTheDocument();
  });

  it("提交载荷包含全部字段（精确断言）", async () => {
    mockedApi.listProjects.mockResolvedValue([]);
    mockedApi.createProject.mockResolvedValue({
      meta: newProjectMeta({ name: "x", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
      document: defaultDoc("x"),
    });
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={vi.fn()} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.type(screen.getByLabelText("项目名称"), "全字段");
    await user.type(screen.getByLabelText("产品类型"), "后台");
    await user.type(screen.getByLabelText("目标用户"), "运营");
    await user.type(screen.getByLabelText("页面目标"), "目标");
    await user.type(screen.getByLabelText("品牌规则"), "规则");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(mockedApi.createProject).toHaveBeenCalledWith({
      name: "全字段",
      productType: "后台",
      targetUsers: "运营",
      goal: "目标",
      referenceLinks: [],
      brandRules: "规则",
      projectType: "ui",
    });
  });
});

describe("新建项目：起始模板画廊（route A）", () => {
  const meta = () =>
    newProjectMeta({ name: "模板项目", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" });

  const templateItem = (over: Partial<TemplateGalleryItem> = {}): TemplateGalleryItem => ({
    id: "dashboard-01",
    name: "运营数据看板",
    category: "数据看板",
    description: "外部导入模板",
    source: "shadcn/ui (MIT)",
    document: defaultDoc("看板"),
    ...over,
  });

  const interactiveTemplateDocument = () => {
    const doc = defaultDoc("表单模板");
    // T19 v2 shape: TemplateThumb renders pages[0], so the interactive nodes
    // must live inside the first page, not on the (v1) root.
    return {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          nodes: [
            { id: "root", type: "Container", props: {}, children: ["form"] },
            { id: "form", type: "Form", props: { title: "登录" }, children: ["submit"] },
            { id: "submit", type: "Button", props: { label: "提交", variant: "primary", size: "md" }, children: [] },
          ],
        },
      ],
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listProjects.mockResolvedValue([]);
    mockEmptyGallery();
  });

  async function openForm() {
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={vi.fn()} />);
    // 空列表下等空态稳定，再从唯一主按钮打开表单
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    return user;
  }

  it("默认「空白」高亮；ready 模板以卡片渲染（分类 tab + 名称）", async () => {
    mockedApi.listTemplates.mockResolvedValue({ templates: [templateItem()] });
    await openForm();
    expect(screen.getByRole("button", { name: "空白", pressed: true })).toBeInTheDocument();
    expect(await screen.findByText("运营数据看板")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "数据看板" })).toBeInTheDocument();
  });

  it("含 Form/Button 的模板缩略图不嵌套创建表单；卡片可键盘选择且缩略图控件不抢焦点", async () => {
    mockedApi.listTemplates.mockResolvedValue({
      templates: [templateItem({ document: interactiveTemplateDocument() })],
    });
    const user = await openForm();
    const card = await screen.findByRole("button", { name: /运营数据看板/ });

    // The live preview keeps its own native Form/Button semantics, but it is
    // outside the create form and the card itself is a non-native button.
    const createForm = screen.getByLabelText("项目名称").closest("form");
    expect(createForm).not.toBeNull();
    expect(createForm?.contains(card)).toBe(false);
    expect(createForm?.querySelector("form")).toBeNull();
    expect(card).not.toBeInstanceOf(HTMLButtonElement);
    expect(card.querySelector("form")).not.toBeNull();
    expect(card).toHaveAttribute("aria-pressed", "false");

    const thumbnail = card.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.inert).toBe(true);

    card.focus();
    await user.keyboard("{Enter}");
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("选「空白」只调 createProject，不额外保存文档", async () => {
    const m = meta();
    mockedApi.createProject.mockResolvedValue({ meta: m, document: defaultDoc("模板项目") });
    const user = await openForm();
    await user.type(screen.getByLabelText("项目名称"), "模板项目");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(mockedApi.createProject).toHaveBeenCalledTimes(1);
    expect(mockedApi.saveProject).not.toHaveBeenCalled();
  });

  it("选模板后创建：文档保留模板内容但使用项目名（走 saveProject）", async () => {
    const m = meta();
    const item = templateItem();
    mockedApi.listTemplates.mockResolvedValue({ templates: [item] });
    mockedApi.createProject.mockResolvedValue({ meta: m, document: defaultDoc("模板项目") });
    mockedApi.saveProject.mockImplementation(async (_id, data) => data);
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.click(await screen.findByText("运营数据看板"));
    await user.type(screen.getByLabelText("项目名称"), "模板项目");
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    expect(mockedApi.saveProject).toHaveBeenCalledWith(m.id, {
      meta: m,
      document: { ...item.document, name: "模板项目" },
    });
    expect(onOpen).toHaveBeenCalledWith(m.id);
  });

  it("待导入模板显示「导入」按钮；导入成功后变为可选中", async () => {
    mockedApi.listTemplates.mockResolvedValue({
      templates: [templateItem({ document: undefined as never })],
    });
    const imported = templateItem();
    mockedApi.importTemplate.mockResolvedValue({ ok: true, template: imported });
    const user = await openForm();
    expect(await screen.findByText(/运营数据看板/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "导入" }));
    expect(mockedApi.importTemplate).toHaveBeenCalledWith("dashboard-01");
    // 导入后卡片出现（按钮可访问名含实时预览文本，用正则匹配）
    expect(
      await screen.findByRole("button", { name: /运营数据看板/ }),
    ).toBeInTheDocument();
  });

  it("模板保存失败：显示错误且不打开项目", async () => {
    const m = meta();
    const item = templateItem();
    mockedApi.listTemplates.mockResolvedValue({ templates: [item] });
    mockedApi.createProject.mockResolvedValue({ meta: m, document: defaultDoc("模板项目") });
    mockedApi.saveProject.mockRejectedValueOnce(new Error("API 409: conflict"));
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.click(await screen.findByText("运营数据看板"));
    await user.type(screen.getByLabelText("项目名称"), "模板项目");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect((await screen.findByRole("alert")).textContent).toContain("API 409");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it.each([
    ["ppt", "PPT 演示"],
    ["word", "Word 文档"],
  ] as const)("切换到 %s 后隐藏整组 UI 起始模板并清空选择", async (projectType, projectTypeLabel) => {
    const m = meta();
    const item = templateItem();
    mockedApi.listTemplates.mockResolvedValue({ templates: [item] });
    mockedApi.createProject.mockResolvedValue({
      meta: { ...m, projectType },
      document: defaultDoc("模板项目"),
    });
    const user = await openForm();

    await user.click(await screen.findByText("运营数据看板"));
    expect(screen.getByRole("button", { name: /运营数据看板/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("radio", { name: projectTypeLabel }));

    // 设计变更：模板区（含「空白」开关）仅对 ui 项目渲染，ppt/word 不出现空模板区
    expect(screen.queryByText("起始模板")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "空白" })).not.toBeInTheDocument();
    expect(screen.queryByText("运营数据看板")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("项目名称"), "模板项目");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(mockedApi.saveProject).not.toHaveBeenCalled();
  });
});

describe("新建项目：从截图导入（T49）", () => {
  const meta = () =>
    newProjectMeta({ name: "截图项目", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" });

  const imageFile = () => new File(["png-bytes"], "首页.png", { type: "image/png" });

  const mockedImportImage = vi.mocked(importImageApi.importImage);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedImportImage.mockReset();
    mockedApi.listProjects.mockResolvedValue([]);
    mockEmptyGallery();
  });

  async function openForm(onOpen: (id: string) => void = vi.fn()) {
    const user = userEvent.setup();
    render(<ProjectListScreen onOpen={onOpen} />);
    await screen.findByText("暂无项目");
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    return user;
  }

  it("UI 项目渲染「从截图导入」分区，无图时导入按钮禁用；切 PPT 后隐藏", async () => {
    const user = await openForm();
    expect(screen.getByText("从截图导入（可选）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入截图生成页面" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /PPT 演示/ }));
    expect(screen.queryByText("从截图导入（可选）")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("导入截图")).not.toBeInTheDocument();
  });

  it("选择截图后显示预览缩略与文件名，可移除", async () => {
    const user = await openForm();
    await user.upload(screen.getByLabelText("导入截图"), imageFile());
    expect(await screen.findByAltText("截图预览 1")).toBeInTheDocument();
    expect(screen.getByText("首页.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移除截图 首页.png" }));
    expect(screen.queryByAltText("截图预览 1")).not.toBeInTheDocument();
  });

  it("导入成功：import-image → createProject → saveProject（文档改项目名）→ 打开项目", async () => {
    const m = meta();
    const imported = defaultDoc("导入页面");
    mockedImportImage.mockResolvedValue({ document: imported, warnings: [], pages: 1 });
    mockedApi.createProject.mockResolvedValue({ meta: m, document: defaultDoc("截图项目") });
    mockedApi.saveProject.mockImplementation(async (_id, data) => data);
    const onOpen = vi.fn();
    const user = await openForm(onOpen);
    await user.type(screen.getByLabelText("项目名称"), "截图项目");
    // 模式切换：手绘线框 → payload mode=wireframe
    await user.click(screen.getByRole("radio", { name: /手绘/ }));
    await user.upload(screen.getByLabelText("导入截图"), imageFile());
    await screen.findByAltText("截图预览 1");
    await user.click(screen.getByRole("button", { name: "导入截图生成页面" }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(m.id));
    expect(mockedImportImage).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "wireframe",
        images: [expect.stringMatching(/^data:/)],
      }),
    );
    expect(mockedApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "截图项目", projectType: "ui" }),
    );
    expect(mockedApi.saveProject).toHaveBeenCalledWith(
      m.id,
      expect.objectContaining({
        meta: m,
        document: expect.objectContaining({ name: "截图项目" }),
      }),
    );
  });

  it("导入成功且带 warnings：ui 分支渲染降级提示列表（T64）", async () => {
    const m = meta();
    const imported = defaultDoc("导入页面");
    mockedImportImage.mockResolvedValue({
      document: imported,
      warnings: ["第 2 张图片识别失败，已跳过", "字体缺失，已回退到默认字体"],
      pages: 1,
    });
    mockedApi.createProject.mockResolvedValue({ meta: m, document: defaultDoc("截图项目") });
    mockedApi.saveProject.mockImplementation(async (_id, data) => data);
    const onOpen = vi.fn();
    const user = await openForm(onOpen);
    await user.type(screen.getByLabelText("项目名称"), "截图项目");
    expect(screen.queryByLabelText("导入降级提示")).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText("导入截图"), imageFile());
    await screen.findByAltText("截图预览 1");
    await user.click(screen.getByRole("button", { name: "导入截图生成页面" }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(m.id));
    const list = screen.getByLabelText("导入降级提示");
    expect(list).toHaveTextContent("第 2 张图片识别失败，已跳过");
    expect(list).toHaveTextContent("字体缺失，已回退到默认字体");
  });

  it("导入失败：分区内显示错误，不创建项目不跳转", async () => {
    mockedImportImage.mockRejectedValue(new Error("API 422: 全部图片转换失败"));
    const onOpen = vi.fn();
    const user = await openForm(onOpen);
    await user.type(screen.getByLabelText("项目名称"), "截图项目");
    await user.upload(screen.getByLabelText("导入截图"), imageFile());
    await screen.findByAltText("截图预览 1");
    await user.click(screen.getByRole("button", { name: "导入截图生成页面" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("全部图片转换失败");
    expect(mockedApi.createProject).not.toHaveBeenCalled();
    expect(mockedApi.saveProject).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  type User = ReturnType<typeof userEvent.setup>;

  /** Drive the screenshot path to a saveProject failure with the blank project
   *  already created; the second saveProject call succeeds (retry target). */
  async function failScreenshotSaveOnce(user: User) {
    const m = meta();
    mockedImportImage.mockResolvedValue({ document: defaultDoc("导入页面"), warnings: [], pages: 1 });
    mockedApi.createProject.mockResolvedValue({ meta: m, document: defaultDoc("截图项目") });
    mockedApi.saveProject
      .mockRejectedValueOnce(new Error("API 500: 保存失败"))
      .mockResolvedValueOnce({ meta: m, document: defaultDoc("导入页面") });
    await user.type(screen.getByLabelText("项目名称"), "截图项目");
    await user.upload(screen.getByLabelText("导入截图"), imageFile());
    await screen.findByAltText("截图预览 1");
    await user.click(screen.getByRole("button", { name: "导入截图生成页面" }));
    return m;
  }

  it("U2：截图保存失败后「重试保存已识别内容」补存同一空白项目，不再 createProject", async () => {
    const onOpen = vi.fn();
    const user = await openForm(onOpen);
    const m = await failScreenshotSaveOnce(user);

    expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
    const retryButton = await screen.findByRole("button", { name: "重试保存已识别内容" });
    expect(screen.getByText(/识别结果已保存在本地/)).toBeInTheDocument();
    expect(mockedApi.createProject).toHaveBeenCalledTimes(1);
    expect(mockedApi.saveProject).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    await user.click(retryButton);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(m.id));

    // Same blank project receives the doc; no orphan-creating second createProject.
    expect(mockedApi.createProject).toHaveBeenCalledTimes(1);
    expect(mockedApi.saveProject).toHaveBeenCalledTimes(2);
    expect(mockedApi.saveProject).toHaveBeenNthCalledWith(1, m.id, expect.objectContaining({ meta: m }));
    expect(mockedApi.saveProject).toHaveBeenNthCalledWith(2, m.id, expect.objectContaining({ meta: m }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("U2：重试保存不重新识别——/api/ai/import-image 整个流程只调用一次", async () => {
    const onOpen = vi.fn();
    const user = await openForm(onOpen);
    await failScreenshotSaveOnce(user);
    await screen.findByRole("button", { name: "重试保存已识别内容" });
    expect(mockedImportImage).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "重试保存已识别内容" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalled());

    // importImage is the sole wrapper of POST /api/ai/import-image in this
    // module-mocked suite: count 1 before and after retry proves no re-conversion.
    expect(mockedImportImage).toHaveBeenCalledTimes(1);
    expect(mockedApi.saveProject).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ document: expect.objectContaining({ name: "截图项目" }) }),
    );
  });
});
