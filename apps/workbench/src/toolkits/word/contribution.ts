import { WordEditorPanel } from "./WordEditorPanel";

/**
 * Word toolkit workbench contribution (P10.1).
 * App.tsx consumes editorPanel for projectType === "word".
 */
export const wordContribution = { editorPanel: WordEditorPanel };

// P10.2 finishing panels (appended; mounting is the coordinator's step).
export { ExportPanel } from "./ExportPanel";
export { QualityPanel } from "./QualityPanel";
export { PrintPreview } from "./PrintPreview";
