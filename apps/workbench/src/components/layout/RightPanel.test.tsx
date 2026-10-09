import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultPage, defaultStudioDocument, type StudioDocument } from "@studio/schema-core";
import { beforeEach, describe, expect, it } from "vitest";
import { RightPanel } from "./RightPanel";
import { useEditorStore } from "../../state/editorStore";

/** Root is pinned+framed (absolute codegen path); btn is a flow node. */
function inspectDoc(): StudioDocument {
  const doc = defaultStudioDocument("测试页");
  doc.pages[0] = {
    ...defaultPage("测试页"),
    rootId: "root",
    nodes: [
      {
        id: "root",
        type: "Section",
        props: { title: "区块", description: "" },
        children: ["btn"],
        pinned: true,
        frame: { x: 100, y: 50, w: 400, h: 300, rotation: 0 },
      },
      { id: "btn", type: "Button", props: { label: "保存" }, children: [] },
    ],
  };
  return doc;
}

beforeEach(() => {
  cleanup();
  useEditorStore.setState({ document: null, selectedId: null, selectedIds: [] });
});

describe("RightPanel 检查页签", () => {
  it("四个页签可切换，检查页渲染选中节点的 codegen 同源参数", async () => {
    const user = userEvent.setup();
    const doc = inspectDoc();
    useEditorStore.setState({ document: doc, selectedId: "root", selectedIds: ["root"] });
    render(<RightPanel doc={doc} selectedId="root" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "属性",
      "Token",
      "图层",
      "检查",
    ]);

    await user.click(screen.getByRole("tab", { name: "检查" }));
    // Pinned+frame root → frameStyleSource preview (rebased to page origin).
    expect(screen.getByText(/position: "absolute", left: 100, top: 50/)).toBeInTheDocument();
    expect(screen.getByText("布局参数")).toBeInTheDocument();
    expect(screen.getByText("有效属性")).toBeInTheDocument();
  });

  it("检查页：流式节点显示继承提示，多选显示已选 N 个", async () => {
    const user = userEvent.setup();
    const doc = inspectDoc();
    useEditorStore.setState({
      document: doc,
      selectedId: "btn",
      selectedIds: ["root", "btn"],
    });
    render(<RightPanel doc={doc} selectedId="btn" />);
    await user.click(screen.getByRole("tab", { name: "检查" }));
    expect(screen.getByText("已选 2 个对象")).toBeInTheDocument();
    expect(screen.getByText("流式布局 · 继承容器")).toBeInTheDocument();
    expect(screen.queryByText("CSS 预览（codegen 同源）")).toBeNull();
  });
});
