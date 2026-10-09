import type { Page, Rect, StudioDocument } from "@studio/schema-core";
import { useMemo } from "react";
import type { AlignMode, DistributeMode } from "./alignOps";
import { alignBounds, alignFrames, alignTargets, applyFrameSet, distributeFrames } from "./alignOps";
import type { ApplyOp } from "./canvasCommit";
import { groupNodes, isCanvasGroup, ungroupNode } from "./canvasGroupOps";
import { replacePage } from "@studio/schema-core";
import { isRootChild } from "./flowNodes";
import { isUiDoc, useEditorStore } from "../../state/editorStore";

/**
 * Align/group availability + handlers (T13). Pure derivation from doc /
 * selection; every action lands as ONE applyOp (one undo entry). Geometry
 * itself lives in alignOps — this hook only wires selection state to it.
 *
 * Group/ungroup post-op selection mirrors the keyboard pattern (T14): the op
 * is synchronous, so the store document reference is read right after the
 * call to learn what changed (groupNodes mints the group id inside the op).
 */

export interface UseCanvasAlignArgs {
  doc: Page;
  selectedId: string | null;
  selectedIds: string[];
  page: Rect;
  applyOp: ApplyOp;
}

export interface CanvasAlignApi {
  /** AlignBar mounts only when >= 1 pin box in selection. */
  visible: boolean;
  /** Distribute needs >= 3 targets. */
  canDistribute: boolean;
  /** Root-child pin boxes in selection >= 2. */
  canGroup: boolean;
  /** Exactly one selected id and it is a canvas group. */
  canUngroup: boolean;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (mode: DistributeMode) => void;
  /** Success -> selectNodes([groupId]). */
  onGroup: () => void;
  /** Success -> selectNodes(members). */
  onUngroup: () => void;
}

/** Root-child pin boxes among the selection (grouping candidates). */
function rootPinBoxSelection(doc: Page, ids: readonly string[]): string[] {
  return ids.filter((id) => isRootChild(doc, id) && alignTargets(doc, [id]).has(id));
}

/** New node ids present after the op but not before (the minted group id). */
function addedNodeIds(before: Page, after: Page): string[] {
  const known = new Set(before.nodes.map((n) => n.id));
  return after.nodes.filter((n) => !known.has(n.id)).map((n) => n.id);
}

export function useCanvasAlign(args: UseCanvasAlignArgs): CanvasAlignApi {
  const { doc, selectedId, selectedIds, page, applyOp } = args;
  // T19: alignment/group ops stay page-scoped; applyOp is doc-level so each
  // write splices the page back as ONE undo entry.
  const pageId = doc.id;

  return useMemo(() => {
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    const targets = alignTargets(doc, ids);
    const rootPins = rootPinBoxSelection(doc, ids);
    const singleId = ids.length === 1 ? ids[0]! : null;
    const bounds = alignBounds(targets, page);

    const onAlign = (mode: AlignMode) => {
      if (targets.size === 0) return;
      const frames = alignFrames(targets, mode, bounds);
      applyOp((d) => replacePage(d, pageId, applyFrameSet(d.pages[0]!, frames)));
    };

    const onDistribute = (mode: DistributeMode) => {
      if (targets.size < 3) return;
      const frames = distributeFrames(targets, mode, bounds);
      if (frames.size === 0) return;
      applyOp((d) => replacePage(d, pageId, applyFrameSet(d.pages[0]!, frames)));
    };

    const onGroup = () => {
      if (rootPins.length < 2) return;
      applyOp((d) => { const g = groupNodes(d.pages[0]!, rootPins); return g ? replacePage(d, pageId, g.doc) : d; });
      const state = useEditorStore.getState();
      if (!isUiDoc(state.document)) return;
      const after = state.document;
      // Select the minted group: the new root-child canvas group id (T19: node
      // tables are page-scoped; single-page doc today).
      const afterPage = after.pages.find((pg) => pg.id === pageId) ?? after.pages[0]!;
      const newGroupId = addedNodeIds(afterPage, afterPage).find((id) => isCanvasGroup(afterPage, id));
      if (newGroupId) state.selectNodes([newGroupId]);
    };

    const onUngroup = () => {
      if (!singleId || !isCanvasGroup(doc, singleId)) return;
      const members = doc.nodes.find((n) => n.id === singleId)?.children ?? [];
      applyOp((d) => { const u = ungroupNode(d.pages[0]!, singleId); return u ? replacePage(d, pageId, u) : d; });
      const state = useEditorStore.getState();
      if (!isUiDoc(state.document) || members.length === 0) return;
      state.selectNodes([...members]);
    };

    return {
      visible: targets.size > 0,
      canDistribute: targets.size >= 3,
      canGroup: rootPins.length >= 2,
      canUngroup: singleId !== null && isCanvasGroup(doc, singleId),
      onAlign,
      onDistribute,
      onGroup,
      onUngroup,
    };
  }, [doc, selectedId, selectedIds, page, applyOp]);
}
