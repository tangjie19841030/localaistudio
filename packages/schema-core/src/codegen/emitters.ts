import type { Frame, NodeAction, NodeRecord, Page } from "../document.js";
import { getComponentDef, hasComponent } from "../registry/componentDefs.js";
import { getNode } from "../registry/treeUtils.js";
import { currentSvgParser, serializeSvgElement } from "../registry/svgSubset.js";
import { escapeJsxString, serializeProps } from "./serialize.js";

/**
 * JSX emitters: node subtree -> JSX source text (pure functions).
 *
 * Container nodes emit their children as JSX children with 2-space indent;
 * leaf nodes self-close. Unknown types become a comment placeholder instead of
 * throwing — preview must not crash and codegen likewise must not.
 *
 * AppShell contract: the kit's AppShell requires a `tokens` prop, but tokens
 * are document-level and never live in node props. The emitter injects
 * `tokens={TOKENS}` on every AppShell and records the usage, so the file
 * assembler can add `import { TOKENS } from "<rel>/styles/tokens"` (the
 * relative prefix depends on the file's depth — pages/ vs components/generated/).
 *
 * studioId contract: every node also gets `studioId="<node.id>"` injected. The
 * kit renders it as `data-studio-id` on the component root, which is how a
 * DOM-level visual issue found in the running export maps back to the Schema
 * node that produced it. Like `tokens`, it is an injected concern and never an
 * author-editable prop, so it is not part of the registry propsSchema.
 *
 * Frame contract: a node may carry optional absolute geometry (`frame`), but
 * frames are CANVAS metadata (page-absolute drag rects, see
 * registry/autoLayout.ts). Under Plan C hybrid positioning the default "flow"
 * codegen wraps ONLY `pinned && frame` nodes in the geometric div (pin is the
 * explicit free-positioning exemption); a legacy frame on an un-pinned node
 * stays inert and never reaches the output. The explicit `absolute` mode
 * (generateFiles opts `{ layout: "absolute" }`) keeps the P5 compatibility
 * path: frame-bearing nodes wrap in ONE geometric div with `position: absolute`
 * + x/y/w/h (+ rotate when non-zero), exactly one wrapper, never nested
 * wrappers.
 */

const INDENT = "  ";

/**
 * Codegen layout mode. "flow" (default) renders the whole tree in normal
 * document flow; "absolute" is the explicit compatibility path.
 */
export type CodegenLayout = "flow" | "absolute";

/**
 * Frame emission context threaded through the JSX walk.
 *
 * Frames store PAGE-ABSOLUTE coordinates, but CSS resolves left/top against
 * the nearest POSITIONED ancestor — in absolute mode that is the nearest
 * framed ancestor's wrapper. Each wrapper therefore re-bases its geometry by
 * `originX/originY` (the wrapped ancestor's frame origin, 0/0 at the page
 * root). Without the re-base, nested framed nodes stack parent+child offsets
 * and drift down-right with depth (the project-preview bug).
 */
export interface FrameEmitContext {
  layout: CodegenLayout;
  originX: number;
  originY: number;
}

/** Default context: flow layout, frames ignored. */
export const FLOW_CONTEXT: FrameEmitContext = { layout: "flow", originX: 0, originY: 0 };

/** Root context of the explicit absolute compatibility path. */
export const ABSOLUTE_CONTEXT: FrameEmitContext = { layout: "absolute", originX: 0, originY: 0 };

/**
 * Interaction emission context (W3-A) — deliberately separate from
 * FrameEmitContext (frames are canvas geometry, this is navigation). The
 * resolver maps an action pageId to the page NAME = the hash route key, and
 * returns "" for an unknown page (dangling action -> no onClick).
 */
export interface EmitContext {
  pageNameOf: (pageId: string) => string;
}

/** No-navigation context: actions emit nothing (standalone emitNodeJsx callers). */
export const NO_NAV_CONTEXT: EmitContext = { pageNameOf: () => "" };

/**
 * Make a free-text value (node id, component type) safe inside a JSX brace
 * comment: a literal star-slash sequence in the value would close the comment
 * early and leak the rest into code space (P2 comment-escape hardening).
 * The star is swapped for the division-slash lookalike U+2215, which keeps
 * the comment visually intact while being impossible to terminate early.
 */
export function sanitizeIdForComment(id: string): string {
  return id.replaceAll("*/", "*∕");
}

/** Indent every non-empty line of a block by one level. */
export function indentBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => (line === "" ? line : INDENT + line))
    .join("\n");
}

/**
 * Attribute string with leading space, e.g. ` title="x" sidebar studioId="n1"`.
 *
 * Deterministic order: author props (doc insertion order), then `studioId`,
 * then `tokens={TOKENS}` for AppShell. `onAppShell` is the hook the callers use
 * to record that the enclosing file needs the TOKENS import.
 *
 * Props are filtered to the keys the component's registry schema declares
 * before serializing: a document written by an older/looser path may carry
 * undeclared keys (e.g. imageUrl/height on Hero), and emitting them produces
 * JSX props the ui-kit type does not declare — the exported project then fails
 * `tsc --noEmit`. Preview drops such props silently, so this only ever shows
 * up at export; filtering here keeps every writer path safe.
 *
 * W3-A: a navigate action appends its onClick LAST (see actionOnClickSource) —
 * document-level intent wins over any author prop of the same name.
 */
/**
 * W3-A: `onClick` JSX attribute for a node carrying a navigate action, or "".
 *
 * The hash is `#/` + the target page NAME verbatim (the route key main.tsx
 * builds), so the emitted demo navigates on click without a router. Emitted
 * AFTER the author props so it wins over a model-authored `props.onClick`
 * (document-level intent beats a kit prop; Button's onClick is not even in the
 * registry propsSchema, so declaredProps already drops it). A dangling pageId
 * (document predating checkStudioDocument) resolves to "" -> no attribute, the
 * click is inert and the generated project still compiles.
 */
function actionOnClickSource(action: NodeAction | undefined, ctx: EmitContext): string {
  if (action?.type !== "navigate") return "";
  const name = ctx.pageNameOf(action.pageId);
  if (name === "") return "";
  return ` onClick={() => { window.location.hash = ${JSON.stringify(`#/${name}`)}; }}`;
}

export function emitInjectedAttrs(
  node: NodeRecord,
  onAppShell: () => void,
  ctx: EmitContext = NO_NAV_CONTEXT,
): string {
  // studioId reuses serializeProps so it gets the same quote/backslash escaping.
  const parts = [serializeProps(declaredProps(node)), serializeProps({ studioId: node.id })];
  if (node.type === "AppShell") {
    onAppShell();
    parts.push("tokens={TOKENS}");
  }
  parts.push(actionOnClickSource(node.action, ctx));
  return ` ${parts.filter((s) => s !== "").join(" ")}`;
}

function emitAttrs(node: NodeRecord, appShellUsed: Set<string>, ctx: EmitContext): string {
  return emitInjectedAttrs(node, () => appShellUsed.add(node.type), ctx);
}

/**
 * Node props normalized to the registry-declared keys, dropping undeclared
 * ones and materializing the defaults needed by the copied ui-kit contract.
 *
 * Codegen is a trust boundary: older documents and model proposals can carry
 * a valid generic `props` record that is incomplete for a required ui-kit prop
 * or contains an invalid enum. Validate each declared field independently so
 * one bad optional field does not erase valid neighboring content; use that
 * field's registry default when available. Unknown types pass through
 * untouched (they emit a placeholder comment).
 */
function declaredProps(node: NodeRecord): Record<string, unknown> {
  const raw = (node.props ?? {}) as Record<string, unknown>;
  const def = getComponentDef(node.type);
  if (!def) return raw;
  const shape = (def.propsSchema as { shape?: Record<string, unknown> }).shape;
  if (!shape) return raw;

  const normalized: Record<string, unknown> = {};
  const required = new Set(def.requiredProps);
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (Object.hasOwn(raw, key)) {
      const result = (fieldSchema as { safeParse?: (value: unknown) => { success: boolean; data?: unknown } }).safeParse?.(raw[key]);
      if (result?.success) {
        if (result.data !== undefined) normalized[key] = result.data;
        continue;
      }
      if (Object.hasOwn(def.defaultProps, key)) {
        normalized[key] = def.defaultProps[key];
        continue;
      }
      if (required.has(key)) {
        throw new Error(`组件 ${node.type} 的必填属性 "${key}" 无法生成安全默认值`);
      }
      continue;
    }

    if (required.has(key)) {
      if (!Object.hasOwn(def.defaultProps, key)) {
        throw new Error(`组件 ${node.type} 的必填属性 "${key}" 无法生成安全默认值`);
      }
      normalized[key] = def.defaultProps[key];
    }
  }
  return normalized;
}

/**
 * React style object literal for one frame: numbers emit as raw literals
 * (`left: 320` — React's style prop appends px to numeric values) and strings
 * are double-quoted. rotation 0 omits the transform entry entirely so
 * unrotated geometry stays clean. `originX/originY` re-bases the page-absolute
 * frame onto its positioned wrapper (absolute mode). This is deliberately NOT
 * serializeProps: that one is for JSX attributes (=name={value}); this is the
 * inline object of a style={{ ... }} expression (name: value). An emitter
 * concern — lives here, not in serialize.ts.
 */
export function frameStyleSource(frame: Frame, originX = 0, originY = 0): string {
  const entries: string[] = [
    'position: "absolute"',
    `left: ${frame.x - originX}`,
    `top: ${frame.y - originY}`,
    `width: ${frame.w}`,
    `height: ${frame.h}`,
  ];
  if (frame.rotation !== 0) {
    entries.push(`transform: "rotate(${frame.rotation}deg)"`);
  }
  return `{ ${entries.join(", ")} }`;
}

/**
 * Wrap a node's JSX in the geometric div (frame-bearing nodes only).
 *
 * data-studio-id moves to the WRAPPER: it is the outermost rendered element
 * now, so the audit's `closest("[data-studio-id]")` from any inner DOM element
 * resolves to it. The inner component KEEPS its studioId prop (it renders its
 * own data-studio-id too — duplicate attributes across DIFFERENT elements are
 * harmless), so DOM issues inside the subtree still map back to the node.
 */
function wrapWithFrame(node: NodeRecord, jsx: string, ctx: FrameEmitContext): string {
  const style = frameStyleSource(node.frame!, ctx.originX, ctx.originY);
  const inner = indentBlock(jsx);
  return `<div data-studio-id="${node.id}" style={${style}}>\n${inner}\n</div>`;
}

/**
 * Wrap the JSX in the frame div when the layout mode demands absolute
 * placement for this node.
 *
 * - absolute (explicit compat mode): any frame-bearing node wraps (the P5
 *   legacy rule, unchanged).
 * - flow (default): only `pinned && frame` nodes wrap — pin is the explicit
 *   free-positioning exemption, and a legacy frame on an un-pinned node is
 *   inert canvas metadata that must not leak into the output.
 */
export function withFrameWrap(
  node: NodeRecord,
  jsx: string,
  ctx: FrameEmitContext = FLOW_CONTEXT,
): string {
  if (node.frame === undefined) return jsx;
  if (ctx.layout === "absolute") return wrapWithFrame(node, jsx, ctx);
  if (node.pinned) return wrapWithFrame(node, jsx, ctx);
  return jsx;
}

/** Context for the children walk: a positioned node's wrapper becomes the
 *  origin its positioned descendants re-base against. In absolute mode any
 *  framed node wraps (and so positions); in flow mode only a pinned+frame
 *  node wraps, so an un-pinned framed ancestor must NOT re-base (it emits no
 *  wrapper and CSS would resolve children against the page root instead). */
export function childFrameContext(node: NodeRecord, ctx: FrameEmitContext): FrameEmitContext {
  if (node.frame === undefined) return ctx;
  if (ctx.layout === "flow" && !node.pinned) return ctx;
  return { layout: ctx.layout, originX: node.frame.x, originY: node.frame.y };
}

/**
 * W5 SvgBox inline JSX: the node's SVG source goes through the registry's
 * controlled-subset serializer — the SAME bytes the renderer injects (parity
 * by construction, w5-wave D4/OP-7). The output is escaped as a JSX string
 * literal inside dangerouslySetInnerHTML, so `"` in the SVG becomes &quot;
 * in the source and decodes back at runtime (decode-level equivalence).
 * A "" serialization (empty / invalid / parser unavailable) degrades to an
 * empty placeholder div — never throws, mirror of the renderer path.
 * Exported for pages.emitInlineNodeJsx; not part of the package surface docs.
 */
export function svgInlineJsx(node: NodeRecord): string {
  const raw = node.props?.["source"];
  const source = typeof raw === "string" ? raw : "";
  const serialized = serializeSvgElement(source, currentSvgParser());
  if (serialized === "") {
    return `<div data-component="SvgBox" data-studio-id="${node.id}" />`;
  }
  const html = escapeJsxString(serialized);
  return `<div data-component="SvgBox" data-studio-id="${node.id}" dangerouslySetInnerHTML={{ __html: "${html}" }} />`;
}

function emitKnownNode(
  doc: Page,
  node: NodeRecord,
  appShellUsed: Set<string>,
  ctx: FrameEmitContext,
  navCtx: EmitContext,
): string {
  // W5: SvgBox has no kit component — emit the inline SVG div BEFORE any attr
  // computation (serializeProps must never touch the raw source prop).
  if (node.type === "SvgBox") return withFrameWrap(node, svgInlineJsx(node), ctx);
  const attrs = emitAttrs(node, appShellUsed, navCtx);
  if (node.children.length === 0) {
    return withFrameWrap(node, `<${node.type}${attrs} />`, ctx);
  }
  const childCtx = childFrameContext(node, ctx);
  const childrenJsx = node.children
    .map((childId) => emitNodeJsx(doc, childId, appShellUsed, childCtx, navCtx))
    .map(indentBlock)
    .join("\n");
  return withFrameWrap(node, `<${node.type}${attrs}>\n${childrenJsx}\n</${node.type}>`, ctx);
}

/**
 * Recursive JSX for one node's subtree at depth 0. Unknown node ids and
 * unregistered types degrade to comment placeholders (never throws).
 * `ctx` defaults to flow — the default codegen output ignores frames.
 * `navCtx` defaults to no-navigation — action-less callers stay byte-identical.
 */
export function emitNodeJsx(
  doc: Page,
  id: string,
  appShellUsed: Set<string>,
  ctx: FrameEmitContext = FLOW_CONTEXT,
  navCtx: EmitContext = NO_NAV_CONTEXT,
): string {
  const node = getNode(doc, id);
  if (!node) return `{/* unknown node: ${sanitizeIdForComment(id)} */}`;
  if (!hasComponent(node.type)) return `{/* unknown component: ${sanitizeIdForComment(node.type)} */}`;
  return emitKnownNode(doc, node, appShellUsed, ctx, navCtx);
}
