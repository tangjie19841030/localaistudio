import type { Frame, Page } from "@studio/schema-core";
import { zOrder } from "@studio/schema-core";
import { useMemo } from "react";
import { isPinBox } from "./flowNodes";

/**
 * Z-ordered PINNED frame list for the canvas pin layer (Plan C). Only
 * pin-box nodes (`pinned && frame`, the shared R11 predicate) become absolute
 * NodeFrameBox boxes; everything else — unpinned nodes (legacy frames are
 * inert) and the inconsistent pinned-frameless state — renders in the flow
 * layer. Transient frames from an in-flight drag override the committed ones.
 */
export function usePinned(doc: Page, moving: Map<string, Frame> | undefined) {
  return useMemo(() => {
    const list: { id: string; frame: Frame }[] = [];
    for (const id of zOrder(doc)) {
      const node = doc.nodes.find((n) => n.id === id);
      if (!isPinBox(node)) continue;
      list.push({ id, frame: moving?.get(id) ?? node!.frame! });
    }
    return list;
  }, [doc, moving]);
}
