import type { NodeRecord, Page, Tokens } from "../document.js";
import { hasComponent } from "../registry/componentDefs.js";
import { getNode } from "../registry/treeUtils.js";
import {
  childFrameContext,
  emitInjectedAttrs,
  indentBlock,
  sanitizeIdForComment,
  svgInlineJsx,
  withFrameWrap,
  FLOW_CONTEXT,
  NO_NAV_CONTEXT,
  type EmitContext,
  type FrameEmitContext,
} from "./emitters.js";

/**
 * Page assembly + Section extraction (spec §6.2).
 *
 * Extraction rule: every Section node becomes its own generated component
 * file `src/components/generated/<Name>.tsx`. The component file renders the
 * Section node itself inline (with its full subtree as children); every place
 * referencing that Section emits `<Name />` instead. Sections nested inside
 * another Section become cross-component imports (./<ChildName>).
 *
 * Name derivation: props.title (fallback node id) -> strip identifier-illegal
 * characters (keep letters incl. CJK, digits, underscore; drop space/hyphen)
 * -> prefix "_" when it starts with a digit -> capitalize the first ASCII
 * letter -> uniquify against already-used names AND copied kit component
 * names (a Section titled "Button" would import-shadow the kit Button within
 * the same file, so it becomes "Button2").
 *
 * AppShell contract: tokens never live in node props; the scoped emitter
 * injects `tokens={TOKENS}` on every AppShell it renders inline and records
 * the usage so the enclosing file gets `import { TOKENS } from "<rel>styles/tokens"`
 * (rel = ../ for pages/, ../../ for components/generated/).
 */

const NAME_STRIP_RE = /[^\p{L}\p{N}_\- ]+/gu;
const IDENT_RE = /^[A-Za-z_$\p{L}][\p{L}\p{N}_$]*$/u;

/** Strip identifier-illegal characters; falls back to the raw input when empty. */
export function pascalName(raw: string): string {
  const cleaned = raw.replace(NAME_STRIP_RE, "").replace(/[ \-]+/g, "");
  if (cleaned === "") return raw;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Valid JS identifier or "" (leading digits get an underscore prefix first). */
function toIdentifier(cleaned: string): string {
  if (cleaned === "") return "";
  const prefixed = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  return IDENT_RE.test(prefixed) ? prefixed : "";
}

/** Capitalize the leading ASCII lowercase letter (CJK untouched). */
function capitalizeAsciiHead(name: string): string {
  return name.replace(/^([a-z])/, (c) => c.toUpperCase());
}

/** Component name for one Section node; falls back to id when title is unusable. */
function sectionBaseName(node: NodeRecord): string {
  const fromTitle = toIdentifier(pascalName(String(node.props.title ?? "")));
  if (fromTitle !== "") return capitalizeAsciiHead(fromTitle);
  const fromId = toIdentifier(pascalName(node.id));
  if (fromId !== "") return capitalizeAsciiHead(fromId);
  throw new Error(`Section "${node.id}" 无法生成合法组件名（title 与 id 都不是有效标识符）`);
}

/** Sections in pre-order (deterministic; parents before children). */
function collectSections(doc: Page): NodeRecord[] {
  const sections: NodeRecord[] = [];
  const visited = new Set<string>([doc.rootId]);
  const walk = (id: string): void => {
    const node = getNode(doc, id);
    if (!node) return;
    if (node.type === "Section") sections.push(node);
    for (const childId of node.children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        walk(childId);
      }
    }
  };
  walk(doc.rootId);
  return sections;
}

/** base, then base2, base3, ... — `taken` is mutated. */
function uniquify(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}${n}`)) n += 1;
  const name = `${base}${n}`;
  taken.add(name);
  return name;
}

/**
 * Section node id -> unique generated component name. `taken` is the SHARED
 * reservation set (kit catalog + page names + prior pages' sections, W3 §3.5):
 * uniquify mutates it, so same-titled sections across pages dedup with Name2
 * suffixes and never shadow kit components or overwrite each other's files.
 */
export function resolveSectionNames(doc: Page, taken: Set<string>): Map<string, string> {
  const byNode = new Map<string, string>();
  for (const node of collectSections(doc)) {
    byNode.set(node.id, uniquify(sectionBaseName(node), taken));
  }
  return byNode;
}

export interface FileScope {
  doc: Page;
  /** Document-level tokens (T19 §0.2: shared across pages); injected on AppShell. */
  tokens: Tokens;
  /** Section node id -> generated component name. */
  sectionNames: Map<string, string>;
  /** kit component types referenced inline in this file. */
  kitTypes: Set<string>;
  /** referenced Section node id -> component name. */
  sectionRefs: Map<string, string>;
  /** an AppShell is rendered inline here -> file needs the TOKENS import. */
  appShellUsed: boolean;
  /** Frame emission mode for this file (flow default / explicit absolute). */
  frameCtx: FrameEmitContext;
  /** W3-A interaction context: action pageId -> page name (hash route key). */
  navCtx: EmitContext;
}

export function newFileScope(
  doc: Page,
  tokens: Tokens,
  sectionNames: Map<string, string>,
  frameCtx: FrameEmitContext = FLOW_CONTEXT,
  navCtx: EmitContext = NO_NAV_CONTEXT,
): FileScope {
  return {
    doc,
    tokens,
    sectionNames,
    kitTypes: new Set<string>(),
    sectionRefs: new Map<string, string>(),
    appShellUsed: false,
    frameCtx,
    navCtx,
  };
}

/** Attribute string with leading space; injects studioId + tokens={TOKENS}. */
function scopedAttrs(node: NodeRecord, scope: FileScope): string {
  return emitInjectedAttrs(
    node,
    () => {
      scope.appShellUsed = true;
    },
    scope.navCtx,
  );
}

/** Scoped children of a node (Sections become `<Name />` refs). Every line
 *  of each child subtree gets the one-level indent (multi-line frame wrappers
 *  included) — matches emitNodeJsx's child indentation. `ctx` is the child
 *  positioning origin the caller derived via childFrameContext. */
function emitScopedChildren(scope: FileScope, node: NodeRecord, ctx: FrameEmitContext): string {
  return node.children
    .map((childId) => emitScopedNode(scope, childId, ctx))
    .map(indentBlock)
    .join("\n");
}

/** One node's JSX inside a file scope: Section refs, everything else inline.
 *  `ctx` defaults to the file's frame mode (flow default / explicit absolute). */
export function emitScopedNode(
  scope: FileScope,
  id: string,
  ctx: FrameEmitContext = scope.frameCtx,
): string {
  const sectionName = scope.sectionNames.get(id);
  if (sectionName !== undefined) {
    scope.sectionRefs.set(id, sectionName);
    return `<${sectionName} />`;
  }
  const node = getNode(scope.doc, id);
  if (!node) return `{/* unknown node: ${sanitizeIdForComment(id)} */}`;
  if (!hasComponent(node.type)) return `{/* unknown component: ${sanitizeIdForComment(node.type)} */}`;
  return withFrameWrap(node, emitInlineNodeJsx(scope, node, ctx), ctx);
}

/** Shared inline emission for emitScopedNode / emitSectionComponentJsx. */
function emitInlineNodeJsx(scope: FileScope, node: NodeRecord, ctx: FrameEmitContext): string {
  // W5: SvgBox emits inline (no kit component) — must NOT join kitTypes or the
  // file assembler would import it from a barrel that never contains it.
  if (node.type === "SvgBox") return svgInlineJsx(node);
  scope.kitTypes.add(node.type);
  const attrs = scopedAttrs(node, scope);
  if (node.children.length === 0) {
    return `<${node.type}${attrs} />`;
  }
  return `<${node.type}${attrs}>\n${emitScopedChildren(scope, node, childFrameContext(node, ctx))}\n</${node.type}>`;
}

/** Extraction body: the Section node itself inline, its children scoped.
 *  `ctx` defaults to the file's frame mode (flow default / explicit absolute). */
export function emitSectionComponentJsx(
  scope: FileScope,
  nodeId: string,
  ctx: FrameEmitContext = scope.frameCtx,
): string {
  const node = getNode(scope.doc, nodeId);
  if (!node) return `{/* unknown node: ${sanitizeIdForComment(nodeId)} */}`;
  return withFrameWrap(node, emitInlineNodeJsx(scope, node, ctx), ctx);
}

export const GENERATED_FILE_HEADER = "// GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理）";

/**
 * True when ANY node in the document carries a frame (the doc.nodes flat list
 * is authoritative — no walk needed). Only the EXPLICIT absolute mode consults
 * this: when true, the PAGE component's root gets a `position: relative`
 * wrapper so absolute children anchor to the page (not the viewport/unknown
 * ancestor). Default flow mode never emits the wrapper — frames stay canvas
 * metadata.
 */
export function hasAnyFrame(doc: Page): boolean {
  return doc.nodes.some((n) => n.frame !== undefined);
}

/**
 * True when ANY node is `pinned && frame` — the flow-mode absolute-placement
 * set. Only these nodes emit geometric wrappers under flow, so this is the
 * flow-mode gate for the page's `position: relative` root: no pinned nodes ->
 * no wrapper, byte-identical output for all pre-Plan-C documents.
 */
export function hasAnyPinnedFrame(doc: Page): boolean {
  return doc.nodes.some((n) => n.pinned === true && n.frame !== undefined);
}

/** Opening tag of the page root's `position: relative` container (closing is
 *  `</div>` added by the caller). Emitted only when hasAnyFrame(doc) is true. */
export function relativeRootWrap(): string {
  return '<div style={{ position: "relative" }}>';
}

/** File text: header + imports + function around the JSX. Pages default-export. */
export function assembleComponentFile(
  componentName: string,
  jsx: string,
  imports: string[],
  opts: { defaultExport?: boolean } = {},
): string {
  const head = [GENERATED_FILE_HEADER, ...imports].filter((s) => s !== "").join("\n");
  const keyword = opts.defaultExport ? "export default function" : "export function";
  const body = [
    `${keyword} ${componentName}() {`,
    "  return (",
    indentBlock(jsx),
    "  );",
    "}",
  ].join("\n");
  return `${head}\n\n${body}\n`;
}
