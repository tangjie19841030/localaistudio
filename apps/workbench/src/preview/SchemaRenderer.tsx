import {
  childFrameContext,
  currentSvgParser,
  FLOW_CONTEXT,
  getNode,
  hasAnyPinnedFrame,
  resolveBreakpointProps,
  serializeSvgElement,
} from "@studio/schema-core";
import type { BreakpointName, Frame, FrameEmitContext, NodeRecord, Page, Tokens } from "@studio/schema-core";
import { kitComponents, tokensToCssVars } from "@studio/ui-kit";
import { Fragment } from "react";
import { isPinBox } from "../features/canvas/flowNodes";
import { NodeErrorBoundary } from "./NodeErrorBoundary";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

export interface SchemaRendererProps {
  /** The ACTIVE page (T19 §3.5) — schema preview renders one page at a time. */
  doc: Page;
  /** Document-level tokens: AppShell injection + CSS-vars wrapper. */
  tokens: Tokens;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** W3-A: a node carrying a navigate action switches the active page instead
   *  of selecting. Optional — without it the click falls back to onSelect only
   *  (never throws; PreviewSurface always threads it in the schema branch). */
  onNavigate?: (pageId: string) => void;
  /** W4-A: the device preset being previewed. Defaults to "desktop" (the
   *  identity viewport), so omitting it renders the base props byte-for-byte
   *  like before this wave. */
  viewport?: BreakpointName;
}

/**
 * Kit components drop unknown props (no rest spread), so data-node-id/onClick
 * cannot be injected via cloneElement. Each node therefore renders inside a
 * wrapper div that carries the hit target + selection marks.
 *
 * display:contents keeps the wrapper transparent to Grid/Stack/flex layouts
 * (it generates no box). When selected we switch to a real box so the outline
 * actually paints — a minor, transient layout shift that is standard editor
 * highlight behavior.
 */
const WRAPPER_BASE: CSSProperties = { display: "contents" };
const WRAPPER_SELECTED: CSSProperties = {
  display: "block",
  outline: "2px solid #5e6ad2",
  outlineOffset: "1px",
};

/**
 * Inline style for a pinned node's geometric wrapper. Mirrors codegen's
 * frameStyleSource (schema-core emitters.ts) so the Schema preview and the
 * project preview iframe place the node identically: same property order,
 * numeric values (React appends px, codegen emits raw literals), rotation
 * omitted at 0, and left/top re-based by the parent pin origin so nested
 * pinned nodes do not stack parent+child offsets.
 */
function frameStyle(frame: Frame, originX: number, originY: number): CSSProperties {
  const style: CSSProperties = {
    position: "absolute",
    left: frame.x - originX,
    top: frame.y - originY,
    width: frame.w,
    height: frame.h,
  };
  if (frame.rotation !== 0) style.transform = `rotate(${frame.rotation}deg)`;
  return style;
}

/** Placeholder for types the kit does not implement — never crashes the preview.
 *  Renders on the white preview paper — fixed slate, not chrome ink. */
function UnknownType({ type }: { type: string }) {
  return (
    <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
      未知组件 {type}
    </div>
  );
}

/**
 * W5 SvgBox: inject the controlled-subset serialization — the SAME bytes the
 * codegen ships (both consume serializeSvgElement; parity by construction).
 * Empty/invalid source (or no parser bound) serializes to "" and degrades to
 * the gray placeholder, mirroring UnknownType styling. Never crashes.
 */
function renderSvgBoxNode(node: NodeRecord, viewport: BreakpointName): ReactNode {
  const source = resolveBreakpointProps(node, viewport)["source"];
  const serialized = serializeSvgElement(typeof source === "string" ? source : "", currentSvgParser());
  if (serialized === "") {
    return (
      <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">SVG 源码无效</div>
    );
  }
  return <div data-component="SvgBox" data-studio-id={node.id} dangerouslySetInnerHTML={{ __html: serialized }} />;
}

/** Kit component for the node, or the gray placeholder when unregistered. */
function renderKitNode(
  tokens: Tokens,
  node: NodeRecord,
  children: ReactNode,
  viewport: BreakpointName,
): ReactNode {
  const Kit = kitComponents[node.type];
  // W5: SvgBox has no kit component — inline SVG branch BEFORE the !Kit check.
  if (node.type === "SvgBox") return renderSvgBoxNode(node, viewport);
  if (!Kit) return <UnknownType type={node.type} />;
  // W4-A: resolve the viewport overlay BEFORE tokens injection. The result is a
  // fresh object (resolveBreakpointProps never writes back into node.props), so
  // the store stays immutable and desktop/no-override rendering is unchanged.
  const props = resolveBreakpointProps(node, viewport);
  if (node.type === "AppShell") {
    // Contract: tokens are document-level; every AppShell instance gets them.
    props.tokens = tokens;
  }
  return <Kit {...props}>{children}</Kit>;
}

export function SchemaRenderer({ doc, tokens, selectedId, onSelect, onNavigate, viewport = "desktop" }: SchemaRendererProps) {
  const root = getNode(doc, doc.rootId);
  if (!root) return <UnknownType type="(missing root)" />;

  /**
   * W3-A click semantics, one meaning per click: a node carrying a navigate
   * action calls onNavigate(pageId) INSTEAD of onSelect; anything else selects.
   * Without an onNavigate prop (or with an unknown target pageId) the action is
   * inert and the click degrades to selection — the renderer never throws on a
   * dangling action (schema validation owns that invariant).
   */
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    const hit = (e.target as HTMLElement).closest("[data-node-id]");
    if (!hit) return;
    const id = hit.getAttribute("data-node-id") as string;
    const node = getNode(doc, id);
    if (onNavigate && node?.action?.type === "navigate") {
      onNavigate(node.action.pageId);
      return;
    }
    onSelect(id);
  };

  /** Recursively render a subtree; children flow in as React children.
   *  `ctx` carries the pin origin so nested pinned nodes re-base like codegen. */
  const renderTree = (id: string, ctx: FrameEmitContext): ReactNode => {
    const node = getNode(doc, id);
    if (!node) return null;
    const childCtx = childFrameContext(node, ctx);
    const children = node.children.map((childId) => (
      <Fragment key={childId}>{renderTree(childId, childCtx)}</Fragment>
    ));
    const selected = id === selectedId;
    const body = (
      <div
        data-node-id={id}
        onClick={handleClick}
        className={selected ? "outline outline-2 outline-accent outline-offset-1" : undefined}
        style={selected ? WRAPPER_SELECTED : WRAPPER_BASE}
      >
        {/* One bad AI-generated node must not blank the whole editor. */}
        <NodeErrorBoundary nodeId={id}>{renderKitNode(tokens, node, children, viewport)}</NodeErrorBoundary>
      </div>
    );
    // Pin parity (R11 predicate): a pinned+frame node gets the same absolute
    // wrapper codegen emits, so the Schema preview matches the other two views.
    if (!isPinBox(node)) return body;
    return (
      <div data-studio-id={id} style={frameStyle(node.frame!, ctx.originX, ctx.originY)}>
        {body}
      </div>
    );
  };

  const content = renderTree(doc.rootId, FLOW_CONTEXT);
  // A pinned node needs a positioned ancestor; codegen wraps the page root in
  // position:relative (pages.ts relativeRootWrap) under the same gate.
  const needsRelativeRoot = hasAnyPinnedFrame(doc);
  if (root.type === "AppShell") {
    // AppShell takes tokens as a prop and injects the CSS vars itself.
    if (!needsRelativeRoot) return <>{content}</>;
    return <div style={{ position: "relative" }}>{content}</div>;
  }
  // Any other root: wrap so the CSS vars are always in scope, and pin the text
  // color to the document token — otherwise non-AppShell roots inherit the
  // workbench chrome color (near-white in dark theme) and render unreadably
  // on the white preview paper (found by visual inspection, P5 follow-up).
  const style = {
    ...tokensToCssVars(tokens),
    color: "var(--studio-color-text)",
    backgroundColor: "var(--studio-color-surface)",
    ...(needsRelativeRoot ? { position: "relative" as const } : {}),
  } as CSSProperties;
  return (
    <div style={style} className="min-h-full">
      {content}
    </div>
  );
}
