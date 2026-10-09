import { ToolkitExportPanel } from "../shared/ToolkitExportPanel";

/**
 * Word delivery panel: shared export lifecycle (save-first -> POST -> download)
 * with docx pinned as the primary always-available format.
 */
export function ExportPanel() {
  return <ToolkitExportPanel primaryFormat="docx" primaryLabel="DOCX" />;
}
