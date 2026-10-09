import type { PptSlide } from "@studio/ppt-toolkit";
import { useLayoutEffect, useState } from "react";
import { manualInvocation, runPptCommands } from "./state";

export interface NotesPanelProps {
  slide: PptSlide | null;
}

/** Bottom bar: speaker notes of the selected slide, committed on blur or Enter. */
export function NotesPanel({ slide }: NotesPanelProps) {
  const [notes, setNotes] = useState(slide?.notes ?? "");

  // Resync before paint when the selected slide (or undo/redo) changes the
  // notes source, so history hops never paint the previous local draft.
  useLayoutEffect(() => {
    setNotes(slide?.notes ?? "");
  }, [slide?.id, slide?.notes]);

  if (!slide) {
    return (
      <footer className="border-t border-hairline bg-rail px-3 py-2 text-xs text-ink-muted">
        无幻灯片
      </footer>
    );
  }

  const commit = () => {
    if (notes === slide.notes) return; // no change: skip the transaction
    runPptCommands([manualInvocation("slide.setNotes", { slideId: slide.id, notes })]);
  };

  return (
    <footer className="flex shrink-0 items-start gap-2 border-t border-hairline bg-rail px-3 py-2">
      <span className="pt-1 text-xs text-ink-muted">备注</span>
      <textarea
        id="ppt-slide-notes"
        aria-label="幻灯片备注"
        className="min-h-10 flex-1 resize-y rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        placeholder="演讲者备注（失焦后保存）"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Enter commits; Shift+Enter keeps the default newline (no commit).
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
      />
    </footer>
  );
}
