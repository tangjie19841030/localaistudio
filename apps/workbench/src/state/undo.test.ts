import { defaultPage, defaultStudioDocument, newProjectMeta, removeNode, replacePage, updateProps, type StudioDocument, type ProjectBundle, type Page } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { db } from "../db/db";
import { emptyStack, pushUndo, redoStack, undoStack as undoStackFn, type UndoStack } from "./undoStack";
import { useEditorStore } from "./editorStore";
/** T19: whole-doc wrap for page fixtures. */
function docAsWhole(page: Page): StudioDocument {
  const d = defaultStudioDocument(page.name);
  d.pages[0] = page;
  return d;
}


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
    canUndo: false,


    canRedo: false,
    undoStack: emptyStack,
  });
});

const bundle = (): ProjectBundle => ({
  meta: newProjectMeta({ name: "运营工作台", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
  document: defaultDoc("运营工作台"),
});

const docA = (): StudioDocument => defaultDoc("A");
const docB = (): StudioDocument => defaultDoc("B");
const docC = (): StudioDocument => defaultDoc("C");

describe("undoStack 纯函数", () => {
  it("emptyStack 初始为空；pushUndo 后 past 增长、future 清空", () => {
    expect(emptyStack).toEqual({ past: [], future: [] });
    let s: UndoStack = { ...emptyStack, future: [docA()] };
    s = pushUndo(s, docB());
    expect(s.past).toHaveLength(1);
    expect(s.future).toHaveLength(0);
    expect(s.past[0]?.name).toBe("B");
  });

  it("pushUndo 超过 50 步丢最旧（FIFO）", () => {
    let s: UndoStack = emptyStack;
    for (let i = 0; i < 52; i++) {
      s = pushUndo(s, defaultDoc(`d${i}`));
    }
    expect(s.past).toHaveLength(50);
    expect(s.past[0]?.name).toBe("d2");
    expect(s.past[49]?.name).toBe("d51");
  });

  it("undo/redo 往返恢复文档；无历史返回 null", () => {
    expect(undoStackFn(emptyStack, docA())).toBeNull();
    expect(redoStack(emptyStack, docA())).toBeNull();

    let s = pushUndo(emptyStack, docA());
    const undone = undoStackFn(s, docB());
    expect(undone).not.toBeNull();
    expect(undone!.doc.name).toBe("A");
    expect(undone!.stack.past).toHaveLength(0);
    expect(undone!.stack.future).toHaveLength(1);

    const redone = redoStack(undone!.stack, undone!.doc);
    expect(redone).not.toBeNull();
    expect(redone!.doc.name).toBe("B");
    expect(redone!.stack.past).toHaveLength(1);
    expect(redone!.stack.future).toHaveLength(0);
  });
});

describe("editorStore 扩展（selection/viewport/applyOp/undo/redo）", () => {
  it("applyOp 成功：入栈 canUndo、document 更新、dirty", () => {
    useEditorStore.setState({ document: docA() });
    const ok = useEditorStore.getState().applyOp((doc) => ({ ...doc, name: "B" }));
    expect(ok).toBe(true);
    const s = useEditorStore.getState();
    expect(s.document?.name).toBe("B");
    expect(s.dirty).toBe(true);
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
  });

  it("applyOp→undo 恢复→redo 重做", () => {
    useEditorStore.setState({ document: docA() });
    const st = useEditorStore.getState();
    st.applyOp((doc) => ({ ...doc, name: "B" }));
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().document?.name).toBe("A");
    expect(useEditorStore.getState().canRedo).toBe(true);
    expect(useEditorStore.getState().redo()).toBe(true);
    expect(useEditorStore.getState().document?.name).toBe("B");
  });

  it("无历史时 undo/redo 返回 false 且不动文档", () => {
    useEditorStore.setState({ document: docA() });
    expect(useEditorStore.getState().undo()).toBe(false);
    expect(useEditorStore.getState().redo()).toBe(false);
    expect(useEditorStore.getState().document?.name).toBe("A");
  });

  it("applyOp 抛 OpError：document 不变、error 置位、返回 false", () => {
    useEditorStore.setState({ document: docA() });
    const ok = useEditorStore.getState().applyOp((doc) => replacePage(doc, doc.pages[0]!.id, updateProps(doc.pages[0]!, "no-such-node", { x: 1 })));
    expect(ok).toBe(false);
    const s = useEditorStore.getState();
    expect(s.document?.name).toBe("A");
    expect(s.error).toContain("no-such-node");
    expect(s.canUndo).toBe(false);
  });

  it("redo 后 selectedId 不在新文档则清空", () => {
    // doc: root Container + child card；选中 card 后删除它
    const doc: Page = { ...defaultPage("A"), rootId: "root",
      nodes: [
        { id: "root", type: "Container", props: {}, children: ["card"] },
        { id: "card", type: "Card", props: { title: "t", padded: true }, children: [] },
      ],
    };
    useEditorStore.setState({ document: docAsWhole(doc), selectedId: "card" });
    const removed = useEditorStore.getState().applyOp((d) => replacePage(d, d.pages[0]!.id, removeNode(d.pages[0]!, "card")));
    expect(removed).toBe(true);
    expect(useEditorStore.getState().selectedId).toBe("card"); // 删除自身不强制清（undo 可回）
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().selectedId).toBe("card"); // 旧文档含 card，保留
    expect(useEditorStore.getState().redo()).toBe(true);
    expect(useEditorStore.getState().selectedId).toBeNull(); // 新文档无 card，清空
  });

  it("undo 恢复后 selectedId 仍在新文档中则保留", () => {
    const doc = defaultDoc("A");
    useEditorStore.setState({ document: doc, selectedId: "root" });
    useEditorStore.getState().applyOp((d) => replacePage(d, d.pages[0]!.id, updateProps(d.pages[0]!, "root", {})));
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(useEditorStore.getState().selectedId).toBe("root");
  });

  it("selectNode / setViewport 更新状态", () => {
    useEditorStore.getState().selectNode("n1");
    expect(useEditorStore.getState().selectedId).toBe("n1");
    useEditorStore.getState().selectNode(null);
    expect(useEditorStore.getState().selectedId).toBeNull();
    useEditorStore.getState().setViewport("mobile");
    expect(useEditorStore.getState().viewport).toBe("mobile");
  });

  it("openProject 成功后：清 undo 栈、清 selectedId、viewport 回 desktop", async () => {
    useEditorStore.setState({ document: docA(), selectedId: "root" });
    useEditorStore.getState().applyOp((d) => ({ ...d, name: "改" }));
    useEditorStore.getState().setViewport("mobile");
    expect(useEditorStore.getState().canUndo).toBe(true);

    const b = bundle();
    mockedApi.getProject.mockResolvedValue(b);
    await useEditorStore.getState().openProject(b.meta.id);
    const s = useEditorStore.getState();
    expect(s.document?.name).toBe("运营工作台");
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.selectedId).toBeNull();
    expect(s.viewport).toBe("desktop");
  });

  it("reset 后迟到的 openProject 不回填（epoch 对称守卫）", async () => {
    const b = bundle();
    let resolveFirst!: (v: ProjectBundle) => void;
    mockedApi.getProject.mockImplementationOnce(
      () => new Promise<ProjectBundle>((r) => { resolveFirst = r; }),
    );

    const p = useEditorStore.getState().openProject(b.meta.id); // 挂起
    useEditorStore.getState().reset(); // 用户离开：epoch bump
    resolveFirst(b); // 迟到的响应此刻完成
    await p;

    const s = useEditorStore.getState();
    expect(s.projectId).toBeNull();
    expect(s.document).toBeNull();
    expect(await db.projects.get(b.meta.id)).toBeUndefined(); // Dexie 未被污染
  });
});
