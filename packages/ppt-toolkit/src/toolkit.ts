import type { ToolKit } from "@studio/studio-core";
import { PPT_CAPABILITIES, PPT_TOOLKIT_ID, PPT_TOOLKIT_VERSION, pptDocumentAdapter } from "./adapter.js";
import type { PptDocument } from "./document.js";
import { PPT_COMMANDS } from "./commands.js";

export const PPT_TOOLKIT: ToolKit<PptDocument> = {
  id: PPT_TOOLKIT_ID,
  version: PPT_TOOLKIT_VERSION,
  projectType: "ppt",
  document: pptDocumentAdapter,
  commands: PPT_COMMANDS,
  aiTools: [
    {
      id: "ppt.ai.storyline",
      title: "规划幻灯片叙事",
      commandIds: ["slide.add", "slide.remove", "slide.reorder", "slide.rename", "slide.setNotes", "theme.apply"],
    },
    {
      id: "ppt.ai.slide-edit",
      title: "编辑幻灯片",
      commandIds: ["slide.duplicate", "slide.remove", "slide.rename", "slide.applyLayout", "slide.lock", "slide.setNotes", "slide.setBackground"],
    },
    {
      id: "ppt.ai.object-edit",
      title: "编辑幻灯片对象",
      commandIds: [
        "object.add",
        "object.move",
        "object.resize",
        "object.align",
        "object.alignMany",
        "object.distribute",
        "object.editText",
        "object.editShape",
        "object.editImage",
        "object.editVideo",
        "object.editTable",
        "object.editChart",
        "object.group",
        "object.ungroup",
        "object.duplicate",
        "object.reorder",
        "object.remove",
        "object.lock",
      ],
    },
  ],
  importers: [],
  exporters: [],
  inspectors: [],
  capabilities: PPT_CAPABILITIES,
};
