import type { NodeRecord, StudioDocument } from "@studio/schema-core";
import { activePageOf, getComponentDef } from "@studio/schema-core";

/**
 * W1-A selection-aware quick actions: chips + outbound summary prefix.
 * Pure functions only — no store or React imports — so both the chips row
 * (AiChatPanel) and the composer prefix (Composer) stay independently testable.
 */

/** One quick-action chip: the label the user clicks and the text it prefills. */
export interface SelectionChip {
  label: string;
  /** Full text delivered to the composer on click. */
  text: string;
}

interface ChipRule {
  /** Registry types this rule applies to. */
  types: readonly string[];
  /** label -> instruction template; {label} placeholders resolve from node props. */
  actions: readonly { label: string; text: string }[];
}

/**
 * Per-type quick actions. Text is a ready-to-send patch instruction — modeFor()
 * turns a selection + this wording into a scoped patch (no target markers
 * needed here; the send path appends them).
 */
const CHIP_RULES: readonly ChipRule[] = [
  {
    types: ["Button"],
    actions: [
      { label: "改标题", text: "修改按钮标题文案" },
      { label: "换色调", text: "把这个按钮换成强调色风格" },
      { label: "改大小", text: "把这个按钮改大一号" },
    ],
  },
  {
    types: ["Card", "Section", "StatCard", "PricingCard"],
    actions: [
      { label: "加阴影", text: "给这个卡片加一层柔和阴影效果" },
      { label: "更紧凑", text: "把这个卡片内部改得更紧凑（缩小内边距与间距）" },
      { label: "改标题", text: "修改这个卡片的标题文案" },
    ],
  },
  {
    types: ["Heading", "Text"],
    actions: [
      { label: "改文案", text: "修改这段文字的内容" },
      { label: "改字号", text: "把这段文字字号调大一级" },
    ],
  },
  {
    types: ["Table", "List", "KeyValList"],
    actions: [
      { label: "加一列", text: "给这个表格增加一列数据" },
      { label: "改标题行", text: "修改这个表格的列标题" },
    ],
  },
  {
    types: ["Input", "Select", "Textarea", "SearchInput"],
    actions: [
      { label: "改占位符", text: "修改这个输入框的占位提示文字" },
      { label: "改标签", text: "修改这个输入框的标签文字" },
    ],
  },
  {
    types: ["Grid", "Stack", "MetricGrid", "Container"],
    actions: [
      { label: "改间距", text: "调整这个容器的内部间距（更宽松）" },
      { label: "改列数", text: "调整这个栅格的列数" },
    ],
  },
  {
    types: ["Image", "Avatar"],
    actions: [
      { label: "换比例", text: "调整这个图片为圆角更大的展示比例" },
      { label: "改描述", text: "修改这个图片的替代文字描述" },
    ],
  },
];

/** Fallback actions for any registered type without a dedicated rule. */
const GENERIC_ACTIONS: readonly { label: string; text: string }[] = [
  { label: "换色调", text: "把这个组件换成强调色风格" },
  { label: "改文案", text: "修改这个组件的文字内容" },
];

/** Max chips rendered per selection (keeps the row one line). */
export const MAX_CHIPS = 4;

/** Registry type -> its chip rule; unresolved types fall back to GENERIC_ACTIONS. */
const RULE_BY_TYPE: ReadonlyMap<string, ChipRule> = (() => {
  const map = new Map<string, ChipRule>();
  for (const rule of CHIP_RULES) for (const type of rule.types) map.set(type, rule);
  return map;
})();

/** Resolve the quick actions for one node type (dedicated rule or generic). */
function actionsForType(type: string): readonly { label: string; text: string }[] {
  return RULE_BY_TYPE.get(type)?.actions ?? GENERIC_ACTIONS;
}

/**
 * Quick-action chips for the current selection. Multi-select uses the first
 * node's type (same primary-node convention as the scope chip); unknown or
 * unregistered types fall back to the generic pair. Empty selection -> [].
 */
export function selectionChips(nodes: NodeRecord[]): SelectionChip[] {
  const primary = nodes[0];
  if (!primary) return [];
  const actions = actionsForType(primary.type).slice(0, MAX_CHIPS);
  return actions.map((a) => ({ label: a.label, text: a.text }));
}

/** Props worth echoing in the summary, in priority order. */
const SUMMARY_PROP_KEYS = ["title", "label", "text", "content", "value", "placeholder"] as const;

/** First meaningful string prop among SUMMARY_PROP_KEYS (short, single line). */
function summaryProp(node: NodeRecord): string | null {
  for (const key of SUMMARY_PROP_KEYS) {
    const value = node.props[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/** Hard cap for the whole summary line (one line in the composer, spec W1-A). */
const SUMMARY_MAX = 120;

/**
 * One-line selection summary prefixed onto outbound text: node type
 * (Chinese title from the registry) + key props. Truncated with an ellipsis
 * so a pathological prop cannot flood the request.
 */
export function selectionSummary(nodes: NodeRecord[]): string | null {
  const primary = nodes[0];
  if (!primary) return null;
  const typeTitle = getComponentDef(primary.type)?.title ?? primary.type;
  const propText = summaryProp(primary);
  const multi = nodes.length > 1 ? ` 等 ${nodes.length} 个节点` : "";
  const line = propText ? `${typeTitle}「${propText}」${multi}` : `${typeTitle}${multi}`;
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX)}…` : line;
}

/**
 * Outbound prefix for a send: `【选中：…】` + the user text. Selection-aware
 * modeFor() keeps working because the prefix contains no target:/move: syntax.
 */
export function withSelectionPrefix(nodes: NodeRecord[], text: string): string {
  const summary = selectionSummary(nodes);
  return summary ? `【选中：${summary}】${text}` : text;
}

/**
 * Collect selected nodes in document order (missing ids are skipped). The node
 * table follows the ACTIVE page (G1): pageId selects it, null/absent falls back
 * to pages[0]. Stale ids — present on another page or nowhere — resolve to
 * nothing here, never to a same-named node on a different page.
 */
export function selectedNodes(
  doc: StudioDocument | null,
  ids: string[],
  pageId?: string | null,
): NodeRecord[] {
  if (!doc || ids.length === 0) return [];
  const byId = new Map(activePageOf(doc, pageId ?? null).nodes.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)).filter((n): n is NodeRecord => Boolean(n));
}
