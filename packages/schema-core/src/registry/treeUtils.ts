import type { NodeRecord, Page } from "../document.js";

/**
 * Tree traversal utilities over the flat node table.
 *
 * Walks always start at doc.rootId and follow children edges; nodes present in
 * the table but not reachable from the root ("detached") are never entered.
 * Pathological docs (cyclic children) are guarded by visited sets so the
 * traversal terminates — checkPage does not catch cycles, these helpers must.
 */

function nodeMap(doc: Page): Map<string, NodeRecord> {
  return new Map(doc.nodes.map((n) => [n.id, n]));
}

export function getNode(doc: Page, id: string): NodeRecord | undefined {
  return nodeMap(doc).get(id);
}

/** ID path from root to the node; undefined when not on the tree (detached or unknown). */
export function getPath(doc: Page, id: string): string[] | undefined {
  const map = nodeMap(doc);
  if (!map.has(id)) return undefined; // not in the table at all
  const parentOf = new Map<string, string>();
  // Pre-order DFS from root; visited set makes cycles terminate.
  const visited = new Set<string>([doc.rootId]);
  const walk = (nodeId: string, path: string[]): boolean => {
    if (nodeId === id) {
      return true; // caller checks path via parentOf chain below
    }
    void path;
    const node = map.get(nodeId);
    if (!node) return false;
    let found = false;
    for (const childId of node.children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        parentOf.set(childId, nodeId);
        if (walk(childId, [...path, childId])) found = true;
      }
    }
    return found;
  };
  if (id === doc.rootId) return [doc.rootId];
  walk(doc.rootId, [doc.rootId]);
  if (!parentOf.has(id)) return undefined; // detached (in table, no tree edge)
  const path: string[] = [id];
  let cur = id;
  while (cur !== doc.rootId) {
    cur = parentOf.get(cur)!;
    path.unshift(cur);
  }
  return path;
}

/**
 * The node itself plus all descendants in declaration order (pre-order).
 * [] when the id is unknown. Detached roots still collect their own detached subtree.
 */
export function collectSubtreeIds(doc: Page, id: string): string[] {
  const map = nodeMap(doc);
  const root = map.get(id);
  if (!root) return [];
  const out: string[] = [];
  const visited = new Set<string>([id]);
  const collect = (nodeId: string): void => {
    out.push(nodeId);
    const node = map.get(nodeId);
    if (!node) return;
    for (const childId of node.children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        collect(childId);
      }
    }
  };
  collect(id);
  return out;
}

export function isAncestor(doc: Page, ancestorId: string, nodeId: string): boolean {
  if (ancestorId === nodeId) return false;
  return collectSubtreeIds(doc, ancestorId).includes(nodeId);
}

/** Root depth is 0; undefined for unknown or detached ids. Shortest depth wins under cycles. */
export function depthOf(doc: Page, id: string): number | undefined {
  if (id === doc.rootId) return 0;
  const map = nodeMap(doc);
  if (!map.has(id)) return undefined;
  // BFS from root: first hit is the shortest (cycle-safe) depth.
  const visited = new Set<string>([doc.rootId]);
  let depth = 0;
  let frontier: string[] = [doc.rootId];
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const nodeId of frontier) {
      const node = map.get(nodeId);
      if (!node) continue;
      for (const childId of node.children) {
        if (childId === id) return depth;
        if (!visited.has(childId)) {
          visited.add(childId);
          next.push(childId);
        }
      }
    }
    frontier = next;
  }
  return undefined; // detached
}

/** Which parent and index the node is attached at; undefined for the root or unknown ids. */
export function attachPoint(
  doc: Page,
  childId: string,
): { parentId: string; index: number } | undefined {
  if (childId === doc.rootId) return undefined;
  if (!nodeMap(doc).has(childId)) return undefined;
  // Scan every table entry (including detached parents) for the owning index.
  for (const node of doc.nodes) {
    const idx = node.children.indexOf(childId);
    if (idx !== -1) return { parentId: node.id, index: idx };
  }
  return undefined;
}
