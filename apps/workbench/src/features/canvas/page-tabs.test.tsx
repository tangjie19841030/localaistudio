import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultPage, defaultStudioDocument, type Page, type StudioDocument } from "@studio/schema-core";
import { afterEach, describe, expect, it } from "vitest";
import { PageTabs } from "./PageTabs";
import { usePageTabs } from "./usePageTabs";
import { useEditorStore } from "../../state/editorStore";
import { emptyStack } from "../../state/undoStack";

/**
 * T19 §5 D 组 (D1–D6): page-tab wiring against the REAL editorStore —
 * assertions read store state (doc JSON / undo depth), never component
 * internals. The store is fed a whole StudioDocument; the tabs hook +
 * component render on top of the active-page state.
 */

function multiPageDoc(): StudioDocument {
  const doc = defaultStudioDocument("多页项目");
  const withNode = (page: Page, id: string): Page => ({
    ...page,
    nodes: [
      ...page.nodes,
      { id, type: "Button", props: { label: id }, children: [] },
    ],
  });
  const first = withNode(doc.pages[0]!, "first-btn");
  // Node ids are globally unique across pages (T19 §0.2): the second page
  // carries its own root id, not the shared "root" of defaultPage.
  const second = withNode(
    { ...defaultPage("第二页", "page-2"), rootId: "root-2", nodes: [{ id: "root-2", type: "Container", props: {}, children: [] }] },
    "second-btn",
  );
  return { ...doc, pages: [first, second] };
}

function setup(doc: StudioDocument = multiPageDoc()) {
  useEditorStore.setState({
    projectId: "p1",
    document: doc,
    activePageId: null,
    selectedId: null,
    selectedIds: [],
    dirty: false,
    error: null,
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
  return { doc, rendered: render(<TabsHost doc={doc} activePageId={null} />) };
}

/** Hook host: usePageTabs must run inside a component (rules of hooks). */
function TabsHost(args: { doc: StudioDocument; activePageId: string | null }) {
  return <PageTabs {...usePageTabs(args)} />;
}

/** Current whole document from the store (the assertion surface). */
const storeDoc = () => useEditorStore.getState().document as StudioDocument;

afterEach(() => {
  cleanup();
  useEditorStore.setState({
    projectId: null,
    meta: null,
    document: null,
    dirty: false,
    saving: false,
    error: null,
    selectedId: null,
    selectedIds: [],
    activePageId: null,
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
});

describe("PageTabs（D 组）", () => {
  it("D1: 点击页签 → activePageId 变更且画布文档切到对应页", () => {
    setup();
    expect(screen.getByTestId("page-tabs")).not.toBeNull();
    fireEvent.click(screen.getByText("第二页"));
    expect(useEditorStore.getState().activePageId).toBe("page-2");
    // Canvas doc resolution: activePageOf over the store document.
    const doc = storeDoc();
    const active = doc.pages.find((p) => p.id === useEditorStore.getState().activePageId);
    expect(active?.name).toBe("第二页");
    expect(active?.nodes.some((n) => n.id === "second-btn")).toBe(true);
  });

  it("D2: 切页清空选择", () => {
    setup();
    useEditorStore.setState({ selectedId: "first-btn", selectedIds: ["first-btn"] });
    fireEvent.click(screen.getByText("第二页"));
    expect(useEditorStore.getState().selectedId).toBeNull();
    expect(useEditorStore.getState().selectedIds).toEqual([]);
  });

  it("D3: 新建页 → undoStack +1，undo 后回到单页", () => {
    setup(defaultStudioDocument("单页项目"));
    fireEvent.click(screen.getByTestId("page-add"));
    expect(storeDoc().pages.length).toBe(2);
    expect(useEditorStore.getState().undoStack.past.length).toBe(1);
    expect(useEditorStore.getState().undo()).toBe(true);
    expect(storeDoc().pages.length).toBe(1);
  });

  it("D4: 最后一页删除禁用", () => {
    setup(defaultStudioDocument("单页项目"));
    const remove = screen.getByRole("button", { name: /删除页面/ });
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(storeDoc().pages.length).toBe(1);
  });

  it("D5: 重命名 Enter 提交 / Esc 取消", async () => {
    const user = userEvent.setup();
    setup();
    const tabLabel = screen.getByTestId("page-tab-0").querySelector("button[role=tab]")!;
    fireEvent.doubleClick(tabLabel);
    const input = screen.getByTestId("page-tab-input-0");
    await user.clear(input);
    await user.type(input, "改名页{Enter}");
    expect(storeDoc().pages[0]!.name).toBe("改名页");
    // Esc cancels the second rename.
    fireEvent.doubleClick(screen.getByTestId("page-tab-0").querySelector("button[role=tab]")!);
    const input2 = screen.getByTestId("page-tab-input-0");
    await user.clear(input2);
    await user.type(input2, "不应生效{Escape}");
    expect(storeDoc().pages[0]!.name).toBe("改名页");
  });

  it("D6: 复制页 → 页数+1 且节点 fresh-id", () => {
    setup();
    const firstTab = screen.getByTestId("page-tab-0");
    fireEvent.click(firstTab.querySelector('button[aria-label^="复制页面"]')!);
    const pages = storeDoc().pages;
    expect(pages.length).toBe(3);
    const cloned = pages[2]!;
    const all = pages.flatMap((p) => p.nodes.map((n) => n.id));
    expect(cloned.nodes.some((n) => n.id === "first-btn")).toBe(false);
    expect(new Set(all).size).toBe(all.length);
    expect(cloned.name).toBe(pages[0]!.name);
  });
});
