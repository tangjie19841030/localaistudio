import { collectSubtreeIds, getComponentDef, getNode } from "@studio/schema-core";
import type { Page } from "@studio/schema-core";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fadeItemVariants, useZeroable } from "../motion";
import {
  DndContext,
  KeyboardSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

export interface LayerTreeProps {
  doc: Page;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Multi-selection membership + Shift/Ctrl-click toggle (canvas parity). */
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onRemove: (id: string) => void;
  /** Drop-to-reparent callback; omitted = dragging disabled (graceful no-op). */
  onMove?: (id: string, newParentId: string, index: number) => void;
  /** Indent per depth level, default 16px. */
  indentDepth?: number;
}

interface TreeContextValue {
  doc: Page;
  selectedId: string | null;
  selectedIds?: string[];
  onSelect: (id: string) => void;
  onToggleSelect?: (id: string) => void;
  indentDepth: number;
  onRemove: (id: string) => void;
}

/** Can `id` legally land on `overId`? Mirrors moveNode rules (container target, not own subtree). */
export function canDropOn(doc: Page, id: string, overId: string): boolean {
  if (id === overId) return false;
  if (id === doc.rootId) return false; // root cannot be moved at all
  const target = getNode(doc, overId);
  if (!target) return false;
  const def = getComponentDef(target.type);
  if (!def?.container) return false; // non-container rows are never valid parents
  if (collectSubtreeIds(doc, id).includes(overId)) return false; // own subtree
  return true;
}

/**
 * One tree row: draggable + droppable under the same node id, so a drop on a
 * row reports that row's id as the landing target. Must render INSIDE
 * DndContext (useDraggable reads activators from its InternalContext).
 */
function LayerRow({
  id,
  depth,
  ctx,
  enter,
}: {
  id: string;
  depth: number;
  ctx: TreeContextValue;
  /** Play the fade-in on mount; false for rows returning from a search filter. */
  enter: boolean;
}) {
  const { doc, selectedId, selectedIds, indentDepth, onSelect, onToggleSelect, onRemove } = ctx;
  const node = getNode(doc, id);
  if (!node) return null;
  const fade = useZeroable(fadeItemVariants);
  const def = getComponentDef(node.type);
  const title = def?.title ?? node.type;
  const isRoot = id === doc.rootId;
  const selected = selectedIds ? selectedIds.includes(id) : id === selectedId;

  const drag = useDraggable({ id, disabled: isRoot || !node });
  const drop = useDroppable({ id, disabled: isRoot });
  const isOver = drop.isOver && !selected;

  return (
    <motion.div
      ref={(el: HTMLElement | null) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      variants={fade}
      initial={enter ? "hidden" : false}
      animate="visible"
      role="treeitem"
      aria-selected={selected}
      aria-roledescription="draggable"
      aria-pressed={drag.isDragging || undefined}
      // Node id demoted to hover tooltip; rows show the component title only.
      title={`${title} · ${id}`}
      tabIndex={isRoot ? -1 : (drag.attributes.tabIndex as number)}
      onKeyDown={isRoot ? undefined : (drag.listeners?.onKeyDown as React.KeyboardEventHandler)}
      onClick={(e) => {
        if ((e.shiftKey || e.ctrlKey || e.metaKey) && onToggleSelect) onToggleSelect(id);
        else onSelect(id);
      }}
      className={`studio-transition flex cursor-pointer items-center justify-between rounded-md px-2 py-1 ${
        selected
          ? "bg-accent-soft text-accent"
          : isOver
            ? "bg-rail text-ink"
            : "text-ink-soft hover:bg-rail hover:text-ink"
      }`}
      style={{ paddingLeft: depth * indentDepth + 8 }}
    >
      <span className="min-w-0 truncate">{title}</span>
      {!isRoot && (
        <button
          type="button"
          aria-label={`删除 ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(id);
          }}
          className="studio-transition ml-2 rounded px-1 text-xs text-danger hover:bg-danger-soft"
        >
          ×
        </button>
      )}
    </motion.div>
  );
}

/** Flat pre-order row ids under root (cycle-safe via collectSubtreeIds). */
function flatRowIds(doc: Page): string[] {
  return collectSubtreeIds(doc, doc.rootId);
}

/** Depth lookup keyed by id (root depth 0, cycle-safe). */
function depthMapOf(doc: Page): Map<string, number> {
  const map = new Map<string, number>([[doc.rootId, 0]]);
  const walk = (id: string, depth: number): void => {
    const node = getNode(doc, id);
    if (!node) return;
    for (const childId of node.children) {
      if (map.has(childId)) continue; // cycle guard
      map.set(childId, depth);
      walk(childId, depth + 1);
    }
  };
  walk(doc.rootId, 1);
  return map;
}

/**
 * Filter rows by query while keeping ancestors of matches visible (search
 * must not orphan a hit). Matches component title, node id AND prop text
 * ("会员总数" should find the StatCard that renders it). Empty query = full tree.
 */
export function filterTreeRows(doc: Page, query: string): string[] {
  const all = flatRowIds(doc);
  const q = query.trim().toLowerCase();
  if (!q) return all;
  const keep = new Set<string>();
  for (const id of all) {
    const node = getNode(doc, id);
    if (!node) continue;
    const title = (getComponentDef(node.type)?.title ?? node.type).toLowerCase();
    const propsText = JSON.stringify(node.props ?? {}).toLowerCase();
    const hay = `${title} ${node.id.toLowerCase()} ${propsText}`;
    if (!hay.includes(q)) continue;
    // keep self + every ancestor
    keep.add(id);
    let cur = id;
    for (;;) {
      const parent = doc.nodes.find((n) => n.children.includes(cur));
      if (!parent || keep.has(parent.id)) break;
      keep.add(parent.id);
      cur = parent.id;
    }
  }
  return all.filter((id) => keep.has(id));
}

/** Rows renderer — a child component of DndContext so hooks see its context. */
function TreeBody({ ctx, rows }: { ctx: TreeContextValue; rows: string[] }) {
  const depths = depthMapOf(ctx.doc);
  // Ids ever shown in this tree instance. The first commit fades every row in;
  // afterwards rows returning from a search filter appear instantly, while
  // genuinely new nodes (e.g. AI inserts) still get their entry fade.
  const seenRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seenRef.current) seenRef.current = new Set();
    for (const id of rows) seenRef.current.add(id);
  });
  return (
    <div role="tree" className="text-sm">
      {rows.map((id) => (
        <LayerRow
          key={id}
          id={id}
          depth={depths.get(id) ?? 0}
          ctx={ctx}
          enter={!seenRef.current || !seenRef.current.has(id)}
        />
      ))}
    </div>
  );
}

export function LayerTree({ doc, selectedId, selectedIds, onSelect, onToggleSelect, onRemove, onMove, indentDepth = 16 }: LayerTreeProps) {
  const root = getNode(doc, doc.rootId);
  const sensors = useSensors(useSensor(KeyboardSensor));
  const [query, setQuery] = useState("");
  const rows = useMemo(() => filterTreeRows(doc, query), [doc, query]);
  if (!root) return <p className="text-xs text-ink-muted">文档无根节点</p>;

  /** Drop resolution: reject illegal targets, append under the new parent. */
  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!onMove || !over || active.id === over.id) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (!canDropOn(doc, id, overId)) return;
    const parent = getNode(doc, overId);
    if (!parent) return;
    onMove(id, overId, parent.children.length);
  };

  const ctx: TreeContextValue = { doc, selectedId, selectedIds, indentDepth, onSelect, onToggleSelect, onRemove };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <input
        type="search"
        aria-label="搜索图层"
        placeholder="搜索图层…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="studio-transition h-8 w-full rounded-md border border-hairline bg-surface px-2.5 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {query.trim() && rows.length === 0 ? (
        <p className="text-xs text-ink-muted">无匹配图层</p>
      ) : (
        <DndContext
          sensors={onMove ? sensors : []}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{
            announcements: {
              onDragStart: () => "已拾起，用空格键放下",
              onDragOver: () => "已移动",
              onDragEnd: () => "已放下",
              onDragCancel: () => "已取消",
            },
          }}
        >
          <TreeBody ctx={ctx} rows={rows} />
        </DndContext>
      )}
    </div>
  );
}
