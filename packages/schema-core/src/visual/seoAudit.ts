/**
 * SEO detectors split out from audit.ts so the parent stays under the 400-line
 * budget (T24c §8 escape hatch). Pure — every detector takes the per-viewport
 * metrics and returns zero or more issues. Severity comes from the shared
 * ISSUE_KIND_SEVERITY table in audit.ts, never hard-coded here.
 */
import type { Issue, PageMetrics } from "./audit.js";
import { ISSUE_KIND_SEVERITY } from "./audit.js";

function detectSeoTitle(m: PageMetrics): Issue[] {
  if (m.seo.title.trim() !== "") return [];
  return [
    {
      kind: "seo-title",
      viewport: m.viewport,
      severity: ISSUE_KIND_SEVERITY["seo-title"],
      message: "缺少页面标题：<title> 为空，请补充有意义的页面标题",
    },
  ];
}

function detectSeoDescription(m: PageMetrics): Issue[] {
  if (m.seo.description.trim() !== "") return [];
  return [
    {
      kind: "seo-description",
      viewport: m.viewport,
      severity: ISSUE_KIND_SEVERITY["seo-description"],
      message: "缺少页面描述：<meta name=\"description\"> 为空，请补充一句话描述",
    },
  ];
}

function detectSeoH1(m: PageMetrics): Issue[] {
  const { h1Count } = m.seo;
  if (h1Count === 1) return [];
  const word = h1Count === 0 ? "缺失" : `过多 (${h1Count})`;
  return [
    {
      kind: "seo-h1",
      viewport: m.viewport,
      severity: ISSUE_KIND_SEVERITY["seo-h1"],
      message: `h1 数量异常：${word}，页面应只有一个 <h1>`,
    },
  ];
}

export const seoDetectors: ReadonlyArray<(m: PageMetrics) => Issue[]> = [
  detectSeoTitle,
  detectSeoDescription,
  detectSeoH1,
];
