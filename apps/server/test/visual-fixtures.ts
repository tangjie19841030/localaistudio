import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { A11yElementMetric, ElementMetric, PageMetrics, PageSeoMetrics } from "@studio/schema-core";
import { ISSUES_FILE, runDir } from "../src/visual/paths.js";
import type { ScreenshotRunner, ShotFile, ShotRequest, VisualRunResult } from "../src/visual/screenshots.js";

export const RUN_ID_A = "aaaaaaaa-1111-4111-8111-111111111111";
export const RUN_ID_B = "bbbbbbbb-2222-4222-8222-222222222222";

/** Smallest valid 1x1 PNG — asserts the route really serves image bytes. */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

function element(over: Partial<ElementMetric>): ElementMetric {
  return {
    selector: "div > h3",
    text: "标题",
    scrollWidth: 100,
    clientWidth: 100,
    rect: { x: 0, y: 0, width: 100, height: 20 },
    interactive: false,
    ancestorSelectors: ["div"],
    ...over,
  };
}

/** Healthy a11y / seo fixtures so the audit doesn't accidentally add issues
 *  that would change the legacy 3-issue / 2-error / 1-warn contract. */
function cleanA11y(): A11yElementMetric[] {
  return [
    { selector: "body > h1", kind: "heading", level: 1, text: "标题", accessibleName: "标题" },
    { selector: "body > img", kind: "image", text: "", accessibleName: "logo" },
    { selector: "body > button", kind: "control", text: "提交", accessibleName: "提交" },
    { selector: "body > a", kind: "link", text: "了解更多", accessibleName: "了解更多" },
  ];
}

function cleanSeo(): PageSeoMetrics {
  return {
    title: "运营工作台",
    description: "面向运营的本地工作台",
    lang: "zh-CN",
    viewportMeta: true,
    h1Count: 1,
  };
}

/**
 * Fixed metrics crafted to yield exactly three issues across the run:
 * mobile 横向溢出(error) + tablet 文本截断(warn) + mobile 控制台错误(error).
 */
export function fixedMetrics(): PageMetrics[] {
  const clean = { docScrollWidth: 1440, docClientWidth: 1440, consoleErrors: [], pageErrors: [], failedRequests: [] };
  return [
    { viewport: "desktop", ...clean, elements: [element({})], a11y: cleanA11y(), seo: cleanSeo() },
    {
      viewport: "tablet",
      ...clean,
      docScrollWidth: 1024,
      docClientWidth: 1024,
      elements: [element({ selector: "section > h3", studioId: "node-title", scrollWidth: 320, clientWidth: 200 })],
      a11y: cleanA11y(),
      seo: cleanSeo(),
    },
    {
      viewport: "mobile",
      docScrollWidth: 520,
      docClientWidth: 390,
      elements: [element({})],
      consoleErrors: ["Uncaught TypeError: x is not a function"],
      pageErrors: [],
      failedRequests: [],
      a11y: cleanA11y(),
      seo: cleanSeo(),
    },
  ];
}

export interface FakeRunner {
  run: ScreenshotRunner;
  calls: ShotRequest[];
}

/** Fake runner: writes real PNG bytes into outDir; never touches a browser. */
export function fakeRunner(): FakeRunner {
  const calls: ShotRequest[] = [];
  const run: ScreenshotRunner = async (req) => {
    calls.push(req);
    const metrics = fixedMetrics();
    const shots: ShotFile[] = [];
    for (const m of metrics) {
      const file = `${m.viewport}.png`;
      await fs.writeFile(join(req.outDir, file), PNG_1X1);
      shots.push({ viewport: m.viewport, file });
    }
    return { shots, metrics };
  };
  return { run, calls };
}

/** Writes a minimal run fixture (issues.json + one PNG) straight to disk. */
export async function writeRunFixture(
  projectDir: string,
  runId: string,
  createdAt: string,
): Promise<VisualRunResult> {
  const dir = runDir(projectDir, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "desktop.png"), PNG_1X1);
  const record: VisualRunResult = {
    runId,
    createdAt,
    url: "http://127.0.0.1:5180",
    issues: [],
    summary: {
      total: 0,
      byKind: {
        "horizontal-overflow": 0,
        "text-truncation": 0,
        overlap: 0,
        "console-error": 0,
        "page-error": 0,
        "request-failed": 0,
        "a11y-image-alt": 0,
        "a11y-control-name": 0,
        "a11y-link-name": 0,
        "a11y-heading-order": 0,
        "seo-title": 0,
        "seo-description": 0,
        "seo-h1": 0,
      },
      errorCount: 0,
      warnCount: 0,
    },
    shots: [{ viewport: "desktop", file: "desktop.png" }],
  };
  await fs.writeFile(join(dir, ISSUES_FILE), JSON.stringify(record, null, 2), "utf8");
  return record;
}
