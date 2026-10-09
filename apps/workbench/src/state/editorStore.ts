import type { Page, ProjectMeta, StudioDocument } from "@studio/schema-core";
import type { PptDocument } from "@studio/ppt-toolkit";
import type { WordDocument } from "@studio/word-toolkit";
import { OpError, collectSubtreeIds } from "@studio/schema-core";
import {
  addPage,
  activePageOf,
  duplicatePage,
  removePage,
  renamePage,
  replacePage,
} from "@studio/schema-core";
import { create } from "zustand";
import { api, type ProjectBundle } from "../api/client";
import { putDocument, putProjectMeta } from "../db/repo";
import { emptyStack, pushUndo, redoStack, undoStack as stepBack, type UndoStack } from "./undoStack";

export type Viewport = "desktop" | "tablet" | "mobile";

/** Any open project's domain document (P7.3: per-toolkit)。 */
export type EditorDocument = StudioDocument | PptDocument | WordDocument;

export interface EditorState {
  projectId: string | null;
  meta: ProjectMeta | null;
  /** Per-toolkit domain document; UI editing ops only apply to the ui member. */
  document: EditorDocument | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** Node selected in the preview/layer tree; null when nothing is selected. */
  selectedId: string | null;
  /** Multi-selection (canvas). Always contains selectedId when non-empty. */
  selectedIds: string[];
  viewport: Viewport;
  /** Active canvas/preview/AI page; null -> pages[0] via activePageOf (T19 §3.3). */
  activePageId: string | null;
  /** Derived undo/redo availability — kept in sync for reactive UI. */
  canUndo: boolean;
  canRedo: boolean;
  /** Internal history storage; components must not subscribe to this. */
  undoStack: UndoStack;
  openProject: (id: string) => Promise<void>;
  setDocumentName: (name: string) => void;
  save: () => Promise<void>;
  reset: () => void;
  selectNode: (id: string | null) => void;
  /** Multi-selection (canvas marquee / shift-click). */
  selectNodes: (ids: string[]) => void;
  setViewport: (v: Viewport) => void;
  /** Page switch: clears selection (node ids are page-scoped visually). */
  setActivePage: (pageId: string) => void;
  /** Apply a UI document op (no-op + error for non-ui projects); throws inside fn are caught. */
  applyOp: (fn: (doc: StudioDocument) => StudioDocument) => boolean;
  /** Page-scoped op funnel: runs fn on the ACTIVE page, replacePage back,
   *  ONE whole-doc undo entry (same stack/granularity as applyOp, T19 §3.3). */
  applyPageOp: (fn: (page: Page) => Page) => boolean;
  addPage: () => void;
  removePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  duplicatePage: (pageId: string) => void;
  undo: () => boolean;
  redo: () => boolean;
}

// 竞态守卫（epoch）：过期的 openProject/reset 完成后不得回填状态或 Dexie。
// reset 也 bump——同 id 重开时旧请求必须作废（P0 遗留债，对称守卫）。
let epoch = 0;

/** Non-ui projects have no UI editing ops yet — shared no-op guard message (P7.3). */
const NON_UI_OP_ERROR = "该工具包编辑器开发中，暂不支持此操作（仅 UI 项目可编辑）";

/** Narrow the union to the UI document member (pages 是 StudioDocument 独有形状, T19 §3.3). */
export function isUiDoc(document: EditorDocument | null): document is StudioDocument {
  const doc = document as StudioDocument | null;
  return typeof doc === "object" && doc !== null && Array.isArray(doc.pages);
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  projectId: null,
  meta: null,
  document: null,
  dirty: false,
  saving: false,
  error: null,
  selectedId: null,
  selectedIds: [],
  viewport: "desktop",
  activePageId: null,
  canUndo: false,
  canRedo: false,
  undoStack: emptyStack,

  async openProject(id) {
    const seq = ++epoch;
    set({ error: null });
    try {
      const b = await api.getProject(id);
      if (seq !== epoch) return; // 已被更新的 open/reset 取代
      await putProjectMeta(b.meta);
      await putDocument(id, b.document, b.meta.updatedAt);
      set({
        projectId: id,
        meta: b.meta,
        document: b.document,
        dirty: false,
        saving: false,
        selectedId: null,
        selectedIds: [],
        viewport: "desktop",
        activePageId: null,
        canUndo: false,
        canRedo: false,
        undoStack: emptyStack,
      });
    } catch (err) {
      if (seq !== epoch) return;
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setDocumentName(name) {
    const doc = get().document;
    if (!doc) return;
    // 全部三个领域文档都有 name 字段（UI rootId/nodes、PPT slides、Word blocks）。
    set({ document: { ...doc, name }, dirty: true });
  },

  async save() {
    const { projectId, meta, document, dirty, saving } = get();
    if (!projectId || !meta || !document || !dirty || saving) return;
    set({ saving: true, error: null });
    try {
      // document 联合原样回传：server 按项目类型的 toolkit 校验（P7.3）。
      const b = await api.saveProject(projectId, { meta, document } as ProjectBundle);
      await putProjectMeta(b.meta);
      await putDocument(projectId, b.document, b.meta.updatedAt);
      if (get().projectId !== projectId) return; // store 已切走（返回/重开）：过期保存不得回填
      // 丢失更新守卫：保存发起后又发生了编辑（document 引用已变），回写服务端文档
      // 会吞掉在途改动。此时只更新 meta / saving，文档保持本地最新且 dirty 仍为 true。
      const docChanged = get().document !== document;
      // 工具包编辑器持有独立历史。保存成功返回的文档通常只是服务端解码后的
      // 新引用；内容等价时非 UI 项目保留当前引用可避免 Word/PPT 的
      // syncDocument 误清空撤销栈。服务端若做了规范化，则采用回包内容。
      const sameDocument = !docChanged && JSON.stringify(document) === JSON.stringify(b.document);
      const replaceDocument = !docChanged && (isUiDoc(document) || !sameDocument);
      set({
        meta: b.meta,
        saving: false,
        ...(replaceDocument ? { document: b.document, dirty: false } : !docChanged ? { dirty: false } : {}),
      });
      // A shortcut or another editor action can arrive while the request is in
      // flight. Once the first response has released the saving lock, persist
      // the newer in-memory document instead of leaving the user in a dirty
      // state with a stale server copy.
      if (docChanged && get().dirty) await get().save();
    } catch (err) {
      if (get().projectId !== projectId) return; // 过期失败不得在别人的屏幕上显示
      set({ saving: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  reset() {
    ++epoch; // 迟到的 openProject 完成后不得回填（对称守卫）
    set({
      projectId: null,
      meta: null,
      document: null,
      dirty: false,
      saving: false,
      error: null,
      selectedId: null,
      selectedIds: [],
      viewport: "desktop",
      activePageId: null,
      canUndo: false,
      canRedo: false,
      undoStack: emptyStack,
    });
  },

  selectNode(id) {
    set({ selectedId: id, selectedIds: id ? [id] : [] });
  },

  selectNodes(ids) {
    const next = [...new Set(ids)];
    set({ selectedIds: next, selectedId: next[next.length - 1] ?? null });
  },

  setViewport(v) {
    set({ viewport: v });
  },

  setActivePage(pageId) {
    const { document } = get();
    // Unknown id keeps the current resolution (activePageOf falls back to pages[0]).
    if (!isUiDoc(document) || !document.pages.some((p) => p.id === pageId)) return;
    // Node ids are page-scoped visually: a page switch clears the selection.
    set({ activePageId: pageId, selectedId: null, selectedIds: [] });
  },

  applyOp(fn) {
    const { document, undoStack: stack } = get();
    if (!document) return false;
    if (!isUiDoc(document)) {
      // P7.3 防呆：ppt/word 项目的 UI 编辑事务不生效（编辑器面板后续接入）
      set({ error: NON_UI_OP_ERROR });
      return false;
    }
    let next: StudioDocument;
    try {
      next = fn(document);
    } catch (err) {
      if (err instanceof OpError) {
        set({ error: err.reason });
        return false;
      }
      throw err;
    }
    const pushed = pushUndo(stack, document);
    set({
      document: next,
      dirty: true,
      undoStack: pushed,
      canUndo: true,
      canRedo: false,
    });
    return true;
  },

  applyPageOp(fn) {
    const { document, activePageId } = get();
    if (!isUiDoc(document)) return false;
    const page = activePageOf(document, activePageId);
    let nextPage: Page;
    try {
      nextPage = fn(page);
    } catch (err) {
      if (err instanceof OpError) {
        set({ error: err.reason });
        return false;
      }
      throw err;
    }
    return get().applyOp((doc) => replacePage(doc, page.id, nextPage));
  },

  addPage() {
    const n = pageCount(get());
    get().applyOp((doc) => addPage(doc, `页面 ${n + 1}`).doc);
  },

  removePage(pageId) {
    // Last-page delete is a silent no-op (>=1 pages invariant, T19 §3.3).
    if (pageCount(get()) <= 1) return;
    get().applyOp((doc) => removePage(doc, pageId) ?? doc);
    // Deleting the active page falls back to the (new) pages[0].
    const { document, activePageId } = get();
    if (isUiDoc(document) && activePageId === pageId) set({ activePageId: null });
  },

  renamePage(pageId, name) {
    get().applyOp((doc) => renamePage(doc, pageId, name) ?? doc);
  },

  duplicatePage(pageId) {
    // Unknown page id: pageOps returns null -> keep the doc unchanged (no undo entry).
    get().applyOp((doc) => duplicatePage(doc, pageId)?.doc ?? doc);
  },

  undo() {
    const { document, undoStack: stack } = get();
    if (!document) return false;
    if (!isUiDoc(document)) {
      set({ error: NON_UI_OP_ERROR });
      return false;
    }
    const step = stepBack(stack, document);
    if (!step) return false;
    const selectedId = keepIfPresent(get().selectedId, step.doc);
    const selectedIds = get().selectedIds.filter((id) =>
      collectSubtreeIds(step.doc.pages[0]!, step.doc.pages[0]!.rootId).includes(id),
    );
    set({
      document: step.doc,
      dirty: true,
      undoStack: step.stack,
      canUndo: step.stack.past.length > 0,
      canRedo: true,
      selectedId,
      selectedIds,
    });
    return true;
  },

  redo() {
    const { document, undoStack: stack } = get();
    if (!document) return false;
    if (!isUiDoc(document)) {
      set({ error: NON_UI_OP_ERROR });
      return false;
    }
    const step = redoStack(stack, document);
    if (!step) return false;
    const selectedId = keepIfPresent(get().selectedId, step.doc);
    const selectedIds = get().selectedIds.filter((id) =>
      collectSubtreeIds(step.doc.pages[0]!, step.doc.pages[0]!.rootId).includes(id),
    );
    set({
      document: step.doc,
      dirty: true,
      undoStack: step.stack,
      canUndo: true,
      canRedo: step.stack.future.length > 0,
      selectedId,
      selectedIds,
    });
    return true;
  },
}));

/** Selection survives a history hop only when the id is still reachable from the root. */
function keepIfPresent(selectedId: string | null, doc: StudioDocument): string | null {
  if (selectedId === null) return null;
  const page = doc.pages[0]!;
  return collectSubtreeIds(page, page.rootId).includes(selectedId) ? selectedId : null;
}

/** Page count of the current UI document; 0 when absent/non-ui. */
function pageCount(state: { document: EditorDocument | null }): number {
  return isUiDoc(state.document) ? state.document.pages.length : 0;
}
