import { describe, expect, it } from "vitest";
import type { NodeRecord, Page, StudioDocument } from "../src/document.js";
import { defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import { breakpointCssSource } from "../src/codegen/breakpointCss.js";
import { generateFiles } from "../src/codegen/generateFiles.js";
import { tokensCssWithBreakpoints, tokensToCssSource } from "../src/codegen/scaffold.js";
import { minimalKit } from "./codegen-fixtures.js";

/**
 * W4-A codegen side of the three-view parity matrix. The schema-view twin
 * assertions live in apps/workbench/src/preview/preview.test.tsx; P1/P2 assert
 * the SAME literal (`repeat(2, minmax(0,1fr))`) on both sides — that string
 * equality is the parity lock.
 */

/** Parity fixture: Grid columns base 3 / tablet 2 / mobile 1 + Stack gap base 4 / mobile 2. */
const PARITY_GRID_ID = "grid-1";
const PARITY_STACK_ID = "stack-1";

function bpNode(id: string, type: string, props: Record<string, unknown>, breakpoints?: unknown): NodeRecord {
  return { id, type, props, children: [], ...(breakpoints ? { breakpoints: breakpoints as never } : {}) };
}

/** Root Container > Grid(3, tablet 2, mobile 1) + Stack(gap 4, mobile 2). */
function parityPage(): Page {
  return {
    id: "page-1",
    name: "断点页",
    rootId: "root",
    nodes: [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: [PARITY_GRID_ID, PARITY_STACK_ID] },
      bpNode(PARITY_GRID_ID, "Grid", { columns: 3, gap: 4 }, { tablet: { columns: 2 }, mobile: { columns: 1 } }),
      bpNode(PARITY_STACK_ID, "Stack", { gap: 4, align: "stretch" }, { mobile: { gap: 2 } }),
    ],
  };
}

const parityDoc = (): StudioDocument => ({
  documentVersion: DOCUMENT_VERSION,
  name: "断点文档",
  tokens: defaultTokens(),
  pages: [parityPage()],
});

/** Same structure, no overrides — the byte-identity baseline fixture. */
function plainPage(): Page {
  return {
    id: "page-1",
    name: "断点页",
    rootId: "root",
    nodes: [
      { id: "root", type: "Container", props: { maxWidth: "lg" }, children: [PARITY_GRID_ID, PARITY_STACK_ID] },
      bpNode(PARITY_GRID_ID, "Grid", { columns: 3, gap: 4 }),
      bpNode(PARITY_STACK_ID, "Stack", { gap: 4, align: "stretch" }),
    ],
  };
}

const plainDoc = (): StudioDocument => ({ ...parityDoc(), pages: [plainPage()] });

const parityKit = (): Map<string, string> => minimalKit("Container", "Grid", "Stack");

describe("W4-A codegen：breakpointCssSource", () => {
  const css = breakpointCssSource(parityDoc());

  it("P1 tablet 段：min-width:768px and max-width:1279px + data-studio-id + repeat(2, minmax(0,1fr))", () => {
    expect(css).toContain("@media (min-width:768px) and (max-width:1279px) {");
    expect(css).toContain(`[data-studio-id="${PARITY_GRID_ID}"]`);
    // Parity lock: identical literal to the renderer-side assertion (preview.test.tsx).
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr)) !important;");
  });

  it("P2 mobile 段：max-width:767px + repeat(1, minmax(0,1fr))", () => {
    expect(css).toContain("@media (max-width:767px) {");
    expect(css).toContain("grid-template-columns:repeat(1,minmax(0,1fr)) !important;");
  });

  it("gap 覆盖按 kit 语义 ×4 转 px（Stack gap 4 → mobile 2 = 8px）", () => {
    expect(css).toContain(`[data-studio-id="${PARITY_STACK_ID}"] { gap:8px !important; }`);
    // Grid 未被覆盖的 gap 不出现在任何规则里（只覆盖显式声明的键）
    expect(css).not.toContain("gap:16px");
  });

  it("每节点每视口一段，块顺序按页内节点顺序 + 视口声明顺序", () => {
    const grid = css.indexOf(`[data-studio-id="${PARITY_GRID_ID}"]`);
    const stack = css.indexOf(`[data-studio-id="${PARITY_STACK_ID}"]`);
    expect(grid).toBeGreaterThan(-1);
    expect(stack).toBeGreaterThan(grid);
  });

  it("无覆盖文档返回空串（不产文件、不改 tokens.css）", () => {
    expect(breakpointCssSource(plainDoc())).toBe("");
  });

  it("P4 非白名单键与坏值不产规则（绕过校验的旧档静默降级）", () => {
    const doc = parityDoc();
    doc.pages[0]!.nodes[1]!.breakpoints = {
      tablet: { label: "非法", columns: 99 },
      mobile: { gap: 2 },
    } as never;
    const out = breakpointCssSource(doc);
    expect(out).not.toContain("label");
    expect(out).not.toContain("columns");
    // Grid 的 gap 不在白名单外的 mobile 覆盖里 —— 但 Grid.gap 是白名单键
    expect(out).toContain(`[data-studio-id="${PARITY_GRID_ID}"] { gap:8px !important; }`);
  });

  it("P5 pinned 节点不产规则（校验前置拦截的镜像）", () => {
    const doc = parityDoc();
    doc.pages[0]!.nodes[1] = { ...doc.pages[0]!.nodes[1]!, pinned: true, frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 } };
    const out = breakpointCssSource(doc);
    expect(out).not.toContain(`[data-studio-id="${PARITY_GRID_ID}"]`);
    expect(out).toContain(`[data-studio-id="${PARITY_STACK_ID}"]`);
  });

  it("未知组件类型/未知视口键不产规则", () => {
    const doc = parityDoc();
    doc.pages[0]!.nodes.push(bpNode("ghost", "Ghost", { columns: 3 }, { tablet: { columns: 1 } }));
    doc.pages[0]!.nodes[1]!.breakpoints = { wide: { columns: 2 } } as never;
    doc.pages[0]!.nodes[2]!.breakpoints = undefined;
    expect(breakpointCssSource(doc)).toBe("");
  });
});

describe("W4-A codegen：generateFiles 接入", () => {
  it("P1/P2 产物：带覆盖文档写 breakpoints.css 且 tokens.css @import 它", () => {
    const files = generateFiles(parityDoc(), parityKit());
    const css = files.get("src/styles/breakpoints.css");
    expect(css).toBeDefined();
    expect(css).toContain("@media (min-width:768px) and (max-width:1279px) {");
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr)) !important;");
    // @import 必须在规则之前才生效（CSS 规范），因此紧跟 tailwind 入口
    const tokens = files.get("src/styles/tokens.css")!;
    expect(tokens).toContain('@import "tailwindcss";\n@import "./breakpoints.css";');
  });

  it("P3 无覆盖文档：产物与 W4 前基线字节相等（不产 breakpoints.css、tokens.css 不变）", () => {
    const files = generateFiles(plainDoc(), parityKit());
    expect(files.has("src/styles/breakpoints.css")).toBe(false);
    expect(files.get("src/styles/tokens.css")).toBe(tokensToCssSource(plainDoc().tokens));
  });

  it("P3 回归：同一无覆盖文档两次生成逐字节相等", () => {
    const a = generateFiles(plainDoc(), parityKit());
    const b = generateFiles(plainDoc(), parityKit());
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("页面 JSX 不受影响（A 方案：CSS 直击 data-studio-id，emitters 零改动）", () => {
    const withBp = generateFiles(parityDoc(), parityKit()).get("src/pages/断点页.tsx")!;
    const withoutBp = generateFiles(plainDoc(), parityKit()).get("src/pages/断点页.tsx")!;
    expect(withBp).toBe(withoutBp);
  });

  it("tokensCssWithBreakpoints：空串原样返回（无覆盖基线护栏）", () => {
    const tokens = tokensToCssSource(defaultTokens());
    expect(tokensCssWithBreakpoints(tokens, "")).toBe(tokens);
    expect(tokensCssWithBreakpoints(tokens, "/* x */")).not.toBe(tokens);
  });
});
