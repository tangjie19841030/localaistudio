/**
 * a11y detectors split out from audit.ts so the parent stays under the 400-line
 * budget (T24c fix round 1). Pure — every detector takes the per-viewport
 * metrics and returns zero or more issues. Severity comes from the shared
 * ISSUE_KIND_SEVERITY table in audit.ts, never hard-coded here. Order in
 * `a11yDetectors` mirrors the original auditPage() invocation order so issue
 * ordering stays stable across the split.
 */
import type { A11yElementMetric, Issue, IssueKind, PageMetrics } from "./audit.js";
import { ISSUE_KIND_SEVERITY } from "./audit.js";

/**
 * Same `issue()` helper as in audit.ts (drops empty studioIds so equality
 * checks stay simple). Kept private here so audit.ts owns the public export.
 */
function issue(base: Issue & { studioIds?: string[] }): Issue {
  if (base.studioIds && base.studioIds.length === 0) {
    const { studioIds: _drop, ...rest } = base;
    return rest;
  }
  return base;
}

/** Builds an a11y element issue whose severity comes from the shared table. */
function elementIssue(
  m: PageMetrics,
  kind: IssueKind,
  metric: A11yElementMetric,
  message: string,
): Issue {
  return issue({
    kind,
    viewport: m.viewport,
    severity: ISSUE_KIND_SEVERITY[kind],
    message,
    selector: metric.selector,
    studioIds: metric.studioId ? [metric.studioId] : [],
  });
}

function detectA11yImageAlt(m: PageMetrics): Issue[] {
  const issues: Issue[] = [];
  for (const el of m.a11y) {
    if (el.kind !== "image") continue;
    if (el.accessibleName.trim() !== "") continue;
    issues.push(
      elementIssue(m, "a11y-image-alt", el, `图片缺少 alt：${el.selector}，请补 alt 或 role="presentation"`),
    );
  }
  return issues;
}

function detectA11yControlName(m: PageMetrics): Issue[] {
  const issues: Issue[] = [];
  for (const el of m.a11y) {
    if (el.kind !== "control") continue;
    if (el.accessibleName.trim() !== "") continue;
    issues.push(
      elementIssue(
        m,
        "a11y-control-name",
        el,
        `控件缺少可访问名：${el.selector}，请补 label / aria-label / 文本`,
      ),
    );
  }
  return issues;
}

function detectA11yLinkName(m: PageMetrics): Issue[] {
  const issues: Issue[] = [];
  for (const el of m.a11y) {
    if (el.kind !== "link") continue;
    if (el.accessibleName.trim() !== "") continue;
    issues.push(
      elementIssue(
        m,
        "a11y-link-name",
        el,
        `链接缺少可访问名：${el.selector}，请补文本或 aria-label`,
      ),
    );
  }
  return issues;
}

/**
 * Headings that step down more than one level (h1 -> h3, h2 -> h4) break the
 * reading order assistive tech builds from headings. Going UP (h3 -> h2) is
 * legal and not reported. A single heading alone is also fine — the skip is
 * only meaningful when a higher-level heading should exist before it.
 */
function detectA11yHeadingOrder(m: PageMetrics): Issue[] {
  const issues: Issue[] = [];
  let prevLevel = 0;
  let prevSelector = "";
  for (const el of m.a11y) {
    if (el.kind !== "heading" || typeof el.level !== "number") continue;
    if (prevLevel !== 0 && el.level > prevLevel + 1) {
      issues.push(
        issue({
          kind: "a11y-heading-order",
          viewport: m.viewport,
          severity: ISSUE_KIND_SEVERITY["a11y-heading-order"],
          message: `标题层级跳级：${prevSelector} (h${prevLevel}) 后直接出现 ${el.selector} (h${el.level})`,
          selector: el.selector,
          studioIds: el.studioId ? [el.studioId] : [],
        }),
      );
    }
    prevLevel = el.level;
    prevSelector = el.selector;
  }
  return issues;
}

export const a11yDetectors: ReadonlyArray<(m: PageMetrics) => Issue[]> = [
  detectA11yImageAlt,
  detectA11yControlName,
  detectA11yLinkName,
  detectA11yHeadingOrder,
];
