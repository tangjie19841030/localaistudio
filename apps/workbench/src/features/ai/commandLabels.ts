import { PPT_TOOLKIT } from "@studio/ppt-toolkit";
import { WORD_TOOLKIT } from "@studio/word-toolkit";

/**
 * Human-readable Chinese labels for the tool names seen on tool-call SSE
 * frames. Toolkit commands already carry a `title` in their shared package
 * definition, so PPT/Word labels are derived from the toolkit registries
 * (no protocol change needed); UI agent tools only have a description, so a
 * small built-in phrase table covers them.
 */
export type CommandDomain = "ui" | "ppt" | "word";

/** UI agent-loop tool names (packages/schema-core/src/agent/tools.ts). */
const UI_TOOL_LABELS: Record<string, string> = {
  read_document: "读取文档",
  list_components: "查询可用组件",
  insert_node: "插入节点",
  update_props: "修改节点属性",
  remove_node: "删除节点",
  move_node: "移动节点",
  set_frame: "调整位置与尺寸",
  set_token: "设置设计变量",
  propose_document: "生成整页方案",
};

function toolkitLabelMap(toolkit: { commands: { id: string; title: string }[]; aiTools?: { id: string; title: string }[] }): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of toolkit.commands) map.set(c.id, c.title);
  // Aggregate AI tools (e.g. ppt.ai.storyline) — defensively mapped in case a
  // frame ever carries the aggregate id instead of the concrete command id.
  for (const t of toolkit.aiTools ?? []) map.set(t.id, t.title);
  return map;
}

const PPT_LABELS = toolkitLabelMap(PPT_TOOLKIT);
const WORD_LABELS = toolkitLabelMap(WORD_TOOLKIT);

/** Last-resort: turn a raw id ("slide.add") into a less technical fallback. */
function humanizeId(name: string): string {
  const tail = name.split(".").pop() ?? name;
  return tail.replace(/[-_]+/g, " ");
}

/**
 * Map a tool-call frame name to a Chinese action label.
 * Falls back to the id's tail segment, then the raw id — never throws.
 */
export function commandLabel(domain: CommandDomain, name: string): string {
  if (domain === "ui") return UI_TOOL_LABELS[name] ?? humanizeId(name);
  const map = domain === "ppt" ? PPT_LABELS : WORD_LABELS;
  return map.get(name) ?? humanizeId(name);
}
