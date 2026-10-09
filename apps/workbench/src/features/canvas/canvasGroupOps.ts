import type { Frame, Page } from "@studio/schema-core";
import { insertNode, makeNode, moveNode, pin, removeNode, setFrame } from "@studio/schema-core";
import { isPinBox } from "./flowNodes";

/**
 * Canvas group algebra (T13). A group is a LIGHTWEIGHT CONTAINER built purely
 * from existing schema-core primitives — no schema change: type "Container" +
 * `pinned && frame` + a structural predicate (every direct child is a pin
 * box). Members keep their page-absolute frames; the group's frame is a
 * DERIVED value recomputed from the union bbox of its pin-box descendants.
 *
 * z-order rule: the group node sits BEFORE its first member in the nodes
 * array (zOrder = nodes array order), so the empty group box never covers its
 * members' pointer hit-testing. insertNode only appends, so the group op
 * performs one pure array reorder (splice of existing entries — no id
 * created/destroyed, checkDocument invariants intact).
 */

/** Structural group predicate: pin box + Container + every direct child is a pin box. */
export function isCanvasGroup(doc: Page, id: string): boolean {
  const node = doc.nodes.find((n) => n.id === id);
  if (!isPinBox(node) || node!.type !== "Container") return false;
  const childNodes = node!.children.map((cid) => doc.nodes.find((n) => n.id === cid));
  return node!.children.length > 0 && childNodes.every((c) => isPinBox(c));
}

/** Rotate eligibility: pin box with ZERO pin-box descendants (parity gate, design §3.4). */
export function rotateEligible(doc: Page, id: string): boolean {
  const node = doc.nodes.find((n) => n.id === id);
  if (!isPinBox(node)) return false;
  return descendantPinBoxes(doc, id).length === 0;
}

/**
 * Group >= 2 eligible members (root-child pin boxes only) into a new pinned
 * Container at the union bbox. Members keep page-absolute frames. The group
 * node is placed BEFORE its first member in the nodes array. One composed doc
 * pass. Returns null when < 2 members or any member is not a root-child pin
 * box.
 */
export function groupNodes(
  doc: Page,
  memberIds: readonly string[],
): { doc: Page; groupId: string } | null {
  const members = eligibleRootPinBoxes(doc, memberIds);
  if (members.length < 2) return null;
  const union = unionBbox(members.map((m) => m.frame!));
  const base = makeNode("Container");
  const groupId = `grp_${base.id}`;
  const groupNode = { ...base, id: groupId, props: { ...base.props, maxWidth: "full" } };
  let next = pin(insertNode(doc, groupNode, doc.rootId), groupId, union);
  for (const member of members) next = moveNode(next, member.id, groupId);
  next = reorderGroupBeforeMembers(next, groupId, memberIds);
  return { doc: next, groupId };
}

/** Ungroup: lift every direct child to doc.rootId (append), then removeNode(group). */
export function ungroupNode(doc: Page, groupId: string): Page | null {
  if (!isCanvasGroup(doc, groupId)) return null;
  const group = doc.nodes.find((n) => n.id === groupId)!;
  let next = doc;
  for (const childId of group.children) next = moveNode(next, childId, next.rootId);
  return removeNode(next, groupId);
}

/**
 * Recompute every canvas-group ANCESTOR frame of movedIds to the union bbox
 * of its pin-box descendants; keeps existing rotation. No-op safe: an empty
 * union keeps the old frame. Pure — callers wrap in their own applyOp.
 */
export function refreshGroupFrames(doc: Page, movedIds: readonly string[]): Page {
  let next = doc;
  const groups = new Set<string>();
  for (const movedId of movedIds) {
    for (const ancestor of groupAncestors(doc, movedId)) groups.add(ancestor);
  }
  for (const groupId of groups) next = refreshOneGroup(next, groupId);
  return next;
}

// --- helpers (kept below the public API; each single-purpose) ---

/** Member record for grouping: id + its committed frame. */
interface GroupMember {
  id: string;
  frame: Frame;
}

/** Members are accepted only as DISTINCT root-child pin boxes. */
function eligibleRootPinBoxes(doc: Page, memberIds: readonly string[]): GroupMember[] {
  const rootChildren = new Set(doc.nodes.find((n) => n.id === doc.rootId)?.children ?? []);
  const seen = new Set<string>();
  const members: GroupMember[] = [];
  for (const id of memberIds) {
    if (seen.has(id) || !rootChildren.has(id)) continue;
    seen.add(id);
    const node = doc.nodes.find((n) => n.id === id);
    if (!isPinBox(node)) continue;
    members.push({ id, frame: node!.frame! });
  }
  return members;
}

/** Union bounding box of the given frames (>= 1 frame expected). */
function unionBbox(frames: Frame[]): Frame {
  const minX = Math.min(...frames.map((f) => f.x));
  const minY = Math.min(...frames.map((f) => f.y));
  const maxX = Math.max(...frames.map((f) => f.x + f.w));
  const maxY = Math.max(...frames.map((f) => f.y + f.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0 };
}

/**
 * Splice the group entry to sit right before its first member still in the
 * nodes array (pure reorder of EXISTING entries — no id created/destroyed).
 */
function reorderGroupBeforeMembers(doc: Page, groupId: string, memberIds: readonly string[]): Page {
  const index = new Map(doc.nodes.map((n, i) => [n.id, i]));
  const memberOrder = memberIds
    .map((id) => index.get(id))
    .filter((i): i is number => i !== undefined)
    .sort((a, b) => a - b);
  const firstMemberAt = memberOrder[0];
  if (firstMemberAt === undefined) return doc;
  const groupAt = index.get(groupId);
  if (groupAt === undefined || groupAt < firstMemberAt) return doc;
  const nodes = [...doc.nodes];
  const [group] = nodes.splice(groupAt, 1);
  // Insert before the FIRST member in ARRAY order (same semantics as the
  // guard above) — using the selection-order head (memberIds[0]) would put
  // the group after earlier-painted members when the two orders disagree,
  // and the group box would cover their pointer hit-testing.
  const firstMemberId = nodes[firstMemberAt <= index.get(groupId)! ? firstMemberAt : firstMemberAt - 1]?.id;
  const insertAt = nodes.findIndex((n) => n.id === firstMemberId);
  nodes.splice(insertAt, 0, group!);
  return { ...doc, nodes };
}

/** Pin-box descendants of id (excluding id itself), via the flat children edges. */
function descendantPinBoxes(doc: Page, id: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>([id]);
  const walk = (nodeId: string): void => {
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    for (const childId of node.children) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      const child = doc.nodes.find((n) => n.id === childId);
      if (isPinBox(child)) out.push(childId);
      walk(childId);
    }
  };
  walk(id);
  return out;
}

/** Ancestors of id that are canvas groups (bottom-up). */
function groupAncestors(doc: Page, id: string): string[] {
  const parentOf = new Map<string, string>();
  for (const n of doc.nodes) for (const c of n.children) parentOf.set(c, n.id);
  const groups: string[] = [];
  let cur: string | undefined = id;
  while (cur !== undefined) {
    cur = parentOf.get(cur);
    if (cur !== undefined && isCanvasGroup(doc, cur)) groups.push(cur);
  }
  return groups;
}

/** Recompute ONE group's frame from its pin-box descendants (rotation kept). */
function refreshOneGroup(doc: Page, groupId: string): Page {
  const group = doc.nodes.find((n) => n.id === groupId);
  if (!group || !group.frame) return doc;
  const pinIds = descendantPinBoxes(doc, groupId);
  const frames = pinIds
    .map((id) => doc.nodes.find((n) => n.id === id)?.frame)
    .filter((f): f is Frame => f !== undefined);
  if (frames.length === 0) return doc; // empty union keeps the old frame
  const union = unionBbox(frames);
  return setFrame(doc, groupId, { ...union, rotation: group.frame.rotation });
}
