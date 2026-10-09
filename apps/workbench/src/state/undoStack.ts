import type { StudioDocument } from "@studio/schema-core";

/** Bounded undo history; the current document always lives in the store, not here. */
export interface UndoStack {
  past: StudioDocument[];
  future: StudioDocument[];
}

export const emptyStack: UndoStack = { past: [], future: [] };

const MAX_DEPTH = 50;

/**
 * Record the pre-op document. Future is cleared (a new edit invalidates the redo branch).
 * Past is capped at MAX_DEPTH, dropping the oldest entry (FIFO).
 */
export function pushUndo(stack: UndoStack, doc: StudioDocument): UndoStack {
  const past = [...stack.past, doc];
  if (past.length > MAX_DEPTH) past.splice(0, past.length - MAX_DEPTH);
  return { past, future: [] };
}

/** Step back: returns the previous document and the mutated stack, or null when at the origin. */
export function undoStack(stack: UndoStack, current: StudioDocument): { stack: UndoStack; doc: StudioDocument } | null {
  if (stack.past.length === 0) return null;
  const past = [...stack.past];
  const doc = past.pop();
  if (doc === undefined) return null;
  return { stack: { past, future: [current, ...stack.future] }, doc };
}

/** Step forward: mirror of undoStack; null when there is nothing to redo. */
export function redoStack(stack: UndoStack, current: StudioDocument): { stack: UndoStack; doc: StudioDocument } | null {
  if (stack.future.length === 0) return null;
  const [doc, ...future] = stack.future;
  if (doc === undefined) return null;
  return { stack: { past: [...stack.past, current], future }, doc };
}
