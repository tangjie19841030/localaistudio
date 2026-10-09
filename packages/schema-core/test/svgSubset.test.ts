import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentSvgParser,
  serializeSvgElement,
  setSvgParser,
  SVG_SOURCE_MAX_LENGTH,
  svgBoxIssues,
  svgSourceIssues,
  type XmlParser,
} from "../src/registry/svgSubset.js";
import {
  checkStudioDocument,
  defaultTokens,
  DOCUMENT_VERSION,
  type NodeRecord,
  type Page,
  type StudioDocument,
} from "../src/document.js";
import { getComponentDef } from "../src/registry/componentDefs.js";
import { STUDIO_TOOLS, toolByName, type StudioTool } from "../src/agent/tools.js";

/**
 * jsdom is a devDependency used ONLY by this suite (OP-2): the shipped module
 * takes the parser as an argument (or via setSvgParser) so schema-core keeps
 * zero runtime dependencies. Typed through a local structural interface
 * because @types/jsdom is deliberately not installed (OP-5).
 */
interface JsdomCtor {
  new (html?: string): {
    window: { DOMParser: new () => { parseFromString(source: string, type: string): { documentElement: Element } } };
  };
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: JsdomCtor };

const domParser = new (new JSDOM("").window.DOMParser)();

/** The injected parser the workbench/server bind: root element or null. */
const parse: XmlParser = (source) => {
  const doc = domParser.parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  return root ? (root as unknown as Element) : null;
};

/** Every test that touches the module-level binding restores it afterwards. */
afterEach(() => setSvgParser(parse));

const ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

const svgNode = (source: string, id = "svg-1"): NodeRecord => ({ id, type: "SvgBox", props: { source, alt: "" }, children: [] });

const svgPage = (source: string): Page => ({
  id: "page-1",
  name: "矢量页",
  rootId: "root",
  nodes: [{ id: "root", type: "Container", props: {}, children: ["svg-1"] }, svgNode(source)],
});

const docOf = (page: Page): StudioDocument => ({
  documentVersion: DOCUMENT_VERSION,
  name: page.name,
  tokens: defaultTokens(),
  pages: [page],
});

describe("T71 SvgBox 登记", () => {
  it("registry 含 SvgBox：content 品类叶子，source/alt 有默认值，REQUIRED_PROPS 不动", () => {
    const def = getComponentDef("SvgBox")!;
    expect(def.title).toBe("矢量图形");
    expect(def.category).toBe("content");
    expect(def.container).toBe(false);
    expect(def.layout).toBeUndefined();
    expect(def.defaultProps).toEqual({ source: "", alt: "" });
    expect(def.requiredProps).toEqual([]);
  });

  it("source 字段级硬上限走 SVG_SOURCE_MAX_LENGTH，超限 zod 拒绝", () => {
    const schema = getComponentDef("SvgBox")!.propsSchema;
    expect(schema.safeParse({ source: "x".repeat(SVG_SOURCE_MAX_LENGTH), alt: "" }).success).toBe(true);
    const over = schema.safeParse({ source: "x".repeat(SVG_SOURCE_MAX_LENGTH + 1), alt: "" });
    expect(over.success).toBe(false);
    expect(SVG_SOURCE_MAX_LENGTH).toBe(20000);
  });
});

describe("T71 svgSourceIssues 白名单", () => {
  it("空串是合法空占位（不报错）", () => {
    expect(svgSourceIssues("", parse)).toEqual([]);
  });

  it("完整合法图形通过：svg/path/circle/rect/line/polyline/polygon/g/defs + currentColor/none", () => {
    const source =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">' +
      '<defs><path d="M0 0"/></defs>' +
      '<g transform="translate(2 3) scale(1.5)" opacity="0.8">' +
      '<path d="M1 2L3 4z" fill="currentColor" stroke="none"/>' +
      '<polygon points="1,2 3,4 5,6"/>' +
      '<polyline points="0,0 1,1"/>' +
      '<circle cx="12" cy="12" r="10" stroke="currentColor"/>' +
      '<rect x="0" y="0" width="5" height="5" fill-opacity="0.5"/>' +
      '<line x1="0" y1="0" x2="1" y2="1" stroke="#fff" stroke-linecap="round"/>' +
      "</g></svg>";
    expect(svgSourceIssues(source, parse)).toEqual([]);
  });

  it("非白名单标签被拒并给出标签名（script/text/use/foreignObject）", () => {
    for (const tag of ["script", "text", "use", "foreignObject", "a"]) {
      const issues = svgSourceIssues(`<svg viewBox="0 0 1 1"><${tag}/></svg>`, parse);
      expect(issues.length, tag).toBe(1);
      expect(issues[0], tag).toContain(`不允许的元素 "${tag.toLowerCase()}"`);
      expect(issues[0], tag).toContain("仅允许：svg/path/circle/rect/line/polyline/polygon/g/defs");
    }
  });

  it("script 带内容也被拒（jsdom 保留子元素，白名单兜住）", () => {
    const issues = svgSourceIssues('<svg viewBox="0 0 1 1"><script>alert(1)</script><path d="M0 0"/></svg>', parse);
    expect(issues).toEqual(['不允许的元素 "script"；仅允许：svg/path/circle/rect/line/polyline/polygon/g/defs']);
  });

  it("事件属性被拒（含大写 ONCLICK），且不猜危险与否一律不收", () => {
    const lower = svgSourceIssues('<svg viewBox="0 0 1 1"><circle r="1" onclick="x()"/></svg>', parse);
    expect(lower).toEqual(['元素 "circle" 不允许的属性 "onclick"；仅允许几何与填充属性']);
    const upper = svgSourceIssues('<svg viewBox="0 0 1 1"><circle r="1" ONCLICK="x()"/></svg>', parse);
    expect(upper).toEqual(['元素 "circle" 不允许的属性 "ONCLICK"；仅允许几何与填充属性']);
    const root = svgSourceIssues('<svg viewBox="0 0 1 1" onload="x()"></svg>', parse);
    expect(root).toEqual(['元素 "svg" 不允许的属性 "onload"；仅允许几何与填充属性']);
  });

  it("href/xlink:href/style 一律拒绝（白名单天然拒绝属性名）", () => {
    expect(svgSourceIssues('<svg viewBox="0 0 1 1"><use href="#x"/></svg>', parse)).toEqual([
      '不允许的元素 "use"；仅允许：svg/path/circle/rect/line/polyline/polygon/g/defs',
    ]);
    // href 挂在白名单标签上：标签通过、属性名被拒（属性级拒绝的直证）
    expect(svgSourceIssues('<svg viewBox="0 0 1 1"><path d="M0 0" href="#x"/></svg>', parse)).toEqual([
      '元素 "path" 不允许的属性 "href"；仅允许几何与填充属性',
    ]);
    // xlink:href 需要根上的 xmlns:xlink 声明（XML 命名空间前置条件），
    // 两者都在白名单之外：根与形状属性各报一行
    expect(
      svgSourceIssues(
        '<svg viewBox="0 0 1 1" xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M0 0" xlink:href="#x"/></svg>',
        parse,
      ),
    ).toEqual([
      '元素 "svg" 不允许的属性 "xmlns:xlink"；仅允许几何与填充属性',
      '元素 "path" 不允许的属性 "xlink:href"；仅允许几何与填充属性',
    ]);
    const style = svgSourceIssues('<svg viewBox="0 0 1 1"><path d="M0 0" style="fill:red"/></svg>', parse);
    expect(style).toEqual(['元素 "path" 不允许的属性 "style"；仅允许几何与填充属性']);
  });

  it("属性值外链/引用逃逸被拒：url(...) 与 http(s):// 双保险", () => {
    const url = svgSourceIssues('<svg viewBox="0 0 1 1"><path d="M0 0" fill="url(#grad)"/></svg>', parse);
    expect(url).toEqual(['元素 "path" 的属性 "fill" 含外链或 CSS 引用（url( / http:// / https:// 一律拒绝）']);
    const http = svgSourceIssues('<svg viewBox="0 0 1 1"><path d="M0 0" stroke="http://evil.test/x.svg"/></svg>', parse);
    expect(http[0]).toContain("含外链或 CSS 引用");
    // 唯一例外：svg 根上的标准命名空间声明是标识符而非引用
    expect(svgSourceIssues('<svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg"></svg>', parse)).toEqual([]);
    expect(svgSourceIssues('<svg viewBox="0 0 1 1" xmlns="http://evil.test/ns"></svg>', parse)).toEqual([
      '元素 "svg" 的属性 "xmlns" 含外链或 CSS 引用（url( / http:// / https:// 一律拒绝）',
    ]);
  });

  it("transform 只允许 translate/scale/rotate/matrix 数值参数", () => {
    const ok = ["translate(2 3)", "scale(1.5)", "rotate(45 12 12)", "matrix(1 0 0 1 4 4)", "translate(1,2) scale(2)"];
    for (const t of ok) {
      expect(svgSourceIssues(`<svg viewBox="0 0 1 1"><g transform="${t}"><path d="M0 0"/></g></svg>`, parse), t).toEqual([]);
    }
    for (const t of ["skewX(10)", "translate(1) rotate(a)", "scale(calc(1))"]) {
      const issues = svgSourceIssues(`<svg viewBox="0 0 1 1"><g transform="${t}"><path d="M0 0"/></g></svg>`, parse);
      expect(issues, t).toEqual(['元素 "g" 的属性 "transform" 只允许 translate/scale/rotate/matrix 数值参数']);
    }
    // url( 命中更前置的外链拒绝（引用逃逸优先于语法白名单）
    expect(svgSourceIssues('<svg viewBox="0 0 1 1"><g transform="rotate(45) url(#x)"><path d="M0 0"/></g></svg>', parse)).toEqual([
      '元素 "g" 的属性 "transform" 含外链或 CSS 引用（url( / http:// / https:// 一律拒绝）',
    ]);
  });

  it("d/points 字符集白名单，越界字符被拒", () => {
    expect(svgSourceIssues('<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>', parse)).toEqual([]);
    const bad = svgSourceIssues('<svg viewBox="0 0 1 1"><path d="M0 0 onmouseover=alert(1)"/></svg>', parse);
    expect(bad).toEqual(['元素 "path" 的属性 "d" 含非法字符（只允许 [0-9 .,mlczhvqaMZMLCZHVQ-]）']);
    const points = svgSourceIssues('<svg viewBox="0 0 1 1"><polygon points="0,0 1,1;&#10;"/></svg>', parse);
    expect(points).toEqual(['元素 "polygon" 的属性 "points" 含非法字符（只允许 [0-9 .,mlczhvqaMZMLCZHVQ-]）']);
  });

  it("非 svg 单根报错（div 根 / 多根 / 纯文本）", () => {
    expect(svgSourceIssues('<div><span>x</span></div>', parse)).toEqual(["SVG 源码必须是 <svg> 单根"]);
    expect(svgSourceIssues('<svg viewBox="0 0 1 1"/><svg viewBox="0 0 1 1"/>', parse)).toEqual(["SVG 源码必须是 <svg> 单根"]);
    expect(svgSourceIssues("not xml at all", parse)).toEqual(["SVG 源码必须是 <svg> 单根"]);
  });

  it("XML 非法 / parsererror 根被拒", () => {
    const issues = svgSourceIssues("<svg><broken", parse);
    expect(issues).toEqual(["SVG 源码解析失败（XML 非法或含 parsererror）"]);
  });

  it("长度上限在 svgSourceIssues 内重复检查（绕过 zod 的手工对象兜底）", () => {
    const oversized = `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>${" ".repeat(SVG_SOURCE_MAX_LENGTH)}`;
    expect(svgSourceIssues(oversized, parse)).toEqual([`SVG 源码长度超过上限 ${SVG_SOURCE_MAX_LENGTH}`]);
  });

  it("深度 >24 被拒（嵌套炸弹）", () => {
    const deep = "<svg viewBox=\"0 0 1 1\">" + "<g>".repeat(30) + "<path d=\"M0 0\"/>" + "</g>".repeat(30) + "</svg>";
    const issues = svgSourceIssues(deep, parse);
    expect(issues).toEqual(["SVG 嵌套深度超过上限 24"]);
  });

  it("元素数 >300 被拒", () => {
    const wide = '<svg viewBox="0 0 1 1">' + '<circle r="1"/>'.repeat(320) + "</svg>";
    const issues = svgSourceIssues(wide, parse);
    expect(issues).toEqual(["SVG 元素数量超过上限 300"]);
    // 300 及以下放行
    expect(svgSourceIssues('<svg viewBox="0 0 1 1">' + '<circle r="1"/>'.repeat(299) + "</svg>", parse)).toEqual([]);
  });

  it("未注入 parser 时 fail-closed：报解析器不可用而非放行（fresh module 无绑定）", async () => {
    vi.resetModules();
    const fresh = await import("../src/registry/svgSubset.js");
    const unbound = fresh.currentSvgParser();
    expect(typeof unbound).toBe("function"); // 永不为 undefined：reject-all 桩
    expect(fresh.svgSourceIssues(ICON, unbound)).toEqual(["解析器不可用：未注入 XML 解析器"]);
    expect(fresh.svgSourceIssues(ICON)).toEqual(["解析器不可用：未注入 XML 解析器"]);
    expect(fresh.serializeSvgElement(ICON)).toBe(""); // 降级占位，不崩
    expect(fresh.serializeSvgElement("")).toBe(""); // 空串仍合法空占位
    // 显式传入返回 null 的解析器走解析失败路径（另一条拒绝分支）
    expect(svgSourceIssues(ICON, () => null)).toEqual(["SVG 源码解析失败（XML 非法或含 parsererror）"]);
  });

  it("抛异常的 parser 不炸，读作解析失败", () => {
    expect(svgSourceIssues(ICON, () => { throw new Error("boom"); })).toEqual([
      "SVG 源码解析失败（XML 非法或含 parsererror）",
    ]);
  });
});

describe("T71 serializeSvgElement", () => {
  it("归一化：属性间单空格、viewBox 在前、其余按 key 排序、去注释", () => {
    const source =
      '<svg  xmlns="http://www.w3.org/2000/svg"  fill="none"   viewBox="0 0 24 24">\n  <!-- 注释被去掉 -->\n  <circle  r="10"  cx="12"  cy="12" />\n</svg>';
    expect(serializeSvgElement(source, parse)).toBe(
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/></svg>',
    );
  });

  it("同 input 同 output（parity 由构造保证，两视图消费同一函数）", () => {
    const a = serializeSvgElement(ICON, parse);
    const b = serializeSvgElement(ICON, parse);
    expect(a).toBe(b);
    expect(a).toContain('<circle cx="12" cy="12" fill="none" r="10" stroke="currentColor" stroke-width="2"/>');
  });

  it("空串 / 解析失败 / 子集违规 一律降级为 \"\"（不崩）", () => {
    expect(serializeSvgElement("", parse)).toBe("");
    expect(serializeSvgElement("<svg><broken", parse)).toBe("");
    expect(serializeSvgElement('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', parse)).toBe("");
    expect(serializeSvgElement('<svg viewBox="0 0 1 1" onload="x()"></svg>', parse)).toBe("");
    expect(serializeSvgElement(ICON, () => null)).toBe("");
  });

  it("缺省 parse 用 setSvgParser 注入的 activeParser", () => {
    setSvgParser(parse);
    expect(currentSvgParser()).toBe(parse);
    expect(svgSourceIssues(ICON)).toEqual([]);
    expect(serializeSvgElement(ICON)).toContain("<circle");
  });
});

describe("T71 svgBoxIssues / 挂点", () => {
  it("合法 SvgBox 页无错误行；非 SvgBox 节点不受影响", () => {
    expect(svgBoxIssues(svgPage(ICON))).toEqual([]);
    expect(svgBoxIssues({ id: "p", name: "x", rootId: "root", nodes: [{ id: "root", type: "Container", props: {}, children: [] }] })).toEqual([]);
    expect(svgBoxIssues(svgPage(""))).toEqual([]); // 空占位不报错
  });

  it("错误行前缀为 节点 \"<id>\" 的 SVG 源码，逐行可读（含白名单速记）", () => {
    setSvgParser(parse);
    const page = svgPage('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>');
    expect(svgBoxIssues(page)).toEqual([
      '节点 "svg-1" 的 SVG 源码：不允许的元素 "script"；仅允许：svg/path/circle/rect/line/polyline/polygon/g/defs',
    ]);
  });

  it("source 非字符串时交给 zod，不产生伪错误行", () => {
    const page: Page = { id: "p", name: "x", rootId: "root", nodes: [{ id: "svg-1", type: "SvgBox", props: { source: 42 }, children: [] }] };
    expect(svgBoxIssues(page)).toEqual([]);
  });

  it("checkStudioDocument 拦截带 script 的 SvgBox 文档（保存/版本/AI 提案口同一面）", () => {
    setSvgParser(parse);
    const bad = docOf(svgPage('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'));
    expect(checkStudioDocument(bad)).toEqual([
      '节点 "svg-1" 的 SVG 源码：不允许的元素 "script"；仅允许：svg/path/circle/rect/line/polyline/polygon/g/defs',
    ]);
    // 合法文档零错误行（挂点不误伤）
    expect(checkStudioDocument(docOf(svgPage(ICON)))).toEqual([]);
    // 中间态（用户敲一半）报解析失败而不是静默通过
    expect(checkStudioDocument(docOf(svgPage("<svg vie")))).toEqual([
      '节点 "svg-1" 的 SVG 源码：SVG 源码解析失败（XML 非法或含 parsererror）',
    ]);
  });
});

describe("T71 proposeDocument 提案口", () => {
  const tool: StudioTool = toolByName("propose_document")!;

  function run(source: string) {
    const page: Page = {
      id: "page-1",
      name: "当前页",
      rootId: "root",
      nodes: [{ id: "root", type: "Container", props: {}, children: ["svg-1"] }, svgNode(source)],
    };
    return tool.execute(
      { document: { rootId: "root", name: "当前页", nodes: page.nodes } },
      { page, doc: docOf(page) },
    );
  }

  it("提案内 SvgBox 走子集校验：违规被拒且错误行回传模型", () => {
    setSvgParser(parse);
    const result = run('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("文档 SVG 子集校验失败");
    expect(result.message).toContain('节点 "svg-1" 的 SVG 源码：不允许的元素 "script"');
  });

  it("合法 SvgBox 提案通过", () => {
    setSvgParser(parse);
    const result = run(ICON);
    expect(result.ok).toBe(true);
  });

  it("STUDIO_TOOLS 仍注册 propose_document（挂点不改变工具面）", () => {
    expect(STUDIO_TOOLS.some((t) => t.name === "propose_document")).toBe(true);
  });
});
