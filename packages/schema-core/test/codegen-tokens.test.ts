import { describe, expect, it } from "vitest";
import type { NodeRecord, Page, StudioDocument } from "../src/document.js";
import { DOCUMENT_VERSION, defaultTokens } from "../src/document.js";

/** Wrap a page fixture into a single-page StudioDocument (generateFiles input). */
function asDoc(page: Page, tokens = defaultTokens()): StudioDocument {
  return { documentVersion: DOCUMENT_VERSION, name: page.name, tokens, pages: [page] };
}
import { generateFiles } from "../src/codegen/generateFiles.js";

const node = (
  id: string,
  type: string,
  children: string[] = [],
  props: Record<string, unknown> = {},
): NodeRecord => ({ id, type, props, children });

/** doc 不含任何引用 tokens 助手的组件 -> src/components/tokens.ts 不拷贝。 */
function noTokensDoc(): Page {
  return {
    id: "page-1",
    name: "无引用页",
    rootId: "sec-1",
    nodes: [
      node("sec-1", "Section", ["text-1"], { title: "说明", description: "" }),
      node("text-1", "Text", [], { content: "正文", muted: false }),
    ],
  };
}

/** doc 含引用 tokens 助手的组件（StatCard）。 */
function tokensImporterDoc(): Page {
  return {
    id: "page-1",
    name: "引用页",
    rootId: "sec-1",
    nodes: [
      node("sec-1", "Section", ["stat-1"], { title: "指标", description: "" }),
      node("stat-1", "StatCard", [], { label: "A", value: "1", tone: "brand" }),
    ],
  };
}


/** Minimal kit source map for single-arg generateFiles calls: Section+Text. */
function minimalKitStub(): Map<string, string> {
  return new Map([
    ["Section", "x"],
    ["Text", "y"],
    ["Stack", "s"],
    ["AppShell", "a"],
    ["StatCard", "sc"],
    ["Header", "h"],
    ["tokens", "export {}"],
  ]);
}

describe("generateFiles：tokens 助手拷贝决策", () => {
  it("无引用组件时 src/components/tokens.ts 不在输出里", () => {
    const files = generateFiles(asDoc(noTokensDoc()), minimalKitStub());
    expect(files.has("src/components/tokens.ts")).toBe(false);
  });

  it("有引用组件但 kitSources 缺 tokens -> 抛错点名", () => {
    const kit = minimalKitStub();
    kit.delete("tokens"); // 缺 tokens 助手源码
    kit.set("StatCard", 'import { toneTextClass } from "../tokens";\n'); // 引用 tokens 助手
    expect(() => generateFiles(asDoc(tokensImporterDoc()), kit)).toThrow(/tokens/);
  });

  it("有引用组件且 kitSources 有 tokens -> 原样拷贝", () => {
    const kit = minimalKitStub();
    kit.set("StatCard", 'import { toneTextClass } from "../tokens";\n'); // 引用 tokens 助手
    kit.set("tokens", "export type Tone = ...;\n");
    const files = generateFiles(asDoc(tokensImporterDoc()), kit);
    expect(files.get("src/components/tokens.ts")).toBe("export type Tone = ...;\n");
  });
});

describe("generateFiles：嵌套 Section", () => {
  it("外层 Section 引用内层 Section 组件（./相对路径），内层自身内联", () => {
    const doc: Page = {
      id: "page-1",
      name: "嵌套页",
      rootId: "sec-outer",
      nodes: [
        node("sec-outer", "Section", ["sec-inner"], { title: "外", description: "" }),
        node("sec-inner", "Section", ["text-1"], { title: "内", description: "" }),
        node("text-1", "Text", [], { content: "正文", muted: false }),
      ],
    };
    const files = generateFiles(asDoc(doc), minimalKitStub());
    const outer = files.get("src/components/generated/外.tsx")!;
    expect(outer).toContain('import { 内 } from "./内";');
    expect(outer).toContain("<内 />");
    expect(outer).toContain('import { Section } from "../ui-studio";'); // 外层 Section 自身内联
    const inner = files.get("src/components/generated/内.tsx")!;
    expect(inner).toContain('import { Section, Text } from "../ui-studio";');
    expect(inner).toContain('<Text content="正文" muted={false} studioId="text-1" />');
  });
});

describe("generateFiles：重复引用与重复节点", () => {
  it("同一 Section 多次引用时 import 只写一条；Text 在各 Section 文件内联", () => {
    const doc: Page = {
      id: "page-1",
      name: "重复页",
      rootId: "stack-1",
      nodes: [
        node("stack-1", "Stack", ["sec-a", "sec-b"], { gap: 2 }),
        node("sec-a", "Section", ["text-a"], { title: "甲", description: "" }),
        node("text-a", "Text", [], { content: "甲正文", muted: false }),
        node("sec-b", "Section", ["text-b"], { title: "乙", description: "" }),
        node("text-b", "Text", [], { content: "乙正文", muted: false }),
      ],
    };
    const files = generateFiles(asDoc(doc), minimalKitStub());
    const page = files.get("src/pages/重复页.tsx")!;
    expect((page.match(/import \{ 甲 \}/g) ?? []).length).toBe(1);
    expect((page.match(/import \{ 乙 \}/g) ?? []).length).toBe(1);
    expect(page).toContain("<甲 />");
    expect(page).toContain("<乙 />");
    expect(page).not.toContain("<Text "); // Text 内联在各 generated 文件，不在页面
    const jia = files.get("src/components/generated/甲.tsx")!;
    const yi = files.get("src/components/generated/乙.tsx")!;
    expect(jia).toContain('import { Section, Text } from "../ui-studio";');
    expect(yi).toContain('import { Section, Text } from "../ui-studio";');
    expect(jia).toContain('<Text content="甲正文" muted={false} studioId="text-a" />');
    expect(yi).toContain('<Text content="乙正文" muted={false} studioId="text-b" />');
  });

  it("根节点本身是 Section 时：页面引用根组件，不重复生成", () => {
    const doc: Page = {
      id: "page-1",
      name: "根区块页",
      rootId: "sec-root",
      nodes: [
        node("sec-root", "Section", ["text-1"], { title: "根区块", description: "" }),
        node("text-1", "Text", [], { content: "正文", muted: false }),
      ],
    };
    const files = generateFiles(asDoc(doc), minimalKitStub());
    const page = files.get("src/pages/根区块页.tsx")!;
    expect(page).toContain("<根区块 />");
    expect(files.get("src/components/generated/根区块.tsx")!).toContain(
      'import { Section, Text } from "../ui-studio";',
    );
  });
});
