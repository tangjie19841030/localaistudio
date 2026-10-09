import type { CommandDefinition } from "@studio/studio-core";
import type { PptDocument } from "./document.js";
import { OBJECT_EDIT_COMMANDS } from "./object-edit-commands.js";
import { OBJECT_LAYOUT_COMMANDS } from "./object-layout-commands.js";
import { OBJECT_TOPOLOGY_COMMANDS } from "./object-topology-commands.js";

/** All object.* commands aggregated by domain (topology → layout → edit). */
export const OBJECT_COMMANDS: CommandDefinition<PptDocument>[] = [
  ...OBJECT_TOPOLOGY_COMMANDS,
  ...OBJECT_LAYOUT_COMMANDS,
  ...OBJECT_EDIT_COMMANDS,
];
