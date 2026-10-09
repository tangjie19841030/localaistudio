import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { NodeRecord, Page } from "../src/document.js";
import { defaultTokens, DOCUMENT_VERSION } from "../src/document.js";
import { escapeJsxString } from "../src/codegen/serialize.js";
import { generateFiles } from "../src/codegen/generateFiles.js";
import {
  serializeSvgElement,
  setSvgParser,
  type XmlParser,
} from "../src/registry/svgSubset.js";
import { asDoc, buildFixtureDoc, kitFixture, node } from "./codegen-fixtures.js";

/**
 * W5 codegen side of the three-view parity matrix (twin of
 * apps/workbench/src/preview/preview.test.tsx). The renderer injects
 * serializeSvgElement output via dangerouslySetInnerHTML; codegen ships the
 * SAME bytes as a JSX string literal (escapeJsxString-escaped, OP-7: parity is
 * decode-level). Both suites lock the SAME literal substring (CIRCLE_SUBSTR).
 */

// jsdom is a test-only devDependency (OP-2/OP-5); structural typing, no @types.
interface JsdomCtor {
  new (html?: string): {
    window: { DOMParser: new () => { parseFromString(source: string, type: string): { documentElement: Element } } };
  };
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: JsdomCtor };
const domParser = new (new JSDOM("").window.DOMParser)();
const parse: XmlParser = (source) => {
  const doc = domParser.parseFromString(source, "image/svg+xml");
  return doc.documentElement ? (doc.documentElement as unknown as Element) : null;
};
setSvgParser(parse);
afterEach(() => setSvgParser(parse));

// Parity fixture: the SAME source string is used by preview.test.tsx.
const ICON =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
// serializeSvgElement output: viewBox first, remaining attrs in key order.
const CIRCLE_SUBSTR = '<circle cx="12" cy="12" fill="none" r="10" stroke="currentColor" stroke-width="2"';

const svgNode = (source: string, id = "svg-1"): NodeRecord => ({ id, type: "SvgBox", props: { source, alt: "" }, children: [] });

function svgPage(source: string, extra?: Partial<NodeRecord>): Page {
  return {
    id: "page-1",
    name: "矢量页",
    rootId: "root",
    nodes: [node("root", "Container", ["svg-1"], { maxWidth: "lg" }), { ...svgNode(source), ...extra }],
  };
}

const pageFileOf = (source: string, extra?: Partial<NodeRecord>): string =>
  generateFiles(asDoc(svgPage(source, extra)), kitFixture()).get("src/pages/矢量页.tsx")!;

/** Reverse of escapeJsxString (JSX string literals decode XML entities). */
function decodeJsxString(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#13;/g, "\r")
    .replace(/&#10;/g, "\n")
    .replace(/&#9;/g, "\t")
    .replace(/&amp;/g, "&");
}

/** Extract + decode the dangerouslySetInnerHTML literal from emitted page JSX. */
function decodedHtmlOf(pageJsx: string): string {
  const match = pageJsx.match(/__html: "((?:[^"\\]|\\.)*)"/);
  expect(match).not.toBeNull();
  return decodeJsxString(match![1]!);
}

describe("W5 codegen：SvgBox 内联 JSX", () => {
  it("页面 JSX 产 dangerouslySetInnerHTML div，含 data-studio-id，无 <SvgBox kit 标签", () => {
    const page = pageFileOf(ICON);
    expect(page).toContain('<div data-component="SvgBox" data-studio-id="svg-1" dangerouslySetInnerHTML=');
    expect(page).not.toContain("<SvgBox");
  });

  it("parity 锁：__html 解码后 === serializeSvgElement 输出（含与 preview.test 同一子串）", () => {
    const page = pageFileOf(ICON);
    const decoded = decodedHtmlOf(page);
    expect(decoded).toBe(serializeSvgElement(ICON, parse));
    expect(decoded).toContain(CIRCLE_SUBSTR);
  });

  it("转义链 decode 等价：序列化产物的 \" 与 &amp; 双层转义后可逆", () => {
    // fill value "a&b" serializes to a&amp;b; the JSX literal carries &amp;amp;b.
    const source = '<svg viewBox="0 0 1 1"><rect width="1" height="1" fill="a&amp;b"/></svg>';
    const page = pageFileOf(source);
    expect(page).toContain("a&amp;amp;b");
    const decoded = decodedHtmlOf(page);
    expect(decoded).toBe(serializeSvgElement(source, parse));
  });

  it("escapeJsxString round-trip：\"、<、>、& 实体转义可逆", () => {
    const raw = '<a "b" & c>';
    expect(decodeJsxString(escapeJsxString(raw))).toBe(raw);
  });

  it("空 source：空占位 div，无 dangerouslySetInnerHTML", () => {
    const page = pageFileOf("");
    expect(page).toContain('<div data-component="SvgBox" data-studio-id="svg-1" />');
    expect(page).not.toContain("dangerouslySetInnerHTML");
  });

  it("非法 source（script）：空占位降级，不抛错", () => {
    const page = pageFileOf('<svg onload="alert(1)"><script>alert(1)</script></svg>');
    expect(page).toContain('<div data-component="SvgBox" data-studio-id="svg-1" />');
  });

  it("未绑定 parser：fail-closed 降级空占位，不抛错", () => {
    setSvgParser(() => null);
    const page = pageFileOf(ICON);
    expect(page).toContain('<div data-component="SvgBox" data-studio-id="svg-1" />');
  });

  it("pinned SvgBox 走 withFrameWrap：geometric div 包住内联 div", () => {
    const page = pageFileOf(ICON, { pinned: true, frame: { x: 10, y: 20, w: 100, h: 50, rotation: 0 } });
    expect(page).toContain('<div data-studio-id="svg-1" style={{ position: "absolute", left: 10, top: 20, width: 100, height: 50 }}>');
    expect(page).toContain('<div data-component="SvgBox" data-studio-id="svg-1" dangerouslySetInnerHTML=');
  });
});

describe("W5 codegen：SvgBox 不进 kit 拷贝面", () => {
  it("无 SvgBox.tsx 拷贝、barrel 不含 SvgBox、页面 import 不含 SvgBox", () => {
    const files = generateFiles(asDoc(svgPage(ICON)), kitFixture());
    expect([...files.keys()].some((p) => p.includes("SvgBox"))).toBe(false);
    expect(files.get("src/components/ui-studio/index.ts")).not.toContain("SvgBox");
    const imports = (files.get("src/pages/矢量页.tsx") ?? "")
      .split("\n")
      .filter((line) => line.startsWith("import"))
      .join("\n");
    expect(imports).toContain('from "../components/ui-studio"');
    expect(imports).not.toContain("SvgBox");
  });

  it("Section 内嵌 SvgBox：generated 文件内联 div，不 import 不存在的 kit 组件", () => {
    const page: Page = {
      id: "page-1",
      name: "矢量页",
      rootId: "sec-1",
      nodes: [
        node("sec-1", "Section", ["svg-1"], { title: "图区", description: "" }),
        svgNode(ICON),
      ],
    };
    const files = generateFiles(asDoc(page), kitFixture());
    const section = files.get("src/components/generated/图区.tsx")!;
    expect(section).toContain('<div data-component="SvgBox" data-studio-id="svg-1" dangerouslySetInnerHTML=');
    expect(section).toContain('import { Section } from "../ui-studio";');
    expect(section).not.toContain("SvgBox } from");
  });

  it("T71 回归：SvgBox 文档 + 无 SvgBox kit 源 → 不再 throw「kitSources 缺少」", () => {
    expect(() => generateFiles(asDoc(svgPage(ICON)), kitFixture())).not.toThrow();
  });
});

describe("W5 codegen：无 SvgBox 文档字节不变", () => {
  const BASELINE: Record<string, string> = JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/codegen-baseline-no-svgbox.json", import.meta.url)), "utf8"),
  ) as Record<string, string>;

  it("buildFixtureDoc 产物与改前基线逐字节相等（22 个文件全量对比）", () => {
    const files = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    expect(files.size).toBe(Object.keys(BASELINE).length);
    for (const [path, content] of Object.entries(BASELINE)) {
      expect(files.get(path), path).toBe(content);
    }
  });

  it("同一文档两次生成逐字节相等（确定性）", () => {
    const a = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    const b = generateFiles(asDoc(buildFixtureDoc()), kitFixture());
    expect([...b.entries()]).toEqual([...a.entries()]);
  });
});
