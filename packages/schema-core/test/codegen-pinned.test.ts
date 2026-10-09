import { describe, expect, it } from "vitest";
import type { NodeRecord, Page, StudioDocument } from "../src/document.js";
import { emitNodeJsx, FLOW_CONTEXT } from "../src/codegen/emitters.js";
import { generateFiles } from "../src/codegen/generateFiles.js";
import { asDoc, docWith, frame, frameDoc, minimalKit, node, nodeF } from "./codegen-fixtures.js";
import { toolByName, type StudioTool } from "../src/agent/tools.js";

/**
 * Plan C hybrid positioning — codegen honors `pinned`:
 *
 * flow default: ONLY `pinned && frame` nodes wrap in the absolute geometric
 * div (page-level coordinates, page root becomes position:relative). A legacy
 * frame on an un-pinned node is inert metadata — pre-Plan-C documents must
 * not regress. Explicit absolute mode keeps the P5 rule (any frame wraps) and
 * ignores `pinned`. Ruling R9: propose_document strips model-authored pinned
 * so AI output is always flow.
 */

/** NodeRecord builder with an optional pinned flag (fixture layer for Plan C). */
const nodeP = (
  id: string,
  type: string,
  children: string[] = [],
  props: Record<string, unknown> = {},
  f?: ReturnType<typeof frame>,
  pinned?: boolean,
): NodeRecord => ({ id, type, props, children, ...(f ? { frame: f } : {}), ...(pinned ? { pinned: true } : {}) });

describe("codegen · flow 默认：pinned 绝对层判据", () => {
  it("pinned+frame 叶子：输出绝对几何层（left/top/w/h 来自 frame），组件 studioId 保留", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["card-1"], { title: "T", sidebar: false }),
      nodeP("card-1", "StatCard", [], { label: "A", value: "1" }, frame(320, 80, 240, 120), true),
    ]);
    expect(emitNodeJsx(doc, "card-1", new Set())).toBe(
      [
        '<div data-studio-id="card-1" style={{ position: "absolute", left: 320, top: 80, width: 240, height: 120 }}>',
        '  <StatCard label="A" value="1" studioId="card-1" />',
        "</div>",
      ].join("\n"),
    );
  });

  it("未 pinned 带 frame（迁移安全核心）：输出无任何绝对包装，与同构无 frame 文档逐字节一致", () => {
    const legacy = frameDoc(); // AppShell + framed StatCard（无 pinned）+ Header
    const stripped = {
      ...legacy,
      nodes: legacy.nodes.map((n) => ({ id: n.id, type: n.type, props: n.props, children: n.children })),
    };
    const kit = minimalKit("AppShell", "StatCard", "Header");
    const a = generateFiles(asDoc(legacy), minimalKit("AppShell", "StatCard", "Header"));
    const b = generateFiles(asDoc(stripped), minimalKit("AppShell", "StatCard", "Header"));
    expect(a.get("src/pages/画布页.tsx")).toBe(b.get("src/pages/画布页.tsx"));
    const page = a.get("src/pages/画布页.tsx")!;
    expect(page).not.toContain('position: "absolute"');
    expect(page).not.toContain('position: "relative"');
    expect(page).not.toMatch(/<div data-studio-id=/);
  });

  it("pinned 无 frame：不包层（pin 是定位豁免但没有几何时无可输出）", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["card-1"], { title: "T", sidebar: false }),
      nodeP("card-1", "StatCard", [], { label: "A", value: "1" }, undefined, true),
    ]);
    expect(emitNodeJsx(doc, "card-1", new Set())).toBe('<StatCard label="A" value="1" studioId="card-1" />');
  });

  it("嵌套 pinned：子包装层相对最近 pinned 祖先重定基（页面级坐标语义）", () => {
    const doc = docWith("shell", [
      nodeP("shell", "AppShell", ["card-1"], { title: "T", sidebar: false }, frame(10, 20, 800, 600), true),
      nodeP("card-1", "StatCard", [], { label: "A", value: "1" }, frame(160, 110, 240, 120), true),
    ]);
    expect(emitNodeJsx(doc, "shell", new Set())).toBe(
      [
        '<div data-studio-id="shell" style={{ position: "absolute", left: 10, top: 20, width: 800, height: 600 }}>',
        '  <AppShell title="T" sidebar={false} studioId="shell" tokens={TOKENS}>',
        '    <div data-studio-id="card-1" style={{ position: "absolute", left: 150, top: 90, width: 240, height: 120 }}>',
        '      <StatCard label="A" value="1" studioId="card-1" />',
        "    </div>",
        "  </AppShell>",
        "</div>",
      ].join("\n"),
    );
  });

  it("未 pinned 的 framed 祖先不重定基：pinned 后代坐标保持页面级（不随未包层祖先漂移）", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["g"], { title: "T", sidebar: false }),
      nodeF("g", "Grid", ["card-1"], { columns: 2, gap: 4 }, frame(100, 50, 400, 300)), // 未 pinned：不包层
      nodeP("card-1", "StatCard", [], { label: "A", value: "1" }, frame(160, 110, 240, 120), true),
    ]);
    const page = generateFiles(asDoc(doc), minimalKit("AppShell", "Grid", "StatCard")).get("src/pages/测试页.tsx")!;
    expect(page).toContain(
      '<div data-studio-id="card-1" style={{ position: "absolute", left: 160, top: 110, width: 240, height: 120 }}>',
    );
    expect(page).not.toContain('data-studio-id="g" style=');
  });
});

describe("codegen · 页面容器定位上下文", () => {
  it("含 pinned 节点的 flow 页面：根容器 position: relative，包装层锚到页面", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["card-1"], { title: "T", sidebar: false }),
      nodeP("card-1", "StatCard", [], { label: "A", value: "1" }, frame(320, 80, 240, 120), true),
    ]);
    const page = generateFiles(asDoc(doc), minimalKit("AppShell", "Grid", "StatCard")).get("src/pages/测试页.tsx")!;
    expect(page).toContain('<div style={{ position: "relative" }}>');
    expect(page).toContain(
      [
        '      <div data-studio-id="card-1" style={{ position: "absolute", left: 320, top: 80, width: 240, height: 120 }}>',
        '        <StatCard label="A" value="1" studioId="card-1" />',
        "      </div>",
      ].join("\n"),
    );
  });

  it("无 pinned 文档（含未 pinned frame）：flow 页面无 relative 壳（零漂移）", () => {
    const page = generateFiles(asDoc(frameDoc()), minimalKit("AppShell", "StatCard", "Header")).get(
      "src/pages/画布页.tsx",
    )!;
    expect(page).not.toContain('position: "relative"');
  });
});

describe("codegen · absolute 兼容模式：pinned 无额外作用", () => {
  it("未 pinned 带 frame 的节点在 absolute 模式照常包层（P5 判据不变）", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["card-1"], { title: "T", sidebar: false }),
      nodeF("card-1", "StatCard", [], { label: "A", value: "1" }, frame(320, 80, 240, 120)),
    ]);
    expect(emitNodeJsx(doc, "card-1", new Set(), { layout: "absolute", originX: 0, originY: 0 })).toBe(
      [
        '<div data-studio-id="card-1" style={{ position: "absolute", left: 320, top: 80, width: 240, height: 120 }}>',
        '  <StatCard label="A" value="1" studioId="card-1" />',
        "</div>",
      ].join("\n"),
    );
  });

  it("flow 模式 pinned 包装与 absolute 模式同节点包装逐字节一致（同一包装路径）", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["card-1"], { title: "T", sidebar: false }),
      nodeP("card-1", "StatCard", [], { label: "A", value: "1" }, frame(320, 80, 240, 120), true),
    ]);
    const flow = emitNodeJsx(doc, "card-1", new Set(), FLOW_CONTEXT);
    const absolute = emitNodeJsx(doc, "card-1", new Set(), { layout: "absolute", originX: 0, originY: 0 });
    expect(flow).toBe(absolute);
  });
});

describe("propose_document · R9：剥离模型 authored 的 pinned", () => {
  const tool: StudioTool = toolByName("propose_document")!;

  const ctxDoc: StudioDocument = {
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
  };

  it("模型输出带 pinned 的节点 → 归一化后 pinned 被剥离，其余字段保留", () => {
    const proposal = {
      documentVersion: 1,
      name: "R9 测试页",
      tokens: {},
      rootId: "root",
      nodes: [
        { id: "root", type: "Stack", props: { gap: 4 }, children: ["btn"], pinned: true },
        { id: "btn", type: "Button", props: { label: "提交" }, children: [], pinned: true },
      ],
    };
    const result = tool.execute({ document: proposal }, { page: ctxDoc.pages[0]!, doc: ctxDoc });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resultPage = result.doc.pages[0]!;
    expect(resultPage.nodes.every((n) => n.pinned === undefined)).toBe(true);
    const root = resultPage.nodes.find((n) => n.id === "root")!;
    expect(root.type).toBe("Stack");
    expect(root.props).toEqual({ gap: 4 });
    expect(root.children).toEqual(["btn"]);
    const btn = resultPage.nodes.find((n) => n.id === "btn")!;
    expect(btn.props).toEqual({ label: "提交" });
  });

  it("内嵌 children 里的 pinned 同样剥离（flatten 之后 strip 生效）", () => {
    const proposal = {
      documentVersion: 1,
      name: "内嵌 R9 页",
      tokens: {},
      rootId: "root",
      nodes: [
        {
          id: "root",
          type: "Stack",
          props: {},
          children: [{ id: "h1", type: "Heading", props: { text: "标题", level: 1 }, pinned: true }],
        },
      ],
    };
    const result = tool.execute({ document: proposal }, { page: ctxDoc.pages[0]!, doc: ctxDoc });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resultPage = result.doc.pages[0]!;
    expect(resultPage.nodes.every((n) => n.pinned === undefined)).toBe(true);
    expect(resultPage.nodes.map((n) => n.id)).toEqual(["root", "h1"]);
  });
});
