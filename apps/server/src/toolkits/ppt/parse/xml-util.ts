import { posix as pathPosix } from "node:path";
import { XMLParser } from "fast-xml-parser";

/**
 * XML helpers over fast-xml-parser (no DTD/external entities → no XXE surface):
 * a regular parser for object-shaped extraction plus a preserve-order parser
 * whose child sequence is attached back for z-order-sensitive dispatch.
 */

const ARRAY_TAGS = new Set([
  "sldId", "Relationship", "sp", "pic", "grpSp", "graphicFrame",
  "p", "r", "br", "fld", "tr", "tc", "gs", "gridCol", "sldLayoutId", "clrMapOvr",
]);

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false, // EMU values are huge strings on purpose
  trimValues: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

// The regular object model is convenient for extraction, while this parallel
// parser keeps the XML child sequence needed for z-order-sensitive containers.
export const orderedXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
  preserveOrder: true,
  isArray: () => true,
});

export type XmlNode = Record<string, unknown> & {
  __orderedChildren?: XmlNodeChild[];
};

export interface XmlNodeChild {
  tag: string;
  node: XmlNode;
}

export function asObj(value: unknown): XmlNode | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as XmlNode) : undefined;
}

export function asArr(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/** obj[key] normalized to an array of object nodes. */
export function children(obj: XmlNode | null | undefined, key: string): XmlNode[] {
  return asArr(obj?.[key]).map(asObj).filter((n): n is XmlNode => n !== undefined);
}

export function orderedChildren(obj: XmlNode | null | undefined): XmlNodeChild[] {
  return obj?.__orderedChildren ?? [];
}

/** Attach preserve-order children to the matching regular-parser nodes. */
export function attachXmlOrder(normal: XmlNode, ordered: unknown): void {
  const items = Array.isArray(ordered) ? ordered : ordered ? [ordered] : [];
  if (items.length === 0) return;
  const seen = new Map<string, number>();
  const sequence: XmlNodeChild[] = [];
  for (const item of items) {
    const itemObj = asObj(item);
    if (!itemObj) continue;
    const tag = Object.keys(itemObj).find((key) => key !== ":@");
    if (!tag) continue;
    const occurrence = seen.get(tag) ?? 0;
    seen.set(tag, occurrence + 1);
    const raw = normal[tag];
    const node = Array.isArray(raw) ? asObj(raw[occurrence]) : asObj(raw);
    if (!node) continue;
    sequence.push({ tag, node });
    attachXmlOrder(node, itemObj[tag]);
  }
  normal.__orderedChildren = sequence;
}

export function strAttr(node: XmlNode | undefined, key: string): string | undefined {
  const value = node?.[`@_${key}`];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function intAttr(node: XmlNode | undefined, key: string): number | undefined {
  const raw = strAttr(node, key);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (asObj(node)?.["#text"] !== undefined) return String(asObj(node)!["#text"]);
  return "";
}

/** Resolve an OOXML relationship Target relative to its source part path. */
export function resolveRelTarget(sourcePart: string, target: string): string {
  // A leading "/" denotes a package-root-absolute Target (Google Slides etc.
  // emit these); path.join treats it as a normal segment and mis-nests it.
  if (target.startsWith("/")) return normalizePart(target);
  const sourceDir = pathPosix.dirname(sourcePart); // _rels/foo.xml.rels → foo's dir handled by caller
  return normalizePart(pathPosix.join(sourceDir, target));
}

export function normalizePart(part: string): string {
  return part.replace(/^\.\//, "").replace(/^\/+/, "");
}
