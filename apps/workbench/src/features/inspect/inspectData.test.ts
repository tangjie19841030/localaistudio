import { describe, expect, it } from "vitest";
import type { NodeRecord, Page } from "@studio/schema-core";
import { buildInspectData } from "./inspectData";

function page(nodes: NodeRecord[]): Page {
  return { id: "p1", name: "测试页", rootId: "root", nodes };
}

const framedDoc = (): Page =>
  page([
    {
      id: "root",
      type: "Section",
      props: { title: "区块", description: "" },
      children: ["btn"],
      pinned: true,
      frame: { x: 100, y: 50, w: 400, h: 300, rotation: 0 },
    },
    {
      id: "btn",
      type: "Button",
      props: { label: "保存" },
      children: [],
      pinned: true,
      frame: { x: 140, y: 90, w: 80, h: 32, rotation: 45 },
    },
  ]);

describe("buildInspectData", () => {
  it("frame+pinned 节点：布局参数行 + codegen 同源 CSS（父 frame 原点重基，含 rotate）", () => {
    const doc = framedDoc();
    const btn = buildInspectData(doc.nodes[1]!, doc);
    expect(btn.flowNote).toBeNull();
    expect(btn.frameSection.rows.map((r) => `${r.label}=${r.value}`)).toEqual([
      "x=140",
      "y=90",
      "w=80",
      "h=32",
      "rotation=45",
    ]);
    // Parent frame (100,50) re-bases the child origin: left 140-100, top 90-50.
    expect(btn.cssPreview).toBe(
      '{ position: "absolute", left: 40, top: 40, width: 80, height: 32, transform: "rotate(45deg)" }',
    );
    // Root has no positioned ancestor: absolute page origin, rotation 0 → no transform.
    const root = buildInspectData(doc.nodes[0]!, doc);
    expect(root.cssPreview).toBe(
      '{ position: "absolute", left: 100, top: 50, width: 400, height: 300 }',
    );
  });

  it("流式节点（无 frame）：流式布局提示、无 CSS 预览、无布局参数", () => {
    const doc = page([
      { id: "root", type: "Section", props: { title: "区块", description: "" }, children: ["btn"] },
      { id: "btn", type: "Button", props: { label: "保存" }, children: [] },
    ]);
    const data = buildInspectData(doc.nodes[1]!, doc);
    expect(data.flowNote).toBe("流式布局 · 继承容器");
    expect(data.cssPreview).toBe("");
    expect(data.frameSection.rows).toEqual([]);
    // Required prop kept; optional schema keys without raw values dropped.
    expect(data.propsSection.rows).toEqual([{ label: "label", value: "保存" }]);
  });

  it("未知类型：原始 props 透传、标题回退为 type", () => {
    const doc = page([
      { id: "u", type: "MysteryBox", props: { a: 1, b: "x" }, children: [] },
    ]);
    const data = buildInspectData(doc.nodes[0]!, doc);
    expect(data.title).toBe("MysteryBox");
    expect(data.subtitle).toBe("MysteryBox");
    expect(data.propsSection.rows).toEqual([
      { label: "a", value: "1" },
      { label: "b", value: "x" },
    ]);
  });

  it("props 反射：非法值回退默认、未声明键丢弃、缺失必填填默认", () => {
    const doc = page([{ id: "b", type: "Button", props: { label: "保存", variant: "nope", extra: "dropped" }, children: [] }]);
    const data = buildInspectData(doc.nodes[0]!, doc);
    expect(data.propsSection.rows).toEqual([
      { label: "label", value: "保存" },
      { label: "variant", value: "primary" },
    ]);
    // Required prop missing entirely → registry default (emitter equivalence).
    const empty = buildInspectData(
      { id: "b2", type: "Button", props: {}, children: [] },
      page([]),
    );
    expect(empty.propsSection.rows).toEqual([{ label: "label", value: "按钮" }]);
    expect(empty.title).toBe("按钮");
  });
});
