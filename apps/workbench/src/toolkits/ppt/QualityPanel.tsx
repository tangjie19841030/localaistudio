import { ToolkitQualityPanel, type ToolkitIssue } from "../shared/ToolkitQualityPanel";

/** PPT issue location: slide + object anchors. */
function describeLocation(issue: ToolkitIssue): string {
  const slide = issue.slideId ? `幻灯片 ${issue.slideId}` : "";
  const object = issue.objectId ? `对象 ${issue.objectId}` : "";
  return [slide, object].filter(Boolean).join(" · ");
}

/**
 * PPT quality panel: shared inspect lifecycle (save-first -> POST
 * /inspect/ppt -> issue list) with ppt danger inspectors pinned.
 */
export function QualityPanel() {
  return (
    <ToolkitQualityPanel
      inspectPath="ppt"
      dangerInspectors={["ppt.qc.bounds", "ppt.qc.overlap"]}
      describeLocation={describeLocation}
    />
  );
}
