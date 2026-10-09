import { activePageOf, type StudioDocument } from "@studio/schema-core";

/**
 * Marker-protocol regexes (target:/move:/resize:). Client-side copy kept as one
 * named export so the server copy (apps/server/src/ai/mock.ts) can converge on
 * the same constants later — the server module is owned by another workstream.
 * Id charset matches the server: [A-Za-z0-9_-]+.
 */
export const MARKER_PATTERNS = {
  /** "target:<id>" selects the patch-local node (last occurrence wins). */
  target: /target:([A-Za-z0-9_-]+)/,
  /** "move:<id>:<x>,<y>" / "resize:<id>:<w>,<h>" — decimals accepted. */
  spatial: /(move|resize):([A-Za-z0-9_-]+):/,
} as const;

export interface ModeDecision {
  mode: "generate" | "patch";
  /** Final outbound text (patch mode appends the "target:<id>" marker for the mock provider). */
  text: string;
  /** P5 spatial markers name their target node; it joins the allowed scope. */
  markerNodeIds?: string[];
  /** Color/theme requests are TOKEN-level changes — scope must allow tokens. */
  allowAllTokens?: boolean;
}

/** Color/theme wording = token-level intent ("整体换成暖色品牌色"). */
const TOKEN_INTENT =
  /(颜色|配色|换色|色系|暖色|冷色|主题|品牌色|token|color|theme|palette|brand.?colou?r|recolor|retheme)/i;

/** Explicit whole-page creation/generation should win over token wording when nothing is selected. */
const WHOLE_PAGE_GENERATE_INTENT =
  /(?:生成|创建|新建|搭建|制作|设计)[^\r\n]{0,32}(?:整页|全页|页面|网页|界面|工作台|仪表盘|看板|后台|应用|站点|系统)/i;

/**
 * Page-navigation wording (W3-A): "跳转到设置页" / "点击卡片导航到详情页面".
 * Such a request edits an EXISTING node (adds the navigate action), so it is a
 * patch — without this it fell through to generate mode whenever no node was
 * selected, and the whole page was rebuilt just to add one click handler.
 */
const NAVIGATE_INTENT = /(跳转|跳到|点击.{0,12}到|链接到|导航到).{0,20}(页|页面)/;

/** Guidance appended to the outbound text so the model emits the action field. */
const NAVIGATE_HINT = "（用 action navigate 实现）";

/** Normalize the selection to an id list (canvas multi-select passes an array). */
function selectionIds(selection: string | string[] | null | undefined): string[] {
  if (!selection) return [];
  return Array.isArray(selection) ? selection : [selection];
}

/**
 * Fresh project (nothing but the root node): no node can be patched yet, so any
 * request must be a whole-page generation. Without this an empty document +
 * token wording ("做一个暖色的运营看板") produced a scoped patch whose write
 * scope was empty — every insert came back "节点 … 超出修改范围" and the canvas
 * stayed empty. `null`/undefined doc = caller has no doc → keep prior behavior.
 * The node table follows the ACTIVE page (G1): pageId selects it, null falls
 * back to pages[0] (activePageOf), so a filled page 2 is patchable even while
 * page 1 is blank.
 */
function isBlankDocument(
  doc: StudioDocument | null | undefined,
  pageId?: string | null,
): boolean {
  if (!doc) return false;
  const page = activePageOf(doc, pageId ?? null);
  return page.nodes.every((node) => node.id === page.rootId);
}

/**
 * Id table of the caller's active page (G1), or null when there is no doc.
 * `pageId ?? null` keeps the optional-tail contract: absent = pages[0].
 */
function activePageIdSet(
  doc: StudioDocument | null | undefined,
  pageId?: string | null,
): Set<string> | null {
  if (!doc) return null;
  return new Set(activePageOf(doc, pageId ?? null).nodes.map((node) => node.id));
}

/** Append one target marker per selected id so the mock (and the model) see each. */
function withTargetMarkers(text: string, ids: string[]): string {
  return `${text} ${ids.map((id) => `target:${id}`).join(" ")}`;
}

/**
 * T27 short fuzzy intents: exact-phrase aliases expanded into explicit
 * interface-copy instructions before modeFor's normal branches run. Strict
 * trim + equality only — no NLP, no punctuation stripping, no substring match.
 */
const SHORT_TEXT_INTENTS: Readonly<Record<string, string>> = {
  中文: "把界面文案改成中文",
  中文化: "把界面文案改成中文",
  改中文: "把界面文案改成中文",
  英文: "把界面文案改成英文",
  英文化: "把界面文案改成英文",
  改英文: "把界面文案改成英文",
};

/** The canonical instructions the aliases expand into (isInterfaceCopyIntent's vocabulary). */
const INTERFACE_COPY_INTENTS: ReadonlySet<string> = new Set([
  "把界面文案改成中文",
  "把界面文案改成英文",
]);

/**
 * Expand a trimmed alias ("中文") into its canonical instruction. A leading
 * 【选中：…】 summary is preserved verbatim; the split uses the LAST 】 so a
 * summary that itself contains 】 still leaves the user body intact.
 */
function expandShortTextIntent(text: string): string {
  const trimmed = text.trim();
  const bodyStart = trimmed.startsWith("【选中：") ? trimmed.lastIndexOf("】") + 1 : 0;
  const prefix = trimmed.slice(0, bodyStart);
  const body = trimmed.slice(bodyStart).trim();
  return `${prefix}${SHORT_TEXT_INTENTS[body] ?? body}`;
}

/**
 * True when the (prefix-stripped, trimmed) body is exactly one of the two
 * canonical interface-copy instructions. Equality only — never substring or
 * regex matching, so long sentences stay on their original branch.
 */
function isInterfaceCopyIntent(text: string): boolean {
  const trimmed = text.trim();
  const bodyStart = trimmed.startsWith("【选中：") ? trimmed.lastIndexOf("】") + 1 : 0;
  const body = trimmed.slice(bodyStart).trim();
  return INTERFACE_COPY_INTENTS.has(body);
}

/**
 * Decide the request mode from the selection + text. Spatial markers (P5) carry
 * an explicit nodeId, so they are patch ops even without a selection — generate
 * mode would reject the ops JSON as invalid. Token-intent wording unlocks
 * tokens.set: without allowAllTokens the scope gate forbids it and the model —
 * seeing the violation — often gives up with empty ops (real-model flow finding).
 * Multi-select (canvas marquee / shift-click) scopes the patch to every
 * selected node's subtree.
 *
 * Two overrides keep whole-page requests OUT of patch mode (regression: a
 * leftover canvas selection turned "生成一个运营工作台" into a scoped patch and
 * every write came back 超出修改范围, leaving the canvas empty):
 *  1. explicit whole-page creation wording wins even when nodes are selected;
 *  2. a blank document has nothing to patch, so it must generate.
 * Navigate wording (W3-A) routes to patch and appends a hint to emit the
 * action field; it sits after both overrides so it never resurrects a
 * blank-document generate. Pass `doc` to enable (2) and the navigate branch;
 * omitting it keeps the selection-only behavior. Pass `pageId` (G1) to resolve
 * the node table against that page — selection ids missing from it are stale
 * and dropped, so the request degrades to the no-selection path instead of
 * patching a same-named node on another page (never cross-page fishing).
 */
export function modeFor(
  selection: string | string[] | null,
  text: string,
  doc?: StudioDocument | null,
  pageId?: string | null,
): ModeDecision {
  // G1: with a pageId-aware caller (pageId passed, null = pages[0]) selection
  // ids missing from the active page are stale — drop them so the request
  // degrades to the no-selection path instead of patching a same-named node
  // on another page. Callers on the old 3-arg signature keep legacy behavior.
  const pageIds = doc && pageId !== undefined ? activePageIdSet(doc, pageId) : null;
  const ids = pageIds
    ? selectionIds(selection).filter((id) => pageIds.has(id))
    : selectionIds(selection);
  // T27: expand exact short intents first so every downstream branch sees the
  // canonical instruction ("中文" → "把界面文案改成中文").
  const expandedText = expandShortTextIntent(text);
  const spatial = MARKER_PATTERNS.spatial.exec(expandedText.trim());
  if (spatial) {
    return { mode: "patch", text: expandedText, markerNodeIds: [spatial[2]!] };
  }
  if (WHOLE_PAGE_GENERATE_INTENT.test(expandedText)) {
    return { mode: "generate", text: expandedText };
  }
  if (isBlankDocument(doc, pageId)) {
    return { mode: "generate", text: expandedText };
  }
  // T27: an explicit interface-copy instruction is a local text edit — patch
  // the whole document when nothing is selected, the selection subtree when
  // nodes are selected. Placed after the blank-document check so an empty
  // document still generates.
  if (isInterfaceCopyIntent(expandedText)) {
    return {
      mode: "patch",
      text: ids.length > 0 ? withTargetMarkers(expandedText, ids) : expandedText,
    };
  }
  if (TOKEN_INTENT.test(expandedText)) {
    const base = ids.length > 0
      ? { mode: "patch" as const, text: withTargetMarkers(expandedText, ids) }
      : { mode: "patch" as const, text: expandedText };
    return { ...base, allowAllTokens: true };
  }
  // Navigate wording (W3-A) after the token branch so a combined "换色并跳转"
  // request keeps its allowAllTokens permission (losing it makes the server
  // reject every token write). Placed after the blank-document check above: an
  // empty document has no node to carry the action, so it still generates.
  // `doc` must be present — without it the caller has no document, so the
  // selection-only fallback below keeps its old behavior.
  if (doc && NAVIGATE_INTENT.test(expandedText)) {
    const hinted = `${expandedText} ${NAVIGATE_HINT}`;
    return { mode: "patch", text: ids.length > 0 ? withTargetMarkers(hinted, ids) : hinted };
  }
  return ids.length > 0
    ? { mode: "patch", text: withTargetMarkers(expandedText, ids) }
    : { mode: "generate", text: expandedText };
}

/**
 * Build the request scope from the selection + marker nodes. A spatial marker
 * names its target node explicitly — that IS the user's chosen scope, same
 * semantics as a selection (scopeChecker otherwise defaults to zero nodes
 * allowed). Multi-select unions every selected subtree into nodeIds. Returns
 * undefined when nothing constrains the request to patch ops. `pageId` (G1)
 * resolves the node table: ids missing from the active page contribute nothing
 * (stale selection → empty scope → undefined, i.e. whole-document fallback).
 */
/** Collect the id plus every descendant id (flat node table, children = id list).
 * `strict` (G1-aware callers, pageId passed) drops ids missing from the active
 * page's table; legacy callers keep the old permissive push of the raw id. */
function subtreeIds(
  doc: StudioDocument | null,
  rootId: string,
  strict: boolean,
  pageId?: string | null,
): string[] {
  if (!doc) return [rootId];
  const byId = new Map(activePageOf(doc, pageId ?? null).nodes.map((node) => [node.id, node]));
  const out: string[] = [];
  const walk = (id: string): void => {
    const node = byId.get(id);
    if (!node) {
      if (!strict && !out.includes(id)) out.push(id);
      return;
    }
    if (out.includes(id)) return;
    out.push(id);
    for (const childId of node.children) walk(childId);
  };
  walk(rootId);
  return out;
}

export function buildScope(
  doc: StudioDocument | null,
  selection: string | string[] | null,
  extraNodeIds?: string[],
  allowAllTokens?: boolean,
  pageId?: string | null,
): { nodeIds: string[]; allowAllTokens: boolean } | undefined {
  // A selected CONTAINER must include its whole subtree, otherwise editing
  // "this card's inner elements" was rejected as out-of-scope.
  const strict = pageId !== undefined;
  const roots = new Set<string>([...(extraNodeIds ?? []), ...selectionIds(selection)]);
  const ids = new Set<string>();
  for (const rootId of roots) {
    for (const id of subtreeIds(doc, rootId, strict, pageId)) ids.add(id);
  }
  if (ids.size === 0 && !allowAllTokens) return undefined;
  return { nodeIds: [...ids], allowAllTokens: allowAllTokens === true };
}
