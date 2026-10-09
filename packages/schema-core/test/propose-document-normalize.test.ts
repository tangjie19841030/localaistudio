import { describe, expect, it } from "vitest";
import { pageSchema } from "../src/document.js";
import { STUDIO_TOOLS, toolByName, type StudioTool } from "../src/agent/tools.js";

/**
 * Normalizer contract for propose_document (live-model tolerance):
 * inline children flattening, token deep-merge, rootId/name/version healing.
 * The flat-schema strictness stays — normalization only repairs RECURRING
 * real-model shapes, it never invents nodes the model did not describe.
 */

const tool: StudioTool = toolByName("propose_document")!;

function run(args: unknown, scope?: { nodeIds?: string[] }) {
  return tool.execute(args, {
    page: {
      id: "page-1",
      name: "当前页",
      rootId: "root",
      nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
    },
    doc: {
      documentVersion: 2,
      name: "当前页",
      tokens: {
        color: { brand: "#000000", surface: "#FFFFFF", text: "#111111", muted: "#666666", border: "#EEEEEE", accent: "#00AA00", success: "#00CC00", warning: "#CC8800", danger: "#CC0000" },
        radius: { card: 8, control: 4 },
        spacing: { unit: 4 },
        font: { sans: "Inter" },
      },
      pages: [
        {
          id: "page-1",
          name: "当前页",
          rootId: "root",
          nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
        },
      ],
    },
    ...(scope ? { scope } : {}),
  });
}

describe("propose_document 归一化（真实模型容错）", () => {
  it("内嵌 children 对象 → 拍平为节点表，声明的 id 原样保留", () => {
    const inline = {
      documentVersion: 1,
      name: "内嵌页",
      tokens: {},
      rootId: "root",
      nodes: [
        {
          id: "root",
          type: "Stack",
          props: { gap: 6 },
          children: [
            { id: "h1", type: "Heading", props: { text: "标题", level: 1 } },
            { type: "Text", props: { content: "副文案" }, children: [] },
          ],
        },
      ],
    };
    const result = run({ document: inline });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0]!.nodes.map((n) => n.id)).toEqual(["root", "h1", "Text-1"]);
    expect(result.doc.pages[0]!.nodes.find((n) => n.id === "root")?.children).toEqual(["h1", "Text-1"]);
    const reparsed = pageSchema.safeParse(result.doc.pages[0]!);
    expect(reparsed.success).toBe(true);
  });

  it("children 混合字符串引用与内嵌对象 → 引用保留，对象拍平", () => {
    const mixed = {
      documentVersion: 1,
      name: "混合页",
      tokens: {},
      rootId: "root",
      nodes: [
        { id: "h1", type: "Heading", props: { text: "标题", level: 1 } },
        {
          id: "root",
          type: "Stack",
          props: {},
          children: ["h1", { id: "btn", type: "Button", props: { label: "订阅" } }],
        },
      ],
    };
    const result = run({ document: mixed });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0]!.nodes.find((n) => n.id === "root")?.children).toEqual(["h1", "btn"]);
    expect(result.doc.pages[0]!.nodes.map((n) => n.id)).toEqual(["h1", "root", "btn"]);
  });

  it("重复 id → 后者重新生成，不产生冲突", () => {
    const dup = {
      documentVersion: 1,
      name: "重复页",
      tokens: {},
      rootId: "root",
      nodes: [
        {
          id: "root",
          type: "Stack",
          props: {},
          children: [
            { id: "h1", type: "Heading", props: { text: "一", level: 1 } },
            { id: "h1", type: "Heading", props: { text: "二", level: 2 } },
          ],
        },
      ],
    };
    const result = run({ document: dup });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.doc.pages[0]!.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("h1");
    const kids = result.doc.pages[0]!.nodes.find((n) => n.id === "root")!.children;
    expect(kids).toHaveLength(2);
  });

  it("缺失/部分 tokens → 深合并默认值，自定义值保留", () => {
    const partial = {
      documentVersion: 1,
      name: "令牌页",
      tokens: { color: { brand: "#6F4E37" }, radius: { card: 12 } },
      rootId: "root",
      nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
    };
    const result = run({ document: partial });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // T19: model-submitted tokens are ignored — the doc keeps its own tokens.
    expect(result.doc.tokens.color.brand).toBe("#000000");
    expect(result.doc.tokens.radius.card).toBe(8);
  });

  it("模型双重编码的 JSON 字符串（含内嵌 children）→ 解析并拍平", () => {
    const doc = {
      documentVersion: 1,
      name: "串行页",
      tokens: { color: { brand: "#6F4E37" } },
      rootId: "root",
      nodes: [
        {
          id: "root",
          type: "Stack",
          props: {},
          children: [{ id: "h1", type: "Heading", props: { text: "标题", level: 1 } }],
        },
      ],
    };
    const result = run({ document: JSON.stringify(doc) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0]!.name).toBe("串行页");
    expect(result.doc.pages[0]!.nodes.map((n) => n.id)).toEqual(["root", "h1"]);
  });

  it("缺 name / documentVersion → 安全默认值补齐", () => {
    const bare = {
      tokens: {},
      rootId: "root",
      nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
    };
    const result = run({ document: bare });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.name).toBe("当前页");
    expect(result.doc.documentVersion).toBe(2);
  });

  it("children 写在 props 里 → 提升为结构字段，props 不再含 children", () => {
    const propsChildren = {
      documentVersion: 1,
      name: "props子页",
      tokens: {},
      rootId: "root",
      nodes: [
        {
          id: "root",
          type: "Stack",
          props: {
            gap: 6,
            children: [{ id: "h1", type: "Heading", props: { text: "标题", level: 1 } }],
          },
        },
      ],
    };
    const result = run({ document: propsChildren });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.doc.pages[0]!.nodes.find((n) => n.id === "root")!;
    expect(root.children).toEqual(["h1"]);
    expect(Object.keys(root.props)).toEqual(["gap"]);
    expect(result.doc.pages[0]!.nodes.map((n) => n.id)).toEqual(["root", "h1"]);
  });

  it("node 级 children 与 props.children 冲突 → node 级优先", () => {
    const conflict = {
      documentVersion: 1,
      name: "冲突页",
      tokens: {},
      rootId: "root",
      nodes: [
        {
          id: "root",
          type: "Stack",
          props: { children: [{ id: "inProps", type: "Text", props: { content: "x" } }] },
          children: [{ id: "onNode", type: "Text", props: { content: "y" } }],
        },
      ],
    };
    const result = run({ document: conflict });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0]!.nodes.find((n) => n.id === "root")!.children).toEqual(["onNode"]);
    expect(result.doc.pages[0]!.nodes.map((n) => n.id)).toEqual(["root", "onNode"]);
  });

  it("STUDIO_TOOLS 注册表仍包含 propose_document（拆分后注册不变）", () => {
    expect(STUDIO_TOOLS.some((t) => t.name === "propose_document")).toBe(true);
  });
});
