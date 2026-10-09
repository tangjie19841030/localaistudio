import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Browser } from "playwright-core";
import {
  VIEWPORTS,
  auditPages,
  summarize,
  type Issue,
  type IssueSummary,
  type PageMetrics,
  type ViewportName,
  type ViewportSpec,
} from "@studio/schema-core";
import { COLLECT_SCRIPT, type CollectedPage } from "./collect.js";
import { ISSUES_FILE, runDir, snapshotsDir } from "./paths.js";

export interface ShotRequest {
  /** Page to screenshot, e.g. http://127.0.0.1:5180 */
  url: string;
  /** Existing dir the runner writes `<viewport>.png` files into. */
  outDir: string;
}

export interface ShotFile {
  viewport: ViewportName;
  /** File name relative to outDir, e.g. "desktop.png". */
  file: string;
}

export interface ShotOutcome {
  shots: ShotFile[];
  metrics: PageMetrics[];
}

/**
 * Injected seam (mirrors codegen/export.ts CheckRunner): the runner owns the
 * browser AND writes the PNG bytes into `req.outDir`, returning the names it wrote.
 * Tests inject a fake that writes real bytes the same way, so no browser ever starts.
 */
export type ScreenshotRunner = (req: ShotRequest) => Promise<ShotOutcome>;

export interface VisualRunResult {
  runId: string;
  createdAt: string;
  url: string;
  issues: Issue[];
  summary: IssueSummary;
  shots: ShotFile[];
}

/** Per-viewport navigation budget. */
const NAV_TIMEOUT_MS = 30_000;

/**
 * Returns true when the URL is one the local QC pipeline is allowed to fetch.
 * Allow-list (T24c §4.4): loopback HTTP(S) + the three browser-internal
 * pseudo-protocols (data:, blob:, about:). Everything else — public hosts,
 * file:, ws: — is a non-local resource and must be aborted by the route guard.
 */
export function isLocalBrowserUrl(url: string): boolean {
  if (typeof url !== "string" || url === "") return false;
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/**
 * Installs the local-only Playwright route guard on `context`. Must be called
 * BEFORE the first page.goto so even the initial document load can only reach
 * loopback / pseudo-URLs. Aborted requests fall through to the existing
 * `requestfailed` listener as `request-failed` warnings — no extra plumbing.
 * Exported so visual-screenshots.test.ts can drive it with a fake BrowserContext.
 */
export async function installLocalOnlyGuard(
  context: import("playwright-core").BrowserContext,
): Promise<void> {
  await context.route("**/*", (route) => {
    if (isLocalBrowserUrl(route.request().url())) {
      void route.continue();
    } else {
      void route.abort("blockedbyclient");
    }
  });
}

/** Captures one viewport in a fresh context: listeners attached before navigation. */
async function captureViewport(
  browser: Browser,
  vp: ViewportSpec,
  req: ShotRequest,
): Promise<{ shot: ShotFile; metrics: PageMetrics }> {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  try {
    await installLocalOnlyGuard(context);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    // Attached BEFORE goto so nothing emitted during load is missed.
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("requestfailed", (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ""}`.trim()));

    await page.goto(req.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    const collected = (await page.evaluate(COLLECT_SCRIPT)) as CollectedPage;
    const file = `${vp.name}.png`;
    await page.screenshot({ path: join(req.outDir, file), fullPage: true });
    return {
      shot: { viewport: vp.name, file },
      metrics: { viewport: vp.name, ...collected, consoleErrors, pageErrors, failedRequests },
    };
  } finally {
    await context.close();
  }
}

/**
 * Real runner. Launches ONE headless chromium and reuses it across the three
 * viewports (spec §3); playwright-core is imported lazily so merely constructing
 * the runner (createApp does) costs nothing and starts nothing.
 */
export function createPlaywrightRunner(): ScreenshotRunner {
  return async (req) => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true });
    try {
      const shots: ShotFile[] = [];
      const metrics: PageMetrics[] = [];
      for (const vp of VIEWPORTS) {
        const result = await captureViewport(browser, vp, req);
        shots.push(result.shot);
        metrics.push(result.metrics);
      }
      return { shots, metrics };
    } finally {
      await browser.close();
    }
  };
}

/**
 * One visual check: fresh run dir → runner → pure audit → issues.json.
 * All judgement comes from schema-core; this function only orchestrates IO.
 */
export async function runVisualCheck(
  projectDir: string,
  url: string,
  runner: ScreenshotRunner,
): Promise<VisualRunResult> {
  const runId = randomUUID();
  const outDir = runDir(projectDir, runId);
  await fs.mkdir(outDir, { recursive: true });
  const outcome = await runner({ url, outDir });
  const issues = auditPages(outcome.metrics);
  const result: VisualRunResult = {
    runId,
    createdAt: new Date().toISOString(),
    url,
    issues,
    summary: summarize(issues),
    shots: outcome.shots,
  };
  await fs.writeFile(join(outDir, ISSUES_FILE), JSON.stringify(result, null, 2), "utf8");
  return result;
}

/** Reads every snapshots/<runId>/issues.json, newest first; unreadable ones are skipped. */
export async function listVisualRuns(projectDir: string): Promise<VisualRunResult[]> {
  const dir = snapshotsDir(projectDir);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const runs: VisualRunResult[] = [];
  for (const entry of entries) {
    try {
      const raw = await fs.readFile(join(dir, entry, ISSUES_FILE), "utf8");
      runs.push(JSON.parse(raw) as VisualRunResult);
    } catch (err) {
      // Skip unreadable runs so the history stays usable, but keep a visible trace
      // (mirrors versions.list behavior exactly).
      console.error(`[server] 跳过无法读取的截图批次: ${entry}（${(err as Error).message}）`);
    }
  }
  runs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return runs;
}
