import { describe, expect, it } from "vitest";
import ts from "typescript";
import type { NodeRecord, Page, StudioDocument } from "../src/document.js";
import { DOCUMENT_VERSION, defaultTokens } from "../src/document.js";

/** Wrap a page fixture into a single-page StudioDocument (generateFiles input). */
function asDoc(page: Page, tokens = defaultTokens()): StudioDocument {
  return { documentVersion: DOCUMENT_VERSION, name: page.name, tokens, pages: [page] };
}
import { generateFiles } from "../src/codegen/generateFiles.js";
import { emitNodeJsx } from "../src/codegen/emitters.js";
import { serializeProps } from "../src/codegen/serialize.js";
import { pascalName } from "../src/codegen/pages.js";
import { pageName, slugify, tokensToTsSource } from "../src/codegen/scaffold.js";

const node = (
  id: string,
  type: string,
  children: string[] = [],
  props: Record<string, unknown> = {},
): NodeRecord => ({ id, type, props, children });

function docWith(
  rootId: string,
  nodes: NodeRecord[],
  name = "测试页",
): Page {
  return { id: "page-1", name, rootId, nodes };
}

const stackKit = new Map<string, string>([["Stack", "src"]]);


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

describe("serializeProps", () => {
  it("字符串 -> 双引号 JSX 属性字面量，实体编码且反斜杠保留", () => {
    expect(serializeProps({ title: 'a"b\\c' })).toBe('title="a&quot;b\\c"');
  });

  it("字符串属性生成可执行 TSX，并保留引号、实体文本、换行与反斜杠", () => {
    const value = ["今日 \"活跃\" & 留存", String.raw`D:\data\note &quot;`].join("\n");
    const attrs = serializeProps({ label: value });
    expect(attrs).toBe(String.raw`label="今日 &quot;活跃&quot; &amp; 留存&#10;D:\data\note &amp;quot;"`);
    const transpiled = ts.transpileModule(`const node = <X ${attrs} />;`, {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    expect(transpiled.diagnostics ?? []).toEqual([]);
    const component = Symbol("X");
    const element = new Function(
      "React",
      "X",
      `${transpiled.outputText}\nreturn node;`,
    )({
      createElement: (type: symbol, props: Record<string, unknown>) => ({ type, props }),
    }, component) as { type: symbol; props: Record<string, unknown> };
    expect(element.type).toBe(component);
    expect(element.props.label).toBe(value);
  });

  it("boolean：true 裸属性名，false -> ={false}", () => {
    expect(serializeProps({ sidebar: true })).toBe("sidebar");
    expect(serializeProps({ muted: false })).toBe("muted={false}");
  });

  it("number -> ={n}", () => {
    expect(serializeProps({ columns: 3, gap: 4 })).toBe("columns={3} gap={4}");
  });

  it("数组 -> ={JSON}", () => {
    expect(serializeProps({ items: ["首页", "数据"] })).toBe('items={["首页","数据"]}');
  });

  it("enum 字符串走字面量（tone/variant/size）", () => {
    expect(serializeProps({ tone: "success", variant: "primary" })).toBe('tone="success" variant="primary"');
  });

  it("undefined 与 null 跳过；空 props -> 空串", () => {
    expect(serializeProps({ a: undefined, b: "x", c: null })).toBe('b="x"');
    expect(serializeProps({})).toBe("");
  });

  it("多 key 用空格分隔，键序等于对象插入序", () => {
    expect(serializeProps({ label: "指标", value: "1", tone: "brand" })).toBe(
      'label="指标" value="1" tone="brand"',
    );
  });
});

describe("emitNodeJsx", () => {
  it("叶子自闭合", () => {
    const doc = docWith("t1", [node("t1", "Text", [], { content: "hi", muted: false })]);
    expect(emitNodeJsx(doc, "t1", new Set())).toBe(
      '<Text content="hi" muted={false} studioId="t1" />',
    );
  });

  it("容器子节点缩进为 JSX 子元素", () => {
    const doc = docWith("g", [
      node("g", "Grid", ["s1", "s2"], { columns: 2, gap: 4 }),
      node("s1", "StatCard", [], { label: "A", value: "1", tone: "brand" }),
      node("s2", "StatCard", [], { label: "B", value: "2", tone: "brand" }),
    ]);
    const jsx = emitNodeJsx(doc, "g", new Set());
    expect(jsx).toBe(
      [
        '<Grid columns={2} gap={4} studioId="g">',
        '  <StatCard label="A" value="1" tone="brand" studioId="s1" />',
        '  <StatCard label="B" value="2" tone="brand" studioId="s2" />',
        "</Grid>",
      ].join("\n"),
    );
  });

  it("AppShell 特例注入 studioId 与 tokens={TOKENS} 并标记 used", () => {
    const doc = docWith("shell", [node("shell", "AppShell", [], { title: "运营", sidebar: true })]);
    const used = new Set<string>();
    const jsx = emitNodeJsx(doc, "shell", used);
    expect(jsx).toBe('<AppShell title="运营" sidebar studioId="shell" tokens={TOKENS} />');
    expect(used.size).toBe(1);
  });

  it("无 props 的节点也带 studioId（属性序：props -> studioId -> tokens）", () => {
    const doc = docWith("only-id", [node("only-id", "Table", [], {})]);
    expect(emitNodeJsx(doc, "only-id", new Set())).toBe('<Table studioId="only-id" />');
  });

  it("studioId 值走同一套转义（引号/反斜杠）", () => {
    const weird = 'n"1\\x';
    const doc = docWith(weird, [node(weird, "Text", [], { content: "hi" })]);
    expect(emitNodeJsx(doc, weird, new Set())).toBe(
      String.raw`<Text content="hi" studioId="n&quot;1\x" />`,
    );
  });

  it("两次生成同一节点输出逐字符相等（确定性）", () => {
    const doc = docWith("g", [
      node("g", "Grid", ["s1"], { columns: 2, gap: 4 }),
      node("s1", "StatCard", [], { label: "A", value: "1", tone: "brand" }),
    ]);
    expect(emitNodeJsx(doc, "g", new Set())).toBe(emitNodeJsx(doc, "g", new Set()));
  });

  it("未知 type 与未知 id 都是占位注释", () => {
    const doc = docWith("m", [node("m", "MysteryBox", [], { x: 1 })]);
    expect(emitNodeJsx(doc, "m", new Set())).toBe("{/* unknown component: MysteryBox */}");
    expect(emitNodeJsx(doc, "ghost", new Set())).toBe("{/* unknown node: ghost */}");
  });

  it("id 中的 */ 不能提前闭合注释（sanitizeIdForComment 替换为 U+2215）", () => {
    const doc = docWith("shell", [node("shell", "AppShell", [], { title: "运营", sidebar: true })]);
    expect(emitNodeJsx(doc, "evil*/alert(1)", new Set())).toBe(
      "{/* unknown node: evil*∕alert(1) */}",
    );
    expect(emitNodeJsx(doc, "a*/*/*/b", new Set())).toBe("{/* unknown node: a*∕*∕*∕b */}");
  });
});

// frame 几何发射（emitNodeJsx absolute 模式 / frameStyleSource）见 codegen-layout.test.ts。

describe("pascalName / pageName / slugify", () => {
  it("pascalName：去非法字符，保留 CJK/数字，空格与连字符删除，数字开头加 _", () => {
    expect(pascalName("核心指标")).toBe("核心指标");
    expect(pascalName("数据-导入!")).toBe("数据导入");
    expect(pascalName("2024 复盘")).toBe("_2024复盘");
    expect(pascalName("!!!")).toBe("!!!");
  });

  it("pageName：ASCII 词 Pascal，CJK 直用，数字开头加 Page 前缀", () => {
    expect(pageName("My Dashboard")).toBe("MyDashboard");
    expect(pageName("运营工作台")).toBe("运营工作台");
    // 首字母必须大写：小写会被 JSX 当成 HTML 标签
    expect(pageName("my dashboard page")).toBe("MyDashboardPage");
    // 数字开头不是合法标识符（tsc TS1003 / esbuild 解析失败）
    // 「P3验收」ASCII+CJK 混词进 CJK 尾段，纯数字词排前 → 需要 Page 前缀
    expect(pageName("P3验收-1788901548556")).toBe("Page1788901548556P3验收");
    expect(pageName("2024")).toBe("Page2024");
    expect(pageName("!!!")).toBe("Page");
  });

  it("slugify：ASCII 小写连字符，CJK 直用", () => {
    expect(slugify("My Dashboard")).toBe("my-dashboard");
    expect(slugify("运营工作台")).toBe("运营工作台");
    expect(slugify("!!!")).toBe("studio-app");
  });
});

describe("tokens.css", () => {
  const files = generateFiles(asDoc(docWith("s", [node("s", "Stack", [], { gap: 2 })])), minimalKitStub());
  const css = files.get("src/styles/tokens.css")!;

  it(":root 14 个颜色变量（含 soft 色调）+ radius/spacing/font", () => {
    const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("@theme"));
    for (const key of ["brand", "surface", "text", "muted", "border", "accent", "success", "warning", "danger"]) {
      expect(rootBlock).toContain(`--studio-color-${key}:`);
    }
    for (const key of ["brand-soft", "success-soft", "warning-soft", "danger-soft", "muted-soft"]) {
      expect(rootBlock).toContain(`--studio-color-${key}:`);
    }
    expect((rootBlock.match(/--studio-color-/g) ?? []).length).toBe(16);
    expect(css).toContain("--studio-radius-card: 8px;");
    expect(css).toContain("--studio-radius-control: 6px;");
    expect(css).toContain("--studio-spacing-unit: 4px;");
    expect(css).toContain(`--studio-font-sans: "Inter, 'Segoe UI', system-ui, sans-serif";`);
  });

  it("@theme 映射全部变量 + tailwindcss import", () => {
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain("--color-studio-brand: var(--studio-color-brand);");
    expect(css).toContain("--radius-studio-card: var(--studio-radius-card);");
    expect(css).toContain("--spacing-studio-unit: var(--studio-spacing-unit);");
    expect(css).toContain("--font-studio-sans: var(--studio-font-sans);");
  });
});

describe("styles/tokens.ts", () => {
  it("TOKENS 对象字面量与 doc.tokens 深相等（as const satisfies）", () => {
    const ts = tokensToTsSource(defaultTokens());
    expect(ts).toContain('import type { Tokens } from "../studio/schema-core";');
    expect(ts).toContain("export const TOKENS = {");
    expect(ts).toContain("} as const satisfies Tokens;");
    // 对象字面量是 JSON 安全的（值全是 string/number）；key 加引号后 JSON.parse 深比较
    const declAt = ts.indexOf("export const TOKENS");
    const openAt = ts.indexOf("{", declAt);
    const closeAt = ts.indexOf("} as const", openAt); // 外层对象的收口
    const literal = ts.slice(openAt, closeAt + 1);
    const asJson = literal.replace(/^[ \t]*([A-Za-z0-9_]+):/gm, '"$1":');
    expect(JSON.parse(asJson)).toEqual(defaultTokens());
  });
});

describe("package.json 脚手架", () => {
  const files = generateFiles(asDoc(docWith("s", [node("s", "Stack", [], { gap: 2 })])), minimalKitStub());
  const pkg = JSON.parse(files.get("package.json")!) as {
    name: string;
    type: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };

  it("name slug 化、type module、scripts 三条", () => {
    expect(pkg.name).toBe("测试页");
    expect(pkg.type).toBe("module");
    expect(Object.keys(pkg.scripts)).toEqual(["dev", "build", "preview"]);
    expect(pkg.scripts.build).toContain("tsc --noEmit");
    expect(pkg.scripts.build).toContain("vite build");
  });

  it("dependencies：react 19、无 @studio", () => {
    expect(pkg.dependencies.react).toBe("^19.1.0");
    expect(pkg.dependencies["react-dom"]).toBe("^19.1.0");
    expect(Object.keys(pkg.dependencies).every((d) => !d.startsWith("@studio/"))).toBe(true);
  });

  it("devDependencies 版本与主仓库一致", () => {
    expect(pkg.devDependencies.vite).toBe("^7.0.0");
    expect(pkg.devDependencies["@vitejs/plugin-react"]).toBe("^4.5.0");
    expect(pkg.devDependencies.tailwindcss).toBe("^4.1.8");
    expect(pkg.devDependencies["@tailwindcss/vite"]).toBe("^4.1.8");
    expect(pkg.devDependencies.typescript).toBe("^5.9.0");
    expect(pkg.devDependencies["@types/react"]).toBe("^19.1.0");
    expect(pkg.devDependencies["@types/react-dom"]).toBe("^19.1.0");
  });
});

describe("vite/tsconfig/main/index.html/README 脚手架", () => {
  const files = generateFiles(asDoc(
    docWith("s", [node("s", "Stack", [], { gap: 2 })], "My App")), minimalKitStub());

  it("vite.config.ts 含 react + tailwindcss 两插件", () => {
    const vite = files.get("vite.config.ts")!;
    expect(vite).toContain("react()");
    expect(vite).toContain("tailwindcss()");
    expect(vite).toContain('from "@vitejs/plugin-react"');
    expect(vite).toContain('from "@tailwindcss/vite"');
  });

  it("tsconfig：react-jsx、strict、bundler、noEmit", () => {
    const ts = JSON.parse(files.get("tsconfig.json")!) as Record<string, unknown>;
    const co = ts.compilerOptions as Record<string, unknown>;
    expect(co.jsx).toBe("react-jsx");
    expect(co.strict).toBe(true);
    expect(co.moduleResolution).toBe("bundler");
    expect(co.noEmit).toBe(true);
  });

  it("main.tsx 默认导入 Page 组件与 tokens.css", () => {
    const main = files.get("src/main.tsx")!;
    expect(main).toContain('import { createRoot } from "react-dom/client";');
    expect(main).toContain('import MyApp from "./pages/MyApp";');
    expect(main).toContain('import "./styles/tokens.css";');
  });

  it("index.html root div + main.tsx", () => {
    const html = files.get("index.html")!;
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it("README 三行命令", () => {
    const readme = files.get("README.md")!;
    expect(readme).toContain("pnpm install");
    expect(readme).toContain("pnpm dev");
    expect(readme).toContain("pnpm build");
  });
});
