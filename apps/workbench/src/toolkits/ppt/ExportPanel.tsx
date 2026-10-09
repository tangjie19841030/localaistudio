import { ToolkitExportPanel } from "../shared/ToolkitExportPanel";

/**
 * PPT delivery panel: shared export lifecycle (save-first -> POST -> download)
 * with pptx pinned as the primary always-available format.
 */
export function ExportPanel() {
  return <ToolkitExportPanel primaryFormat="pptx" primaryLabel="PPTX" />;
}
