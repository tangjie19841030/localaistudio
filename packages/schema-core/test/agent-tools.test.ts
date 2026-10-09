import { describe, expect, it } from "vitest";
import type { NodeRecord, Page, StudioDocument, ToolContext } from "../src/index.js";
import { checkPage, defaultPage, defaultTokens, DOCUMENT_VERSION, pageSchema } from "../src/document.js";
import { getComponentDef } from "../src/registry/componentDefs.js";
import { STUDIO_TOOLS, toolByName, type StudioTool } from "../src/agent/tools.js";

const node = (id: string, type: string, children: string[] = [], props: Record<string, unknown> = {}): NodeRecord => ({
  id,
  type,
  props,
  children,
});

/** root(sec 容器) > s1(StatCard) + stat-1(StatCard)；root 下另有 sec-2(Section) 容器。 */
function buildDoc(): Page {
  return {
    id: "page-1",
    name: "工具测试页",
    rootId: "root",
    nodes: [
      node("root", "Container", ["sec", "sec-2"]),
      node("sec", "Section", ["s1", "stat-1"]),
      node("s1", "StatCard", [], { label: "收入", value: "120", delta: "+5%", tone: "brand" }),
      node("stat-1", "StatCard", [], { label: "指标", value: "0", delta: "", tone: "brand" }),
      node("sec-2", "Section"),
    ],
  };
}

/** Wrap the page fixture into a minimal single-page StudioDocument. */
function docOf(page: Page): StudioDocument {
  return {
    documentVersion: DOCUMENT_VERSION,
    name: page.name,
    tokens: defaultTokens(),
    pages: [page],
  };
}

function getNode(doc: Page, id: string): NodeRecord | undefined {
  return doc.nodes.find((n) => n.id === id);
}

/** Deep-freeze the doc so any in-place mutation throws — immutability gate. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function run(tool: StudioTool, args: unknown, ctx: Partial<ToolContext> = {}) {
  const page = ctx.page ?? buildDoc();
  const doc = ctx.doc ?? docOf(page);
  const scope = "scope" in ctx ? ctx.scope : undefined;
  return tool.execute(args, { page, doc, scope });
}

/** All success results must keep the ACTIVE PAGE structurally valid. */
function assertValid(next: StudioDocument): void {
  expect(checkPage(next.pages[0]!)).toEqual([]);
}

/** First page of a tool-result document (single-page fixtures here). */
function pageOf(doc: StudioDocument): Page {
  return doc.pages[0]!;
}

describe("STUDIO_TOOLS 注册表", () => {
  it("恰好 9 个工具，名字唯一", () => {
    expect(STUDIO_TOOLS).toHaveLength(9);
    const names = STUDIO_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(9);
  });

  it("parameters 全为 zod schema，description 为非空中文", () => {
    for (const tool of STUDIO_TOOLS) {
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.parameters.safeParse).toBe("function");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it("toolByName 命中 9 个名字；未知名字返回 undefined", () => {
    for (const tool of STUDIO_TOOLS) {
      expect(toolByName(tool.name)).toBe(tool);
    }
    expect(toolByName("no_such_tool")).toBeUndefined();
  });
});

describe("read_document", () => {
  const tool = toolByName("read_document")!;

  it("返回文档名、节点数、树形大纲与完整 tokens；doc 引用不变", () => {
    const doc = buildDoc();
    const ctx = docOf(doc);
    const result = run(tool, {}, { page: doc, doc: ctx });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toBe(ctx); // same reference, read-only
    expect(result.message).toContain("文档: 工具测试页");
    expect(result.message).toContain("节点数: 5");
    expect(result.message).toContain("root(Container) > sec(Section)");
    expect(result.message).toContain("s1(StatCard)");
    expect(result.message).toContain("stat-1(StatCard)");
    expect(result.message).toContain("sec-2(Section)");
    expect(result.message).toContain("color");
    expect(result.message).toContain("#0F766E");
  });

  it("任意 scope 下都能读（只读豁免）", () => {
    const result = run(tool, {}, { scope: { nodeIds: [] } });
    expect(result.ok).toBe(true);
  });

  it("缺 doc 上下文返回 ok:false 且不抛", () => {
    const result = tool.execute({}, {} as ToolContext);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("list_components", () => {
  const tool = toolByName("list_components")!;

  it("列出全部注册组件行：type 标题 category 容器标记与精确属性名", () => {
    const result = run(tool, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain("StatCard 指标卡 data 属性: label, value, delta, tone");
    expect(result.message).toContain("Section 区块 layout 容器 属性: title, description");
    expect(result.message).toContain("AppShell 应用外壳 layout 容器 属性: title, sidebar");
    expect(result.message).toContain("Text 正文 content 属性: content, muted");
    // Non-container types must NOT carry the marker.
    expect(result.message).not.toContain("StatCard 指标卡 data 容器");
    for (const line of result.message.split("\n")) {
      expect(line).toMatch(/^[A-Za-z]+ .+ (layout|navigation|content|form|data|chart|feedback|marketing)( 容器)? 属性: .+$/);
    }
  });

  it("任意 scope 下都能列（只读豁免）且不修改文档", () => {
    const doc = buildDoc();
    const ctx = docOf(doc);
    const result = run(tool, {}, { page: doc, doc: ctx, scope: { nodeIds: [] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toBe(ctx);
  });
});

describe("insert_node", () => {
  const tool = toolByName("insert_node")!;

  it("省略 parentId 插入根节点下，默认 props，原 doc 冻结不变", () => {
    const doc = deepFreeze(buildDoc());
    const result = run(tool, { type: "Badge" }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    const rootChildren = getNode(pageOf(result.doc), "root")!.children;
    expect(rootChildren).toHaveLength(3);
    const newId = rootChildren[2]!;
    const inserted = getNode(pageOf(result.doc), newId)!;
    expect(inserted.type).toBe("Badge");
    expect(inserted.props).toEqual(getComponentDef("Badge")!.defaultProps);
    expect(result.message).toContain("已插入");
    expect(result.message).toContain("标签");
    expect(result.message).toContain(newId);
  });

  it("指定 parentId 与 index 插入，带 props 覆盖默认值", () => {
    const result = run(tool, { type: "StatCard", parentId: "sec", index: 0, props: { label: "活跃", value: "88", delta: "-1%", tone: "success" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    const secChildren = getNode(pageOf(result.doc), "sec")!.children;
    expect(secChildren).toEqual([secChildren[0], "s1", "stat-1"]);
    const inserted = getNode(pageOf(result.doc), secChildren[0]!)!;
    expect(inserted.props).toEqual({ label: "活跃", value: "88", delta: "-1%", tone: "success" });
  });

  it("未知 type → ok:false 提示 list_components；不修改文档", () => {
    const doc = buildDoc();
    const result = run(tool, { type: "NotAThing" }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("未知组件类型");
    expect(result.message).toContain("list_components");
    expect(doc.nodes).toHaveLength(5);
  });

  it("props 违反组件 schema（StatCard tone 枚举）→ ok:false 逐行列出 zod 问题", () => {
    const result = run(tool, { type: "StatCard", props: { tone: "sparkle" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("props 校验失败 (StatCard)");
    expect(result.message).toMatch(/tone: /);
  });

  it("父节点不存在 / 非容器 → ok:false 可读错误", () => {
    const missing = run(tool, { type: "Badge", parentId: "ghost" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.message).toContain("父节点 \"ghost\" 不存在");

    const leaf = run(tool, { type: "Badge", parentId: "s1" });
    expect(leaf.ok).toBe(false);
    if (leaf.ok) return;
    expect(leaf.message).toContain("不是容器");
  });

  it("坏参数（type 缺失）→ ok:false zod 行，不抛", () => {
    const result = run(tool, { parentId: "root" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/type: /);
  });

  it("scope：插入到范围外父节点 → 标准违规文本", () => {
    const result = run(tool, { type: "Badge", parentId: "sec-2" }, { scope: { nodeIds: ["sec"] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("节点 sec-2 超出修改范围");
  });

  it("scope：范围内父节点放行", () => {
    const result = run(tool, { type: "Badge", parentId: "sec" }, { scope: { nodeIds: ["sec"] } });
    expect(result.ok).toBe(true);
  });

  it("scope 未定义时任何父节点都可插", () => {
    const result = run(tool, { type: "Badge", parentId: "sec-2" });
    expect(result.ok).toBe(true);
  });
});

describe("update_props", () => {
  const tool = toolByName("update_props")!;

  it("合法 props 全量替换并计入 message；原 doc 不变", () => {
    const doc = deepFreeze(buildDoc());
    const result = run(tool, { nodeId: "stat-1", props: { label: "利润", value: "42", delta: "+2%", tone: "danger" } }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    expect(getNode(pageOf(result.doc), "stat-1")!.props).toEqual({ label: "利润", value: "42", delta: "+2%", tone: "danger" });
    expect(result.message).toContain("已更新节点 stat-1");
    expect(result.message).toContain("4");
  });

  it("缺省字段取组件默认值（zod default 生效）", () => {
    const result = run(tool, { nodeId: "stat-1", props: { label: "仅标签" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getNode(pageOf(result.doc), "stat-1")!.props).toEqual({ ...getComponentDef("StatCard")!.defaultProps, label: "仅标签" });
  });

  it("StatCard tone 非法枚举 → ok:false 列出 zod 问题行", () => {
    const result = run(tool, { nodeId: "s1", props: { tone: "purple" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("props 校验失败 (StatCard)");
    expect(result.message).toMatch(/tone: /);
  });

  it("未知节点 → ok:false；坏参数 → ok:false zod 行", () => {
    const missing = run(tool, { nodeId: "ghost", props: {} });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.message).toContain("\"ghost\" 不存在");

    const bad = run(tool, { nodeId: "s1" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.message).toMatch(/props: /);
  });

  it("scope：范围外节点 → 标准违规文本；范围内节点放行", () => {
    const denied = run(tool, { nodeId: "s1", props: { label: "x" } }, { scope: { nodeIds: ["stat-1"] } });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.message).toBe("节点 s1 超出修改范围");

    const allowed = run(tool, { nodeId: "stat-1", props: { label: "y" } }, { scope: { nodeIds: ["stat-1"] } });
    expect(allowed.ok).toBe(true);
  });

  it("scope 定义但省略 nodeIds（只读）→ 一律违规", () => {
    const result = run(tool, { nodeId: "s1", props: { label: "x" } }, { scope: { allowAllTokens: true } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("节点 s1 超出修改范围");
  });
});

describe("remove_node", () => {
  const tool = toolByName("remove_node")!;

  it("删除叶子节点；message 含节点 id；原 doc 不变", () => {
    const doc = deepFreeze(buildDoc());
    const result = run(tool, { nodeId: "stat-1" }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    expect(getNode(pageOf(result.doc), "stat-1")).toBeUndefined();
    expect(getNode(pageOf(result.doc), "sec")!.children).toEqual(["s1"]);
    expect(result.message).toBe("已删除节点 stat-1");
  });

  it("删除带子树的节点，message 计入后代数", () => {
    const result = run(tool, { nodeId: "sec" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    expect(getNode(pageOf(result.doc), "sec")).toBeUndefined();
    expect(getNode(pageOf(result.doc), "s1")).toBeUndefined();
    expect(getNode(pageOf(result.doc), "stat-1")).toBeUndefined();
    expect(result.message).toBe("已删除节点 sec（含 2 个后代节点）");
  });

  it("根节点 / 未知节点 → ok:false 可读错误，不抛", () => {
    const root = run(tool, { nodeId: "root" });
    expect(root.ok).toBe(false);
    if (root.ok) return;
    expect(root.message).toContain("不能删除根节点");

    const ghost = run(tool, { nodeId: "ghost" });
    expect(ghost.ok).toBe(false);
    if (ghost.ok) return;
    expect(ghost.message).toContain("\"ghost\" 不存在");
  });

  it("坏参数（缺 nodeId）→ ok:false zod 行", () => {
    const result = run(tool, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/nodeId: /);
  });

  it("scope：范围外 → 标准违规文本", () => {
    const result = run(tool, { nodeId: "sec-2" }, { scope: { nodeIds: ["sec"] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("节点 sec-2 超出修改范围");
  });
});

describe("move_node", () => {
  const tool = toolByName("move_node")!;

  it("跨容器移动到指定下标；原 doc 不变", () => {
    const doc = deepFreeze(buildDoc());
    const result = run(tool, { nodeId: "s1", newParentId: "sec-2", index: 0 }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    expect(getNode(pageOf(result.doc), "sec")!.children).toEqual(["stat-1"]);
    expect(getNode(pageOf(result.doc), "sec-2")!.children).toEqual(["s1"]);
    expect(result.message).toContain("已移动节点 s1");
  });

  it("目标非容器 / 节点不存在 → ok:false 可读错误", () => {
    const leaf = run(tool, { nodeId: "sec-2", newParentId: "s1" });
    expect(leaf.ok).toBe(false);
    if (leaf.ok) return;
    expect(leaf.message).toContain("不是容器");

    const ghostNode = run(tool, { nodeId: "ghost", newParentId: "sec" });
    expect(ghostNode.ok).toBe(false);
    if (ghostNode.ok) return;
    expect(ghostNode.message).toContain("\"ghost\" 不存在");

    const ghostParent = run(tool, { nodeId: "s1", newParentId: "ghost" });
    expect(ghostParent.ok).toBe(false);
    if (ghostParent.ok) return;
    expect(ghostParent.message).toContain("\"ghost\" 不存在");
  });

  it("移入自身后代（容器场景）→ ok:false 委托 OpError 文本", () => {
    const result = run(tool, { nodeId: "sec", newParentId: "sec" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("自身");
  });

  it("目标为非容器叶子 → ok:false 委托 OpError 文本", () => {
    const result = run(tool, { nodeId: "sec-2", newParentId: "s1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("不是容器");
  });

  it("scope：节点或新父容器任一越界都拒绝，文本逐行", () => {
    const both = run(tool, { nodeId: "s1", newParentId: "sec-2" }, { scope: { nodeIds: [] } });
    expect(both.ok).toBe(false);
    if (both.ok) return;
    expect(both.message).toBe("节点 s1 超出修改范围\n节点 sec-2 超出修改范围");

    const oneSide = run(tool, { nodeId: "s1", newParentId: "sec-2" }, { scope: { nodeIds: ["s1"] } });
    expect(oneSide.ok).toBe(false);
    if (oneSide.ok) return;
    expect(oneSide.message).toBe("节点 sec-2 超出修改范围");
  });

  it("scope：两端都在范围内放行", () => {
    const result = run(tool, { nodeId: "s1", newParentId: "sec-2" }, { scope: { nodeIds: ["s1", "sec-2"] } });
    expect(result.ok).toBe(true);
  });
});

describe("set_frame", () => {
  const tool = toolByName("set_frame")!;

  it("rotation 可省略（默认 0），frame 写入目标节点；原 doc 不变", () => {
    const doc = deepFreeze(buildDoc());
    const result = run(tool, { nodeId: "stat-1", frame: { x: -50.5, y: 80, w: 320, h: 160 } }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    expect(getNode(pageOf(result.doc), "stat-1")!.frame).toEqual({ x: -50.5, y: 80, w: 320, h: 160, rotation: 0 });
    expect(result.message).toContain("已设置节点 stat-1 的 frame");
  });

  it("非法 frame（w 0.5 / rotation 361）→ ok:false zod 行", () => {
    const small = run(tool, { nodeId: "stat-1", frame: { x: 0, y: 0, w: 0.5, h: 10, rotation: 0 } });
    expect(small.ok).toBe(false);
    if (small.ok) return;
    expect(small.message).toMatch(/frame\.w: /);

    const spun = run(tool, { nodeId: "stat-1", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 361 } });
    expect(spun.ok).toBe(false);
    if (spun.ok) return;
    expect(spun.message).toMatch(/frame\.rotation: /);
  });

  it("未知节点 → ok:false", () => {
    const result = run(tool, { nodeId: "ghost", frame: { x: 0, y: 0, w: 10, h: 10 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("\"ghost\" 不存在");
  });

  it("scope：范围外节点 → 标准违规文本", () => {
    const result = run(tool, { nodeId: "stat-1", frame: { x: 0, y: 0, w: 10, h: 10 } }, { scope: { nodeIds: ["s1"] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("节点 stat-1 超出修改范围");
  });
});

describe("set_token", () => {
  const tool = toolByName("set_token")!;

  it("合法 color token 写入并保持文档有效；原 doc 不变", () => {
    const doc = deepFreeze(buildDoc());
    const ctx = docOf(doc);
    const result = run(tool, { path: ["color", "brand"], value: "#123456" }, { page: doc, doc: ctx });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    expect(result.doc.tokens.color.brand).toBe("#123456");
    expect(ctx.tokens.color.brand).toBe("#0F766E"); // input doc unchanged
    expect(result.message).toContain("已设置 token color.brand = #123456");
  });

  it("radius / spacing / font 全族可用（表格驱动）", () => {
    const cases: Array<{ path: [string, string]; value: string | number; expected: string }> = [
      { path: ["radius", "card"], value: 8, expected: "已设置 token radius.card = 8" },
      { path: ["spacing", "unit"], value: 6, expected: "已设置 token spacing.unit = 6" },
      { path: ["font", "sans"], value: "Arial", expected: "已设置 token font.sans = Arial" },
    ];
    for (const c of cases) {
      const result = run(tool, { path: c.path, value: c.value });
      expect(result.ok, JSON.stringify(c)).toBe(true);
      if (!result.ok) continue;
      expect(result.message).toBe(c.expected);
    }
  });

  it("非法值（坏 hex / 越界数值）→ ok:false 委托 OpError 文本", () => {
    const badHex = run(tool, { path: ["color", "brand"], value: "teal" });
    expect(badHex.ok).toBe(false);
    if (badHex.ok) return;
    expect(badHex.message).toContain("#RRGGBB");

    const tooBig = run(tool, { path: ["radius", "card"], value: 65 });
    expect(tooBig.ok).toBe(false);
    if (tooBig.ok) return;
    expect(tooBig.message).toContain("0-64");
  });

  it("非法 path（未知 family / key）→ ok:false zod 行", () => {
    const badFamily = run(tool, { path: ["typo", "unit"], value: 4 });
    expect(badFamily.ok).toBe(false);
    if (badFamily.ok) return;
    expect(badFamily.message).toMatch(/path: /);

    const badKey = run(tool, { path: ["color", "sparkle"], value: "#123456" });
    expect(badKey.ok).toBe(false);
    if (badKey.ok) return;
    expect(badKey.message).toMatch(/path: /);
  });

  it("scope 定义但未开 allowAllTokens → token 违规文本", () => {
    const result = run(tool, { path: ["color", "brand"], value: "#123456" }, { scope: { nodeIds: ["s1"] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("token color.brand 不在允许范围");
  });

  it("scope 开 allowAllTokens → 放行", () => {
    const result = run(tool, { path: ["color", "brand"], value: "#123456" }, { scope: { allowAllTokens: true } });
    expect(result.ok).toBe(true);
  });

  it("scope 未定义（生成模式）→ 放行", () => {
    const result = run(tool, { path: ["color", "brand"], value: "#123456" });
    expect(result.ok).toBe(true);
  });
});

describe("propose_document", () => {
  const tool = toolByName("propose_document")!;
  const validDoc = {
    name: "提案页",
    rootId: "app",
    nodes: [
      node("app", "AppShell", ["h1"]),
      node("h1", "Heading", [], { text: "标题", level: 2 }),
    ],
  };

  it("合法文档 → ok:true，返回解析后的 doc（引用完整性通过；无 frame 节点已自动布局）", () => {
    const result = run(tool, { document: validDoc });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    const resultPage = result.doc.pages[0]!;
    expect(resultPage.name).toBe("提案页");
    expect(resultPage.nodes).toHaveLength(2);
    // Auto-framing adds frames on top of the parsed proposal. Unknown props are
    // rejected before this success path, so accepted props remain unchanged.
    const parsed = pageSchema.parse({ ...validDoc, id: "page-1" });
    const normalizedNodes = parsed.nodes.map((n) => ({
      ...n,
      frame: expect.any(Object),
    }));
    expect(resultPage).toEqual({ ...parsed, nodes: normalizedNodes });
    expect(resultPage.nodes.every((n) => n.frame !== undefined)).toBe(true);
    expect(result.message).toContain("页面提案有效");
    expect(result.message).toContain("自动布局");
  });

  it("AI 编造的未注册 props → 拒绝整页提案并返回可修正字段", () => {
    const docWithInventedProps = {
      ...validDoc,
      nodes: validDoc.nodes.map((n) =>
        n.id === "h1"
          ? { ...n, props: { text: "标题", imageUrl: "https://x/y.png", height: 220, background: "#F97316" } }
          : n,
      ),
    };
    const result = run(tool, { document: docWithInventedProps });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("文档属性校验失败");
    expect(result.message).toContain('节点 "h1" (Heading)');
    expect(result.message).toContain("imageUrl, height, background");
    expect(result.message).toContain("允许字段: text, level");
  });

  it("原型链字段不会伪装成声明 props，并返回明确错误", () => {
    const docWithInheritedNames = {
      ...validDoc,
      nodes: validDoc.nodes.map((n) =>
        n.id === "app"
          ? { ...n, props: { title: "自定义壳", toString: "误注入", constructor: "误注入" } }
          : { ...n, props: { text: "仅声明字段", valueOf: "误注入" } },
      ),
    };
    const result = run(tool, { document: docWithInheritedNames });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('节点 "app" (AppShell)');
    expect(result.message).toContain("toString, constructor");
    expect(result.message).toContain('节点 "h1" (Heading)');
    expect(result.message).toContain("valueOf");
  });

  it("坏枚举 / 缺字段 → ok:false 逐行回传 zod 问题", () => {
    // tokens color invalid enum + bad documentVersion literal
    // T19: pages carry no documentVersion/tokens — model-authored values are
    // stripped before validation, so those fields can no longer fail. A page
    // without nodes still fails schema validation.
    const missingField = run(tool, { document: { name: "缺节点页", rootId: "root" } });
    expect(missingField.ok).toBe(false);
    if (missingField.ok) return;
    expect(missingField.message).toContain("nodes: Required");
  });

  it("悬空 rootId → 归一化自动补 root 容器并收养孤儿节点", () => {
    const dangling = {
      ...validDoc,
      rootId: "missing",
    };
    const result = run(tool, { document: dangling });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    const resultPage = result.doc.pages[0]!;
    expect(resultPage.rootId).toBe("missing");
    const root = resultPage.nodes.find((n) => n.id === "missing");
    expect(root?.type).toBe("Container");
    expect(root?.children).toEqual(["app"]);
  });

  it("悬空 children 引用 → ok:false 列出对应问题", () => {
    const dangling = {
      ...validDoc,
      nodes: [node("app", "AppShell", ["ghost"])],
    };
    const result = run(tool, { document: dangling });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("文档引用完整性失败");
    expect(result.message).toContain("ghost");
  });

  it("局部修改模式（scope 定义）→ 提示改用单节点工具", () => {
    const result = run(tool, { document: validDoc }, { scope: { nodeIds: ["s1"] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("局部修改模式");
    expect(result.message).toContain("insert_node");
  });

  it("坏参数（缺 document）→ ok:false，不抛", () => {
    // document is required (union of record | string), so a missing key fails
    // at the tool schema with a zod line — still a non-throwing ok:false.
    const result = run(tool, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/document/i);
  });

  it("document 为 JSON 字符串 → 解析后通过校验", () => {
    const doc = defaultPage("串行文档");
    const result = run(tool, { document: JSON.stringify(doc) });
    expect(result.ok).toBe(true);
  });

  it("document 为非法 JSON 字符串 → ok:false 且提示", () => {
    const result = run(tool, { document: "{not json" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/JSON/);
  });
});

describe("execute 永不抛出", () => {
  it("每个工具喂入任意垃圾输入都不抛（表格驱动）", () => {
    const garbage: unknown[] = [null, undefined, 42, "str", [], { totally: "wrong" }, NaN];
    for (const tool of STUDIO_TOOLS) {
      for (const args of garbage) {
        let result: ReturnType<StudioTool["execute"]> | undefined;
        expect(() => {
          result = tool.execute(args, { page: buildDoc(), doc: docOf(buildDoc()) });
        }, `${tool.name}(${JSON.stringify(args)})`).not.toThrow();
        expect(result).toBeDefined();
        expect(typeof result!.message).toBe("string");
        expect(result!.message.length).toBeGreaterThan(0);
      }
    }
  });
});
