import { describe, expect, it } from "vitest";
import { ABSOLUTE_CONTEXT, emitNodeJsx, frameStyleSource } from "../src/codegen/emitters.js";
import { generateFiles } from "../src/codegen/generateFiles.js";
import {
  asDoc,
  buildFixtureDoc,
  docWith,
  frame,
  frameDoc,
  kitFixture,
  minimalKit,
  node,
  nodeF,
} from "./codegen-fixtures.js";

/**
 * Layout-mode contract tests.
 *
 * Default flow: frames are canvas drag geometry (page-absolute rects) and
 * must NEVER reach the generated CSS — the whole tree renders in normal flow.
 * Explicit absolute ({ layout: "absolute" }): the P5 free-canvas compatibility
 * path keeps the old wrapper output, with one fix — page-absolute frame
 * coordinates are re-based onto the nearest framed ancestor (the positioned
 * wrapper CSS anchors to), so nested parent+child offsets no longer stack.
 */

const ABS = ABSOLUTE_CONTEXT;


describe("generateFiles：默认 flow 模式（frame 只是画布元数据，不进输出）", () => {
  it("framed 文档与同构无 frame 文档：页面输出逐字节一致", () => {
    const framed = frameDoc();
    const flowOnly = {
      ...framed,
      nodes: framed.nodes.map((n) => ({ id: n.id, type: n.type, props: n.props, children: n.children })),
    };
    const kit = minimalKit("AppShell", "StatCard", "Header");
    const a = generateFiles(asDoc(framed), kitFixture());
    const b = generateFiles(asDoc(flowOnly), kitFixture());
    expect(a.get("src/pages/画布页.tsx")).toBe(b.get("src/pages/画布页.tsx"));
  });

  it("framed 文档页面：无 absolute、无 relative 壳、无包装 div", () => {
    const page = generateFiles(asDoc(frameDoc()), kitFixture()).get(
      "src/pages/画布页.tsx",
    )!;
    expect(page).toContain('<AppShell title="画布页" sidebar studioId="shell" tokens={TOKENS}>');
    expect(page).toContain('<StatCard label="月收入" value="¥1" studioId="card-1" />');
    expect(page).not.toContain('position: "absolute"');
    expect(page).not.toContain('position: "relative"');
    expect(page).not.toMatch(/<div data-studio-id=/);
  });

  it("frame 藏在 Section 里：generated 文件同样无 absolute（flow 默认）", () => {
    const doc = docWith("sec-1", [
      node("sec-1", "Section", ["card-1"], { title: "画布区", description: "" }),
      nodeF("card-1", "StatCard", [], { label: "A", value: "1" }, frame(10, 20, 100, 50)),
    ]);
    const comp = generateFiles(asDoc(doc), kitFixture()).get(
      "src/components/generated/画布区.tsx",
    )!;
    expect(comp).toContain('<StatCard label="A" value="1" studioId="card-1" />');
    expect(comp).not.toContain('position: "absolute"');
    expect(comp).not.toMatch(/<div data-studio-id=/);
  });

  it("显式 layout:'flow' 与默认输出全量一致", () => {
    const kit = minimalKit("AppShell", "StatCard", "Header");
    const a = generateFiles(asDoc(frameDoc()), kitFixture());
    const b = generateFiles(asDoc(frameDoc()), kitFixture());
    expect([...b.entries()]).toEqual([...a.entries()]);
  });

  it("无 frame 文档回归：既有页面断言逐字节成立（不出现 relative 壳/包装 div）", () => {
    const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    const page = files.get("src/pages/运营工作台.tsx")!;
    expect(page).toContain('<AppShell title="运营工作台" sidebar studioId="app-shell" tokens={TOKENS}>');
    expect(page).toContain('<Header title="页面标题" subtitle="今日经营概况" studioId="header-1" />');
    expect(page).toContain("<核心指标 />");
    expect(page).not.toContain('style={{ position: "relative" }}');
    expect(page).not.toContain('position: "absolute"');
    expect(page).not.toMatch(/<div data-studio-id=/);
  });

  it("无 frame 纯文档：页面根没有 relative 壳", () => {
    const doc = docWith("s", [node("s", "Stack", [], { gap: 2 })], "纯流式页");
    const page = generateFiles(asDoc(doc), kitFixture()).get("src/pages/纯流式页.tsx")!;
    expect(page).not.toContain('position: "relative"');
  });
});

describe("generateFiles：显式 absolute 兼容路径（保持 P5 旧行为）", () => {
  const absolute = { layout: "absolute" } as const;

  it("页面：包装 div 携带 data-studio-id 与几何 style，AppShell 照旧 tokens+studioId", () => {
    const page = generateFiles(asDoc(frameDoc()), kitFixture(), absolute).get(
      "src/pages/画布页.tsx",
    )!;
    expect(page).toContain('<AppShell title="画布页" sidebar studioId="shell" tokens={TOKENS}>');
    expect(page).toContain(
      [
        '      <div data-studio-id="card-1" style={{ position: "absolute", left: 320, top: 80, width: 240, height: 120, transform: "rotate(45deg)" }}>',
        '        <StatCard label="月收入" value="¥1" studioId="card-1" />',
        "      </div>",
      ].join("\n"),
    );
    expect(page).toContain('<Header title="页面标题" subtitle="" studioId="header-1" />');
    expect(page).not.toContain('<div data-studio-id="card-1"><div');
  });

  it("页面根容器 position: relative（absolute 子级锚到页面）", () => {
    const page = generateFiles(asDoc(frameDoc()), kitFixture(), absolute).get(
      "src/pages/画布页.tsx",
    )!;
    expect(page).toContain('<div style={{ position: "relative" }}>');
  });

  it("frame 在 Section 抽取出的文件里也照常包装", () => {
    const doc = docWith("sec-1", [
      node("sec-1", "Section", ["card-1"], { title: "画布区", description: "" }),
      nodeF("card-1", "StatCard", [], { label: "A", value: "1" }, frame(10, 20, 100, 50)),
    ]);
    const comp = generateFiles(asDoc(doc), kitFixture(), absolute).get(
      "src/components/generated/画布区.tsx",
    )!;
    expect(comp).toContain(
      '    <div data-studio-id="card-1" style={{ position: "absolute", left: 10, top: 20, width: 100, height: 50 }}',
    );
  });

  it("根节点带 frame：照样被包装，包装层就是 data-studio-id 载体", () => {
    const doc = docWith("shell", [
      nodeF("shell", "AppShell", [], { title: "根", sidebar: false }, frame(5, 6, 800, 600)),
    ]);
    const page = generateFiles(asDoc(doc), kitFixture(), absolute).get("src/pages/测试页.tsx")!;
    expect(page).toContain(
      [
        '    <div data-studio-id="shell" style={{ position: "absolute", left: 5, top: 6, width: 800, height: 600 }}>',
        '      <AppShell title="根" sidebar={false} studioId="shell" tokens={TOKENS} />',
        "    </div>",
      ].join("\n"),
    );
    expect(page).toContain('<div style={{ position: "relative" }}>');
  });

  it("frame 只藏在 Section 里：页面也拿到 relative 根（any-frame 判定）", () => {
    const doc = docWith(
      "sec-1",
      [
        node("sec-1", "Section", ["card-1"], { title: "区", description: "" }),
        nodeF("card-1", "StatCard", [], { label: "A", value: "1" }, frame(1, 2, 3, 4)),
      ],
      "内嵌画布页",
    );
    const page = generateFiles(asDoc(doc), kitFixture(), absolute).get(
      "src/pages/内嵌画布页.tsx",
    )!;
    expect(page).toContain('<div style={{ position: "relative" }}>');
  });

  it("framed 父子嵌套：子级坐标按最近 framed 祖先重定基（修复坐标叠加）", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["grid-1"], { title: "嵌套", sidebar: false }),
      nodeF("grid-1", "Grid", ["card-1"], { columns: 2, gap: 4 }, frame(100, 50, 400, 300)),
      nodeF("card-1", "StatCard", [], { label: "A", value: "1" }, frame(160, 110, 240, 120)),
    ]);
    const page = generateFiles(asDoc(doc), kitFixture(), absolute).get(
      "src/pages/测试页.tsx",
    )!;
    expect(page).toContain(
      [
        '      <div data-studio-id="grid-1" style={{ position: "absolute", left: 100, top: 50, width: 400, height: 300 }}>',
        '        <Grid columns={2} gap={4} studioId="grid-1">',
        '          <div data-studio-id="card-1" style={{ position: "absolute", left: 60, top: 60, width: 240, height: 120 }}>',
        '            <StatCard label="A" value="1" studioId="card-1" />',
      ].join("\n"),
    );
  });
});

describe("emitNodeJsx：flow 默认不消费 frame", () => {
  it("带 frame 的叶子：默认输出裸组件 JSX（无包装 div）", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["s1"], { title: "运营", sidebar: true }),
      nodeF("s1", "StatCard", [], { label: "A", value: "1" }, frame(320, 80, 240, 120)),
    ]);
    expect(emitNodeJsx(doc, "s1", new Set())).toBe('<StatCard label="A" value="1" studioId="s1" />');
  });

  it("带 frame 的容器：默认整棵子树都是 flow（无包装 div）", () => {
    const doc = docWith("g", [
      nodeF("g", "Grid", ["s1"], { columns: 2, gap: 4 }, frame(0, 0, 400, 300)),
      node("s1", "StatCard", [], { label: "A", value: "1", tone: "brand" }),
    ]);
    expect(emitNodeJsx(doc, "g", new Set())).toBe(
      [
        '<Grid columns={2} gap={4} studioId="g">',
        '  <StatCard label="A" value="1" tone="brand" studioId="s1" />',
        "</Grid>",
      ].join("\n"),
    );
  });
});

describe("emitNodeJsx：显式 absolute（旧行为 + 坐标重定基）", () => {
  it("带 frame 的叶子：外包几何 div，data-studio-id 在包装层，组件保留 studioId", () => {
    const doc = docWith("shell", [
      node("shell", "AppShell", ["s1"], { title: "运营", sidebar: true }),
      nodeF("s1", "StatCard", [], { label: "A", value: "1" }, frame(320, 80, 240, 120)),
    ]);
    expect(emitNodeJsx(doc, "s1", new Set(), ABS)).toBe(
      [
        '<div data-studio-id="s1" style={{ position: "absolute", left: 320, top: 80, width: 240, height: 120 }}>',
        '  <StatCard label="A" value="1" studioId="s1" />',
        "</div>",
      ].join("\n"),
    );
  });

  it("带 frame 的容器：子树整体在包装 div 内缩进一级", () => {
    const doc = docWith("g", [
      nodeF("g", "Grid", ["s1"], { columns: 2, gap: 4 }, frame(0, 0, 400, 300)),
      node("s1", "StatCard", [], { label: "A", value: "1", tone: "brand" }),
    ]);
    expect(emitNodeJsx(doc, "g", new Set(), ABS)).toBe(
      [
        '<div data-studio-id="g" style={{ position: "absolute", left: 0, top: 0, width: 400, height: 300 }}>',
        '  <Grid columns={2} gap={4} studioId="g">',
        '    <StatCard label="A" value="1" tone="brand" studioId="s1" />',
        "  </Grid>",
        "</div>",
      ].join("\n"),
    );
  });

  it("带 frame 的 AppShell：照样被包装，tokens={TOKENS} 注入与 used 标记不变", () => {
    const doc = docWith("shell", [
      nodeF("shell", "AppShell", [], { title: "运营", sidebar: false }, frame(10, 20, 30, 40, 90)),
    ]);
    const used = new Set<string>();
    expect(emitNodeJsx(doc, "shell", used, ABS)).toBe(
      [
        '<div data-studio-id="shell" style={{ position: "absolute", left: 10, top: 20, width: 30, height: 40, transform: "rotate(90deg)" }}>',
        '  <AppShell title="运营" sidebar={false} studioId="shell" tokens={TOKENS} />',
        "</div>",
      ].join("\n"),
    );
    expect(used.size).toBe(1);
  });

  it("rotation 非 0 才有 transform；小数坐标不做 .0 尾巴", () => {
    const doc = docWith("s1", [
      nodeF("s1", "StatCard", [], { label: "A", value: "1" }, frame(12.5, -8, 240.25, 120, 45)),
    ]);
    expect(emitNodeJsx(doc, "s1", new Set(), ABS)).toBe(
      [
        '<div data-studio-id="s1" style={{ position: "absolute", left: 12.5, top: -8, width: 240.25, height: 120, transform: "rotate(45deg)" }}>',
        '  <StatCard label="A" value="1" studioId="s1" />',
        "</div>",
      ].join("\n"),
    );
  });

  it("未知节点带 frame 也不抛错（占位注释照旧，无包装）", () => {
    const doc = docWith("m", [nodeF("m", "MysteryBox", [], {}, frame(1, 2, 3, 4))]);
    expect(emitNodeJsx(doc, "m", new Set(), ABS)).toBe("{/* unknown component: MysteryBox */}");
  });

  it("framed 父子嵌套：子包装层坐标减去父 frame 原点（60,60 = 160,110 - 100,50）", () => {
    const doc = docWith("g", [
      nodeF("g", "Grid", ["s1"], { columns: 2, gap: 4 }, frame(100, 50, 400, 300)),
      nodeF("s1", "StatCard", [], { label: "A", value: "1" }, frame(160, 110, 240, 120)),
    ]);
    expect(emitNodeJsx(doc, "g", new Set(), ABS)).toBe(
      [
        '<div data-studio-id="g" style={{ position: "absolute", left: 100, top: 50, width: 400, height: 300 }}>',
        '  <Grid columns={2} gap={4} studioId="g">',
        '    <div data-studio-id="s1" style={{ position: "absolute", left: 60, top: 60, width: 240, height: 120 }}>',
        '      <StatCard label="A" value="1" studioId="s1" />',
        "    </div>",
        "  </Grid>",
        "</div>",
      ].join("\n"),
    );
  });

  it("framed 祖先 + 无 frame 中间层：跨层重定基（20,40 = 30,60 - 10,20）", () => {
    const doc = docWith("shell", [
      nodeF("shell", "AppShell", ["sec-1"], { title: "壳", sidebar: false }, frame(10, 20, 800, 600)),
      node("sec-1", "Section", ["s1"], { title: "区块标题" }),
      nodeF("s1", "StatCard", [], { label: "A", value: "1" }, frame(30, 60, 100, 50)),
    ]);
    expect(emitNodeJsx(doc, "shell", new Set(), ABS)).toBe(
      [
        '<div data-studio-id="shell" style={{ position: "absolute", left: 10, top: 20, width: 800, height: 600 }}>',
        '  <AppShell title="壳" sidebar={false} studioId="shell" tokens={TOKENS}>',
        '    <Section title="区块标题" studioId="sec-1">',
        '      <div data-studio-id="s1" style={{ position: "absolute", left: 20, top: 40, width: 100, height: 50 }}>',
        '        <StatCard label="A" value="1" studioId="s1" />',
        "      </div>",
        "    </Section>",
        "  </AppShell>",
        "</div>",
      ].join("\n"),
    );
  });
});

describe("frameStyleSource（帧几何 -> React style 对象字面量）", () => {
  it("rotation 0 省略 transform 键（未旋转产物干净）", () => {
    expect(frameStyleSource(frame(320, 80, 240, 120))).toBe(
      '{ position: "absolute", left: 320, top: 80, width: 240, height: 120 }',
    );
  });

  it("rotation 90 -> transform: rotate(90deg) 在末尾", () => {
    expect(frameStyleSource(frame(0, 0, 10, 10, 90))).toBe(
      '{ position: "absolute", left: 0, top: 0, width: 10, height: 10, transform: "rotate(90deg)" }',
    );
  });

  it("rotation 360 也保留（360 合法且视觉上有别于 0 的画布语义）", () => {
    expect(frameStyleSource(frame(0, 0, 10, 10, 360))).toContain('transform: "rotate(360deg)"');
  });

  it("小数原样输出，无尾零", () => {
    expect(frameStyleSource(frame(12.5, -0.25, 240.75, 120, 0))).toBe(
      '{ position: "absolute", left: 12.5, top: -0.25, width: 240.75, height: 120 }',
    );
  });

  it("origin 重定基：left/top 减去 positioned 祖先的 frame 原点", () => {
    expect(frameStyleSource(frame(160, 110, 240, 120), 100, 50)).toBe(
      '{ position: "absolute", left: 60, top: 60, width: 240, height: 120 }',
    );
  });
});
