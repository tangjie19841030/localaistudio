import type { Frame, NodeRecord, Page, StudioDocument } from "../src/document.js";
import { DOCUMENT_VERSION, defaultTokens } from "../src/document.js";

/**
 * Shared codegen fixtures. Extracted from codegen.test.ts when that file
 * exceeded the 400-line cap; imported by codegen.test.ts and
 * codegen-layout.test.ts. Pure data builders — no assertions here.
 */

export const node = (
  id: string,
  type: string,
  children: string[] = [],
  props: Record<string, unknown> = {},
): NodeRecord => ({ id, type, props, children });

/** frame helper：rotation 省略时按 schema default(0) 补齐。 */
export const frame = (x: number, y: number, w: number, h: number, rotation?: number): Frame =>
  rotation === undefined ? { x, y, w, h, rotation: 0 } : { x, y, w, h, rotation };

/** 带 frame 的节点构造器。 */
export const nodeF = (
  id: string,
  type: string,
  children: string[] = [],
  props: Record<string, unknown> = {},
  f?: Frame,
): NodeRecord => ({ id, type, props, children, frame: f });

/** 固定 doc：AppShell 根 + Header + Section(StatCard×2+Button) + 独立 Section(EmptyState)。 */
export function buildFixtureDoc(): Page {
  return {
    id: "page-1",
    name: "运营工作台",
    rootId: "app-shell",
    nodes: [
      node("app-shell", "AppShell", ["header-1", "sec-metrics", "sec-import"], {
        title: "运营工作台",
        sidebar: true,
      }),
      node("header-1", "Header", [], { title: "页面标题", subtitle: "今日经营概况" }),
      node("sec-metrics", "Section", ["grid-1", "btn-1"], { title: "核心指标", description: "" }),
      node("grid-1", "MetricGrid", ["stat-1", "stat-2"], { columns: 2 }),
      node("stat-1", "StatCard", [], {
        label: '总用户（含 "引号" 与 \\ 反斜杠）',
        value: "12,345",
        delta: "+3.2%",
        tone: "success",
      }),
      node("stat-2", "StatCard", [], { label: "月收入", value: "¥12,000", tone: "brand" }),
      node("btn-1", "Button", [], { label: "导出报表", variant: "secondary", size: "sm" }),
      node("sec-import", "Section", ["empty-1"], { title: "数据导入", description: "从 CSV 文件导入" }),
      node("empty-1", "EmptyState", [], { title: "暂无数据", description: "" }),
    ],
  };
}

/** kit 源码 fixture：组件名 -> 源码；特殊 key "tokens" 对应 ui-kit 的 tokens.ts。 */
export function kitFixture(): Map<string, string> {
  const plain = (name: string) => `export default function ${name}() { return null; }\n`;
  return new Map<string, string>([
    ["AppShell", `import { tokensToCssVars } from "../tokens";\nimport type { Tokens } from "@studio/schema-core";\n${plain("AppShell")}`],
    ["StatCard", `import { toneTextClass } from "../tokens";\n${plain("StatCard")}`],
    ["Header", plain("Header")],
    ["Section", plain("Section")],
    ["MetricGrid", plain("MetricGrid")],
    ["Stack", plain("Stack")],
    ["Grid", plain("Grid")],
    ["Container", plain("Container")],
    ["Heading", plain("Heading")],
    ["Text", plain("Text")],
    ["Button", plain("Button")],
    ["EmptyState", plain("EmptyState")],
    ["Table", plain("Table")], // 在 kitSources 中但 doc 未使用 -> 不得拷贝
    ["tokens", `import type { Tokens } from "@studio/schema-core";\nexport type Tone = "brand";\n`],
  ]);
}

export function minimalKit(...names: string[]): Map<string, string> {
  return new Map<string, string>(
    names.map((n) => [n, `export default function ${n}() { return null; }\n`]),
  );
}

/** P5 画布 fixture：AppShell 根 + 1 个带 frame 的 StatCard + 1 个无 frame 的 Header。 */
export function frameDoc(): Page {
  return {
    id: "page-1",
    name: "画布页",
    rootId: "shell",
    nodes: [
      node("shell", "AppShell", ["card-1", "header-1"], { title: "画布页", sidebar: true }),
      nodeF("card-1", "StatCard", [], { label: "月收入", value: "¥1" }, frame(320, 80, 240, 120, 45)),
      node("header-1", "Header", [], { title: "页面标题", subtitle: "" }),
    ],
  };
}

/** 通用 page 构造（emitNodeJsx 级测试用）。 */
export function docWith(rootId: string, nodes: NodeRecord[], name = "测试页"): Page {
  return { id: "page-1", name, rootId, nodes };
}

/** Wrap a page fixture into a single-page StudioDocument (generateFiles input). */
export function asDoc(page: Page, tokens = defaultTokens()): StudioDocument {
  return { documentVersion: DOCUMENT_VERSION, name: page.name, tokens, pages: [page] };
}
