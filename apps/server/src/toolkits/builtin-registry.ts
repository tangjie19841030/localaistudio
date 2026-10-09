import { ToolKitRegistry } from "@studio/studio-core";
import { UI_TOOLKIT } from "@studio/schema-core";
import { PPT_TOOLKIT } from "@studio/ppt-toolkit";
import { WORD_TOOLKIT } from "@studio/word-toolkit";

/**
 * P7.3: server-side registry of first-party toolkits.
 *
 * UI/PPT/Word all register now — `createProject` accepts all three
 * project types, and PUT/save validates the document with each
 * toolkit's own DocumentAdapter (see store/projects.ts).
 */
export function createBuiltinToolKitRegistry(): ToolKitRegistry {
  return new ToolKitRegistry([UI_TOOLKIT, PPT_TOOLKIT, WORD_TOOLKIT]);
}
