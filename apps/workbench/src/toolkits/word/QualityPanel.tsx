import { ToolkitQualityPanel, type ToolkitIssue } from "../shared/ToolkitQualityPanel";

/** Word issue location: block (+comment) anchors. */
function describeLocation(issue: ToolkitIssue): string {
  const block = issue.blockId ? `块 ${issue.blockId}` : "";
  return block;
}

/**
 * Word quality panel: shared inspect lifecycle (save-first -> POST
 * /inspect/word -> issue list) with word danger inspectors pinned. The
 * save-first step is the unified behavior — the previous word-only copy
 * skipped it and inspected a stale saved revision.
 */
export function QualityPanel() {
  return (
    <ToolkitQualityPanel
      inspectPath="word"
      dangerInspectors={["word.qc.comment-ref"]}
      describeLocation={describeLocation}
    />
  );
}
