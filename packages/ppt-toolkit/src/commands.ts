import type { CommandDefinition } from "@studio/studio-core";
import type { PptDocument } from "./document.js";
import { OBJECT_COMMANDS } from "./object-commands.js";
import { SLIDE_COMMANDS } from "./slide-commands.js";

/** All PPT command definitions (slide + object + theme). */
export const PPT_COMMANDS: CommandDefinition<PptDocument>[] = [...SLIDE_COMMANDS, ...OBJECT_COMMANDS];
