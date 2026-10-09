import type { NodeRecord, Page, Tokens } from "@studio/schema-core";
import { getNode } from "@studio/schema-core";
import { kitComponents, tokensToCssVars } from "@studio/ui-kit";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import { NodeErrorBoundary } from "../../preview/NodeErrorBoundary";
import { isPinBox } from "./flowNodes";

/**
 * Headless single-subtree renderer for canvas mode (P5-2). The flow preview
 * renders the whole tree from the root via SchemaRenderer; the canvas instead
 * positions each frame-bearing node's subtree in its own absolute box, so we
 * need "render this node and its children" instead of "render the root".
 *
 * Visual consistency with flow mode comes from reusing the exact same kit
 * components and token wiring: non-AppShell roots get the same CSS-vars
 * wrapper SchemaRenderer applies.
 */

export interface NodeSubtreeProps {
  doc: Page;
  /** Document-level tokens (T19 §0.2): AppShell injection + CSS-vars wrapper. */
  tokens: Tokens;
  /** The node whose subtree renders (NOT necessarily the document root). */
  nodeId: string;
  /**
   * Drag-to-pin (Task 4 fix round): the node currently lifted into the
   * transient pin-drag box. It is skipped here so the flow layer does not
   * paint a stationary ghost copy under the moving box.
   */
  hideId?: string | null;
}

/** Placeholder for types the kit does not implement — never crashes the canvas.
 *  Renders on the white canvas paper — fixed slate, not chrome ink. */
function UnknownType({ type }: { type: string }) {
  return (
    <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
      未知组件 {type}
    </div>
  );
}

/** Kit component for the node, or the gray placeholder when unregistered. */
function renderKitNode(
  tokens: Tokens,
  node: NodeRecord,
  children: ReactNode,
): ReactNode {
  const Kit = kitComponents[node.type];
  if (!Kit) return <UnknownType type={node.type} />;
  const props = { ...(node.props as Record<string, unknown>) };
  if (node.type === "AppShell") {
    // Contract: tokens are document-level; every AppShell instance gets them.
    props.tokens = tokens;
  }
  return <Kit {...props}>{children}</Kit>;
}

/** Recursive subtree render; mirrors SchemaRenderer.renderTree minus hit targets. */
function renderTree(doc: Page, tokens: Tokens, id: string, hideId?: string | null): ReactNode {
  const node = getNode(doc, id);
  if (!node) return null;
  // PIN-BOX children (shared R11 predicate: pinned && frame) draw as their
  // OWN absolute boxes in the pin layer; rendering them inside the parent
  // subtree too would paint the nested content twice. Everything else stays
  // in the flow — including the inconsistent pinned-frameless state, which
  // the pin layer would have nothing to place anyway. hideId skips the node
  // currently shown as the transient pin-drag box (no stationary ghost).
  const children = node.children
    .filter((childId) => childId !== hideId && !isPinBox(getNode(doc, childId)))
    .map((childId) => (
      <Fragment key={childId}>{renderTree(doc, tokens, childId, hideId)}</Fragment>
    ));
  return (
    // display:contents keeps the marker transparent to Grid/Stack/flex layouts
    // (same wrapper contract SchemaRenderer documents for the preview).
    // pointer-events:auto re-enables hit-testing under the flow layer's
    // pointer-events:none shield (events bubble to the layer's handler).
    <div data-studio-id={id} style={{ display: "contents" }} className="pointer-events-auto">
      <NodeErrorBoundary nodeId={id}>{renderKitNode(tokens, node, children)}</NodeErrorBoundary>
    </div>
  );
}

export function NodeSubtree({ doc, tokens, nodeId, hideId }: NodeSubtreeProps) {
  const node = getNode(doc, nodeId);
  if (!node) return null;
  // Same CSS-vars scoping wrapper SchemaRenderer applies to non-AppShell roots,
  // plus the same text-color pin: without it canvas nodes inherit the dark-theme
  // chrome ink and render unreadably on the white paper.
  const style = {
    ...tokensToCssVars(tokens),
    color: "var(--studio-color-text)",
  } as CSSProperties;
  return (
    <div data-studio-id={nodeId} style={style} className="h-full w-full">
      {renderTree(doc, tokens, nodeId, hideId)}
    </div>
  );
}
