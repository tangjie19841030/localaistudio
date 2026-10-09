import type { ViewportName } from "./viewports.js";
import { seoDetectors } from "./seoAudit.js";
import { a11yDetectors } from "./a11yAudit.js";

/** Sub-pixel tolerance in px — avoids false positives from fractional layout rounding. */
const PX_TOLERANCE = 1;

/** Minimum intersection ratio (of the smaller element's area) that counts as a real overlap. */
const OVERLAP_AREA_RATIO = 0.25;

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One element's raw measurements, collected in the browser.
 * Plain data only — this module never touches the DOM.
 */
export interface ElementMetric {
  /** CSS-ish path, e.g. "div.card > h3:nth-child(1)". */
  selector: string;
  /** Value of data-studio-id when present — maps a DOM issue back to a Schema node. */
  studioId?: string;
  /** Trimmed text content, may be "". */
  text: string;
  scrollWidth: number;
  clientWidth: number;
  rect: ElementRect;
  /** button / a / input / select / textarea / [role=button] etc. */
  interactive: boolean;
  /** Selectors of this element's ancestors — used to exclude nesting from overlap. */
  ancestorSelectors: string[];
}

export interface PageMetrics {
  viewport: ViewportName;
  docScrollWidth: number;
  docClientWidth: number;
  elements: ElementMetric[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Per-element accessibility measurements collected in the browser (T24c §4.3). */
  a11y: A11yElementMetric[];
  /** Document-level SEO measurements collected in the browser (T24c §4.3). */
  seo: PageSeoMetrics;
}

export type A11yElementKind = "image" | "control" | "heading" | "link";

export interface A11yElementMetric {
  selector: string;
  studioId?: string;
  kind: A11yElementKind;
  /** Heading level 1-6, present only when kind === "heading". */
  level?: number;
  /** Trimmed element text content (may be empty for images / icon buttons). */
  text: string;
  /** Computed accessible name: alt / aria-label / label text / button text. */
  accessibleName: string;
}

export interface PageSeoMetrics {
  /** document.title, trimmed; "" when missing. */
  title: string;
  /** meta[name="description"] content, trimmed; "" when missing. */
  description: string;
  /** <html lang> attribute, trimmed; "" when missing. */
  lang: string;
  /** True when any <meta name="viewport"> is present in <head>. */
  viewportMeta: boolean;
  /** Number of <h1> elements in the document. */
  h1Count: number;
}

export type IssueKind =
  | "horizontal-overflow"
  | "text-truncation"
  | "overlap"
  | "console-error"
  | "page-error"
  | "request-failed"
  | "a11y-image-alt"
  | "a11y-control-name"
  | "a11y-link-name"
  | "a11y-heading-order"
  | "seo-title"
  | "seo-description"
  | "seo-h1";

export type IssueSeverity = "error" | "warn";

export interface Issue {
  kind: IssueKind;
  viewport: ViewportName;
  severity: IssueSeverity;
  /** Chinese, user-facing, actionable. */
  message: string;
  selector?: string;
  /** Overlap only: the two colliding selectors. */
  selectors?: [string, string];
  /** Affected Schema node ids, for AI repair scoping. */
  studioIds?: string[];
}

export interface IssueSummary {
  total: number;
  byKind: Record<IssueKind, number>;
  errorCount: number;
  warnCount: number;
}

export const ISSUE_KINDS: readonly IssueKind[] = [
  "horizontal-overflow",
  "text-truncation",
  "overlap",
  "console-error",
  "page-error",
  "request-failed",
  "a11y-image-alt",
  "a11y-control-name",
  "a11y-link-name",
  "a11y-heading-order",
  "seo-title",
  "seo-description",
  "seo-h1",
];

/**
 * Per-kind severity table (T24c §4.3). Detectors read from this rather than
 * hard-coding the level, so workbench repair and future reclassification stay
 * a one-line change.
 */
export const ISSUE_KIND_SEVERITY: Record<IssueKind, IssueSeverity> = {
  "horizontal-overflow": "error",
  "text-truncation": "warn",
  overlap: "warn",
  "console-error": "error",
  "page-error": "error",
  "request-failed": "warn",
  "a11y-image-alt": "error",
  "a11y-control-name": "error",
  "a11y-link-name": "error",
  "a11y-heading-order": "warn",
  "seo-title": "error",
  "seo-description": "warn",
  "seo-h1": "warn",
};

/**
 * Shared Chinese labels for every IssueKind (T24c §4.3). The workbench
 * IssueList + repair-request use these so adding a new kind needs no second
 * mapping in the UI.
 */
export const ISSUE_KIND_LABELS: Record<IssueKind, string> = {
  "horizontal-overflow": "横向溢出",
  "text-truncation": "文本截断",
  overlap: "控件重叠",
  "console-error": "控制台错误",
  "page-error": "页面异常",
  "request-failed": "请求失败",
  "a11y-image-alt": "图片缺少 alt",
  "a11y-control-name": "控件缺少可访问名",
  "a11y-link-name": "链接缺少可访问名",
  "a11y-heading-order": "标题层级跳级",
  "seo-title": "缺少页面标题",
  "seo-description": "缺少页面描述",
  "seo-h1": "h1 数量异常",
};

/** Builds an issue, dropping an empty studioIds list so equality checks stay simple. */
function issue(base: Issue & { studioIds?: string[] }): Issue {
  if (base.studioIds && base.studioIds.length === 0) {
    const { studioIds: _drop, ...rest } = base;
    return rest;
  }
  return base;
}

function detectHorizontalOverflow(m: PageMetrics): Issue[] {
  if (m.docScrollWidth <= m.docClientWidth + PX_TOLERANCE) {
    return [];
  }
  return [
    {
      kind: "horizontal-overflow",
      viewport: m.viewport,
      severity: "error",
      message: `横向溢出：页面内容宽 ${m.docScrollWidth}px 超出视口 ${m.docClientWidth}px，请为溢出容器加换行或缩放约束`,
    },
  ];
}

function detectTextTruncation(m: PageMetrics): Issue[] {
  const issues: Issue[] = [];
  for (const el of m.elements) {
    if (el.text === "" || el.scrollWidth <= el.clientWidth + PX_TOLERANCE) {
      continue;
    }
    issues.push(
      issue({
        kind: "text-truncation",
        viewport: m.viewport,
        severity: "warn",
        message: `文本截断：${el.selector}（内容宽 ${el.scrollWidth}px，可见宽 ${el.clientWidth}px）`,
        selector: el.selector,
        studioIds: el.studioId ? [el.studioId] : [],
      }),
    );
  }
  return issues;
}

function area(rect: ElementRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function intersectionArea(a: ElementRect, b: ElementRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) {
    return 0;
  }
  return w * h;
}

/** True when either element is an ancestor of the other — nesting is not an overlap. */
function isNested(a: ElementMetric, b: ElementMetric): boolean {
  return a.ancestorSelectors.includes(b.selector) || b.ancestorSelectors.includes(a.selector);
}

function overlaps(a: ElementMetric, b: ElementMetric): boolean {
  const areaA = area(a.rect);
  const areaB = area(b.rect);
  if (areaA === 0 || areaB === 0 || isNested(a, b)) {
    return false;
  }
  const overlap = intersectionArea(a.rect, b.rect);
  return overlap > Math.min(areaA, areaB) * OVERLAP_AREA_RATIO;
}

function detectOverlap(m: PageMetrics): Issue[] {
  const targets = m.elements.filter((el) => el.interactive);
  const issues: Issue[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i]!;
      const b = targets[j]!;
      if (!overlaps(a, b)) {
        continue;
      }
      issues.push(
        issue({
          kind: "overlap",
          viewport: m.viewport,
          severity: "warn",
          message: `控件重叠：${a.selector} 与 ${b.selector} 的可点击区域相交，请调整间距或布局`,
          selectors: [a.selector, b.selector],
          studioIds: [a.studioId, b.studioId].filter((id): id is string => Boolean(id)),
        }),
      );
    }
  }
  return issues;
}

/** Maps each collected log line to one issue of the given kind. */
function fromLogs(
  m: PageMetrics,
  kind: IssueKind,
  severity: IssueSeverity,
  lines: string[],
  label: string,
): Issue[] {
  return lines.map((line) => ({
    kind,
    viewport: m.viewport,
    severity,
    message: `${label}：${line}`,
  }));
}

/** Runs every detector for one viewport's metrics. Pure — no IO, no DOM. */
export function auditPage(metrics: PageMetrics): Issue[] {
  return [
    ...detectHorizontalOverflow(metrics),
    ...detectTextTruncation(metrics),
    ...detectOverlap(metrics),
    ...fromLogs(metrics, "console-error", "error", metrics.consoleErrors, "控制台错误"),
    ...fromLogs(metrics, "page-error", "error", metrics.pageErrors, "页面异常"),
    ...fromLogs(metrics, "request-failed", "warn", metrics.failedRequests, "请求失败"),
    ...a11yDetectors.flatMap((run) => run(metrics)),
    ...seoDetectors.flatMap((run) => run(metrics)),
  ];
}

/** Concatenates per-viewport audits in the order given. */
export function auditPages(metrics: PageMetrics[]): Issue[] {
  return metrics.flatMap((m) => auditPage(m));
}

function emptyByKind(): Record<IssueKind, number> {
  const byKind = {} as Record<IssueKind, number>;
  for (const kind of ISSUE_KINDS) {
    byKind[kind] = 0;
  }
  return byKind;
}

export function summarize(issues: Issue[]): IssueSummary {
  const byKind = emptyByKind();
  let errorCount = 0;
  let warnCount = 0;
  for (const it of issues) {
    byKind[it.kind] += 1;
    if (it.severity === "error") {
      errorCount += 1;
    } else {
      warnCount += 1;
    }
  }
  return { total: issues.length, byKind, errorCount, warnCount };
}

/** Deduped Schema node ids referenced by the issues — feeds patch scope.nodeIds. */
export function affectedStudioIds(issues: Issue[]): string[] {
  const seen = new Set<string>();
  for (const it of issues) {
    for (const id of it.studioIds ?? []) {
      seen.add(id);
    }
  }
  return [...seen];
}
