import { nanoid } from "nanoid";
import type { Frame, NodeRecord, Page, StudioDocument, Tokens } from "../document.js";
import { checkPage, checkStudioDocument, frameSchema } from "../document.js";
import { getComponentDef } from "./componentDefs.js";
import { OpError } from "./opError.js";
import { attachPoint, collectSubtreeIds, getNode } from "./treeUtils.js";

export { OpError };

export type ColorKey = keyof Tokens["color"];
export type TokenPath =
  | ["color", ColorKey]
  | ["radius", "card" | "control"]
  | ["spacing", "unit"]
  | ["font", "sans"];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Fresh node id: "n_" + 8 random chars. */
export function newNodeId(): string {
  return `n_${nanoid(8)}`;
}

/** Node factory using registry default props; unknown types throw OpError. */
export function makeNode(type: string, id: string = newNodeId()): NodeRecord {
  const def = getComponentDef(type);
  if (!def) throw new OpError(`未知组件类型 "${type}"`);
  return { id, type, props: { ...def.defaultProps }, children: [] };
}

/** Pure clone of the doc with a replaced nodes array and per-node copies. */
function cloneDoc(doc: Page, editNode: (n: NodeRecord) => NodeRecord): Page {
  return { ...doc, nodes: doc.nodes.map(editNode) };
}

/** Clamp insertion index into parent's children range (after any removal). */
function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

/** Post-op invariant gate: duplicate ids or dangling refs abort the op. */
function assertInvariants(next: Page): void {
  const errors = checkPage(next);
  if (errors.length > 0) throw new OpError(`文档不变量失败: ${errors.join("; ")}`);
}

/**
 * Insert a node (optionally with its full subtree node table) under a container.
 * index omitted = append; out-of-range clamps. Never mutates the input doc.
 */
export function insertNode(
  doc: Page,
  node: NodeRecord,
  parentId: string,
  index?: number,
  subtreeNodes: NodeRecord[] = [],
): Page {
  const parent = getNode(doc, parentId);
  if (!parent) throw new OpError(`父节点 "${parentId}" 不存在`);
  const parentDef = getComponentDef(parent.type);
  if (!parentDef?.container) throw new OpError(`父节点 "${parentId}" (${parent.type}) 不是容器`);

  const ids = new Set(doc.nodes.map((n) => n.id));
  if (ids.has(node.id)) throw new OpError(`节点 ID "${node.id}" 已存在`);
  const incoming = subtreeNodes.length > 0 ? subtreeNodes : [node];
  const incomingIds = new Set(incoming.map((n) => n.id));
  if (incomingIds.size !== incoming.length) throw new OpError("插入的子树中存在重复 ID");
  for (const id of incomingIds) {
    if (ids.has(id)) throw new OpError(`节点 ID "${id}" 已存在`);
  }
  for (const n of incoming) {
    for (const childId of n.children) {
      if (!ids.has(childId) && !incomingIds.has(childId)) {
        throw new OpError(`节点 "${n.id}" 引用了不存在的子节点 "${childId}"`);
      }
    }
  }

  const at = clampIndex(index, parent.children.length);
  const next: Page = cloneDoc(doc, (n) =>
    n.id === parentId ? { ...n, children: [...n.children.slice(0, at), node.id, ...n.children.slice(at)] } : { ...n },
  );
  next.nodes.push(...incoming.map((n) => ({ ...n, children: [...n.children] })));
  assertInvariants(next);
  return next;
}

/**
 * Deep-copy a subtree with fresh ids (copy/paste + duplicate).
 * Returns the remapped root id and every node in the clone (pre-order).
 */
export function cloneSubtree(doc: Page, id: string): { rootId: string; nodes: NodeRecord[] } {
  const target = getNode(doc, id);
  if (!target) throw new OpError(`节点 "${id}" 不存在`);
  const oldIds = collectSubtreeIds(doc, id);
  const idMap = new Map<string, string>();
  for (const oldId of oldIds) idMap.set(oldId, newNodeId());

  const nodes: NodeRecord[] = [];
  for (const oldId of oldIds) {
    const src = getNode(doc, oldId);
    if (!src) throw new OpError(`节点 "${oldId}" 不存在`);
    nodes.push({
      id: idMap.get(oldId)!,
      type: src.type,
      props: JSON.parse(JSON.stringify(src.props ?? {})) as Record<string, unknown>,
      children: src.children.filter((c) => idMap.has(c)).map((c) => idMap.get(c)!),
      ...(src.frame ? { frame: { ...src.frame } } : {}),
      // pinned rides along with frame: a clone that kept the geometry but lost
      // the flag would silently collapse back to flow (Plan C), and the copied
      // frame would become inert dead metadata.
      ...(src.pinned ? { pinned: true } : {}),
      ...(src.locked ? { locked: true } : {}),
    });
  }
  return { rootId: idMap.get(id)!, nodes };
}

/**
 * Duplicate a node (and its subtree) next to the original under the same parent.
 * Canvas frames get a 16px cascade offset so the clone is visibly distinct.
 */
export function duplicateNode(doc: Page, id: string, index?: number): Page {
  if (id === doc.rootId) throw new OpError("不能复制根节点");
  const attach = attachPoint(doc, id);
  if (!attach) throw new OpError(`节点 "${id}" 没有父节点`);
  const clone = cloneSubtree(doc, id);
  const root = clone.nodes.find((n) => n.id === clone.rootId);
  if (!root) throw new OpError(`克隆根节点失败`);
  if (root.frame) {
    root.frame = { ...root.frame, x: root.frame.x + 16, y: root.frame.y + 16 };
  }
  const parent = getNode(doc, attach.parentId);
  const at = index === undefined ? (parent?.children.indexOf(id) ?? -1) + 1 : index;
  return insertNode(doc, root, attach.parentId, at, clone.nodes);
}

/** Remove the node's whole subtree from the tree and the table; the root cannot be removed. */
export function removeNode(doc: Page, id: string): Page {
  const target = getNode(doc, id);
  if (!target) throw new OpError(`节点 "${id}" 不存在`);
  if (id === doc.rootId) throw new OpError("不能删除根节点");

  const doomed = new Set(collectSubtreeIds(doc, id));
  const attach = attachPoint(doc, id);
  const next: Page = cloneDoc(doc, (n) => {
    if (n.id === attach?.parentId) {
      return { ...n, children: n.children.filter((childId) => childId !== id) };
    }
    return { ...n };
  });
  next.nodes = next.nodes.filter((n) => !doomed.has(n.id));
  assertInvariants(next);
  return next;
}

/** Replace node props wholesale after registry validation (zod issues summarized in OpError). */
export function updateProps(doc: Page, id: string, props: unknown): Page {
  const target = getNode(doc, id);
  if (!target) throw new OpError(`节点 "${id}" 不存在`);
  const def = getComponentDef(target.type);
  if (!def) throw new OpError(`未知组件类型 "${target.type}"`);

  // PARTIAL merge: update_props semantics patch one or a few props. Parsing
  // just the patch and REPLACING props reset every omitted prop to defaults
  // (real repro: {color:"red"} silently wiped the button label).
  const patch = props !== null && typeof props === "object" && !Array.isArray(props)
    ? (props as Record<string, unknown>)
    : {};
  const result = def.propsSchema.safeParse({ ...target.props, ...patch });
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new OpError(`props 校验失败 (${target.type}): ${summary}`);
  }
  const next = cloneDoc(doc, (n) => (n.id === id ? { ...n, props: result.data } : { ...n }));
  assertInvariants(next);
  return next;
}

/** Move a node under a new container; moving into own subtree throws. */
export function moveNode(doc: Page, id: string, newParentId: string, index?: number): Page {
  const target = getNode(doc, id);
  if (!target) throw new OpError(`节点 "${id}" 不存在`);
  const parent = getNode(doc, newParentId);
  if (!parent) throw new OpError(`目标父节点 "${newParentId}" 不存在`);
  const parentDef = getComponentDef(parent.type);
  if (!parentDef?.container) throw new OpError(`目标 "${newParentId}" (${parent.type}) 不是容器`);
  if (id === newParentId || collectSubtreeIds(doc, id).includes(newParentId)) {
    throw new OpError(`不能把节点 "${id}" 移入自身或自身后代`);
  }
  if (id === doc.rootId) throw new OpError("不能移动根节点");

  const oldAttach = attachPoint(doc, id);
  const at = clampIndex(index, parent.children.length);
  const next: Page = cloneDoc(doc, (n) => {
    if (n.id === oldAttach?.parentId) {
      return { ...n, children: n.children.filter((childId) => childId !== id) };
    }
    return { ...n };
  });
  const nextNodes = next.nodes.map((n) =>
    n.id === newParentId ? { ...n, children: [...n.children.slice(0, at), id, ...n.children.slice(at)] } : n,
  );
  next.nodes = nextNodes;
  assertInvariants(next);
  return next;
}

const COLOR_KEYS = ["brand", "surface", "text", "muted", "border", "accent", "success", "warning", "danger"] as const;

function tokenProblem(path: TokenPath, value: string | number): string | undefined {
  const [family, key] = path;
  if (family === "color") {
    if (!COLOR_KEYS.includes(key as (typeof COLOR_KEYS)[number])) {
      return `未知的颜色 token 键 "${String(key)}"`;
    }
    if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) {
      return `颜色 token 必须是 #RRGGBB，收到 "${String(value)}"`;
    }
    return undefined;
  }
  if (family === "radius") {
    if (key !== "card" && key !== "control") return `未知的 radius token 键 "${String(key)}"`;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 64) {
      return "radius token 必须是 0-64 的数值";
    }
    return undefined;
  }
  if (family === "spacing") {
    if (key !== "unit") return `未知的 spacing token 键 "${String(key)}"`;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 24) {
      return "spacing.unit token 必须是 1-24 的数值";
    }
    return undefined;
  }
  if (family === "font") {
    if (key !== "sans") return `未知的 font token 键 "${String(key)}"`;
    if (typeof value !== "string" || value.length < 1) {
      return "font token 必须是非空字符串";
    }
    return undefined;
  }
  return `未知的 token 族 "${String(family)}"`;
}

/** Set a single token path on the DOCUMENT-level tokens; key and value both validated at runtime (AI patch input is untrusted). */
export function setToken(doc: StudioDocument, path: TokenPath, value: string | number): StudioDocument {
  const problem = tokenProblem(path, value);
  if (problem) throw new OpError(problem);

  const [family, key] = path;
  const tokens = { ...doc.tokens } as Tokens;
  if (family === "color") {
    tokens.color = { ...tokens.color, [key]: value as string };
  } else if (family === "radius") {
    tokens.radius = { ...tokens.radius, [key]: value as number };
  } else if (family === "spacing") {
    tokens.spacing = { ...tokens.spacing, [key]: value as number };
  } else {
    tokens.font = { ...tokens.font, [key]: value as string };
  }
  const next: StudioDocument = { ...doc, tokens };
  const errors = checkStudioDocument(next);
  if (errors.length > 0) throw new OpError(`文档不变量失败: ${errors.join("; ")}`);
  return next;
}

/** Rename the document; trimmed name must be 1-80 chars. */
export function renameDocument(doc: StudioDocument, name: string): StudioDocument {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new OpError("文档名必须 1-80 个字符");
  return { ...doc, name: trimmed };
}

export function setNodeLocked(doc: Page, id: string, locked: boolean): Page {
  if (!getNode(doc, id)) throw new OpError(`节点 "${id}" 不存在`);
  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      if (node.id !== id) return node;
      if (locked) return { ...node, locked: true };
      const { locked: _locked, ...unlocked } = node;
      return unlocked;
    }),
  };
}

/**
 * Set the free-canvas frame of an existing node. The node MUST already exist —
 * a frame never implicitly creates a node. Validation goes through frameSchema
 * (same zod path as document parsing); out-of-range values throw instead of
 * silently clamping. Idempotent and immutable: new doc + new nodes array + one
 * new node object; untouched nodes keep referential identity (unlike cloneDoc,
 * which copies every node — canvas drag paths rely on the cheap identity).
 */
export function setFrame(doc: Page, id: string, frame: Frame): Page {
  const target = getNode(doc, id);
  if (!target) throw new OpError(`节点 "${id}" 不存在`);

  const result = frameSchema.safeParse(frame);
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new OpError(`frame 校验失败 (${id}): ${summary}`);
  }
  const next: Page = {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === id ? { ...n, frame: result.data } : n)),
  };
  assertInvariants(next);
  return next;
}

/**
 * Pin a node to free (absolute) positioning at PAGE coordinates: sets
 * `pinned: true` and its frame in ONE op, because a pin without geometry would
 * have nothing to place and a frame without a pin is inert under Plan C flow
 * semantics. The node MUST already exist — a pin never implicitly creates a
 * node. Validation goes through frameSchema (same zod path as document
 * parsing); out-of-range values throw instead of silently clamping. Idempotent
 * and immutable with setFrame's referential-identity contract: new doc + new
 * nodes array + one new node object; untouched nodes keep their identity.
 */
export function pin(doc: Page, id: string, frame: Frame): Page {
  const target = getNode(doc, id);
  if (!target) throw new OpError(`节点 "${id}" 不存在`);

  const result = frameSchema.safeParse(frame);
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new OpError(`frame 校验失败 (${id}): ${summary}`);
  }
  const next: Page = {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === id ? { ...n, pinned: true, frame: result.data } : n)),
  };
  assertInvariants(next);
  return next;
}

/**
 * Return a node to flow layout: drops `pinned` AND the frame in one op — a
 * frame left behind would be dead metadata the structure ignores, so unpin is
 * also the cleanup. Idempotent on an already-unpinned node; node existence is
 * checked like every other op. Immutable, same identity contract as setFrame.
 */
export function unpin(doc: Page, id: string): Page {
  if (!getNode(doc, id)) throw new OpError(`节点 "${id}" 不存在`);

  const next: Page = {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== id) return n;
      const { pinned: _pinned, frame: _frame, ...flow } = n;
      return flow;
    }),
  };
  assertInvariants(next);
  return next;
}
