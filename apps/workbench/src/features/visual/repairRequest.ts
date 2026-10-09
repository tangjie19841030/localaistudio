import {
  affectedStudioIds,
  ISSUE_KIND_LABELS,
  ISSUE_KINDS,
  type Issue,
  type ViewportName,
} from "@studio/schema-core";

const VIEWPORT_LABEL: Record<ViewportName, string> = {
  desktop: "桌面 1440×900",
  tablet: "平板 1024×768",
  mobile: "手机 390×844",
};

export interface RepairRequestInput {
  issues: Issue[];
  /** Screenshot data URLs in display order; attached as multimodal inputs. */
  shotDataUrls: string[];
}

export interface RepairRequest {
  /** Chinese prompt: grouped issue list + the scope rule the model must obey. */
  text: string;
  images: string[];
  /** Deduped Schema node ids the patch may touch (scope.nodeIds). */
  nodeIds: string[];
}

/** Selector text for one issue: single selector, or the two colliding ones. */
function selectorOf(issue: Issue): string {
  if (issue.selectors) return `${issue.selectors[0]} ↔ ${issue.selectors[1]}`;
  return issue.selector ?? "（无选择器）";
}

/** One bullet: severity + viewport + message + selector + mapped node ids. */
function issueLine(issue: Issue): string {
  const severity = issue.severity === "error" ? "错误" : "警告";
  const nodes = issue.studioIds?.length ? ` 节点=${issue.studioIds.join(",")}` : "";
  return `  - [${severity}][${VIEWPORT_LABEL[issue.viewport]}] ${issue.message} 选择器=${selectorOf(
    issue,
  )}${nodes}`;
}

/** Grouped bullets, ISSUE_KINDS order, empty kinds dropped. */
function issueSection(issues: Issue[]): string[] {
  const lines: string[] = [];
  for (const kind of ISSUE_KINDS) {
    const items = issues.filter((i) => i.kind === kind);
    if (items.length === 0) continue;
    lines.push(`${ISSUE_KIND_LABELS[kind]}（${items.length} 项）：`);
    for (const item of items) lines.push(issueLine(item));
  }
  return lines;
}

/** Scope rule paragraph; wording differs when no node could be mapped. */
function scopeSection(nodeIds: string[]): string[] {
  if (nodeIds.length === 0) {
    return [
      "问题未能映射到具体 Schema 节点，请只针对上述选择器涉及的最小范围提出修改，不要重建页面。",
    ];
  }
  return [
    `只允许修改这些 Schema 节点（共 ${nodeIds.length} 个）：${nodeIds.join("、")}`,
    "不得新增、删除或修改列表之外的任何节点，也不要改动 rootId 与 documentVersion。",
  ];
}

/** Cap listed issues so the user bubble + model context stay readable. */
const MAX_LISTED_ISSUES = 12;

/**
 * Build the "发给 AI 修复" payload from an audit result.
 * Pure: no IO, no store access — the caller supplies already-fetched data URLs.
 */
export function buildRepairRequest(input: RepairRequestInput): RepairRequest {
  const { issues, shotDataUrls } = input;
  const nodeIds = affectedStudioIds(issues);
  const listed = issues.slice(0, MAX_LISTED_ISSUES);
  const overflow = issues.length - listed.length;
  const text = [
    `请修复本地质检发现的 ${issues.length} 个界面问题。附图为实际渲染截图，问题清单如下：`,
    ...issueSection(listed),
    ...(overflow > 0 ? [`…另有 ${overflow} 项同类问题未列出，请一并处理。`] : []),
    ...scopeSection(nodeIds),
    "输出最小必要的 patch ops，逐条说明每个操作对应哪个问题。",
  ].join("\n");
  return { text, images: [...shotDataUrls], nodeIds };
}
