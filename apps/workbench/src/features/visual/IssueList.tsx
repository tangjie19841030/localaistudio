import {
  ISSUE_KIND_LABELS,
  ISSUE_KINDS,
  type Issue,
  type IssueKind,
  type IssueSummary,
} from "@studio/schema-core";

export interface IssueListProps {
  issues: Issue[];
  summary: IssueSummary | null;
}

/** Group issues by kind, preserving ISSUE_KINDS order and dropping empty kinds. */
function groupByKind(issues: Issue[]): { kind: IssueKind; items: Issue[] }[] {
  return ISSUE_KINDS.map((kind) => ({ kind, items: issues.filter((i) => i.kind === kind) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Selector text for one issue: single selector, or the two colliding ones. */
function selectorText(issue: Issue): string | null {
  if (issue.selectors) return `${issue.selectors[0]} ↔ ${issue.selectors[1]}`;
  return issue.selector ?? null;
}

/** Issue list pane: summary counts + issues grouped by kind, error red / warn amber. */
export function IssueList({ issues, summary }: IssueListProps) {
  const groups = groupByKind(issues);

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <p className="shrink-0 text-xs text-ink-soft">
        {summary ? (
          <>
            共 {summary.total} 项 · <span className="font-medium text-danger">错误 {summary.errorCount}</span> ·{" "}
            <span className="font-medium text-warn">警告 {summary.warnCount}</span>
          </>
        ) : (
          "尚无本地质检结果。"
        )}
      </p>
      {groups.length === 0 ? (
        <p className="text-xs text-ink-muted">{summary ? "无问题" : "运行本地质检后此处显示问题清单。"}</p>
      ) : (
        <ul aria-label="问题清单" className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
          {groups.map((g) => (
            <li key={g.kind}>
              <p className="text-xs font-medium text-ink">
                {ISSUE_KIND_LABELS[g.kind]}（{g.items.length}）
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5 pl-2">
                {g.items.map((issue, i) => (
                  <li
                    key={`${g.kind}-${i}`}
                    className={`text-xs ${
                      issue.severity === "error" ? "text-danger" : "text-warn"
                    }`}
                  >
                    <span className="text-ink-muted">[{issue.viewport}]</span> {issue.message}
                    {selectorText(issue) && (
                      <span className="ml-1 font-mono text-ink-muted">{selectorText(issue)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
