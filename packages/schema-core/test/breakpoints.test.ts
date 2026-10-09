import { describe, expect, it } from "vitest";
import {
  BREAKPOINT_NAMES,
  BREAKPOINT_PROPS,
  breakpointIssues,
  clearNodeBreakpoints,
  nodeBreakpointSchema,
  resolveBreakpointProps,
  updateNodeBreakpoints,
  type NodeBreakpoints,
  type OverlayViewport,
} from "../src/registry/breakpoints.js";
import { OpError } from "../src/registry/documentOps.js";
import { clearPlacement, relayoutDocument } from "../src/registry/relayout.js";
import { duplicatePage } from "../src/registry/pageOps.js";
import {
  checkStudioDocument,
  defaultPage,
  defaultStudioDocument,
  validateDocument,
  type NodeRecord,
  type Page,
} from "../src/document.js";

/** Grid(columns 3, gap 4) with tablet/mobile overlay + root Container. */
function bpPage(overrides?: NodeBreakpoints): Page {
  const nodes: NodeRecord[] = [
    { id: "root", type: "Container", props: {}, children: ["g"] },
    { id: "g", type: "Grid", props: { columns: 3, gap: 4 }, children: [], ...(overrides ? { breakpoints: overrides } : {}) },
  ];
  return { id: "page-1", name: "断点测试页", rootId: "root", nodes };
}

function withPage(page: Page) {
  return { ...defaultStudioDocument("断点测试"), pages: [page] };
}

const grid = (overrides?: NodeBreakpoints): NodeRecord => bpPage(overrides).nodes[1]!;

describe("T66 常量与形状", () => {
  it("BREAKPOINT_NAMES 顺序为 desktop/tablet/mobile，白名单只含布局结构属性", () => {
    expect([...BREAKPOINT_NAMES]).toEqual(["desktop", "tablet", "mobile"]);
    expect(BREAKPOINT_PROPS).toEqual({ Grid: ["columns", "gap"], MetricGrid: ["columns"], Stack: ["gap"] });
  });

  it("nodeBreakpointSchema 接受 tablet/mobile 记录，拒绝非记录值", () => {
    expect(nodeBreakpointSchema.safeParse({ tablet: { columns: 2 } }).success).toBe(true);
    expect(nodeBreakpointSchema.safeParse({}).success).toBe(true);
    expect(nodeBreakpointSchema.safeParse({ tablet: [1, 2] }).success).toBe(false);
  });
});

describe("T66 resolveBreakpointProps", () => {
  it("desktop 直接返回 props 浅拷贝（新对象，不改动输入）", () => {
    const node = grid({ tablet: { columns: 2 } });
    const resolved = resolveBreakpointProps(node, "desktop");
    expect(resolved).toEqual({ columns: 3, gap: 4 });
    expect(resolved).not.toBe(node.props);
    expect(node.props).toEqual({ columns: 3, gap: 4 }); // 输入未被写回
    expect(node.breakpoints).toEqual({ tablet: { columns: 2 } });
  });

  it("tablet/mobile 覆盖 base 同名键，其余键保持 base 值", () => {
    const node = grid({ tablet: { columns: 2 }, mobile: { columns: 1, gap: 2 } });
    expect(resolveBreakpointProps(node, "tablet")).toEqual({ columns: 2, gap: 4 });
    expect(resolveBreakpointProps(node, "mobile")).toEqual({ columns: 1, gap: 2 });
  });

  it("无 breakpoints 字段的旧节点三视口结果一致", () => {
    const node = grid();
    const base = resolveBreakpointProps(node, "desktop");
    expect(resolveBreakpointProps(node, "tablet")).toEqual(base);
    expect(resolveBreakpointProps(node, "mobile")).toEqual(base);
  });

  it("非白名单键与坏值在 resolve 层静默丢弃（绕过校验的旧档不崩）", () => {
    const node: NodeRecord = {
      id: "g",
      type: "Grid",
      props: { columns: 3, gap: 4 },
      children: [],
      breakpoints: { tablet: { label: "非法", columns: 99, gap: 3 } } as NodeBreakpoints,
    };
    expect(resolveBreakpointProps(node, "tablet")).toEqual({ columns: 3, gap: 3 });
  });

  it("未知组件类型的覆盖一律丢弃（白名单查不到）", () => {
    const node: NodeRecord = {
      id: "x",
      type: "Ghost",
      props: { columns: 3 },
      children: [],
      breakpoints: { tablet: { columns: 1 } },
    };
    expect(resolveBreakpointProps(node, "tablet")).toEqual({ columns: 3 });
  });

  it("MetricGrid.columns 与 Stack.gap 各自白名单生效", () => {
    const metric: NodeRecord = {
      id: "m",
      type: "MetricGrid",
      props: { columns: 4 },
      children: [],
      breakpoints: { mobile: { columns: 2 } },
    };
    expect(resolveBreakpointProps(metric, "mobile")).toEqual({ columns: 2 });
    const stack: NodeRecord = {
      id: "s",
      type: "Stack",
      props: { gap: 4, align: "stretch" },
      children: [],
      breakpoints: { tablet: { gap: 2, align: "center" } as Record<string, unknown> },
    };
    expect(resolveBreakpointProps(stack, "tablet")).toEqual({ gap: 2, align: "stretch" });
  });
});

describe("T66 breakpointIssues / checkStudioDocument", () => {
  it("白名单 + 合法值：无错误行", () => {
    expect(breakpointIssues(bpPage({ tablet: { columns: 2 }, mobile: { columns: 1, gap: 2 } }))).toEqual([]);
    expect(checkStudioDocument(withPage(bpPage({ tablet: { columns: 2 } })))).toEqual([]);
  });

  it("非白名单键报错（Button.label 进 overlay）", () => {
    const page = bpPage({ tablet: { label: "非法" } });
    expect(breakpointIssues(page)).toEqual(['节点 "g" 的断点覆盖 "Grid.label" 不在白名单']);
    expect(checkStudioDocument(withPage(page))).toEqual(['节点 "g" 的断点覆盖 "Grid.label" 不在白名单']);
  });

  it("desktop 键被拒绝（基础值写在 props 里）", () => {
    const page = bpPage({ desktop: { columns: 2 } } as unknown as NodeBreakpoints);
    expect(breakpointIssues(page)).toEqual(['节点 "g" 的断点覆盖不允许出现 desktop（基础值写在 props 里）']);
  });

  it("未知视口键被拒绝", () => {
    const page = bpPage({ wide: { columns: 2 } } as unknown as NodeBreakpoints);
    expect(breakpointIssues(page)).toEqual(['节点 "g" 的断点覆盖视口 "wide" 不是 desktop/tablet/mobile']);
  });

  it("pinned 节点带 breakpoints 报互斥错误（预览层仍可解析）", () => {
    const page = bpPage({ tablet: { columns: 2 } });
    page.nodes[1] = { ...page.nodes[1]!, pinned: true, frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 } };
    expect(breakpointIssues(page)).toEqual(['节点 "g" 已 pinned（自由定位），不能带断点覆盖（互斥）']);
    expect(resolveBreakpointProps(page.nodes[1]!, "tablet")).toEqual({ columns: 2, gap: 4 });
  });

  it("值过不了字段 schema 报错（Grid.columns=99 / Grid.gap=99）", () => {
    const page = bpPage({ tablet: { columns: 99 }, mobile: { gap: 99 } });
    expect(breakpointIssues(page)).toEqual([
      '节点 "g" 的断点覆盖 "Grid.columns" 取值不合法',
      '节点 "g" 的断点覆盖 "Grid.gap" 取值不合法',
    ]);
  });

  it("无 breakpoints 字段的节点不产生任何错误行", () => {
    expect(breakpointIssues(bpPage())).toEqual([]);
    expect(breakpointIssues(defaultPage("空页"))).toEqual([]);
  });
});

describe("T66 strip 语义与克隆/重排", () => {
  it("旧文档无 breakpoints 时 parse 不注入该字段（DOCUMENT_VERSION 不变）", () => {
    const parsed = validateDocument(withPage(bpPage()));
    expect("breakpoints" in parsed.pages[0]!.nodes[1]!).toBe(false);
    expect(parsed.documentVersion).toBe(2);
  });

  it("带 breakpoints 的文档 parse 保留该字段（免迁移）", () => {
    const parsed = validateDocument(withPage(bpPage({ tablet: { columns: 2 } })));
    expect(parsed.pages[0]!.nodes[1]!.breakpoints).toEqual({ tablet: { columns: 2 } });
    expect(checkStudioDocument(parsed)).toEqual([]);
  });

  it("duplicatePage 克隆不保留 breakpoints（覆盖语义不随克隆迁移）", () => {
    const doc = withPage(bpPage({ tablet: { columns: 2 } }));
    const result = duplicatePage(doc, "page-1");
    expect(result).not.toBeNull();
    const clone = result!.doc.pages[1]!;
    expect(clone.nodes.every((n) => n.breakpoints === undefined)).toBe(true);
    // 源页不受影响
    expect(result!.doc.pages[0]!.nodes[1]!.breakpoints).toEqual({ tablet: { columns: 2 } });
  });

  it("relayout/clearPlacement 一并剥离 breakpoints（含仅有 breakpoints 的文档）", () => {
    const page = bpPage({ mobile: { columns: 1 } });
    const cleared = relayoutDocument(page);
    expect(cleared.nodes.every((n) => n.breakpoints === undefined)).toBe(true);
    expect(cleared.nodes[1]!.props).toEqual({ columns: 3, gap: 4 }); // props 不动
    expect(page.nodes[1]!.breakpoints).toEqual({ mobile: { columns: 1 } }); // 输入不可变
    // 只有 breakpoints 时也必须返回新文档（不是引用相同的 no-op）
    expect(clearPlacement(page)).not.toBe(page);
    // 已 flow 且无覆盖：仍是引用相同的 no-op
    expect(clearPlacement(cleared)).toBe(cleared);
  });
});

describe("T24b updateNodeBreakpoints", () => {
  it("合法 patch 增量合并当前视口，保留其他视口且不改动输入", () => {
    const source = bpPage({ tablet: { gap: 8 }, mobile: { columns: 1 } });
    const before = JSON.stringify(source);

    const once = updateNodeBreakpoints(source, "g", "tablet", { columns: 2 });
    expect(once.nodes[1]!.breakpoints).toEqual({
      tablet: { gap: 8, columns: 2 },
      mobile: { columns: 1 },
    });

    const twice = updateNodeBreakpoints(once, "g", "tablet", { gap: 6 });
    expect(twice.nodes[1]!.breakpoints).toEqual({
      tablet: { gap: 6, columns: 2 },
      mobile: { columns: 1 },
    });
    expect(twice).not.toBe(once);
    expect(twice.nodes[1]).not.toBe(once.nodes[1]);
    expect(JSON.stringify(source)).toBe(before);
    expect(checkStudioDocument(withPage(twice))).toEqual([]);
  });

  it("desktop 运行时防御返回 OpError，且文档不变", () => {
    const source = bpPage();
    const before = JSON.stringify(source);
    const run = () =>
      updateNodeBreakpoints(source, "g", "desktop" as OverlayViewport, { columns: 2 });

    expect(run).toThrow(OpError);
    expect(run).toThrow('节点 "g" 的断点覆盖视口 "desktop" 不合法');
    expect(JSON.stringify(source)).toBe(before);
  });

  it("未知节点和 pinned 节点返回 OpError，且文档不变", () => {
    expect(() => updateNodeBreakpoints(bpPage(), "ghost", "tablet", {})).toThrowError(
      expect.objectContaining({ name: "OpError" }),
    );
    expect(() => updateNodeBreakpoints(bpPage(), "ghost", "tablet", {})).toThrow(
      '节点 "ghost" 不存在',
    );

    const pinnedPage = bpPage({ tablet: { columns: 2 } });
    pinnedPage.nodes[1] = {
      ...pinnedPage.nodes[1]!,
      pinned: true,
      frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
    };
    const before = JSON.stringify(pinnedPage);
    expect(() => updateNodeBreakpoints(pinnedPage, "g", "tablet", { gap: 4 })).toThrow(
      '节点 "g" 已 pinned，不能同时设置断点覆盖',
    );
    expect(JSON.stringify(pinnedPage)).toBe(before);
  });

  it("非白名单字段、非法值或非对象 patch 返回 OpError，禁止部分提交", () => {
    const cases: Array<{ name: string; patch: unknown }> = [
      { name: "non-whitelist", patch: { label: "非法" } },
      { name: "invalid-value", patch: { columns: 99 } },
      { name: "non-object", patch: [{ columns: 2 }] },
    ];
    for (const testCase of cases) {
      const source = bpPage({ tablet: { gap: 8 } });
      const before = JSON.stringify(source);
      expect(
        () => updateNodeBreakpoints(source, "g", "tablet", testCase.patch as Record<string, unknown>),
        testCase.name,
      ).toThrowError(expect.objectContaining({ name: "OpError" }));
      expect(JSON.stringify(source), testCase.name).toBe(before);
    }
  });
});

describe("T24b clearNodeBreakpoints", () => {
  it("只清除指定视口，保留其他视口，成功结果通过文档检查", () => {
    const source = bpPage({ tablet: { columns: 2 }, mobile: { columns: 1 } });
    const before = JSON.stringify(source);

    const cleared = clearNodeBreakpoints(source, "g", "tablet");
    expect(cleared.nodes[1]!.breakpoints).toEqual({ mobile: { columns: 1 } });
    expect(checkStudioDocument(withPage(cleared))).toEqual([]);
    expect(cleared).not.toBe(source);
    expect(cleared.nodes[1]).not.toBe(source.nodes[1]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("清除最后一个视口后省略 breakpoints；无覆盖时仍返回语义等价新页", () => {
    const source = bpPage({ tablet: { columns: 2 } });
    const cleared = clearNodeBreakpoints(source, "g", "tablet");
    expect("breakpoints" in cleared.nodes[1]!).toBe(false);
    expect(checkStudioDocument(withPage(cleared))).toEqual([]);

    const noop = clearNodeBreakpoints(bpPage(), "g", "mobile");
    expect(noop).not.toBe(source);
    expect(noop.nodes[1]).not.toBe(source.nodes[1]);
    expect(checkStudioDocument(withPage(noop))).toEqual([]);
  });

  it("desktop、未知节点和 pinned 节点返回 OpError", () => {
    const source = bpPage();
    expect(() => clearNodeBreakpoints(source, "ghost", "tablet")).toThrowError(
      expect.objectContaining({ name: "OpError" }),
    );
    expect(() =>
      clearNodeBreakpoints(source, "g", "desktop" as OverlayViewport),
    ).toThrowError(expect.objectContaining({ name: "OpError" }));

    const pinnedPage = bpPage({ tablet: { columns: 2 } });
    pinnedPage.nodes[1] = { ...pinnedPage.nodes[1]!, pinned: true };
    expect(() => clearNodeBreakpoints(pinnedPage, "g", "tablet")).toThrowError(
      expect.objectContaining({ name: "OpError" }),
    );
  });
});
