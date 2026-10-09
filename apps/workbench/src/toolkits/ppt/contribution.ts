import type { PptDocument } from "@studio/ppt-toolkit";
import type { ComponentType } from "react";
import { PptEditorPanel } from "./PptEditorPanel";

/**
 * Workbench-side PPT toolkit contribution (P9.1).
 *
 * Registration shape for the future toolkits/registry.ts extension: the
 * registry stays untouched this round; consumers (App wiring) import this
 * object directly so later registry work only flips to a map lookup.
 */
export interface ToolkitContribution {
  projectType: "ppt";
  /** Editor panel component mounted into the editorSlot for ppt projects. */
  editorPanel: ComponentType<{
    document: PptDocument;
    meta: import("@studio/schema-core").ProjectMeta;
    onDocumentChange: (deck: PptDocument) => void;
  }>;
}

export const pptContribution: ToolkitContribution = {
  projectType: "ppt",
  editorPanel: PptEditorPanel,
};

// P9.2 finishing panels (appended; mounting is the coordinator's step).
export { ExportPanel } from "./ExportPanel";
export { QualityPanel } from "./QualityPanel";
export { PresenterView } from "./PresenterView";
