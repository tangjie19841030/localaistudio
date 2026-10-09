import type { WordDocument } from "@studio/word-toolkit";
import { createWordDocumentEnvelope, WORD_TOOLKIT } from "@studio/word-toolkit";
import { executeTransaction, type CommandInvocation } from "@studio/studio-core";
import { create } from "zustand";
import { useAiStore } from "../../state/aiStore";
import { toolkitInvocation, type ToolkitCommand, type ToolkitScope } from "../../features/ai/types";

/** Deep caps mirror the UI editor undo stack (state/undoStack.ts MAX_DEPTH=50). */
const MAX_HISTORY = 50;

let invocationSeq = 0;

/** Monotonic invocation ids keep transactions unique across the session. */
export function nextInvocationId(prefix: string): string {
  invocationSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${invocationSeq}`;
}

/** Manual-source file-scope invocation helper (P10.1 panel edits). */
export function manualInvocation(id: string, args: unknown): CommandInvocation {
  return { invocationId: nextInvocationId(id), id, args, source: "manual", scope: { kind: "file", targetIds: [] } };
}

/** Selection state: a block (or multiple blocks) plus owning section; range reserved. */
export interface WordSelection {
  sectionId: string | null;
  /** Primary block (first of a multi-selection); null = container/file scope. */
  blockId: string | null;
  /** All selected blocks; length > 1 is a multi-block selection. */
  blockIds: string[];
}

/** Local Word editor state: doc snapshot + selection + bounded undo history. */
export interface WordEditorState {
  /** Mirror of editorStore.document narrowed to WordDocument (null before sync). */
  doc: WordDocument | null;
  /** Envelope kept in sync with doc — executeTransaction consumes envelopes. */
  envelopeDoc: WordDocument | null;
  selection: WordSelection;
  error: string | null;
  past: WordDocument[];
  future: WordDocument[];
  /** App wiring: writes the new doc into editorStore + marks dirty. */
  onDocumentChange: ((doc: WordDocument) => void) | null;
  /** Sync incoming document from App props (open/switch/reset); clears history. */
  syncDocument: (doc: WordDocument) => void;
  setOnChange: (cb: (doc: WordDocument) => void) => void;
  setDocumentName: (name: string) => WordDocument | null;
  selectBlock: (blockId: string | null) => void;
  /** Toggle membership of a multi-block selection (Shift/Ctrl-click). */
  toggleBlock: (blockId: string) => void;
  /** Select the whole section (container scope). */
  selectSection: (sectionId: string | null) => void;
  /**
   * Run a manual transaction. On success: doc updates, history pushes,
   * onDocumentChange fires. On failure: error surfaces in Chinese, no state change.
   */
  runCommands: (invocations: readonly CommandInvocation[]) => boolean;
  undo: () => void;
  redo: () => void;
  clearError: () => void;
}

const baseState = {
  doc: null,
  envelopeDoc: null,
  selection: { sectionId: null, blockId: null, blockIds: [] } as WordSelection,
  error: null,
  past: [] as WordDocument[],
  future: [] as WordDocument[],
  onDocumentChange: null as ((doc: WordDocument) => void) | null,
};

/** Keep selected blocks that still exist; drop deleted ones. */
function keepSelection(doc: WordDocument, selection: WordSelection): WordSelection {
  const ids = (selection.blockIds.length > 0 ? selection.blockIds : selection.blockId ? [selection.blockId] : []).filter(
    (id) => doc.blocks.some((block) => block.id === id),
  );
  if (ids.length === 0) return { sectionId: null, blockId: null, blockIds: [] };
  const sectionId = doc.sections.find((candidate) => candidate.blockIds.includes(ids[0]!))?.id ?? null;
  return { sectionId, blockId: ids[0]!, blockIds: ids };
}

export const useWordEditorStore = create<WordEditorState>()((set, get) => ({
  ...baseState,

  syncDocument(doc) {
    if (get().envelopeDoc === doc) return; // same reference: nothing new
    set({
      ...baseState,
      onDocumentChange: get().onDocumentChange,
      doc,
      envelopeDoc: doc,
    });
  },

  setOnChange(cb) {
    set({ onDocumentChange: cb });
  },

  setDocumentName(name) {
    const { doc, past } = get();
    if (!doc) return null;
    if (doc.name === name) return doc;
    const nextDoc = { ...doc, name };
    set({
      doc: nextDoc,
      envelopeDoc: nextDoc,
      past: [...past, doc].slice(-MAX_HISTORY),
      future: [],
      error: null,
    });
    get().onDocumentChange?.(nextDoc);
    return nextDoc;
  },

  selectBlock(blockId) {
    const { doc } = get();
    if (!doc || blockId === null) {
      set({ selection: { sectionId: null, blockId: null, blockIds: [] } });
      return;
    }
    const block = doc.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    const sectionId = doc.sections.find((candidate) => candidate.blockIds.includes(blockId))?.id ?? null;
    set({ selection: { sectionId, blockId, blockIds: [blockId] } });
  },

  toggleBlock(blockId) {
    const { doc, selection } = get();
    if (!doc) return;
    const block = doc.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    const current = selection.blockIds.length > 0 ? selection.blockIds : selection.blockId ? [selection.blockId] : [];
    const ids = current.includes(blockId) ? current.filter((id) => id !== blockId) : [...current, blockId];
    const primary = ids[0] ?? null;
    const sectionId = primary
      ? doc.sections.find((candidate) => candidate.blockIds.includes(primary))?.id ?? null
      : null;
    set({ selection: { sectionId, blockId: primary, blockIds: ids } });
  },

  selectSection(sectionId) {
    set({ selection: { sectionId, blockId: null, blockIds: [] } });
  },

  runCommands(invocations) {
    const { doc, envelopeDoc } = get();
    if (!doc || !envelopeDoc) return false;
    const envelope = createWordDocumentEnvelope(envelopeDoc);
    const result = executeTransaction(WORD_TOOLKIT, envelope, invocations);
    if (!result.ok) {
      set({ error: result.error.message });
      return false;
    }
    const nextDoc = result.envelope.document;
    set({
      doc: nextDoc,
      envelopeDoc: nextDoc,
      error: null,
      past: [...get().past, envelopeDoc].slice(-MAX_HISTORY),
      future: [],
      selection: keepSelection(nextDoc, get().selection),
    });
    get().onDocumentChange?.(nextDoc);
    return true;
  },

  undo() {
    const { doc, past } = get();
    if (!doc || past.length === 0) return;
    const previous = past[past.length - 1]!;
    set({
      doc: previous,
      envelopeDoc: previous,
      past: past.slice(0, -1),
      future: [doc, ...get().future].slice(0, MAX_HISTORY),
      error: null,
      selection: keepSelection(previous, get().selection),
    });
    get().onDocumentChange?.(previous);
  },

  redo() {
    const { doc, future } = get();
    if (!doc || future.length === 0) return;
    const nextDoc = future[0]!;
    set({
      doc: nextDoc,
      envelopeDoc: nextDoc,
      past: [...get().past, doc].slice(-MAX_HISTORY),
      future: future.slice(1),
      error: null,
      selection: keepSelection(nextDoc, get().selection),
    });
    get().onDocumentChange?.(nextDoc);
  },

  clearError() {
    set({ error: null });
  },
}));

/** Command helper bound to the store (components call this, not runCommands). */
export function runWordCommands(invocations: readonly CommandInvocation[]): boolean {
  return useWordEditorStore.getState().runCommands(invocations);
}

/**
 * P7.3 AI applier (registered in App via aiStore.setCommandApplier): replay the
 * done-frame commands — pre-executed on the server's scratch envelope — on the
 * local document in one atomic transaction. Scope comes from the pending plan,
 * i.e. the exact request scope the server ran the commands under. Partial
 * batches pass their request scope explicitly (no pending plan exists yet).
 */
export async function applyWordAiCommands(
  commands: readonly ToolkitCommand[],
  scopeOverride?: ToolkitScope,
): Promise<boolean> {
  const scope = scopeOverride ?? useAiStore.getState().pendingPlan?.scope;
  if (!scope) return false;
  return useWordEditorStore.getState().runCommands(commands.map((c) => toolkitInvocation(c, scope)));
}
