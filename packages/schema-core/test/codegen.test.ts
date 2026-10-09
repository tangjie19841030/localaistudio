import { describe, expect, it } from "vitest";
import type { NodeRecord, Page } from "../src/document.js";
import { DOCUMENT_VERSION, defaultTokens } from "../src/document.js";
import { emitInjectedAttrs } from "../src/codegen/emitters.js";
import { generateFiles } from "../src/codegen/generateFiles.js";
import { componentPropKeys, listComponentDefs } from "../src/registry/componentDefs.js";
import { asDoc, buildFixtureDoc, kitFixture, minimalKit, node } from "./codegen-fixtures.js";


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

describe("generateFiles：固定 doc 的完整文件清单", () => {
  it("文件路径集合精确匹配（CJK 命名、tokens 助手、schema-core stub、脚手架）", () => {
    const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    expect([...files.keys()].sort()).toEqual(
      [
        "README.md",
        "index.html",
        "package.json",
        "pnpm-workspace.yaml",
        "src/components/generated/核心指标.tsx",
        "src/components/generated/数据导入.tsx",
        "src/components/tokens.ts",
        "src/components/ui-studio/AppShell.tsx",
        "src/components/ui-studio/Button.tsx",
        "src/components/ui-studio/EmptyState.tsx",
        "src/components/ui-studio/Header.tsx",
        "src/components/ui-studio/MetricGrid.tsx",
        "src/components/ui-studio/Section.tsx",
        "src/components/ui-studio/StatCard.tsx",
        "src/components/ui-studio/index.ts",
        "src/main.tsx",
        "src/pages/运营工作台.tsx",
        "src/studio/schema-core.ts",
        "src/styles/tokens.css",
        "src/styles/tokens.ts",
        "tsconfig.json",
        "vite.config.ts",
      ].sort(),
    );
  });
});

describe("generateFiles：页面组装", () => {
  const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
  const page = files.get("src/pages/运营工作台.tsx")!;

  it("import：kit barrel、TOKENS、两个 generated Section", () => {
    expect(page).toContain('import { AppShell, Header } from "../components/ui-studio";');
    expect(page).toContain('import { TOKENS } from "../styles/tokens";');
    expect(page).toContain('import { 核心指标 } from "../components/generated/核心指标";');
    expect(page).toContain('import { 数据导入 } from "../components/generated/数据导入";');
  });

  it("页面默认导出；AppShell 内联且注入 studioId + tokens={TOKENS}，sidebar 裸属性", () => {
    expect(page).toContain("export default function 运营工作台()");
    expect(page).toContain(
      '<AppShell title="运营工作台" sidebar studioId="app-shell" tokens={TOKENS}>',
    );
    expect(page).toContain('<Header title="页面标题" subtitle="今日经营概况" studioId="header-1" />');
  });

  it("Section 用 <Name /> 引用而非内联", () => {
    expect(page).toContain("<核心指标 />");
    expect(page).toContain("<数据导入 />");
    expect(page).not.toContain("<Section ");
  });
});

describe("generateFiles：Section 抽取与 props 序列化", () => {
  const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());

  it("核心指标.tsx：Section 自身内联 + StatCard 属性序列化（含引号/反斜杠编码）", () => {
    const m = files.get("src/components/generated/核心指标.tsx")!;
    expect(m).toContain("// GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理）");
    expect(m).toContain('import { Section, MetricGrid, StatCard, Button } from "../ui-studio";');
    expect(m).toContain("export function 核心指标()");
    expect(m).toContain('<Section title="核心指标" description="" studioId="sec-metrics">');
    expect(m).toContain('<MetricGrid columns={2} studioId="grid-1">');
    expect(m).toContain(
      String.raw`<StatCard label="总用户（含 &quot;引号&quot; 与 \ 反斜杠）" value="12,345" delta="+3.2%" tone="success" studioId="stat-1" />`,
    );
    expect(m).toContain('<StatCard label="月收入" value="¥12,000" tone="brand" studioId="stat-2" />');
    expect(m).toContain('<Button label="导出报表" variant="secondary" size="sm" studioId="btn-1" />');
  });

  it("数据导入.tsx：独立 Section 的 EmptyState 子树", () => {
    const f = files.get("src/components/generated/数据导入.tsx")!;
    expect(f).toContain('import { Section, EmptyState } from "../ui-studio";');
    expect(f).toContain("export function 数据导入()");
    expect(f).toContain('<Section title="数据导入" description="从 CSV 文件导入" studioId="sec-import">');
    expect(f).toContain('<EmptyState title="暂无数据" description="" studioId="empty-1" />');
  });
});

describe("generateFiles：kit 拷贝闭包", () => {
  const kit = kitFixture();
  const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());

  it("只拷贝 doc 用到的组件，源码逐字节一致（@studio/schema-core 重写为相对 stub）", () => {
    expect([...files.keys()].some((p) => p.includes("Table"))).toBe(false);
    expect(files.get("src/components/ui-studio/StatCard.tsx")).toBe(kit.get("StatCard"));
    const appShell = files.get("src/components/ui-studio/AppShell.tsx")!;
    expect(appShell).toContain('from "../../studio/schema-core"');
    expect(appShell).not.toContain("@studio/schema-core");
  });

  it("拷贝了依赖 ../tokens 的组件时连带拷贝 tokens 源码（schema-core 引用重写为相对 stub）", () => {
    expect(files.get("src/components/tokens.ts")).toBe(
      'import type { Tokens } from "../studio/schema-core";\nexport type Tone = "brand";\n',
    );
  });

  it("ui-studio/index.ts 只 re-export 拷贝到的组件（声明序）", () => {
    const barrel = files.get("src/components/ui-studio/index.ts")!;
    expect(barrel).toContain('export { default as AppShell } from "./AppShell";');
    expect(barrel).toContain('export { default as StatCard } from "./StatCard";');
    // header + 7 exports（AppShell/Header/Section/MetricGrid/StatCard/Button/EmptyState）+ 尾行 ""
    expect(barrel.split("\n")).toHaveLength(9);
    expect(barrel).not.toContain("Table");
  });
});

describe("generateFiles：studioId 注入（视觉问题回溯 Schema 节点的桥）", () => {
  it("每个注册组件的 codegen 必填契约都来自自身 schema 且有安全默认值", () => {
    for (const definition of listComponentDefs()) {
      const declared = new Set(componentPropKeys(definition));
      for (const key of definition.requiredProps) {
        expect(declared.has(key), `${definition.type}.${key} 未在 propsSchema 声明`).toBe(true);
        expect(Object.hasOwn(definition.defaultProps, key), `${definition.type}.${key} 缺少默认值`).toBe(true);
      }
    }
  });

  it("导出时补齐 registry 默认值并回退非法值，保证 ui-kit 必填契约", () => {
    const doc: Page = {
      id: "page-1",
      name: "登录页面",
      rootId: "page-root",
      nodes: [
        node("page-root", "Container", ["login-section"], {}),
        node("login-section", "Section", ["submit"], {}),
        node("submit", "Button", [], { label: "登录", size: "large" }),
      ],
    };
    const files = generateFiles(asDoc(doc), kitFixture());
    expect(files.get("src/pages/登录页面.tsx")).toContain(
      '<Container maxWidth="lg" studioId="page-root">',
    );
    expect(files.get("src/components/generated/Loginsection.tsx")).toContain(
      '<Section title="区块标题" studioId="login-section">',
    );
    expect(files.get("src/components/generated/Loginsection.tsx")).toContain(
      '<Button label="登录" size="md" studioId="submit" />',
    );
  });

  it("只保留 registry 自有声明属性：原型链字段不能进入导出 JSX，且不补默认值", () => {
    const attrs = emitInjectedAttrs(
      node("heading-1", "Heading", [], {
        text: "标题",
        toString: "误注入",
        constructor: "误注入",
        valueOf: "误注入",
      }),
      () => undefined,
    );
    expect(attrs).toBe(' text="标题" studioId="heading-1"');
  });

  /** 3 节点小 doc：Stack 根 + Heading + Text，全部内联在页面文件里。 */
  function tinyDoc(): Page {
    return {
      id: "page-1",
      name: "小页",
      rootId: "stack-1",
      nodes: [
        node("stack-1", "Stack", ["heading-1", "text-1"], { gap: 2 }),
        node("heading-1", "Heading", [], { text: "标题", level: 2 }),
        node("text-1", "Text", [], { content: "正文", muted: false }),
      ],
    };
  }

  it("每个节点的 JSX 都带 studioId=\"<node.id>\"", () => {
    const files = generateFiles(asDoc(tinyDoc()), kitFixture());
    const page = files.get("src/pages/小页.tsx")!;
    expect(page).toContain('<Stack gap={2} studioId="stack-1">');
    expect(page).toContain('<Heading text="标题" level={2} studioId="heading-1" />');
    expect(page).toContain('<Text content="正文" muted={false} studioId="text-1" />');
    // 节点数 == studioId 出现次数：没有节点被漏掉，也没有重复注入
    expect((page.match(/studioId="/g) ?? []).length).toBe(3);
  });

  it("AppShell 同时拿到 tokens={TOKENS} 与 studioId，且 tokens 在后", () => {
    const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    const page = files.get("src/pages/运营工作台.tsx")!;
    expect(page).toContain(
      '<AppShell title="运营工作台" sidebar studioId="app-shell" tokens={TOKENS}>',
    );
  });

  it("studioId 不进 registry props：doc 未声明也照样注入，属性序固定", () => {
    const doc: Page = {
      id: "page-1",
      name: "空属性页",
      rootId: "tbl-1",
      nodes: [node("tbl-1", "Table", [], { columns: [], rows: [] })],
    };
    const files = generateFiles(asDoc(doc), kitFixture());
    expect(files.get("src/pages/空属性页.tsx")!).toContain(
      '<Table columns={[]} rows={[]} studioId="tbl-1" />',
    );
  });

  it("两次生成 studioId 输出确定（页面内容逐字节相等）", () => {
    const doc = tinyDoc();
    const a = generateFiles(asDoc(doc), kitFixture());
    const b = generateFiles(asDoc(doc), kitFixture());
    expect(b.get("src/pages/小页.tsx")).toBe(a.get("src/pages/小页.tsx"));
  });
});

describe("generateFiles：确定性", () => {
  it("同 doc 两次生成：路径顺序与内容逐字节相等", () => {
    const doc = buildFixtureDoc();
    const a = generateFiles(asDoc(doc), kitFixture());
    const b = generateFiles(asDoc(doc), kitFixture());
    expect([...b.keys()]).toEqual([...a.keys()]);
    for (const [path, content] of a) {
      expect(b.get(path)).toBe(content);
    }
  });
});

describe("generateFiles：未知 type 容错", () => {
  it("占位注释，不抛错，不拷贝未知组件", () => {
    const doc: Page = {
      id: "page-1",
      name: "容错页",
      rootId: "stack-1",
      nodes: [
        node("stack-1", "Stack", ["mystery", "text-1"], { gap: 2 }),
        node("mystery", "MysteryBox", [], {}),
        node("text-1", "Text", [], { content: "说明文字", muted: false }),
      ],
    };
    const files = generateFiles(asDoc(doc), kitFixture());
    const page = files.get("src/pages/容错页.tsx")!;
    expect(page).toContain("{/* unknown component: MysteryBox */}");
    expect(page).toContain('<Text content="说明文字" muted={false} studioId="text-1" />');
    expect([...files.keys()].some((p) => p.includes("MysteryBox"))).toBe(false);
  });
});

describe("generateFiles：AppShell 嵌套在 Section 内", () => {
  it("generated 文件内 TOKENS 用 ../../styles/tokens 相对路径", () => {
    const doc: Page = {
      id: "page-1",
      name: "嵌套壳",
      rootId: "sec-outer",
      nodes: [
        node("sec-outer", "Section", ["shell-inner"], { title: "外层", description: "" }),
        node("shell-inner", "AppShell", [], { title: "内壳", sidebar: false }),
      ],
    };
    const files = generateFiles(asDoc(doc), kitFixture());
    const page = files.get("src/pages/嵌套壳.tsx")!;
    expect(page).toContain("<外层 />");
    expect(page).not.toContain("<AppShell");
    const outer = files.get("src/components/generated/外层.tsx")!;
    expect(outer).toContain('import { TOKENS } from "../../styles/tokens";');
    expect(outer).toContain(
      '<AppShell title="内壳" sidebar={false} studioId="shell-inner" tokens={TOKENS} />',
    );
  });
});

describe("generateFiles：Pascal 名生成与唯一化", () => {
  it("ASCII 名、重名后缀、kit 名冲突、title 兜底 id、数字开头加下划线", () => {
    const doc: Page = {
      id: "page-1",
      name: "My Dashboard",
      rootId: "stack-1",
      nodes: [
        node("stack-1", "Stack", ["s1", "s2", "s3", "s4", "s5"], { gap: 2 }),
        node("s1", "Section", [], { title: "stats", description: "" }),
        node("s2", "Section", [], { title: "Stats", description: "" }),
        node("s3", "Section", [], { title: "Button", description: "" }),
        node("s4", "Section", [], { title: "!!!", description: "" }),
        node("s5", "Section", [], { title: "2024 复盘", description: "" }),
      ],
    };
    const files = generateFiles(asDoc(doc), kitFixture());
    expect(files.has("src/pages/MyDashboard.tsx")).toBe(true);
    expect(files.has("src/components/generated/Stats.tsx")).toBe(true);
    expect(files.has("src/components/generated/Stats2.tsx")).toBe(true);
    expect(files.has("src/components/generated/Button2.tsx")).toBe(true);
    expect(files.has("src/components/generated/S4.tsx")).toBe(true);
    expect(files.has("src/components/generated/_2024复盘.tsx")).toBe(true);
    const page = files.get("src/pages/MyDashboard.tsx")!;
    expect(page).toContain('import { Stats } from "../components/generated/Stats";');
    expect(page).toContain('import { Stats2 } from "../components/generated/Stats2";');
    expect(page).toContain('import { Button2 } from "../components/generated/Button2";');
    expect(files.get("src/components/generated/S4.tsx")!).toContain("export function S4()");
  });
});

describe("generateFiles：kitSources 契约错误", () => {
  it("缺少用到的组件源码 -> 抛错点名组件", () => {
    const kit = kitFixture();
    kit.delete("Header");
    expect(() => generateFiles(asDoc(buildFixtureDoc()), kit)).toThrow(/Header/);
  });

  it("拷贝组件依赖 ../tokens 但 kitSources 缺 tokens -> 抛错", () => {
    const kit = kitFixture();
    kit.delete("tokens");
    expect(() => generateFiles(asDoc(buildFixtureDoc()), kit)).toThrow(/tokens/);
  });

  it("组件源码含不支持的 ../ 相对导入 -> 抛错", () => {
    const kit = kitFixture();
    kit.set("Header", 'import { x } from "../helpers";\nexport default function Header() {}\n');
    expect(() => generateFiles(asDoc(buildFixtureDoc()), kit)).toThrow(/\.\.\/helpers/);
  });

  it("组件源码 import 非 schema-core 的 @studio 包 -> 抛错", () => {
    const kit = kitFixture();
    kit.set("Header", 'import { x } from "@studio/ui-kit";\nexport default function Header() {}\n');
    expect(() => generateFiles(asDoc(buildFixtureDoc()), kit)).toThrow(/@studio\/ui-kit/);
  });
});

describe("generateFiles：main.tsx 与页面组件的导出契约", () => {
  it("main.tsx 用默认导入（页面是 default export）；schema-core stub 语法有效", () => {
    const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    const main = files.get("src/main.tsx")!;
    expect(main).toMatch(/import 运营工作台 from "\.\/pages\/运营工作台";/);
    expect(files.get("src/pages/运营工作台.tsx")!).toContain("export default function 运营工作台()");
    const stub = files.get("src/studio/schema-core.ts")!;
    expect(stub).not.toContain("string,"); // 无尾逗号
    expect(stub).toContain("    string");
  });
});

describe("generateFiles：pnpm workspace 隔离（E2E 发现）", () => {
  it("输出 pnpm-workspace.yaml：空 packages + esbuild 构建许可，防向上攀附 workspace", () => {
    const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    const yaml = files.get("pnpm-workspace.yaml") ?? "";
    expect(yaml).toContain("packages: []");
    expect(yaml).toContain("allowBuilds:");
    expect(yaml).toContain("esbuild: true");
  });
});
