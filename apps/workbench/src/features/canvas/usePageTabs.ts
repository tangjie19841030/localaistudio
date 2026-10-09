import { useCallback, useMemo } from "react";
import type { StudioDocument } from "@studio/schema-core";
import { useEditorStore } from "../../state/editorStore";

/**
 * Page tab state/commands (T19 §3.4): a thin view-model over the store's
 * multi-page document. Resolution only — the component/hook never owns the
 * store; every callback delegates to an editorStore page action.
 */

export interface UsePageTabsArgs {
  doc: StudioDocument;
  activePageId: string | null;
}

export interface PageTabsApi {
  pages: { id: string; name: string }[];
  /** Resolved active page id (never null; unknown id falls back to pages[0]). */
  activeId: string;
  /** Delete affordance only when more than one page exists. */
  canRemove: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}

/** Empty view-model for callers that must run the hook unconditionally
 *  (rules of hooks) while no UI document is open. Renders nothing usable —
 *  App only threads `tabs` when a ui document is open. */
const EMPTY: PageTabsApi = {
  pages: [],
  activeId: "",
  canRemove: false,
  onSelect: (id) => useEditorStore.getState().setActivePage(id),
  onAdd: () => useEditorStore.getState().addPage(),
  onRename: (id, name) => useEditorStore.getState().renamePage(id, name),
  onDuplicate: (id) => useEditorStore.getState().duplicatePage(id),
  onRemove: (id) => useEditorStore.getState().removePage(id),
};

export function usePageTabs(args: UsePageTabsArgs): PageTabsApi {
  const { doc, activePageId } = args;

  const pages = useMemo(() => doc.pages.map((p) => ({ id: p.id, name: p.name })), [doc.pages]);
  // activePageOf mirror: unknown/null id falls back to pages[0] (never throws).
  const activeId = doc.pages.some((p) => p.id === activePageId)
    ? activePageId!
    : doc.pages[0]?.id ?? "";

  const onSelect = useCallback((id: string) => useEditorStore.getState().setActivePage(id), []);
  const onAdd = useCallback(() => useEditorStore.getState().addPage(), []);
  const onRename = useCallback(
    (id: string, name: string) => useEditorStore.getState().renamePage(id, name),
    [],
  );
  const onDuplicate = useCallback(
    (id: string) => useEditorStore.getState().duplicatePage(id),
    [],
  );
  const onRemove = useCallback((id: string) => useEditorStore.getState().removePage(id), []);

  return { pages, activeId, canRemove: doc.pages.length > 1, onSelect, onAdd, onRename, onDuplicate, onRemove };
}
