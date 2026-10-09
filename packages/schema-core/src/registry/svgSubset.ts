import type { Page } from "../document.js";

/**
 * W5 controlled SVG subset for SvgBox — the single authority for the security
 * face of inline SVG (icons / illustrations / logos). Renderer and codegen both
 * consume serializeSvgElement, so the whitelist is enforced exactly once.
 *
 * Design decisions mirrored here (w5-wave §2.2):
 *  - tag-level attribute cross table: an attribute not listed for its own tag
 *    is rejected outright, no "dangerous or not" guessing (OP-4);
 *  - gradients/href stay out (OP-3); currentColor/none/inherit pass (OP-9);
 *  - the XML parser is INJECTED, schema-core adds no runtime dependency (OP-1):
 *    callers pass one, or bind it once via setSvgParser. With no parser bound
 *    the checks fail closed — svgSourceIssues reports 解析器不可用 instead of
 *    accepting, and serializeSvgElement degrades to "".
 *
 * Only the `Page` import is type-only on purpose (same cycle guard as
 * breakpoints.ts: document.ts imports this module as a value).
 */

export const SVG_SOURCE_MAX_LENGTH = 20000;

/** Injected XML parser: the parsed root element, or null when parsing failed. */
export type XmlParser = (source: string) => Element | null;

/** Tags accepted inside a SvgBox source (polygon included, OP-13). */
const ALLOWED_TAGS = ["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "defs"] as const;
const TAG_HINT = ALLOWED_TAGS.join("/");

const SVG_ROOT_ATTRS: readonly string[] = [
  "viewBox", "xmlns", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity",
];

const SHAPE_ATTRS: readonly string[] = [
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2",
  "points", "transform", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "fill-rule",
];

/** Tag-level cross table; `defs` groups shapes only, so it carries no attributes. */
const ATTRS_BY_TAG: Readonly<Record<string, readonly string[]>> = {
  svg: SVG_ROOT_ATTRS,
  path: SHAPE_ATTRS,
  circle: SHAPE_ATTRS,
  rect: SHAPE_ATTRS,
  line: SHAPE_ATTRS,
  polyline: SHAPE_ATTRS,
  polygon: SHAPE_ATTRS,
  g: SHAPE_ATTRS,
  defs: [],
};

const MAX_DEPTH = 24;
const MAX_ELEMENTS = 300;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** External references / CSS escapes: any url(...) or http(s) URL is refused. */
const FORBIDDEN_VALUE = /url\(|https?:\/\//i;
const TRANSFORM_VALUE = /^(?:(?:translate|scale|rotate|matrix)\s*\(\s*[-+0-9.eE]+(?:\s*[,\s]\s*[-+0-9.eE]+)*\s*\)\s*,?\s*)+$/;
const GEOMETRY_CHARSET = "[0-9 .,mlczhvqaMZMLCZHVQ-]";
const GEOMETRY_VALUE = /^[0-9 .,mlczhvqaMZMLCZHVQ-]*$/;
const GEOMETRY_ATTRS = new Set(["d", "points"]);
const PARSER_UNAVAILABLE = "解析器不可用：未注入 XML 解析器";
const PARSE_FAILED = "SVG 源码解析失败（XML 非法或含 parsererror）";
const ROOT_ISSUE = "SVG 源码必须是 <svg> 单根";

/** Fail-closed stub: what an unbound parser behaves as (design §2.2). */
const REJECT_ALL: XmlParser = () => null;

let activeParser: XmlParser | undefined;

/** Bind the process-wide XML parser (workbench/server bootstrap; OP-1). */
export function setSvgParser(parse: XmlParser): void {
  activeParser = parse;
}

/** The bound parser, or the reject-all stub when nothing was injected. */
export function currentSvgParser(): XmlParser {
  return activeParser ?? REJECT_ALL;
}

/** Never throws: a throwing or broken parser reads as "parse failed". */
function safeParse(parse: XmlParser, source: string): Element | null {
  try {
    return parse(source) ?? null;
  } catch {
    return null;
  }
}

/** XML parse failures surface as a `parsererror` root (DOMParser behaviour). */
function isParserError(root: Element): boolean {
  if (root.nodeName.toLowerCase() === "parsererror") return true;
  return (root.namespaceURI ?? "").includes("parsererror");
}

/**
 * Count `<svg` opening tags in the raw source. Only used on the parse-failure
 * path: a source that is not exactly ONE <svg> root (0 = not an svg at all,
 * 2+ = multiple roots / stray markup) is reported as the single-root violation
 * rather than as a generic XML error, which is what the author needs to hear.
 */
function svgRootTagCount(source: string): number {
  return source.match(/<svg[\s/>]/gi)?.length ?? 0;
}

/** The parse-failure branch: single-root violation when the root is not one svg. */
function parseFailureIssue(source: string): string {
  return svgRootTagCount(source) === 1 ? PARSE_FAILED : ROOT_ISSUE;
}

interface SourceAnalysis {
  root: Element | null;
  errors: string[];
}

/** Parse once and run the whole subset check: root (when valid) + error lines. */
function analyzeSource(source: string, parse?: XmlParser): SourceAnalysis {
  if (source === "") return { root: null, errors: [] }; // empty placeholder: legal
  if (source.length > SVG_SOURCE_MAX_LENGTH) {
    return { root: null, errors: [`SVG 源码长度超过上限 ${SVG_SOURCE_MAX_LENGTH}`] };
  }
  const parser = parse ?? activeParser;
  if (!parser || parser === REJECT_ALL) return { root: null, errors: [PARSER_UNAVAILABLE] };
  const root = safeParse(parser, source);
  if (!root || isParserError(root)) return { root: null, errors: [parseFailureIssue(source)] };
  if (root.nodeName.toLowerCase() !== "svg") return { root: null, errors: [ROOT_ISSUE] };
  return { root, errors: collectIssues(root) };
}

interface WalkState {
  count: number;
  tooMany: boolean;
  tooDeep: boolean;
}

/** Depth/size guards plus per-element checks, in document order. */
function collectIssues(root: Element): string[] {
  const errors: string[] = [];
  const state: WalkState = { count: 0, tooMany: false, tooDeep: false };
  walk(root, 1, errors, state);
  if (state.tooMany) errors.push(`SVG 元素数量超过上限 ${MAX_ELEMENTS}`);
  if (state.tooDeep) errors.push(`SVG 嵌套深度超过上限 ${MAX_DEPTH}`);
  return errors;
}

/** Depth-first walk; a breached guard stops the walk (no 300-line error dumps). */
function walk(el: Element, depth: number, errors: string[], state: WalkState): void {
  state.count += 1;
  if (state.count > MAX_ELEMENTS) {
    state.tooMany = true;
    return;
  }
  if (depth > MAX_DEPTH) {
    state.tooDeep = true;
    return;
  }
  errors.push(...checkElement(el));
  for (const child of elementChildren(el)) walk(child, depth + 1, errors, state);
}

function elementChildren(el: Element): Element[] {
  const list = el.children as HTMLCollection | undefined;
  return list ? Array.from(list) : [];
}

function attributeList(el: Element): Attr[] {
  const map = el.attributes as NamedNodeMap | undefined;
  return map ? Array.from(map) : [];
}

/** Tag whitelist first; a rejected tag skips its attributes (noise control). */
function checkElement(el: Element): string[] {
  const tag = el.nodeName.toLowerCase();
  if (!ALLOWED_TAGS.includes(tag as (typeof ALLOWED_TAGS)[number])) {
    return [`不允许的元素 "${tag}"；仅允许：${TAG_HINT}`];
  }
  return checkAttrs(tag, el);
}

/** Cross-table lookup: every attribute must be listed for its own tag. */
function checkAttrs(tag: string, el: Element): string[] {
  const allowed = ATTRS_BY_TAG[tag] ?? [];
  const errors: string[] = [];
  for (const attr of attributeList(el)) {
    if (!allowed.includes(attr.name)) {
      errors.push(`元素 "${tag}" 不允许的属性 "${attr.name}"；仅允许几何与填充属性`);
      continue;
    }
    errors.push(...scanAttributeValue(tag, attr.name, attr.value));
  }
  return errors;
}

/**
 * Value scan: reference/CSS escapes first, then the per-attribute grammars.
 *
 * Narrow exception: `xmlns` on the svg root may carry the SVG namespace URI
 * verbatim. Design §2.2 whitelists xmlns AND rejects any value containing
 * http(s):// — the canonical namespace declaration is the only value xmlns can
 * legally have, so a literal scan would make the whitelist entry dead and
 * reject every real-world exported SVG. A namespace URI is an identifier, never
 * dereferenced, so it is not a reference escape. Every other value (including
 * any other xmlns value) still goes through FORBIDDEN_VALUE.
 */
function scanAttributeValue(tag: string, name: string, value: string): string[] {
  if (tag === "svg" && name === "xmlns" && value === SVG_NAMESPACE) return [];
  if (FORBIDDEN_VALUE.test(value)) {
    return [`元素 "${tag}" 的属性 "${name}" 含外链或 CSS 引用（url( / http:// / https:// 一律拒绝）`];
  }
  if (name === "transform" && !TRANSFORM_VALUE.test(value)) {
    return [`元素 "${tag}" 的属性 "transform" 只允许 translate/scale/rotate/matrix 数值参数`];
  }
  if (GEOMETRY_ATTRS.has(name) && !GEOMETRY_VALUE.test(value)) {
    return [`元素 "${tag}" 的属性 "${name}" 含非法字符（只允许 ${GEOMETRY_CHARSET}）`];
  }
  return [];
}

/**
 * Subset check for one SVG source string: [] when it passes, otherwise Chinese
 * error lines (same shape as breakpointIssues). Empty source is a legal empty
 * placeholder and reports nothing. `parse` defaults to the bound parser.
 */
export function svgSourceIssues(source: string, parse?: XmlParser): string[] {
  return analyzeSource(source, parse).errors;
}

/**
 * Page-level gate for SvgBox nodes: [] or per-node Chinese error lines, in node
 * order — the checkStudioDocument / proposeDocument hook (same shape as
 * breakpointIssues). Non-string sources are zod's business, not ours.
 */
export function svgBoxIssues(page: Page): string[] {
  const errors: string[] = [];
  for (const node of page.nodes) {
    if (node.type !== "SvgBox") continue;
    const source = node.props?.["source"];
    if (typeof source !== "string") continue;
    for (const issue of svgSourceIssues(source)) {
      errors.push(`节点 "${node.id}" 的 SVG 源码：${issue}`);
    }
  }
  return errors;
}

/**
 * Canonical single-root serialization shared by the renderer DOM path and the
 * codegen JSX path (parity by construction, D4): viewBox first, remaining
 * attributes in key order, comments dropped, whitespace normalized to single
 * spaces. Returns "" when the source is empty, unparsable or outside the
 * subset — render/codegen degrade to a placeholder instead of crashing.
 */
export function serializeSvgElement(source: string, parse?: XmlParser): string {
  const { root, errors } = analyzeSource(source, parse);
  if (!root || errors.length > 0) return "";
  return serializeElement(root);
}

function serializeElement(el: Element): string {
  const tag = el.nodeName.toLowerCase();
  const attrs = orderedAttrs(el)
    .map(([name, value]) => ` ${name}="${escapeAttrValue(value)}"`)
    .join("");
  const children = elementChildren(el);
  if (children.length === 0) return `<${tag}${attrs}/>`;
  return `<${tag}${attrs}>${children.map(serializeElement).join("")}</${tag}>`;
}

/** viewBox first, then plain key order — stable bytes for parity assertions. */
function orderedAttrs(el: Element): Array<[string, string]> {
  return attributeList(el)
    .map((attr) => attr.name)
    .sort((a, b) => (a === "viewBox" ? -1 : b === "viewBox" ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .map((name) => [name, el.getAttribute(name) ?? ""] as [string, string]);
}

/** XML-escape an attribute value so the output re-parses to the same bytes. */
function escapeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
