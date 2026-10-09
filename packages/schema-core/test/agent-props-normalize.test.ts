import { describe, expect, it } from "vitest";
import type { NodeRecord, Page, StudioDocument, ToolContext } from "../src/index.js";
import { checkPage, defaultPage, defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import { getComponentDef } from "../src/registry/componentDefs.js";
import { applyPatch, type PatchOp } from "../src/registry/patch.js";
import { toolByName, type StudioTool } from "../src/agent/tools.js";
import { normalizeAgentProps } from "../src/agent/propsNormalize.js";

/**
 * Container.maxWidth numeric tolerance is an AGENT-WRITE-ONLY repair
 * (insert_node / update_props). The registry zod enum stays strict and the
 * patch path keeps rejecting numbers — both asserted here.
 */

const node = (id: string, type: string, children: string[] = [], props: Record<string, unknown> = {}): NodeRecord => ({
  id,
  type,
  props,
  children,
});

/** root(Container) > sec(Section) 容器。 */
function buildDoc(): Page {
  const base = defaultPage("属性归一化测试页");
  return { ...base, nodes: [node("root", "Container", ["sec"]), node("sec", "Section")] };
}

function getNode(doc: Page, id: string): NodeRecord | undefined {
  return doc.nodes.find((n) => n.id === id);
}

/** First page of a tool-result document (single-page fixtures here). */
function pageOf(doc: StudioDocument): Page {
  return doc.pages[0]!;
}

/** Wrap a page fixture into a minimal single-page StudioDocument. */
function docOf(page: Page): StudioDocument {
  return {
    documentVersion: DOCUMENT_VERSION,
    name: "属性归一化测试页",
    tokens: defaultTokens(),
    pages: [page],
  };
}

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
  const doc: StudioDocument = ctx.doc ?? {
    documentVersion: DOCUMENT_VERSION,
    name: "属性归一化测试页",
    tokens: defaultTokens(),
    pages: [page],
  };
  return tool.execute(args, { page, doc, scope: "scope" in ctx ? ctx.scope : undefined });
}

function assertValid(next: StudioDocument): void {
  expect(checkPage(next.pages[0]!)).toEqual([]);
}

describe("Container.maxWidth 数字容错（AI 写入路径专属）", () => {
  const insert = toolByName("insert_node")!;
  const update = toolByName("update_props")!;

  /** 数字/数字字符串 → 语义枚举（Tailwind 断点阶梯）。 */
  const cases: Array<[number | string, string]> = [
    [320, "sm"],
    [640, "sm"],
    [641, "md"],
    [768, "md"],
    [1024, "lg"],
    [1280, "xl"],
    [1281, "full"],
    [1920, "full"],
    ["1200", "xl"],
    ["100%", "full"],
  ];

  it("insert_node：数字 maxWidth 成功并落库为映射后的枚举", () => {
    const result = run(insert, { type: "Container", props: { maxWidth: 1200 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    const inserted = getNode(pageOf(result.doc), getNode(pageOf(result.doc), "root")!.children.at(-1)!)!;
    expect(inserted.type).toBe("Container");
    expect(inserted.props.maxWidth).toBe("xl");
  });

  it("insert_node：阈值边界与数字字符串全表映射正确", () => {
    for (const [input, expected] of cases) {
      const result = run(insert, { type: "Container", props: { maxWidth: input } });
      expect(result.ok, `maxWidth=${String(input)} 应通过`).toBe(true);
      if (!result.ok) return;
      const inserted = getNode(pageOf(result.doc), getNode(pageOf(result.doc), "root")!.children.at(-1)!)!;
      expect(inserted.props.maxWidth, `maxWidth=${String(input)}`).toBe(expected);
    }
  });

  it("update_props：已有 Container 改为数字 maxWidth → 成功且映射正确", () => {
    const doc = deepFreeze(buildDoc());
    const result = run(update, { nodeId: "root", props: { maxWidth: 800 } }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.doc);
    expect(getNode(pageOf(result.doc), "root")!.props.maxWidth).toBe("lg");
    expect(getNode(doc, "root")!.props).toEqual({});
  });

  it("合法枚举原样保留，归一化不改变严格输入", () => {
    const result = run(insert, { type: "Container", props: { maxWidth: "xl" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inserted = getNode(pageOf(result.doc), getNode(pageOf(result.doc), "root")!.children.at(-1)!)!;
    expect(inserted.props.maxWidth).toBe("xl");
  });

  it("归一化仅限 Container.maxWidth：其他组件的数字属性原样保留", () => {
    const result = run(insert, { type: "Grid", props: { columns: 3, gap: 8 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inserted = getNode(pageOf(result.doc), getNode(pageOf(result.doc), "root")!.children.at(-1)!)!;
    expect(inserted.props).toEqual({ columns: 3, gap: 8 });

    // 非 Container 类型不进入归一化：同一 props 引用原样返回
    const passthrough = { maxWidth: 1200 };
    expect(normalizeAgentProps("Grid", passthrough)).toBe(passthrough);
    // 无 maxWidth 的 Container props 也不重建对象
    expect(normalizeAgentProps("Container", {})).toEqual({});
    expect(normalizeAgentProps("Container", undefined)).toBeUndefined();
  });

  it("垃圾值在 agent 写入路径仍失败（不映射负数/NaN/垃圾字符串）", () => {
    for (const bad of ["abc", -5, 0, Number.NaN, "50vh", "12px", ""]) {
      const result = run(insert, { type: "Container", props: { maxWidth: bad } });
      expect(result.ok, `maxWidth=${String(bad)} 应被拒绝`).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain("props 校验失败 (Container)");
      expect(result.message).toMatch(/maxWidth: /);
    }
  });

  it("update_props：垃圾 maxWidth → 失败且原 doc 不变", () => {
    const doc = buildDoc();
    const result = run(update, { nodeId: "root", props: { maxWidth: "abc" } }, { page: doc, doc: docOf(doc) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/maxWidth: /);
    expect(getNode(doc, "root")!.props).toEqual({});
  });

  it("严格性未放宽：zod schema 本身仍拒绝数字 maxWidth", () => {
    const parsed = getComponentDef("Container")!.propsSchema.safeParse({ maxWidth: 1200 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]!.path).toEqual(["maxWidth"]);
  });

  it("严格性未放宽：patch 路径（applyPatch node.update）数字 maxWidth 仍被拒", () => {
    const doc = docOf(buildDoc());
    const ops = [{ op: "node.update", id: "root", props: { maxWidth: 1200 } }] as unknown as PatchOp[];
    const result = applyPatch(doc, ops);
    expect(result.doc).toBe(doc);
    expect(result.applied).toEqual([]);
    expect(result.errors.join("\n")).toMatch(/maxWidth/);
  });
});
