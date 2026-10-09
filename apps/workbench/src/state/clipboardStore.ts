import { cloneSubtree, type NodeRecord } from "@studio/schema-core";
import { create } from "zustand";

/** Clipboard payload: one cloned subtree ready to re-insert with fresh ids on paste. */
export interface ClipboardPayload {
  /** New root id of the cloned subtree. */
  rootId: string;
  /** All nodes in the clone (root included). */
  nodes: NodeRecord[];
  /** Display label for the palette/toast. */
  label: string;
  /** Source type for filtering paste targets. */
  type: string;
}

interface ClipboardState {
  payload: ClipboardPayload | null;
  /** Capture a live document node into the clipboard (deep clone, fresh ids). */
  copyFromDoc: (doc: Parameters<typeof cloneSubtree>[0], nodeId: string, label: string) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>()((set) => ({
  payload: null,
  copyFromDoc(doc, nodeId, label) {
    try {
      const clone = cloneSubtree(doc, nodeId);
      const type = clone.nodes.find((n) => n.id === clone.rootId)?.type ?? "node";
      set({ payload: { ...clone, label, type } });
    } catch {
      // Invalid node (missing/root): leave clipboard untouched.
    }
  },
  clear() {
    set({ payload: null });
  },
}));
