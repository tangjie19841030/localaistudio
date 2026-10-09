import type { NodeRecord, Page } from "@studio/schema-core";

/**
 * Plan C flow/pin classification helpers — pure doc reads shared by the
 * canvas surface, keyboard ops and the flow layer.
 *
 * Controller Ruling R11 (defensive normalization): the pin layer predicate is
 * `pinned && frame` EVERYWHERE. A pinned-but-frameless node is an inconsistent
 * state no product path produces (pin() always sets both, unpin() clears both,
 * the AI path strips pinned) — it classifies as FLOW, never as a pin box.
 */

/** The ONE pin-layer predicate; do not re-implement per call-site. */
export function isPinBox(node: NodeRecord | undefined): boolean {
  return node?.pinned === true && node.frame !== undefined;
}

export function isPinned(doc: Page, id: string): boolean {
  return isPinBox(doc.nodes.find((n) => n.id === id));
}

/** Direct child of the document root (page-level node). */
export function isRootChild(doc: Page, id: string): boolean {
  return doc.nodes.find((n) => n.id === doc.rootId)?.children.includes(id) === true;
}

/** Ancestor chain from the node's parent up to the root (empty for root). */
export function ancestorsOf(doc: Page, id: string): string[] {
  const parentOf = new Map<string, string>();
  for (const n of doc.nodes) for (const c of n.children) parentOf.set(c, n.id);
  const chain: string[] = [];
  let cur = parentOf.get(id);
  while (cur !== undefined) {
    chain.push(cur);
    cur = parentOf.get(cur);
  }
  return chain;
}

/**
 * Pin-box nodes are excluded from flow hit-testing: a pinned descendant never
 * renders inside the flow subtree (NodeSubtree skips pin-box children), so its
 * page position is its pin-layer frame, not the flow DOM rect.
 */
export function hasPinnedAncestor(doc: Page, id: string): boolean {
  return ancestorsOf(doc, id).some((a) => isPinned(doc, a));
}

/** Flow nodes are everything not in the pin layer; drag/resize/nudge only apply to pin boxes. */
export function isFlowNode(doc: Page, id: string): boolean {
  return !isPinned(doc, id);
}

/**
 * Drag-to-pin entry gate (T8): any flow node may leave the flow — nested
 * nodes included, they get promoted to the root on commit — EXCEPT the root
 * itself and nodes under a pin-box ancestor (that subtree renders inside the
 * pin box, where NodeFrameBox owns the gesture). The pinned-ancestor check is
 * defensive: NodeSubtree filters pin-box children from the flow DOM, so hit
 * testing cannot reach them in a consistent document.
 */
export function flowDragCandidate(doc: Page, id: string): boolean {
  return id !== doc.rootId && isFlowNode(doc, id) && !hasPinnedAncestor(doc, id);
}

/**
 * ids plus every pin-box descendant of each pin-box id (dedup): the group
 * carry rule (T13 §3.5) — dragging/nudging/aligning a pin box moves its
 * pin-box descendants by the SAME delta. Non-pin ids pass through unchanged
 * (flow position is owned by container flow, nothing to carry).
 */
export function withPinDescendants(doc: Page, ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const id of ids) {
    push(id);
    if (!isPinBox(doc.nodes.find((n) => n.id === id))) continue;
    for (const pinId of pinBoxDescendants(doc, id)) push(pinId);
  }
  return out;
}

/** Pin-box descendants of id (excluding id itself), walking flat children edges. */
function pinBoxDescendants(doc: Page, id: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>([id]);
  const walk = (nodeId: string): void => {
    const node = doc.nodes.find((n) => n.id === nodeId);
    for (const childId of node?.children ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      if (isPinBox(doc.nodes.find((n) => n.id === childId))) out.push(childId);
      walk(childId);
    }
  };
  walk(id);
  return out;
}
