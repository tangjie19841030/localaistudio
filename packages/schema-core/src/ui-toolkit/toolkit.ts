import type { ToolKit } from "@studio/studio-core";
import type { StudioDocument } from "../document.js";
import { uiDocumentAdapter, UI_TOOLKIT_ID, UI_TOOLKIT_VERSION } from "./adapter.js";
import { UI_COMMANDS } from "./commands.js";

export const UI_TOOLKIT: ToolKit<StudioDocument> = {
  id: UI_TOOLKIT_ID,
  version: UI_TOOLKIT_VERSION,
  projectType: "ui",
  document: uiDocumentAdapter,
  commands: UI_COMMANDS,
  aiTools: [
    { id: "ui.ai.insert", title: "插入 UI 节点", commandIds: ["ui.insert-node"] },
    {
      id: "ui.ai.modify",
      title: "修改 UI 节点",
      commandIds: ["ui.update-props", "ui.move-node", "ui.remove-node", "ui.duplicate-node", "ui.set-frame", "ui.set-token"],
    },
    { id: "ui.ai.rename", title: "重命名 UI 文档", commandIds: ["ui.rename-document"] },
  ],
  importers: [],
  exporters: [],
  inspectors: [],
  capabilities: [],
};
