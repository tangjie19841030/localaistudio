import { defaultStudioDocument, newProjectMeta, type ProjectBundle, type StudioDocument } from "@studio/schema-core";
import { insertNode, makeNode, setToken, updateProps } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { db } from "../db/db";
import { useEditorStore } from "./editorStore";
import { emptyStack } from "./undoStack";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

vi.mock("../api/client", () => ({
  api: {
    getProject: vi.fn(),
    saveProject: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

beforeEach(async () => {
  await db.projects.clear();
  await db.documents.clear();
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
    activePageId: null,
    canUndo: false,


    canRedo: false,
    undoStack: emptyStack,
  });
});

const bundle = (): ProjectBundle => ({
  meta: newProjectMeta({ name: "运营工作台", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
  document: defaultDoc("运营工作台"),
});

describe("editorStore", () => {
  it("openProject 拉取磁盘并镜像到 Dexie", async () => {
    const b = bundle();
    mockedApi.getProject.mockResolvedValue(b);
    await useEditorStore.getState().openProject(b.meta.id);
    const s = useEditorStore.getState();
    expect(s.projectId).toBe(b.meta.id);
    expect(s.document?.name).toBe("运营工作台");
    expect(s.dirty).toBe(false);
    expect((await db.projects.get(b.meta.id))?.name).toBe("运营工作台");
    expect((await db.documents.get(b.meta.id))?.document.name).toBe("运营工作台");
  });

  it("setDocumentName 置 dirty；save 推送并清除 dirty", async () => {
    const b = bundle();
    mockedApi.getProject.mockResolvedValue(b);
    // 服务端语义：返回已持久化的 bundle（改名后的文档 + 服务端时间戳）
    const bumped = {
      ...b,
      document: { ...b.document, name: "改名" },
      meta: { ...b.meta, updatedAt: new Date(Date.parse(b.meta.updatedAt) + 1).toISOString() },
    };
    mockedApi.saveProject.mockResolvedValue(bumped);
    await useEditorStore.getState().openProject(b.meta.id);

    useEditorStore.getState().setDocumentName("改名");
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useEditorStore.getState().document?.name).toBe("改名");

    await useEditorStore.getState().save();
    const s = useEditorStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.meta?.updatedAt).not.toBe(b.meta.updatedAt);
    expect((await db.documents.get(b.meta.id))?.document.name).toBe("改名");
  });

  it("未 dirty 时 save 不调用 API", async () => {
    const b = bundle();
    mockedApi.getProject.mockResolvedValue(b);
    await useEditorStore.getState().openProject(b.meta.id);
    await useEditorStore.getState().save();
    expect(mockedApi.saveProject).not.toHaveBeenCalled();
  });

  it("过期的 openProject 不回填状态（竞态守卫）", async () => {
    const first = bundle();
    const second: ProjectBundle = { ...bundle(), meta: { ...bundle().meta, name: "第二个" } };
    let resolveFirst!: (v: ProjectBundle) => void;
    mockedApi.getProject.mockImplementationOnce(
      () => new Promise<ProjectBundle>((r) => { resolveFirst = r; }),
    );
    mockedApi.getProject.mockResolvedValueOnce(second);

    const p1 = useEditorStore.getState().openProject(first.meta.id);
    const p2 = useEditorStore.getState().openProject(second.meta.id);
    await p2;
    resolveFirst(first); // 过期的请求此刻才完成
    await p1;

    expect(useEditorStore.getState().meta?.name).toBe("第二个");
    // 过期请求不得写入 Dexie 镜像
    expect(await db.projects.get(first.meta.id)).toBeUndefined();
  });

  it("过期的 save 不回填已切换的 store（save 竞态守卫）", async () => {
    const a = bundle();
    const b: ProjectBundle = { ...bundle(), meta: { ...bundle().meta, name: "B项目" } };
    mockedApi.getProject.mockResolvedValue(a);
    await useEditorStore.getState().openProject(a.meta.id);
    useEditorStore.getState().setDocumentName("A改名");

    let resolveSave!: (v: ProjectBundle) => void;
    mockedApi.saveProject.mockImplementationOnce(
      () => new Promise<ProjectBundle>((r) => { resolveSave = r; }),
    );
    const saveP = useEditorStore.getState().save(); // A 的保存挂起
    expect(useEditorStore.getState().saving).toBe(true);

    // 用户返回并打开 B
    useEditorStore.getState().reset();
    mockedApi.getProject.mockResolvedValueOnce(b);
    await useEditorStore.getState().openProject(b.meta.id);

    resolveSave({ ...a, meta: { ...a.meta, updatedAt: "2027-01-01T00:00:00.000Z" }, document: { ...a.document, name: "A改名" } });
    await saveP;

    const s = useEditorStore.getState();
    expect(s.meta?.name).toBe("B项目"); // 未被 A 的迟到保存污染
    expect(s.dirty).toBe(false);
    expect(s.saving).toBe(false); // 不得卡死
  });

  it("保存进行中发生编辑时，首个保存完成后自动补存最新文档", async () => {
    const b = bundle();
    mockedApi.getProject.mockResolvedValue(b);
    await useEditorStore.getState().openProject(b.meta.id);

    useEditorStore.getState().setDocumentName("首个版本");
    let resolveFirst!: (value: ProjectBundle) => void;
    const firstSave = new Promise<ProjectBundle>((resolve) => { resolveFirst = resolve; });
    const firstResult: ProjectBundle = {
      ...b,
      document: { ...b.document, name: "首个版本" },
      meta: { ...b.meta, updatedAt: "2026-09-12T00:00:01.000Z" },
    };
    const latestResult: ProjectBundle = {
      ...b,
      document: { ...b.document, name: "最新版本" },
      meta: { ...b.meta, updatedAt: "2026-09-12T00:00:02.000Z" },
    };
    mockedApi.saveProject
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce(latestResult);

    const saveP = useEditorStore.getState().save();
    expect(useEditorStore.getState().saving).toBe(true);
    useEditorStore.getState().setDocumentName("最新版本");
    resolveFirst(firstResult);

    await saveP;

    expect(mockedApi.saveProject).toHaveBeenCalledTimes(2);
    expect(mockedApi.saveProject.mock.calls[1]?.[1]).toMatchObject({
      document: expect.objectContaining({ name: "最新版本" }),
    });
    expect(useEditorStore.getState().document?.name).toBe("最新版本");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  // T19 §5 E 组 (editorStore 扩展用例)。
  describe("多页扩展（E 组）", () => {
    it("E1: applyPageOp 与 applyOp（token 改动）各自独立撤销条目", async () => {
      const b = bundle();
      mockedApi.getProject.mockResolvedValue(b);
      await useEditorStore.getState().openProject(b.meta.id);
      const s = useEditorStore.getState();

      // One page op = one undo entry.
      const node = makeNode("Button", "e1-btn");
      expect(s.applyPageOp((page) => insertNode(page, node, page.rootId))).toBe(true);
      expect(useEditorStore.getState().undoStack.past.length).toBe(1);

      // One doc-level token op = another independent undo entry.
      expect(s.applyOp((doc) => setToken(doc, ["color", "brand"], "#123456"))).toBe(true);
      expect(useEditorStore.getState().undoStack.past.length).toBe(2);

      // Undo #1 reverts the token; the inserted node survives (page unchanged).
      expect(useEditorStore.getState().undo()).toBe(true);
      let doc = useEditorStore.getState().document as StudioDocument;
      expect(doc.tokens.color.brand).not.toBe("#123456");
      expect(doc.pages[0]!.nodes.some((n) => n.id === "e1-btn")).toBe(true);

      // Undo #2 reverts the page insert.
      expect(useEditorStore.getState().undo()).toBe(true);
      doc = useEditorStore.getState().document as StudioDocument;
      expect(doc.pages[0]!.nodes.some((n) => n.id === "e1-btn")).toBe(false);
    });

    it("E4: activePageId 未知/缺失 → applyPageOp 回落 pages[0]", async () => {
      const b = bundle();
      mockedApi.getProject.mockResolvedValue(b);
      await useEditorStore.getState().openProject(b.meta.id);
      // Simulate a stale/unknown id (e.g. a page deleted elsewhere).
      useEditorStore.setState({ activePageId: "no-such-page" });
      const pageIdBefore = (useEditorStore.getState().document as StudioDocument).pages[0]!.id;
      // Container root defaults to maxWidth:"lg" — the op must land on pages[0].
      expect(
        useEditorStore.getState().applyPageOp((page) => updateProps(page, page.rootId, { maxWidth: "sm" })),
      ).toBe(true);
      const doc = useEditorStore.getState().document as StudioDocument;
      // The fallback page (pages[0]) received the op.
      expect(doc.pages[0]!.id).toBe(pageIdBefore);
      expect(doc.pages[0]!.nodes[0]!.props).toMatchObject({ maxWidth: "sm" });
      expect(useEditorStore.getState().undoStack.past.length).toBe(1);
    });

    it("setActivePage 切页清选择；removePage 末页 no-op", async () => {
      const b = bundle();
      mockedApi.getProject.mockResolvedValue(b);
      await useEditorStore.getState().openProject(b.meta.id);
      const s = useEditorStore.getState();

      // Unknown id: no state change at all.
      s.setActivePage("nope");
      expect(useEditorStore.getState().activePageId).toBeNull();

      s.addPage();
      const page2 = (useEditorStore.getState().document as StudioDocument).pages[1]!.id;
      useEditorStore.setState({ selectedId: "root", selectedIds: ["root"] });
      s.setActivePage(page2);
      expect(useEditorStore.getState().activePageId).toBe(page2);
      expect(useEditorStore.getState().selectedId).toBeNull();

      // Removing page 2 clears the active pointer back to pages[0].
      s.removePage(page2);
      expect((useEditorStore.getState().document as StudioDocument).pages.length).toBe(1);
      expect(useEditorStore.getState().activePageId).toBeNull();

      // Last page: remove is a silent no-op (no undo entry, page intact).
      s.removePage((useEditorStore.getState().document as StudioDocument).pages[0]!.id);
      expect((useEditorStore.getState().document as StudioDocument).pages.length).toBe(1);
      // addPage + removePage = 2 undo entries; the no-op adds none.
      expect(useEditorStore.getState().undoStack.past.length).toBe(2);
    });
  });
});
